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
 * MEMBERSHIP IS THE PERMISSION. Everything here is a diagnostic/event log with no
 * business records and a best-effort writer, which is what makes both operations
 * safe: deletion never cascades to domain data, and an exclusive-lock rewrite can
 * briefly block writers that are explicitly allowed to fail. Domain data with a
 * row-level expiry (lapsed agent memories) is deliberately NOT in this registry —
 * it is purged by its own policy in retentionPurge.ts and never rewritten.
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
import {
  activitySignals,
  apiErrorLog,
  brainChatTrace,
  errorEvents,
  executionLifecycleOutbox,
  integrationSyncLogs,
  llmFailoverLog,
  llmHealthProbes,
  llmTraces,
  managerActions,
  prReconciliationErrors,
  prReconciliationItems,
  prReconciliationRuns,
  qaJourneyEvents,
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
}

export const SWEPT_TABLES: readonly SweptTable[] = [
  {
    relation: 'llm_traces',
    connections: ['transactional', 'primary'],
    retentionDays: 30,
    // The one relation here that is UPDATEd after insert (a stream finalises its row),
    // which is why migration 1104 gives it a fillfactor and the others none.
    rationale: 'Per-call LLM trace stream; the cost panels never look further back than 30d.',
    purge: (db, cutoff) => db.delete(llmTraces).where(acrossTenants(llmTraces, 'scheduled_sweep', lt(llmTraces.createdAt, cutoff))),
  },
  {
    relation: 'llm_failover_log',
    connections: ['transactional', 'primary'],
    retentionDays: 30,
    rationale: 'Routing failover events, read only while diagnosing a live routing incident.',
    purge: (db, cutoff) => db.delete(llmFailoverLog).where(acrossTenants(llmFailoverLog, 'scheduled_sweep', lt(llmFailoverLog.createdAt, cutoff))),
  },
  {
    relation: 'llm_health_probes',
    connections: ['transactional', 'primary'],
    retentionDays: 180,
    rationale: 'Vendor health history — the long window is the point; it is what makes a vendor trend readable.',
    purge: (db, cutoff) => db.delete(llmHealthProbes).where(lt(llmHealthProbes.createdAt, cutoff)),
  },
  {
    relation: 'api_error_log',
    connections: ['transactional', 'primary'],
    retentionDays: 30,
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
    rationale: 'QA journey telemetry, swept on the same window as the other event streams.',
    purge: (db, cutoff) => db.delete(qaJourneyEvents).where(acrossTenants(qaJourneyEvents, 'scheduled_sweep', lt(qaJourneyEvents.ts, cutoff))),
  },
  {
    relation: 'error_events',
    connections: ['primary'],
    retentionDays: 90,
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
      + '→ `buildEvidencePack`, `parseDays(…, 90)`). Shrink the ROW instead — see `redact` below.',
    purge: (db, cutoff) => db.delete(toolAuditEvents).where(acrossTenants(toolAuditEvents, 'scheduled_sweep', lt(toolAuditEvents.createdAt, cutoff))),
    redact: {
      afterDays: 30,
      rationale:
        'The verbatim tool `args`/`result` payloads. No consumer reads either column past the live '
        + 'timeline: the compliance summary and the evidence pack both project only ts, tool, category, '
        + 'agent, execution and duration. At 154 + 139 bytes average they were 186 MB of a 298 MB '
        + 'relation, so blanking them past 30d keeps 90 days of COMPLETE compliance evidence while '
        + 'returning ~20% of the entire database.',
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
  },
  {
    relation: 'pr_reconciliation_items',
    connections: ['primary'],
    retentionDays: 14,
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
    rationale: 'Per-run reconciliation failures, read from the same run-scoped diagnostics view as the items above — same window.',
    purge: (db, cutoff) => db.delete(prReconciliationErrors).where(acrossTenants(prReconciliationErrors, 'scheduled_sweep', lt(prReconciliationErrors.createdAt, cutoff))),
  },
  {
    relation: 'pr_reconciliation_runs',
    connections: ['primary'],
    retentionDays: 14,
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
    relation: 'activity_signals',
    connections: ['primary'],
    retentionDays: 90,
    rationale:
      'Raw presence/engagement telemetry — 90% of it `heartbeat`. The contributor rollups that '
      + 'consume it are materialised elsewhere, so only the raw stream is swept, on the same 90d '
      + 'window as the other event feeds.',
    purge: (db, cutoff) => db.delete(activitySignals).where(acrossTenants(activitySignals, 'scheduled_sweep', lt(activitySignals.createdAt, cutoff))),
  },
  {
    relation: 'brain_chat_trace',
    connections: ['primary'],
    retentionDays: 90,
    // No tenant predicate to declare: this table is keyed by chat, not tenant, so there is
    // no tenantId column for acrossTenants() to be scoped against in the first place.
    rationale: 'Per-turn Brain reasoning trace (llm/tool/recall/learn steps). Backs the expandable trace on a chat turn, which nobody opens on a chat older than a quarter.',
    purge: (db, cutoff) => db.delete(brainChatTrace).where(lt(brainChatTrace.createdAt, cutoff)),
  },
  {
    relation: 'integration_sync_logs',
    connections: ['primary'],
    retentionDays: 90,
    rationale: 'Per-sync connector run log, read only while diagnosing a failing integration. Aged by `started_at` — the row is written when the sync begins.',
    purge: (db, cutoff) => db.delete(integrationSyncLogs).where(acrossTenants(integrationSyncLogs, 'scheduled_sweep', lt(integrationSyncLogs.startedAt, cutoff))),
  },
];

/** The relation names on one connection — what the maintenance sweep vacuums. */
export function sweptRelations(connection: SweptConnection): string[] {
  return SWEPT_TABLES.filter((t) => t.connections.includes(connection)).map((t) => t.relation);
}
