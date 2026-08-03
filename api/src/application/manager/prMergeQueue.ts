import { isActionExhausted } from './stallTriage';

/**
 * WHICH OPEN PULL REQUESTS MAY COST THE PASS ANYTHING.
 *
 * ── THE MEASUREMENT THAT FORCED THIS ─────────────────────────────────────────────
 * Project 11, 2026-07-30, api 2026.7.184 — the first pass that timed its own stages:
 *
 *   stageMs {load:468, board_staffing:427, census:1154, pr:28839, …}  elapsed 30888
 *   stageMs {load:579, board_staffing:435, census:878,  pr:18982, …}  elapsed 20874
 *
 * The PR stage is 93% of a 20s pass. Everything else together is under two seconds.
 * What it bought, in the same day: 233 `pr_conflict` decisions, 0 merges, 0 tickets
 * finished. The stage that consumes the entire budget is the stage that achieves
 * nothing, and it runs BEFORE triage — so the 304 `managed_no_role` tickets that triage
 * exists to move were starved on every pass to pay for it.
 *
 * ── WHY IT ACHIEVES NOTHING: 381 PRs ARE NOT 381 PROBLEMS ────────────────────────
 * They all target one base branch. Only the front of that line can merge, and the
 * instant it does every branch behind it is stale again. Handing twenty conflicting
 * branches back to twenty agents at once is therefore not twenty repairs — it is
 * nineteen repairs that are void before they finish, and each one costs a billable run.
 * That is the O(N²) the decision feed has been showing all along: 349 conflicts, 2
 * merges.
 *
 * A queue is the only shape that converges. The head is worked to a conclusion — merged,
 * or retired to a human by one of the ceilings — and only then does the next PR become
 * reachable. Work behind the head is not deferred because it is unimportant; it is
 * deferred because doing it now cannot survive the head landing.
 *
 * ── WHY THE ROTATION HAD TO GO WITH IT ───────────────────────────────────────────
 * 0383 ordered the window least-recently-worked-first so every PR got a turn. That fixed
 * a real starvation and created a worse one: a turn every ~19 passes (381 PRs, 20 a
 * pass ≈ 95 minutes) against a base that moves every few minutes means no PR ever
 * accumulates the three attempts its ceiling needs. The register is the proof —
 * `attempts=2`, on row after row, after 16 to 28 days of trying. A ceiling that cannot
 * be reached is not a ceiling, so nothing merged and nothing retired either.
 *
 * The order is now oldest-first and STABLE: the same PR is at the head next pass, so its
 * attempts accumulate and it reaches a conclusion within three of them. The tail is not
 * starved by this — it is queued, which is a state that ends.
 */

/**
 * How many PRs may cost provider round-trips in one pass.
 *
 * Measured cost of one worked PR is ~1.4s (28839ms across 20). Three keeps the stage
 * near 4s of the 14s discretionary window, which is what leaves room for the stages
 * after it AND the triage reserve. Deeper does not merge more — only the head can merge.
 */
export const MERGE_QUEUE_DEPTH = 1;

/** A conflicting head is retried autonomously, but never on every five-minute pass.
 * One retry per half hour is enough to pick up a repaired/restarted agent without
 * recreating the conflict storm this queue was introduced to stop. */
export const CONFLICT_RETRY_COOLDOWN_MS = 30 * 60_000;

/** The counters a queued PR is judged on. All are per-PULL-REQUEST (0383), never per
 *  ticket: `pull_requests.task_id` is nullable, and keying any of this on the ticket is
 *  what let an orphan PR escape every ceiling for six passes in thirty minutes. */
export interface QueuedPr {
  id: string;
  taskId: number | null;
  /** Times brought up to date with its base without ever merging. */
  syncs: number | null;
  /** Times the PROVIDER refused the merge. */
  mergeFailures: number | null;
  /** Times the branch was found conflicting with its base. */
  conflicts: number | null;
  /** Newest conflict observation. Required to turn the old permanent ceiling into a
   * bounded autonomous retry rather than an unbounded five-minute loop. */
  lastConflictAt?: Date | string | null;
}

export type PrDisposition =
  /** A ceiling is spent — report once and leave it for a human. Costs nothing. */
  | 'sync_exhausted'
  | 'merge_exhausted'
  | 'conflict_backoff'
  /** A resolution run already owns this branch; touching it would race that run. */
  | 'running'
  /** In the head — may spend provider round-trips this pass. */
  | 'work'
  /** Behind the head. Costs nothing: anything done here dies when the head merges. */
  | 'queued';

export interface PrPlanEntry<T> {
  pr: T;
  disposition: PrDisposition;
  /**
   * True for the FIRST worked PR only. Conflict recovery starts a cloud run — the most
   * expensive unit a pass has, measured at 16.4s against a 14s discretionary window (see
   * MIN_DISPATCH_WINDOW_MS) — so a pass may start at most one. It is also the only one
   * worth starting: the second resolution is invalidated by the first one merging.
   */
  mayRecover: boolean;
}

/**
 * Decide, for an ordered window of open PRs, which may cost anything this pass.
 *
 * Pure and total — every PR in the window gets an entry, so a caller cannot silently
 * drop one, and the counts are journalled so a pass can be read afterwards.
 *
 * A retired PR does not consume the head. An already-running repair DOES: allowing the
 * next branch to merge while the head is being repaired would immediately make that
 * repair stale, recreating the parallel conflict factory this queue replaces.
 */
export function planMergeQueue<T extends QueuedPr>(
  prs: readonly T[],
  opts: { hasActiveRun: (pr: T) => boolean; depth?: number; nowMs?: number },
): PrPlanEntry<T>[] {
  const depth = opts.depth ?? MERGE_QUEUE_DEPTH;
  const nowMs = opts.nowMs ?? Date.now();
  let worked = 0;
  return prs.map((pr) => {
    const at = (disposition: PrDisposition, mayRecover = false): PrPlanEntry<T> =>
      ({ pr, disposition, mayRecover });
    // Sync/provider refusals are structural ceilings. Conflicts are different: an agent
    // can repair one, so a running repair owns the head and an exhausted conflict merely
    // enters a bounded cooldown before autonomy tries again.
    if (isActionExhausted(pr.syncs ?? 0)) return at('sync_exhausted');
    if (isActionExhausted(pr.mergeFailures ?? 0)) return at('merge_exhausted');
    if (opts.hasActiveRun(pr)) {
      if (worked >= depth) return at('queued');
      worked += 1;
      return at('running');
    }
    if (worked >= depth) return at('queued');
    worked += 1;
    if (isActionExhausted(pr.conflicts ?? 0)) {
      const observedAt = pr.lastConflictAt == null ? Number.NaN : new Date(pr.lastConflictAt).getTime();
      if (Number.isFinite(observedAt) && nowMs - observedAt < CONFLICT_RETRY_COOLDOWN_MS) {
        return at('conflict_backoff');
      }
    }
    return at('work', worked === 1);
  });
}

/** Shape of a planned pass, for the closing journal — so the next capture can show
 *  whether the queue is draining without anyone having to infer it from decision counts. */
export function summarizeMergeQueue<T>(plan: readonly PrPlanEntry<T>[]): {
  worked: number; queued: number; retired: number; running: number; cooling: number; depth: number;
} {
  const count = (d: PrDisposition) => plan.filter((e) => e.disposition === d).length;
  return {
    worked: count('work'),
    queued: count('queued'),
    retired: count('sync_exhausted') + count('merge_exhausted'),
    running: count('running'),
    cooling: count('conflict_backoff'),
    depth: MERGE_QUEUE_DEPTH,
  };
}
