import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executions, ticketRuns } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/**
 * The stale-execution reaper's idle gate.
 *
 * The reaper runs on every active cron tick, and on Neon every statement is one HTTPS
 * round trip. It used to issue three UPDATEs and two SELECTs per tick even when nothing
 * was stale (the overwhelmingly common case). This module asks ONE question first —
 * "which of the stale categories have any row at all?" — as a single statement of
 * `EXISTS` arms, so an idle platform pays one cheap indexed probe and the reaper runs
 * only the sweeps that have work.
 *
 * The predicates live here (not in the reaper) so the probe and the reaping statements
 * test exactly the same condition: a probe that drifted from its UPDATE would either
 * hide work or wake the DB for nothing.
 */

/**
 * Max rows one reap statement touches. Each reaped row fans out to a telemetry insert,
 * a principal revocation and chat narration, so an unbounded backlog (a fleet of hosts
 * dropping at once) would otherwise turn one tick into thousands of round trips. 100
 * clears any realistic burst in one tick; a larger backlog drains over the next ticks
 * (the reaper re-signals the cron gate when a batch comes back full).
 */
export const REAP_BATCH_LIMIT = 100;

/** ISO cutoffs for each stale category, computed once per tick by the reaper. */
export interface StaleCutoffs {
  running: string;
  cloudRunning: string;
  queued: string;
  paused: string;
  /** `ticket_runs.updated_at` cutoff for the park-age sibling sweep. */
  parkAge: string;
}

export interface StalePredicates {
  /** Hung self-hosted HOST runs (cloud runs have their own, tighter, category). */
  hostRunning: SQL;
  /** Cloud run candidates silent past the 90s pull floor (per-surface ceiling applied later). */
  cloudRunning: SQL;
  /** Submitted/pending runs no agent ever picked up. */
  queued: SQL;
  /** Runs paused on an `ask_human` question nobody answered. */
  paused: SQL;
  /** Tickets parked on a run_workflow past the park-age cap. */
  parkAge: SQL;
}

export function stalePredicates(c: StaleCutoffs): StalePredicates {
  return {
    hostRunning: and(eq(executions.status, 'running'), isNotNull(executions.agentHostId), sql`coalesce(${executions.startedAt}, ${executions.createdAt}) < ${c.running}`) as SQL,
    cloudRunning: and(eq(executions.status, 'running'), isNull(executions.agentHostId), sql`coalesce(${executions.updatedAt}, ${executions.createdAt}) < ${c.cloudRunning}`) as SQL,
    queued: and(inArray(executions.status, ['pending', 'submitted']), sql`${executions.createdAt} < ${c.queued}`) as SQL,
    paused: and(eq(executions.status, 'paused'), sql`coalesce(${executions.updatedAt}, ${executions.startedAt}, ${executions.createdAt}) < ${c.paused}`) as SQL,
    parkAge: and(eq(ticketRuns.lifecycle, 'awaiting_workflow'), isNotNull(ticketRuns.awaitingWorkflowId), sql`${ticketRuns.updatedAt} < ${c.parkAge}`) as SQL,
  };
}

export type StaleProbe = Record<keyof StalePredicates, boolean>;

const ALL_STALE: StaleProbe = { hostRunning: true, cloudRunning: true, queued: true, paused: true, parkAge: true };

/** Postgres booleans arrive as `true`, or as `'t'` through a text-typed mapper. */
function truthy(v: unknown): boolean {
  return v === true || v === 't' || v === 'true' || v === 1;
}

/**
 * One round trip: which stale categories hold at least one row. Fails OPEN (every
 * category true) — a probe error must never hide stale work, it can only cost the
 * old always-run statements for one tick.
 */
export async function probeStaleWork(db: Db, p: StalePredicates): Promise<StaleProbe> {
  // Declared cross-tenant: the reaper sweeps every tenant, the deadline is the predicate.
  const ex = (table: typeof executions | typeof ticketRuns, cond: SQL) =>
    sql`exists (select 1 from ${table} where ${acrossTenants(table, 'scheduled_sweep', cond)})`;
  try {
    const result = await db.execute(sql`select
      ${ex(executions, p.hostRunning)} as host_running,
      ${ex(executions, p.cloudRunning)} as cloud_running,
      ${ex(executions, p.queued)} as queued,
      ${ex(executions, p.paused)} as paused,
      ${ex(ticketRuns, p.parkAge)} as park_age`);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    return {
      hostRunning: truthy(row.host_running),
      cloudRunning: truthy(row.cloud_running),
      queued: truthy(row.queued),
      paused: truthy(row.paused),
      parkAge: truthy(row.park_age),
    };
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/staleExecutionProbe.ts', operation: 'probeStaleWork', context: { logMessage: '[execution-reaper] stale probe failed; running every sweep fail-open', details: { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) } } });
    return { ...ALL_STALE };
  }
}

export function anyStale(probe: StaleProbe): boolean {
  return Object.values(probe).some(Boolean);
}
