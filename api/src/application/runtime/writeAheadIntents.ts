import { eq, sql } from 'drizzle-orm';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * The write-ahead PROTOCOL STORE (PRD 39 §4b) — the server side of per-run tool-call
 * intents and sequence numbers, on the OPERATIONAL endpoint (`tool_intents`,
 * transactional-migrations/0034). Three seams:
 *
 *   • `recordWriteAheadAck` — a write-ahead host stamps support when it claims a run
 *     (relay `task.assign` ack): the payload gains `writeAhead: 1`. From then on the host
 *     takes the next per-run `seq` and writes an intent BEFORE any tool runs. Only a
 *     NON-allowlisted tool waits for a server ack; on ack the server DELETES the intent
 *     row. So a row left behind is a tool that was about to run (or ran) and never got
 *     its ack — the run may have performed a side effect the server never confirmed.
 *   • `recordIntentAck` — acknowledges a non-allowlisted intent by deleting it. Returns
 *     false when no matching row exists (a forged / already-acked intent), which the host
 *     treats as "do not run, fail the run".
 *   • `loadWriteAheadRunState` — read model the stale-execution reaper uses to decide
 *     failover re-dispatch. Pure decision on the result is `assessWriteAheadRunState`.
 *
 * SAFETY MODEL. `executionId` is REQUIRED on intents (§4b) — the ack matches on it. Old
 * hosts send no intents, so "no intent" proves nothing for them; the reaper only
 * re-dispatches a run whose host ADVERTISED support and left a gap-free sequence with no
 * held non-allowlisted intent. Anything else fails and asks a human.
 */
import type { Db } from '../../infrastructure/database/connection';
import { executions, toolIntents } from '../../infrastructure/database/schema';

/** Flip a run's payload to advertise write-ahead support when its host claims it (§4b). */
export async function recordWriteAheadAck(db: Db, tenantId: number, executionId: number): Promise<boolean> {
  try {
    await db
      .update(executions)
      .set({ payload: sql`coalesce(${executions.payload}, '{}')::jsonb || '{"writeAhead":1}'`, updatedAt: sql`now()` })
      .where(scopedToTenant(executions, tenantId, eq(executions.id, executionId), eq(executions.status, 'running')));
    return true;
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/writeAheadIntents.ts', operation: 'recordWriteAheadAck', context: { logMessage: '[write-ahead] failed to stamp support on run payload', details: { tenantId, executionId, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) } } });
    return false;
  }
}

/** Server ack of a non-allowlisted intent: delete it. False = no such intent (never run). */
export async function recordIntentAck(db: Db, tenantId: number, executionId: number, seq: number): Promise<boolean> {
  try {
    const result = await db
      .delete(toolIntents)
      .where(scopedToTenant(toolIntents, tenantId, eq(toolIntents.executionId, executionId), eq(toolIntents.seq, seq)))
      .returning({ id: toolIntents.id });
    return result.length > 0;
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/writeAheadIntents.ts', operation: 'recordIntentAck', context: { logMessage: '[write-ahead] intent ack delete failed', details: { tenantId, executionId, seq, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) } } });
    return false;
  }
}

/** The raw per-run intent state the reaper reads from the operational handle. */
export interface WriteAheadRunState {
  /** Highest sequence number the server has seen for this run (0 = no intents ever). */
  maxSeq: number;
  /** Sequence values present; gap-free iff `count == maxSeq` (every 1..maxSeq present). */
  count: number;
  /** Intents for non-allowlisted tools never acked — a possible unconfirmed side effect. */
  nonAllowlistedIntents: Array<{ seq: number; toolName: string }>;
}

/**
 * Read a run's intent state from the OPERATIONAL endpoint (tool_audit_events lives
 * there, so intents do too). The reaper resolves the sibling handle itself; this takes
 * whichever handle and never throws — a read failure fails closed (asks a human) rather
 * than guessing a run is safe to re-run.
 */
export async function loadWriteAheadRunState(opDb: Db, executionId: number): Promise<WriteAheadRunState | null> {
  try {
    const rows = await opDb
      .select({
        seq: toolIntents.seq,
        requiresAck: toolIntents.requiresAck,
        toolName: toolIntents.toolName,
      })
      .from(toolIntents)
      .where(eq(toolIntents.executionId, executionId));
    let maxSeq = 0;
    for (const row of rows) if (row.seq > maxSeq) maxSeq = row.seq;
    return {
      maxSeq,
      count: rows.length,
      nonAllowlistedIntents: rows.filter((r) => r.requiresAck).map((r) => ({ seq: r.seq, toolName: r.toolName })),
    };
  } catch (error) {
    reportCaughtError(error, { source: 'application/runtime/writeAheadIntents.ts', operation: 'loadWriteAheadRunState', context: { logMessage: '[write-ahead] intent-state read failed; failing closed', details: { executionId, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) } } });
    return null;
  }
}

/** What the reaper may do with a stranded write-ahead host run. */
export type WriteAheadDecision =
  | { safeToRedispatch: true }
  | { safeToRedispatch: false; reason: string };

/**
 * The §4b re-dispatch rule, pure. Re-dispatch ONLY if the host advertised support AND
 * the server holds no intent for a non-allowlisted tool AND the sequence numbers seen
 * have no gap. Anything else fails and asks a human, with `reason` recorded. `state` is
 * null when the intent read itself failed — that also fails closed (never guess safe).
 */
export function assessWriteAheadRunState(
  advertised: boolean,
  state: WriteAheadRunState | null,
): WriteAheadDecision {
  if (!advertised) {
    return { safeToRedispatch: false, reason: 'host did not advertise write-ahead support' };
  }
  if (state === null) {
    return { safeToRedispatch: false, reason: 'could not read the run\u2019s tool-intent state' };
  }
  if (state.nonAllowlistedIntents.length > 0) {
    const held = state.nonAllowlistedIntents.map((i) => `${i.toolName} (#${i.seq})`).join(', ');
    return { safeToRedispatch: false, reason: `a non-allowlisted tool has an unacknowledged intent (${held}); the run may have performed a side effect` };
  }
  if (state.count !== state.maxSeq) {
    return { safeToRedispatch: false, reason: `the run\u2019s tool-call sequence has a gap (saw ${state.count} of ${state.maxSeq}); a tool call may have been lost` };
  }
  return { safeToRedispatch: true };
}
