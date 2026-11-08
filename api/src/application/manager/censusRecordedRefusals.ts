/**
 * censusRecordedRefusals — lets the stall census use the refusal the dispatcher already
 * RECORDED, for the tickets its fast ladder cannot judge.
 *
 * THE GAP. `classifyBulkAutoRunReason` is a fast, bulk ladder and a strict subset of the
 * real evaluator: it cannot see `capability_mismatch`, `cooldown_active`,
 * `same_lane_reentry`, `tenant_token_limit`, `cloud_run_limit`, `execution_disabled`,
 * `no_board`, `lane_requirement_gate`, or a trigger that threw. Every such ticket fell to
 * `will_run`, and `diagnoseStall` then labelled the whole cohort `never_started` "despite
 * being runnable" — a diagnosis that was false for exactly the tickets that had been
 * refused for a real, nameable reason.
 *
 * THE FIX. The real refusal is already on file per ticket (`autoRunSkipLedger` writes
 * `auto_run_skipped`; the lane-entry trigger writes `auto_run_error`). For the tickets the
 * ladder places on `will_run`, read the latest such row for ALL of them in one batched
 * query (`autoRunSkipReader`) and use that reason.
 *
 * WHICH ROWS COUNT.
 *   • Only reasons the fast ladder is BLIND to. For everything it models, the ladder is a
 *     fresh reading of live state and a recorded row can only be older than it; letting
 *     the row win would resurrect a gate that has since been fixed.
 *   • Only rows NEWER than the ticket's last lane change. A refusal recorded before the
 *     ticket moved describes a lane it is no longer in. The census always has a
 *     lane-change time (the manager's shared signal, or the ticket's creation), so no
 *     fixed window is needed for correctness; the reader's 30-day lookback only bounds the
 *     scan.
 *   • `cooldown_active` additionally expires: a back-off is at most
 *     {@link AUTORUN_COOLDOWN_MAX_MS}, so an older cooldown row is no longer in force.
 */
import type { Db } from '../../infrastructure/database/connection';
import { AUTORUN_COOLDOWN_MAX_MS, type AutoRunReason } from '../swimlane/evaluateAutoRun';
import { loadLatestRefusals, type RecordedRefusal } from '../runtime/autoRunSkipReader';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** The reasons the census fast ladder cannot derive, so a recorded row may supply them. */
export const CENSUS_BLIND_REASONS: ReadonlySet<AutoRunReason> = new Set<AutoRunReason>([
  'capability_mismatch', 'cooldown_active', 'same_lane_reentry', 'tenant_token_limit',
  'cloud_run_limit', 'execution_disabled', 'no_board', 'lane_requirement_gate', 'trigger_error',
]);

/**
 * WORKSPACE-LEVEL refusals clear without the ticket ever moving: the plan limit resets, the
 * token budget refills, an operator re-enables execution. A row recorded for one of them
 * therefore goes stale on its own, and "until the next lane move" kept diagnosing a ticket
 * as limit-blocked for days after the limit was gone. They expire after an hour, after which
 * the census falls back to the LIVE verdict (a still-true refusal re-records within a pass).
 */
const WORKSPACE_REFUSAL_TTL_MS = 3_600_000;

/**
 * `lane_requirement_gate` is LANE-scoped — the lane's required roles/sign-offs — so a lane
 * move rightly supersedes it. But the gate also opens WITHOUT a move (a role completes or is
 * staffed), so it gets a long ceiling rather than none: long enough that a genuinely waiting
 * ticket keeps its true diagnosis across passes, short enough to self-heal within the day.
 */
const LANE_GATE_TTL_MS = 6 * 3_600_000;

/** Reasons that stop being in force after a while, regardless of lane changes. */
export const MAX_REFUSAL_AGE_MS: Partial<Record<AutoRunReason, number>> = {
  cooldown_active: AUTORUN_COOLDOWN_MAX_MS,
  cloud_run_limit: WORKSPACE_REFUSAL_TTL_MS,
  tenant_token_limit: WORKSPACE_REFUSAL_TTL_MS,
  execution_disabled: WORKSPACE_REFUSAL_TTL_MS,
  trigger_error: WORKSPACE_REFUSAL_TTL_MS,
  lane_requirement_gate: LANE_GATE_TTL_MS,
};

/**
 * The reason a recorded refusal contributes to the census, or null when it must be
 * ignored (not a reason the ladder is blind to, recorded before the last lane change, or
 * expired). PURE.
 */
export function usableRefusalReason(
  refusal: RecordedRefusal | undefined,
  lastMovedAtMs: number,
  now: number,
): AutoRunReason | null {
  if (!refusal || !CENSUS_BLIND_REASONS.has(refusal.reason)) return null;
  const at = refusal.at.getTime();
  if (at < lastMovedAtMs) return null;
  const maxAge = MAX_REFUSAL_AGE_MS[refusal.reason];
  if (maxAge != null && now - at > maxAge) return null;
  return refusal.reason;
}

/**
 * Recorded refusal reasons for the given tickets, ONE query regardless of count. Degrades
 * to an empty map on a read failure — the census then reports its fast-ladder floor, as
 * it did before this existed.
 */
export async function loadRecordedRefusalReasons(
  db: Db,
  tenantId: number,
  candidates: ReadonlyArray<{ taskId: number; lastMovedAtMs: number }>,
  now: number,
): Promise<Map<number, AutoRunReason>> {
  const out = new Map<number, AutoRunReason>();
  if (candidates.length === 0) return out;
  let latest: Map<number, RecordedRefusal>;
  try {
    latest = await loadLatestRefusals(db, tenantId, candidates.map((c) => c.taskId), now);
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/manager/censusRecordedRefusals.ts',
      operation: 'loadRecordedRefusalReasons',
      context: { logMessage: '[census] recorded auto-run refusals failed to load — runnable tickets keep the fast-ladder verdict', details: { tenantId, tickets: candidates.length } },
    });
    return out;
  }
  for (const c of candidates) {
    const reason = usableRefusalReason(latest.get(c.taskId), c.lastMovedAtMs, now);
    if (reason) out.set(c.taskId, reason);
  }
  return out;
}
