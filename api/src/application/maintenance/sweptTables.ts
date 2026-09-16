/**
 * SWEPT_TABLES — the append-only diagnostic/telemetry relations the platform
 * maintains on a schedule, declared ONCE.
 *
 * WHY A REGISTRY. Two sweeps act on exactly the same set of tables and used to
 * name them separately: {@link runRetentionPurge} deletes rows past their window,
 * and the table-maintenance sweep vacuums the space those deletes free. A table
 * added to one list and forgotten in the other is the failure this prevents —
 * retention without a vacuum caps row COUNT while the on-disk size keeps climbing
 * (the `manager_actions` case: 46k live rows in a 593 MB relation), and a vacuum
 * without retention has nothing to reclaim.
 *
 * MEMBERSHIP IS THE PERMISSION, AND IT GRANTS TWO THINGS SEPARATELY. Almost
 * everything here is a diagnostic/event log with no business records and a
 * best-effort writer, which is what makes both operations safe: deletion never
 * cascades to domain data, and an exclusive-lock rewrite can briefly block writers
 * that are explicitly allowed to fail. Two entries qualify for only part of that and
 * say so in their own declaration rather than by sitting outside the registry:
 * `activity_log` is the audit trail, so its `purge` is a PREDICATE naming only the
 * anonymous visitor rows and it is `reclaimable: false` (vacuumed, never rewritten);
 * `llm_usage_log` is the billing ledger, so it is bounded by a `rollup` and its
 * `retentionDays` is a three-year backstop rather than the policy. Domain data with a
 * row-level expiry (lapsed agent memories) remains deliberately OUT — it is purged by
 * its own policy in retentionPurge.ts and never rewritten.
 *
 * CROSS-TENANT BY CONSTRUCTION. A retention window is a platform policy, not a
 * tenant one, so these deletes deliberately carry no tenant predicate — declared as
 * `acrossTenants(t, 'scheduled_sweep', …)` on the six relations that own a
 * `tenantId`, which states the reason in the statement instead of filing a
 * deliberate decision in the frozen-debt baseline beside the accidents.
 *
 * ADDING A LOG TABLE: append an entry. Retention, vacuum and the per-table
 * autovacuum tuning guard (`npm run check:swept-tables`) all pick it up.
 */
import { and, eq, isNotNull, lt, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { rollUpToolAudit, TOOL_AUDIT_ROLLUP_AFTER_DAYS } from './toolAuditRollup';
import { rollUpLlmUsage, LLM_USAGE_ROLLUP_AFTER_DAYS } from './llmUsageRollup';
import { VISITOR_RETENTION_DAYS, purgeVisitorActivity } from '../marketing/visitorActivity';
import {
  activitySignals,
  apiErrorLog,
  brainChatTrace,
  errorEvents,
  executionLifecycleOutbox,
  ingestionUsageLog,
  executionRollbacks,
  integrationSyncLogs,
  llmFailoverLog,
  llmHealthProbes,
  llmTraces,
  llmUsageLog,
  managerActions,
  prReconciliationErrors,
  prReconciliationItems,
  prReconciliationRuns,
  qaJourneyEvents,
  toolAuditDaily,
  toolAuditEvents,
} from '../../infrastructure/database/schema';

/** Which Neon database a relation lives in — they are separate endpoints. */
export type SweptConnection = 'primary' | 'transactional';

export interface SweptTable {
  /** Physical relation name. This is the identifier `VACUUM` and `pg_class` use, so
   *  it must match the table's `pgTable(...)` name, not the Drizzle export. */
  relation: string;
  /** Every endpoint the relation physically exists on.
   *
   *  USUALLY ONE. Four of these tables are the exception: `llm_*` and `api_error_log`
   *  were born on the primary database and their writers moved to the transactional
   *  endpoint when it was split out (2026-07-13). The relations were never dropped from
   *  primary, so a copy went on sitting there with no writer AND no sweep — 35 MB of
   *  rows frozen at the date of the split, invisible to a registry that could name only
   *  one endpoint per table. Declaring the endpoints as a LIST is what closes that hole:
   *  purge and vacuum both iterate it, so a dual-resident relation cannot be swept on
   *  one endpoint and forgotten on the other. */
  connections: readonly SweptConnection[];
  /** Days of history kept before older rows are purged. */
  retentionDays: number;
  /**
   * The SHORTEST window this table may be purged to while the database is under
   * storage pressure — never below what a live consumer can still reach.
   *
   * WHY A SECOND NUMBER RATHER THAN JUST A SMALLER `retentionDays`. The steady-state
   * window is chosen for what someone might want; this one is chosen for what
   * something would BREAK without. They are different questions and only the second
   * is safe to apply automatically. `runStoragePressureSweep` compresses each table
   * from `retentionDays` toward this floor as the endpoint fills, so a sweep run at
   * 95% can never delete a compliance window, an unbilled meter period or a run
   * diagnostic that a live surface still reads — the floor is the statement of what
   * that is, per table, beside the window it defends.
   *
   * Omitted = the table is NOT compressible and is purged on `retentionDays` at every
   * pressure tier. That is the right declaration for a relation whose window is set by
   * an external obligation rather than by taste.
   */
  pressureFloorDays?: number;
  /**
   * May the weekly bloat reclaim REWRITE this relation? Default true.
   *
   * WHY THE TWO OPERATIONS COME APART HERE. The registry's opening claim is that
   * membership is the permission, and that it is safe because every member is a
   * diagnostic log whose writer is explicitly allowed to fail — so an ACCESS EXCLUSIVE
   * rewrite that briefly blocks it costs a log line. `activity_log` breaks exactly half
   * of that: its writer IS best-effort (`recordActivity` swallows its own errors), but
   * what it would lose is an AUDIT line, and an audit trail with a hole in it is worse
   * than a large one. It still needs the other half — plain `VACUUM (ANALYZE)` takes no
   * exclusive lock, and without it a table that is being deleted from keeps its
   * high-water mark forever, which is the precise failure this registry was written to
   * stop.
   *
   * So: `false` means retention and plain vacuum, never a rewrite. A relation marked
   * this way can still be rewritten deliberately from the superadmin maintenance route,
   * where a person chose the moment.
   */
  reclaimable?: boolean;
  /** Why this window and not another — the reasoning that used to live inline. */
  rationale: string;
  /** Delete rows older than `cutoff`. Takes the db for its own connection. */
  purge: (db: Db, cutoff: Date) => Promise<unknown>;
  /**
   * Optional COLUMN-level retention, on a shorter window than the row's.
   *
   * WHY A SECOND WINDOW. On some of these relations the fat part of a row and the useful
   * part have very different lifespans. `tool_audit_events` is the case that motivated
   * this: it is retained 90 days because the SOC 2 evidence export reads up to 90 days —
   * but that export, and the compliance summary beside it, select only `ts`, `toolName`,
   * `category`, `agentHostId`, `cloudAgentRef`, `executionId` and `durationMs`. The
   * `args` and `result` payloads they never touch were 186 MB of a 298 MB table: 62% of
   * it, and 20% of the whole database, kept solely because the narrow columns beside them
   * had to be.
   *
   * Blanking the payload past a shorter window keeps the compliance record complete for
   * its full 90 days at a third of the size. It is deliberately a SEPARATE knob from
   * `retentionDays` rather than a shorter retention: dropping the ROW would break the
   * evidence pack, and that is exactly the trade this exists to avoid making.
   */
  redact?: {
    /** Days before the payload columns are blanked — must be < `retentionDays`. */
    afterDays: number;
    /** What the payload is and why nothing needs it past the window. */
    rationale: string;
    /** Blank the payload on rows older than `cutoff`, leaving the row itself intact. */
    run: (db: Db, cutoff: Date) => Promise<unknown>;
  };
  /**
   * Optional GRAIN-level retention — the third and last stage.
   *
   * WHY A THIRD KNOB. `redact` shrinks a row and `purge` deletes it, and on
   * `tool_audit_events` neither could touch the actual cost. Redaction already took it
   * from 298 MB to 176 MB and then stopped, because what remained was 665,010 NARROW
   * rows: the cost was the row COUNT, and the count could not come down while the 90-day
   * evidence window required the rows to exist.
   *
   * A rollup resolves that by changing what "the row" means. Every figure the consumers
   * compute is a sum over a handful of dimensions, so a day of calls folded to one row
   * per (dimension set) preserves all of them — measured 170:1 — and the fold is itself
   * an audit artifact: this agent called this tool this many times on this day. What is
   * lost is the ability to cite ONE call.
   *
   * ORDERING IS THE SAFETY PROPERTY: `redact.afterDays` < `rollup.afterDays` <
   * `retentionDays`. A row is folded only after its payload has already been blanked, so
   * the fold discards a row with nothing left in it but the dimensions the tally keeps.
   * `retentionPurge.test.ts` enforces the chain.
   */
  rollup?: {
    /** Days before rows are folded to a coarser grain — must be > `redact.afterDays`
     *  and < `retentionDays`. */
    afterDays: number;
    /** What grain the fold lands on and which figures survive it unchanged. */
    rationale: string;
    /** Fold rows older than `cutoff` into their summary relation and remove them. */
    run: (db: Db, cutoff: Date) => Promise<unknown>;
  };
}

export const SWEPT_TABLES: readonly SweptTable[] = [
  {
    relation: 'llm_traces',
    connections: ['transactional', 'primary'],
    retentionDays: 30,
    pressureFloorDays: 7,
    // The one relation here that is UPDATEd after insert (a stream finalises its row),
    // which is why migration 1104 gives it a fillfactor and the others none.
    rationale: 'Per-call LLM trace stream; the cost panels never look further back than 30d.',
    purge: (db, cutoff) => db.delete(llmTraces).where(acrossTenants(llmTraces, 'scheduled_sweep', lt(llmTraces.createdAt, cutoff))),
    redact: {
      afterDays: 7,
      rationale:
        'The verbatim `request_body` (the whole message array), `response_body` and the per-attempt '
        + '`attempts` blob. This relation is the operational endpoint what `tool_audit_events` is to the '
        + 'primary one: the ROW is narrow and cheap — identity, routing chain, status, timings, tokens — '
        + 'and three text columns beside it were the entire cost, because every LLM call on every surface '
        + "writes one and an agentic turn's request body IS the context window. "
        + 'Nothing reads either body past the live-debugging window: the cost panels, the per-run token '
        + 'breakdown and the routing diagnostics all project the narrow columns, and `request_shape` — '
        + 'kept — is the compact summary of the request a superadmin actually reasons about. So the same '
        + 'trade `tool_audit_events` already makes applies here: blank the payload, keep the trace '
        + 'COMPLETE as a routing record for its full 30 days at a fraction of the width. '
        + '7d is the window in which anyone opens a body at all — a live incident, or a cascade that '
        + 'misbehaved this week.',
      run: (db, cutoff) => db.update(llmTraces)
        .set({ requestBody: null, responseBody: null, attempts: null })
        .where(acrossTenants(
          llmTraces, 'scheduled_sweep',
          and(
            lt(llmTraces.createdAt, cutoff),
            // Only rows that still carry a payload, so a re-run is a no-op rather than
            // rewriting every old row — and its page — on every nightly tick.
            or(isNotNull(llmTraces.requestBody), isNotNull(llmTraces.responseBody), isNotNull(llmTraces.attempts)),
          ),
        )),
    },
  },
  {
    relation: 'llm_usage_log',
    connections: ['transactional', 'primary'],
    retentionDays: 1200,
    // NO pressure floor, deliberately. This is the billing ledger, and "the database is
    // getting full" is never a reason to shorten how long the platform can answer what a
    // customer was charged. The relation is bounded by the FOLD below instead, which
    // costs no figure anything.
    rationale:
      'The billing ledger — a row per LLM call, on every surface, and the operational '
      + "endpoint's steadiest unbounded grower. It had NO entry here at all: no purge and, "
      + 'just as expensive, no vacuum, so its pages only ever extended. The window is long '
      + 'on purpose (a shade over three years) and is a BACKSTOP rather than the policy: '
      + 'what actually bounds this relation is `rollup`, which costs no reader a figure, '
      + 'and by the time a folded tally is this old every consumer of it is long gone.',
    purge: (db, cutoff) => db.delete(llmUsageLog).where(acrossTenants(llmUsageLog, 'scheduled_sweep', lt(llmUsageLog.createdAt, cutoff))),
    rollup: {
      afterDays: LLM_USAGE_ROLLUP_AFTER_DAYS,
      rationale:
        'Folds a day of calls IN PLACE to one row per (tenant, user, model, project, task, '
        + 'execution, chat, …) — the same relation, not a sibling table, because thirty-odd '
        + 'readers aggregate this one and a tally they did not know about would make every '
        + 'long-window cost figure silently under-report. Every dimension they group by and '
        + 'every quantity they sum survives; what goes is `trace_id` (dangling anyway once '
        + '`llm_traces` is purged at 30d), `idempotency_key` (a 10-minute guard), `metadata`, '
        + 'and the row COUNT — which is why `calls` is a column and why request counts read '
        + 'through `usageRequestCount()`.',
      run: (db, cutoff) => rollUpLlmUsage(db, cutoff),
    },
  },
  {
    relation: 'ingestion_usage_log',
    connections: ['transactional', 'primary'],
    retentionDays: 400,
    pressureFloorDays: 45,
    rationale:
      'The non-token half of the consumption meter — bytes processed per repo import / '
      + 'integration sync. Narrow rows and a far lower write rate than the token ledger '
      + 'beside it, but it was unswept for the same reason and on the same endpoint. 400d '
      + 'keeps a full annual comparison of ingestion volume; the floor stays well clear of '
      + "the meter's month-to-date window, so a compressed sweep can never disturb an "
      + 'allowance that is still being counted.',
    purge: (db, cutoff) => db.delete(ingestionUsageLog).where(acrossTenants(ingestionUsageLog, 'scheduled_sweep', lt(ingestionUsageLog.createdAt, cutoff))),
  },
  {
    relation: 'llm_failover_log',
    connections: ['transactional', 'primary'],
    retentionDays: 30,
    pressureFloorDays: 7,
    rationale: 'Routing failover events, read only while diagnosing a live routing incident.',
    purge: (db, cutoff) => db.delete(llmFailoverLog).where(acrossTenants(llmFailoverLog, 'scheduled_sweep', lt(llmFailoverLog.createdAt, cutoff))),
  },
  {
    relation: 'llm_health_probes',
    connections: ['transactional', 'primary'],
    retentionDays: 180,
    pressureFloorDays: 30,
    rationale: 'Vendor health history — the long window is the point; it is what makes a vendor trend readable.',
    purge: (db, cutoff) => db.delete(llmHealthProbes).where(lt(llmHealthProbes.createdAt, cutoff)),
  },
  {
    relation: 'api_error_log',
    connections: ['transactional', 'primary'],
    retentionDays: 30,
    pressureFloorDays: 7,
    rationale:
      "The platform's OWN caught/unhandled exception stream (persistCaughtError). Its write rate rose "
      + 'sharply once every handled catch reported here, so it is one of the fastest-growing tables; 30d '
      + 'matches the superadmin Logs page, which never looks further back.',
    purge: (db, cutoff) => db.delete(apiErrorLog).where(lt(apiErrorLog.createdAt, cutoff)),
  },
  {
    relation: 'qa_journey_events',
    connections: ['primary'],
    retentionDays: 90,
    pressureFloorDays: 14,
    rationale: 'QA journey telemetry, swept on the same window as the other event streams.',
    purge: (db, cutoff) => db.delete(qaJourneyEvents).where(acrossTenants(qaJourneyEvents, 'scheduled_sweep', lt(qaJourneyEvents.ts, cutoff))),
  },
  {
    relation: 'error_events',
    connections: ['primary'],
    retentionDays: 90,
    pressureFloorDays: 45,
    rationale:
      'Raw Quality error events — group aggregates (error_groups) are kept forever, only the raw stream is '
      + "swept. 90d is safely > the consumption meter's month-to-date window, so error-event billing is "
      + 'never affected by the purge.',
    purge: (db, cutoff) => db.delete(errorEvents).where(acrossTenants(errorEvents, 'scheduled_sweep', lt(errorEvents.createdAt, cutoff))),
  },
  {
    relation: 'manager_actions',
    connections: ['primary'],
    retentionDays: 30,
    pressureFloorDays: 7,
    rationale:
      'The manager-decision FEED (cron + "Run manager now" telemetry) — the platform\'s highest-write '
      + 'table and the one that proved this registry necessary: it had retention but no vacuum, so 46k '
      + 'live rows sat inside 593 MB of page bloat autovacuum never returned to the OS.',
    purge: (db, cutoff) => db.delete(managerActions).where(acrossTenants(managerActions, 'scheduled_sweep', lt(managerActions.createdAt, cutoff))),
  },
  {
    relation: 'tool_audit_events',
    connections: ['primary'],
    retentionDays: 90,
    rationale:
      'Agent tool-audit timeline. The 90d window is NOT arbitrary and must not be shortened to '
      + 'save space: it is the window the SOC 2 evidence export reads (`insights/complianceInsights.ts` '
      + '→ `buildEvidencePack`, `parseDays(…, 90)`). Shrink the ROW instead (`redact`), then the '
      + 'GRAIN (`rollup`) — both below. In practice `rollup` at 45d is what bounds this relation and '
      + 'this window is the backstop that still holds if a fold ever fails.',
    purge: (db, cutoff) => db.delete(toolAuditEvents).where(acrossTenants(toolAuditEvents, 'scheduled_sweep', lt(toolAuditEvents.createdAt, cutoff))),
    redact: {
      afterDays: 14,
      rationale:
        'The verbatim tool `args`/`result` payloads. No consumer reads either column past the live '
        + 'timeline: the compliance summary and the evidence pack both project only ts, tool, category, '
        + 'agent, execution and duration. At 154 + 139 bytes average they were 186 MB of a 298 MB '
        + 'relation, so blanking them keeps the compliance evidence COMPLETE while returning ~20% of '
        + 'the entire database. The window was 30d until `rollup` arrived below and made that a dead '
        + 'knob — a fold at 30d drops the whole row first, so redaction at the same boundary would '
        + 'never have found one. 14d is the window in which anyone actually reads a payload: a live '
        + 'run, or a skip reason quoted off the lifecycle ledger.',
      run: (db, cutoff) => db.update(toolAuditEvents)
        .set({ args: null, result: null })
        .where(acrossTenants(
          toolAuditEvents, 'scheduled_sweep',
          and(
            lt(toolAuditEvents.createdAt, cutoff),
            // Only rows that still carry a payload, so a re-run is a no-op rather than
            // rewriting every old row — and its page — on every nightly tick.
            or(isNotNull(toolAuditEvents.args), isNotNull(toolAuditEvents.result)),
          ),
        )),
    },
    rollup: {
      afterDays: TOOL_AUDIT_ROLLUP_AFTER_DAYS,
      rationale:
        'Folds a day of tool calls to one row per (tenant, day, tool, category, agent) in '
        + '`tool_audit_daily`. That is exactly the grain the compliance summary and the evidence '
        + 'pack aggregate to, so volume, sensitive-action count, the per-tool/per-category/per-agent '
        + 'breakdowns and duration all come out unchanged — measured 188:1 in production '
        + '(651,664 rows → 3,464 tallies; 176 MB → 11 MB). What it gives up is citing ONE call older than the '
        + 'boundary, by which point `redact` has already emptied that row of everything but the '
        + 'dimensions the tally keeps.',
      run: (db, cutoff) => rollUpToolAudit(db, cutoff),
    },
  },
  {
    relation: 'tool_audit_daily',
    connections: ['primary'],
    retentionDays: 400,
    rationale:
      'The compliance record `tool_audit_events` becomes at 45 days. Retained far LONGER than its '
      + 'source on purpose — a full annual audit period plus the lookback an auditor asks for — '
      + 'which is affordable precisely because it is ~4k rows per quarter rather than 665k. It is in '
      + 'this registry for the vacuum half as much as the purge: unlike every other member it is '
      + 'UPDATEd in place (a re-fold adds to a tally), so it accrues dead tuples without the tuning.',
    purge: (db, cutoff) => db.delete(toolAuditDaily).where(acrossTenants(toolAuditDaily, 'scheduled_sweep', lt(toolAuditDaily.createdAt, cutoff))),
  },
  {
    relation: 'pr_reconciliation_items',
    connections: ['primary'],
    retentionDays: 14,
    pressureFloorDays: 3,
    rationale:
      'The PR reconciler stores a FULL snapshot of every open PR on every run, and the sweep '
      + 're-runs a repo every ~4 minutes — 868 runs/day, ~725 rows each. That wrote 1.42M rows '
      + 'covering only 758 distinct PRs and made this the largest object in the database at '
      + '1.84 GB (66% of it) with no retention policy at all. The read surface is far narrower '
      + 'than the window: items are only ever fetched for ONE run id, and the run list itself '
      + 'returns the 25 most recent (100 max) — a few hours of history. 14d is therefore ~50x '
      + 'what any consumer can reach, and still bounds the table at roughly 180k rows.',
    purge: (db, cutoff) => db.delete(prReconciliationItems).where(acrossTenants(prReconciliationItems, 'scheduled_sweep', lt(prReconciliationItems.createdAt, cutoff))),
  },
  {
    relation: 'pr_reconciliation_errors',
    connections: ['primary'],
    retentionDays: 14,
    pressureFloorDays: 3,
    rationale: 'Per-run reconciliation failures, read from the same run-scoped diagnostics view as the items above — same window.',
    purge: (db, cutoff) => db.delete(prReconciliationErrors).where(acrossTenants(prReconciliationErrors, 'scheduled_sweep', lt(prReconciliationErrors.createdAt, cutoff))),
  },
  {
    relation: 'pr_reconciliation_runs',
    connections: ['primary'],
    retentionDays: 14,
    pressureFloorDays: 3,
    // Purged LAST of the three: items and errors both cascade from this row, so deleting
    // the parent first would make the two sweeps above no-ops and hide a growing child
    // table behind a run count that looks healthy.
    rationale: 'The run header for the two relations above. Same window, so a run and its findings expire together.',
    purge: (db, cutoff) => db.delete(prReconciliationRuns).where(acrossTenants(prReconciliationRuns, 'scheduled_sweep', lt(prReconciliationRuns.startedAt, cutoff))),
  },
  {
    relation: 'execution_lifecycle_outbox',
    connections: ['primary'],
    retentionDays: 30,
    pressureFloorDays: 3,
    // The ONE entry here whose purge is not purely age-based, and it must stay that way:
    // this is a delivery outbox, not a pure log. A `pending` or `processing` row is work
    // that has not happened yet, so age alone must never delete it — only a row the
    // dispatcher already marked `done` is spent and safe to drop.
    rationale:
      'Spent execution-lifecycle events. 72k of its 80k rows are `done` and hold 49 MB that '
      + 'nothing reads once delivered; the undelivered remainder is deliberately never swept.',
    purge: (db, cutoff) => db.delete(executionLifecycleOutbox).where(acrossTenants(
      executionLifecycleOutbox, 'scheduled_sweep',
      and(eq(executionLifecycleOutbox.status, 'done'), lt(executionLifecycleOutbox.createdAt, cutoff)),
    )),
  },
  {
    relation: 'execution_rollbacks',
    connections: ['primary'],
    retentionDays: 30,
    pressureFloorDays: 7,
    rationale:
      'Undo records for a cloud run (`undo_payload` jsonb is most of the 24 MB). Nothing '
      + 'references this table, and a rollback is only ever actioned while the run it undoes is '
      + 'recent — every one of its 18,199 rows was already older than 30d, the residue of the '
      + 'runaway dispatch loop. Safe to sweep: the `executions` row it points at is untouched, '
      + 'and that FK is ON DELETE SET NULL in the other direction only.',
    purge: (db, cutoff) => db.delete(executionRollbacks).where(acrossTenants(executionRollbacks, 'scheduled_sweep', lt(executionRollbacks.createdAt, cutoff))),
  },
  {
    relation: 'activity_signals',
    connections: ['primary'],
    retentionDays: 30,
    pressureFloorDays: 7,
    rationale:
      'Raw presence/engagement telemetry — 90% of it `heartbeat`, whose only consumer is the '
      + '"who is active now" read. The contributor rollups are materialised elsewhere and do not '
      + 'read this stream retrospectively, so the 90d window it started on bought nothing; 30d '
      + 'matches how far back presence is ever asked about.',
    purge: (db, cutoff) => db.delete(activitySignals).where(acrossTenants(activitySignals, 'scheduled_sweep', lt(activitySignals.createdAt, cutoff))),
  },
  {
    relation: 'activity_log',
    connections: ['transactional', 'primary'],
    retentionDays: VISITOR_RETENTION_DAYS,
    // No pressure floor and NOT reclaimable: see `reclaimable` above, and note that the
    // window below is not really this table's — it belongs to the visitor rows the
    // predicate names, and compressing it would shorten a funnel history to save space
    // on rows it is not even deleting.
    reclaimable: false,
    rationale:
      'THE AUDIT TRAIL, and the one member here that is not a pure log — which is why its '
      + '`purge` is predicate-scoped rather than age-scoped. It deletes ONLY the anonymous '
      + 'visitor journey (migration 1111), on the window declared beside the writer that '
      + "produces it; every other actor's events are kept indefinitely and this sweep never "
      + 'touches them. It is in the registry for the VACUUM half as much as the purge: the '
      + 'visitor purge was already deleting rows here and nothing vacuumed the relation '
      + 'afterwards, which is retention-without-a-vacuum — the exact shape that left 46k live '
      + '`manager_actions` rows inside 593 MB.',
    purge: (db, cutoff) => purgeVisitorActivity(db, cutoff),
  },
  {
    relation: 'brain_chat_trace',
    connections: ['primary'],
    retentionDays: 90,
    pressureFloorDays: 14,
    // No tenant predicate to declare: this table is keyed by chat, not tenant, so there is
    // no tenantId column for acrossTenants() to be scoped against in the first place.
    rationale: 'Per-turn Brain reasoning trace (llm/tool/recall/learn steps). Backs the expandable trace on a chat turn, which nobody opens on a chat older than a quarter.',
    purge: (db, cutoff) => db.delete(brainChatTrace).where(lt(brainChatTrace.createdAt, cutoff)),
  },
  {
    relation: 'integration_sync_logs',
    connections: ['primary'],
    retentionDays: 90,
    pressureFloorDays: 14,
    rationale: 'Per-sync connector run log, read only while diagnosing a failing integration. Aged by `started_at` — the row is written when the sync begins.',
    purge: (db, cutoff) => db.delete(integrationSyncLogs).where(acrossTenants(integrationSyncLogs, 'scheduled_sweep', lt(integrationSyncLogs.startedAt, cutoff))),
  },
];

/**
 * The relations on one connection the weekly rewrite may take an exclusive lock on.
 *
 * Narrower than the registry itself, on purpose. "What does the daily plain VACUUM
 * cover" is every member, and `runTableVacuum` answers it by walking `SWEPT_TABLES`
 * directly — there was a `sweptRelations()` helper for that question with no callers
 * left, so it is gone rather than kept as a second way to say `SWEPT_TABLES`. This
 * answers the different question: what may be REWRITTEN. See {@link SweptTable.reclaimable}.
 */
export function reclaimableRelations(connection: SweptConnection): string[] {
  return SWEPT_TABLES
    .filter((t) => t.connections.includes(connection) && t.reclaimable !== false)
    .map((t) => t.relation);
}
