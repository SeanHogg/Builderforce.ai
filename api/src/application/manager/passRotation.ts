/**
 * passRotation — the promise the skip journal has been making since it was written:
 * "it runs first on the next pass".
 *
 * ── WHY A RESERVATION WAS NOT ENOUGH ─────────────────────────────────────────────
 * A manager pass runs seven stages inside one Worker invocation against a 20s budget, and
 * triage — which owns EVERY remedy: staffing a stage, resetting a breaker, asking for a
 * sign-off, resolving a conflict — runs last. `MANAGER_TRIAGE_RESERVE_MS` was added to
 * stop the discretionary stages at 14s so triage always had 6s of its own.
 *
 * It did not hold, because a reservation checked only BETWEEN units cannot refuse an
 * oversized one. Measured on project 11, 2026-07-28: the pass reached triage at
 * `elapsedMs: 27648` against `budgetMs: 20000`, having spent 16.4 seconds inside a single
 * PR iteration that hit a merge conflict and dispatched a recovery run (11:01:05.921 →
 * 11:01:22.308 in the decision feed). One unit ate the reserve and 7.6s beyond it. The
 * consequence is the whole board: `Stall triage skipped this pass` on repeat, every stuck
 * register row's `lastAttempt` seven hours stale against a five-minute cadence, and 678
 * stalled tickets whose remedies were never once attempted in that window.
 *
 * A reserve guards against stages that are slightly too slow. It cannot guard against a
 * unit whose duration is set by a third party — a provider round-trip, a container cold
 * start. Estimating that unit is a guess, and a wrong guess restores the starvation.
 *
 * ── THE ROTATION ─────────────────────────────────────────────────────────────────
 * So the guarantee is made structurally instead, and needs no estimate at all: a pass
 * REMEMBERS what it ran out of time for, and the next pass runs ONLY those stages. The
 * stages that starved it yield their turn.
 *
 * Worst case a stage waits one extra tick — five minutes, against the seven hours and
 * counting it waited without this. It cannot be starved indefinitely by a slow neighbour,
 * whatever that neighbour costs, because the neighbour is not running.
 *
 * {@link MAX_CONSECUTIVE_YIELDS} bounds the other direction: if the yielded-to stages keep
 * overrunning too, the rotation resets rather than starving the stages it skipped. Fair
 * sharing, not a new priority order.
 *
 * ── WHY THE CURSOR LIVES IN KV ───────────────────────────────────────────────────
 * It is scheduling scratch, not policy. A project may have no `project_manager_configs`
 * row at all (the effective policy then comes from the workspace tier), so writing one
 * just to hold a cursor would silently convert "inherits" into an explicit override — a
 * behaviour change to pay for a hint. Losing the cursor costs exactly one unrotated pass,
 * so the cache layer's guarantees are already stronger than this needs.
 *
 * The decision itself is PURE ({@link decideRotation} / {@link carryOverRotation}); only
 * the two thin load/save wrappers touch IO.
 */
import { peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

/**
 * How many passes in a row may yield to the same starved set before the rotation gives
 * up and restores the normal order.
 *
 * Two. One yield is the fix; a second covers a stage that legitimately needs two ticks.
 * Past that the starved set is not merely unlucky, it is itself the thing overrunning, and
 * continuing to yield to it would starve everything else — trading one silent starvation
 * for another.
 */
export const MAX_CONSECUTIVE_YIELDS = 2;

/**
 * Stages the rotation understands — the ones that may be carried in the cursor and
 * yielded TO.
 *
 * An allow-list, not a deny-list: a new stage must be opted in deliberately rather than
 * silently inherit rotation behaviour, and a stale cursor naming a stage that no longer
 * exists must be ignored rather than yield the pass to nothing.
 */
export const ROTATABLE_STAGES: ReadonlySet<string> = new Set([
  // `pr_merge` is NOT here any more, and its absence is the point: the merge loop left
  // the pass entirely for its own registry sweep (`application/repos/prMergeSweep.ts`)
  // with its own budget, so there is no longer a PR merge stage for a pass to starve or
  // to yield to. A stale cursor still naming it is ignored by the allow-list filter in
  // `decideRotation`, which is exactly what an allow-list is for.
  'value', 'assign', 'systemic', 'dispatch', 'audit', 'pr_conduct', 'triage',
]);

/**
 * Stages that may give up their turn — {@link ROTATABLE_STAGES} MINUS triage.
 *
 * ── WHY TRIAGE IS YIELDED TO BUT NEVER YIELDED ───────────────────────────────────
 * The two directions are not symmetric, and treating them as one set quietly reintroduced
 * the bug. Walk it through: a pass starves `[pr_merge, audit, triage]` and the next pass
 * yields to exactly those three. Good — triage finally runs. But that pass then starves
 * `[pr_merge, audit]` (triage completed), so the cursor no longer names triage, so the
 * pass after it yields triage away again. Triage would run every third pass at best,
 * oscillating, for no reason other than having succeeded.
 *
 * Triage is also the only stage that produces the remedies — staffing a stage, resetting a
 * breaker, asking for a sign-off, resolving a conflict. Skipping it to make room for a PR
 * loop is precisely the trade this whole mechanism exists to stop making. So it is never
 * skipped by the rotation: it runs whenever the budget's reserve reaches it, and the
 * rotation's job is to make sure the reserve is still there.
 */
export const YIELDABLE_STAGES: ReadonlySet<string> = new Set(
  [...ROTATABLE_STAGES].filter((s) => s !== 'triage'),
);

/** The cursor as it is persisted. Deliberately tiny — it is written every pass. */
export interface RotationState {
  /** Stages the previous pass ran out of wall-clock for. */
  starved: string[];
  /** How many passes in a row have already yielded to that set. */
  yields: number;
}

/** This pass's rotation verdict. */
export interface PassRotation {
  /** Stages this pass is yielding its turn to; empty means "run everything". */
  yieldTo: ReadonlySet<string>;
  /** Passes that have already yielded to this set, including this one. */
  yields: number;
  /** Stages this pass actually skipped to make room — reported, never fed back. */
  yielded: string[];
  /**
   * May this pass run `stage`? Always true for a non-rotatable stage and for every stage
   * on an unrotated pass.
   */
  mayRun: (stage: string) => boolean;
  /** Record that `stage` was skipped for the rotation (not for the budget). */
  skip: (stage: string) => void;
}

/**
 * Turn a persisted cursor into this pass's verdict. PURE.
 *
 * A cursor at or past {@link MAX_CONSECUTIVE_YIELDS} is treated as absent: the yielded-to
 * set has had its turns and the pass returns to the normal order, so the stages it
 * displaced cannot be starved in the other direction.
 */
export function decideRotation(prior: RotationState | null | undefined): PassRotation {
  const starved = (prior?.starved ?? []).filter((s) => ROTATABLE_STAGES.has(s));
  const yields = prior?.yields ?? 0;
  const active = starved.length > 0 && yields < MAX_CONSECUTIVE_YIELDS;
  const yieldTo = new Set(active ? starved : []);
  const yielded: string[] = [];
  return {
    yieldTo,
    yields: active ? yields + 1 : 0,
    yielded,
    mayRun: (stage: string) => yieldTo.size === 0 || !YIELDABLE_STAGES.has(stage) || yieldTo.has(stage),
    skip: (stage: string) => { if (!yielded.includes(stage)) yielded.push(stage); },
  };
}

/**
 * The cursor to persist after a pass. PURE.
 *
 * `budgetShed` must be the stages shed for WALL-CLOCK only. A stage this pass skipped for
 * the rotation is not starved — it was told to wait — and feeding it back would make the
 * two sets chase each other: the pass yields to A, skips B, then reads B as starved and
 * yields to B, forever, with neither ever completing a full pass.
 */
export function carryOverRotation(rotation: PassRotation, budgetShed: readonly string[]): RotationState {
  const starved = budgetShed.filter((s) => ROTATABLE_STAGES.has(s) && !rotation.yielded.includes(s));
  if (starved.length === 0) return { starved: [], yields: 0 };
  return { starved, yields: rotation.yields };
}

const rotationKey = (tenantId: number, projectId: number): string =>
  `manager:pass-rotation:${tenantId}:${projectId}`;

/**
 * Written every pass and read every pass, so a TTL only needs to outlive a few ticks of
 * the five-minute cadence. An expired cursor reads as "nothing was starved", which is the
 * safe default: the pass simply runs in its normal order.
 */
const ROTATION_TTL_SECONDS = 3_600;

/** This pass's rotation. Never throws — a cache miss or failure means "run everything". */
export async function loadPassRotation(env: Env, tenantId: number, projectId: number): Promise<PassRotation> {
  const prior = await peekCached<RotationState>(env, rotationKey(tenantId, projectId)).catch(() => null);
  return decideRotation(prior);
}

/** Persist the cursor for the next pass. Best-effort: a lost write costs one unrotated pass. */
export async function savePassRotation(
  env: Env,
  tenantId: number,
  projectId: number,
  rotation: PassRotation,
  budgetShed: readonly string[],
): Promise<void> {
  await setCached(
    env,
    rotationKey(tenantId, projectId),
    carryOverRotation(rotation, budgetShed),
    { kvTtlSeconds: ROTATION_TTL_SECONDS },
  ).catch(() => undefined);
}
