import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * autoRunSkipLedger — ONE writer for the `auto_run_skipped` Observability event, with a
 * KV state-change gate in front of it.
 *
 * WHY THIS EXISTS. Every refusal to auto-run a ticket is recorded so a stuck ticket is
 * diagnosable from its own timeline — that instrumentation is load-bearing, and the
 * lifecycle ledger reads it to name the gate holding each ticket. But the emit was
 * UNCONDITIONAL and the sweep re-evaluates every runnable ticket every few minutes, so a
 * platform with a large stalled backlog writes the same sentence about the same ticket
 * forever. Measured 2026-07-26: **11,182 rows in one day** (against ~180/day the week
 * before), making `auto_run_skipped` the single largest writer in `tool_audit_events`
 * (107,186 rows in 14 days) on a database held deliberately under $5/month.
 *
 * The waste is total: 313 tickets stuck on `no_agent` do not become more diagnosable for
 * being told so 40 times an hour. What a reader needs is the CURRENT reason and the
 * moment it changed.
 *
 * THE GATE. The ledger's own query is `DISTINCT ON (session_key) … ORDER BY ts DESC` —
 * it reads the LATEST row per ticket and nothing else. So writing only on a state change
 * is not an approximation of the old behaviour, it is exactly equivalent for every
 * consumer: the newest row still carries the live reason. A tiny KV marker per ticket
 * holds `lane|reason`; an identical repeat is dropped before it reaches Postgres.
 *
 * FAIL-OPEN. KV unbound, a read that throws, a write that throws — all fall through to
 * emitting. A cache blip may cost a duplicate row; it must never make a stuck ticket
 * invisible. The re-affirm TTL bounds how long a marker can outlive its event row.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { recordCloudToolEvent } from './cloudAgentEngine';

/**
 * How long a suppression marker survives. A ticket sitting on one unchanged reason
 * re-affirms itself at most this often, so the timeline still shows the stall is LIVE
 * rather than a single row from whenever it began — and a pruned/rolled-off event row
 * cannot leave the ticket permanently unexplained. 6h ⇒ ≤4 rows per stalled ticket per
 * day instead of ~288.
 */
export const SKIP_REAFFIRM_TTL_SECONDS = 6 * 60 * 60;

const markerKey = (tenantId: number, taskId: number): string => `autorun-skip:${tenantId}:${taskId}`;

/** The state a skip represents. Lane is part of it: the same reason on a different lane
 *  is a different fact about the ticket, and the ledger surfaces the lane. */
const skipState = (lane: string | null | undefined, reason: string): string => `${lane ?? '-'}|${reason}`;

export interface AutoRunSkipArgs {
  tenantId: number;
  taskId: number;
  /** Whose timeline the skip lands on (candidate agent, staffed agent, or the dispatcher). */
  cloudAgentRef: string;
  /** MUST be a real `AutoRunReason` — the lifecycle ledger resolves the stall from it. */
  reason: string;
  /** The lane the ticket sat on, when known. */
  lane?: string | null;
  detail: Record<string, unknown>;
  result: string;
}

/**
 * THE GATE, on its own. True when `state` differs from this ticket's last recorded skip
 * state (and the marker has been advanced to it) — i.e. the caller SHOULD write.
 *
 * Separate from the emit because one caller (the capability-mismatch loop) writes a row
 * PER mismatched agent for one state: it must claim once and then emit N rows. Folding
 * the claim into a per-row helper would make those rows fight over a single marker and
 * alternate forever, which is worse than the amplification this removes.
 *
 * Fails OPEN (returns true) on an unbound or throwing KV.
 */
export async function claimAutoRunSkipState(env: Env, tenantId: number, taskId: number, state: string): Promise<boolean> {
  const store = env.AUTH_CACHE_KV;
  if (!store) return true;
  const key = markerKey(tenantId, taskId);
  try {
    if ((await store.get(key)) === state) return false;
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/autoRunSkipLedger.ts", operation: "claimAutoRunSkipState", context: { logMessage: '[auto-run-skip] suppression marker read failed; emitting fail-open', details: {
      tenantId,
      taskId,
      error,
    } } });
    return true; // a KV read blip must not hide a stalled ticket
  }
  try {
    await store.put(key, state, { expirationTtl: SKIP_REAFFIRM_TTL_SECONDS });
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/autoRunSkipLedger.ts", operation: "claimAutoRunSkipState", context: { logMessage: '[auto-run-skip] suppression marker write failed', details: { tenantId, taskId, error } } });
  }
  return true;
}

/** THE WRITE, on its own — no gating. Best-effort; never throws. */
export async function emitAutoRunSkip(db: Db, args: Omit<AutoRunSkipArgs, 'reason' | 'lane'>): Promise<void> {
  await recordCloudToolEvent(db, {
    tenantId: args.tenantId,
    cloudAgentRef: args.cloudAgentRef,
    executionId: null,
    sessionKey: `task:${args.taskId}`,
    toolName: 'auto_run_skipped',
    category: 'planning',
    detail: args.detail,
    result: args.result.slice(0, 300),
  }).catch((error) => reportCaughtError(error, { source: "application/runtime/autoRunSkipLedger.ts", operation: "emitAutoRunSkip", context: { logMessage: '[auto-run-skip] telemetry append failed', details: {
    tenantId: args.tenantId,
    taskId: args.taskId,
    toolName: 'auto_run_skipped',
    error,
  } } }));
}

/**
 * Record an auto-run refusal, unless this ticket's last recorded refusal was already
 * this same (lane, reason). Returns true when a row was written. The single-row case,
 * which is every caller but one.
 */
export async function recordAutoRunSkip(env: Env, db: Db, args: AutoRunSkipArgs): Promise<boolean> {
  if (!(await claimAutoRunSkipState(env, args.tenantId, args.taskId, skipState(args.lane, args.reason)))) return false;
  await emitAutoRunSkip(db, args);
  return true;
}

/** The state string a caller claims when it will emit its own rows. Exported so the
 *  multi-row caller cannot drift from the single-row one on separator or lane handling. */
export { skipState as autoRunSkipState };

/** Marker id standing for "the tenant, not a ticket". Serial task ids start at 1,
 *  so 0 can never collide with a real ticket's suppression marker. */
const TENANT_SCOPE_MARKER_ID = 0;

/**
 * Record a WORKSPACE-WIDE refusal — one row for a condition that is true of the
 * whole tenant, not of any one ticket (DISP-R3).
 *
 * WHY IT IS NOT `recordAutoRunSkip`. The cloud-run cap is a tenant fact: the
 * allowance is exhausted, and it is exhausted identically for every ticket on
 * every board. Discovering it inside the per-ticket dispatcher meant an over-cap
 * tenant with 200 active tickets wrote 200 rows per tick — each with its own
 * suppression marker on its own 6h re-affirm schedule — to say one thing once, on
 * a database held deliberately under $5/month. It also could not be READ as one
 * thing: a board showed 200 stalled cards with no way to see that a single
 * workspace condition explained all of them.
 *
 * The session key is `tenant:<id>`, so these rows do not land on any ticket's
 * timeline and cannot be mistaken for a fact about a ticket. The suppression gate
 * is the same one the per-ticket ledger uses, keyed on the TENANT — a tenant that
 * stays over cap re-affirms at most once per TTL rather than once per ticket per
 * tick.
 */
export async function recordTenantAutoRunSkip(env: Env, db: Db, args: {
  tenantId: number;
  /** MUST be a real `AutoRunReason` — the lifecycle ledger resolves stalls from it. */
  reason: string;
  detail: Record<string, unknown>;
  result: string;
}): Promise<boolean> {
  if (!(await claimAutoRunSkipState(env, args.tenantId, TENANT_SCOPE_MARKER_ID, skipState(null, args.reason)))) return false;
  await recordCloudToolEvent(db, {
    tenantId: args.tenantId,
    cloudAgentRef: 'system:auto-exec',
    executionId: null,
    sessionKey: `tenant:${args.tenantId}`,
    toolName: 'auto_run_skipped',
    category: 'planning',
    detail: args.detail,
    result: args.result.slice(0, 300),
  }).catch((error) => reportCaughtError(error, { source: 'application/runtime/autoRunSkipLedger.ts', operation: 'recordTenantAutoRunSkip', context: { logMessage: '[auto-run-skip] tenant-scoped telemetry append failed', details: { tenantId: args.tenantId, error } } }));
  return true;
}

/** Clear the tenant-scoped marker so the NEXT workspace-wide refusal is recorded
 *  in full — called when the condition lifts and dispatching resumes. */
export async function clearTenantAutoRunSkip(env: Env, tenantId: number): Promise<void> {
  await clearAutoRunSkip(env, tenantId, TENANT_SCOPE_MARKER_ID);
}

/**
 * Drop a ticket's suppression marker so its NEXT refusal is recorded in full.
 *
 * Called when a ticket actually RUNS. Without it, a ticket that runs and then stalls
 * again for the same reason inside the TTL window would leave that second stall
 * unrecorded, and the ledger would show the pre-run row as if nothing had happened
 * since — the one way this optimisation could lose information rather than noise.
 */
export async function clearAutoRunSkip(env: Env, tenantId: number, taskId: number): Promise<void> {
  const store = env.AUTH_CACHE_KV;
  if (!store) return;
  try {
    await store.delete(markerKey(tenantId, taskId));
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/autoRunSkipLedger.ts", operation: "clearAutoRunSkip", context: { logMessage: '[auto-run-skip] suppression marker clear failed', details: { tenantId, taskId, error } } });
  }
}
