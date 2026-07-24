/**
 * Retention purge — daily deletion of rows from append-only diagnostic/telemetry
 * tables that would otherwise grow unbounded. Run from the daily cron tick
 * (scheduled() in index.ts), mirroring the vendor-health cron.
 *
 * Each table keeps a generous live-incident window; older rows are dropped. Every
 * table here is a diagnostic/event log (no business records), so deletion is safe
 * and never cascades to domain data. Add new unbounded log tables to PURGE_TARGETS
 * — one place, one policy (DRY).
 */
import { lt } from 'drizzle-orm';
import { buildDatabase, buildTransactionalDatabase } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { llmTraces, llmFailoverLog, llmHealthProbes, qaJourneyEvents, errorEvents, managerActions, toolAuditEvents, demoEvents } from '../../infrastructure/database/schema';

/** Days of history kept per table before older rows are purged. */
const RETENTION_DAYS = {
  llmTraces: 30,
  llmFailoverLog: 30,
  llmHealthProbes: 180,
  qaJourneyEvents: 90,
  // Raw Quality error events — group aggregates (error_groups) are kept forever;
  // only the raw stream is swept. 90d is safely > the consumption meter's
  // month-to-date window, so error-event billing is never affected by the purge.
  errorEvents: 90,
  // The manager-decision FEED (cron + "Run manager now" telemetry) — the platform's
  // highest-write table (~46k rows in <30d, all from the every-5-min manager sweep).
  // It had NO retention and its on-disk size ballooned to ~593 MB, mostly page bloat
  // (reclaim needs a one-time VACUUM FULL — retention alone won't shrink recent rows).
  // 30d caps the live-row count for a drill-in feed that nobody reads month-old rows
  // from; the KV cron gate further cuts its write rate on idle ticks.
  managerActions: 30,
  // Agent tool-audit timeline (~117 MB, also previously unbounded). Same 90d window
  // as the other agent/telemetry event streams.
  toolAuditEvents: 90,
  // Anonymous demo-funnel telemetry (migration 0360). Append-only, one row per demo
  // visitor interaction — swept on the same 90d window as the other event streams;
  // the admin funnel panel only looks back 30d.
  demoEvents: 90,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const cutoff = (now: number, days: number) => new Date(now - days * DAY_MS);

/**
 * Delete expired rows from every unbounded log table. Best-effort per table — a
 * failure on one is logged and does not block the others. `now` is injectable for
 * tests; defaults to the cron's wall clock.
 */
export async function runRetentionPurge(env: Env, now: number = Date.now()): Promise<void> {
  const db = buildDatabase(env);
  const transactionalDb = buildTransactionalDatabase(env);
  const targets: Array<{ name: string; run: () => Promise<unknown> }> = [
    { name: 'llm_traces',        run: () => transactionalDb.delete(llmTraces).where(lt(llmTraces.createdAt, cutoff(now, RETENTION_DAYS.llmTraces))) },
    { name: 'llm_failover_log',  run: () => transactionalDb.delete(llmFailoverLog).where(lt(llmFailoverLog.createdAt, cutoff(now, RETENTION_DAYS.llmFailoverLog))) },
    { name: 'llm_health_probes', run: () => transactionalDb.delete(llmHealthProbes).where(lt(llmHealthProbes.createdAt, cutoff(now, RETENTION_DAYS.llmHealthProbes))) },
    { name: 'qa_journey_events', run: () => db.delete(qaJourneyEvents).where(lt(qaJourneyEvents.ts, cutoff(now, RETENTION_DAYS.qaJourneyEvents))) },
    { name: 'error_events',      run: () => db.delete(errorEvents).where(lt(errorEvents.createdAt, cutoff(now, RETENTION_DAYS.errorEvents))) },
    { name: 'manager_actions',   run: () => db.delete(managerActions).where(lt(managerActions.createdAt, cutoff(now, RETENTION_DAYS.managerActions))) },
    { name: 'tool_audit_events', run: () => db.delete(toolAuditEvents).where(lt(toolAuditEvents.createdAt, cutoff(now, RETENTION_DAYS.toolAuditEvents))) },
    { name: 'demo_events',       run: () => db.delete(demoEvents).where(lt(demoEvents.createdAt, cutoff(now, RETENTION_DAYS.demoEvents))) },
  ];
  for (const t of targets) {
    try {
      await t.run();
    } catch (err) {
      console.error(`[cron:retention] purge ${t.name} failed`, err);
    }
  }
}
