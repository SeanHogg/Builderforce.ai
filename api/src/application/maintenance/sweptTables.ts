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
import { lt } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import {
  apiErrorLog,
  demoEvents,
  errorEvents,
  llmFailoverLog,
  llmHealthProbes,
  llmTraces,
  managerActions,
  qaJourneyEvents,
  toolAuditEvents,
} from '../../infrastructure/database/schema';

/** Which Neon database a relation lives in — they are separate endpoints. */
export type SweptConnection = 'primary' | 'transactional';

export interface SweptTable {
  /** Physical relation name. This is the identifier `VACUUM` and `pg_class` use, so
   *  it must match the table's `pgTable(...)` name, not the Drizzle export. */
  relation: string;
  connection: SweptConnection;
  /** Days of history kept before older rows are purged. */
  retentionDays: number;
  /** Why this window and not another — the reasoning that used to live inline. */
  rationale: string;
  /** Delete rows older than `cutoff`. Takes the db for its own connection. */
  purge: (db: Db, cutoff: Date) => Promise<unknown>;
}

export const SWEPT_TABLES: readonly SweptTable[] = [
  {
    relation: 'llm_traces',
    connection: 'transactional',
    retentionDays: 30,
    // The one relation here that is UPDATEd after insert (a stream finalises its row),
    // which is why migration 1104 gives it a fillfactor and the others none.
    rationale: 'Per-call LLM trace stream; the cost panels never look further back than 30d.',
    purge: (db, cutoff) => db.delete(llmTraces).where(acrossTenants(llmTraces, 'scheduled_sweep', lt(llmTraces.createdAt, cutoff))),
  },
  {
    relation: 'llm_failover_log',
    connection: 'transactional',
    retentionDays: 30,
    rationale: 'Routing failover events, read only while diagnosing a live routing incident.',
    purge: (db, cutoff) => db.delete(llmFailoverLog).where(acrossTenants(llmFailoverLog, 'scheduled_sweep', lt(llmFailoverLog.createdAt, cutoff))),
  },
  {
    relation: 'llm_health_probes',
    connection: 'transactional',
    retentionDays: 180,
    rationale: 'Vendor health history — the long window is the point; it is what makes a vendor trend readable.',
    purge: (db, cutoff) => db.delete(llmHealthProbes).where(lt(llmHealthProbes.createdAt, cutoff)),
  },
  {
    relation: 'api_error_log',
    connection: 'transactional',
    retentionDays: 30,
    rationale:
      "The platform's OWN caught/unhandled exception stream (persistCaughtError). Its write rate rose "
      + 'sharply once every handled catch reported here, so it is one of the fastest-growing tables; 30d '
      + 'matches the superadmin Logs page, which never looks further back.',
    purge: (db, cutoff) => db.delete(apiErrorLog).where(lt(apiErrorLog.createdAt, cutoff)),
  },
  {
    relation: 'qa_journey_events',
    connection: 'primary',
    retentionDays: 90,
    rationale: 'QA journey telemetry, swept on the same window as the other event streams.',
    purge: (db, cutoff) => db.delete(qaJourneyEvents).where(acrossTenants(qaJourneyEvents, 'scheduled_sweep', lt(qaJourneyEvents.ts, cutoff))),
  },
  {
    relation: 'error_events',
    connection: 'primary',
    retentionDays: 90,
    rationale:
      'Raw Quality error events — group aggregates (error_groups) are kept forever, only the raw stream is '
      + "swept. 90d is safely > the consumption meter's month-to-date window, so error-event billing is "
      + 'never affected by the purge.',
    purge: (db, cutoff) => db.delete(errorEvents).where(acrossTenants(errorEvents, 'scheduled_sweep', lt(errorEvents.createdAt, cutoff))),
  },
  {
    relation: 'manager_actions',
    connection: 'primary',
    retentionDays: 30,
    rationale:
      'The manager-decision FEED (cron + "Run manager now" telemetry) — the platform\'s highest-write '
      + 'table and the one that proved this registry necessary: it had retention but no vacuum, so 46k '
      + 'live rows sat inside 593 MB of page bloat autovacuum never returned to the OS.',
    purge: (db, cutoff) => db.delete(managerActions).where(acrossTenants(managerActions, 'scheduled_sweep', lt(managerActions.createdAt, cutoff))),
  },
  {
    relation: 'tool_audit_events',
    connection: 'primary',
    retentionDays: 90,
    rationale: 'Agent tool-audit timeline, on the same window as the other agent/telemetry streams.',
    purge: (db, cutoff) => db.delete(toolAuditEvents).where(acrossTenants(toolAuditEvents, 'scheduled_sweep', lt(toolAuditEvents.createdAt, cutoff))),
  },
  {
    relation: 'demo_events',
    connection: 'primary',
    retentionDays: 90,
    rationale: 'Anonymous demo-funnel telemetry; the admin funnel panel only looks back 30d.',
    purge: (db, cutoff) => db.delete(demoEvents).where(lt(demoEvents.createdAt, cutoff)),
  },
];

/** The relation names on one connection — what the maintenance sweep vacuums. */
export function sweptRelations(connection: SweptConnection): string[] {
  return SWEPT_TABLES.filter((t) => t.connection === connection).map((t) => t.relation);
}
