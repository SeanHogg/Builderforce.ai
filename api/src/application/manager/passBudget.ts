/**
 * passBudget — the manager pass's wall-clock budget, as a leaf primitive.
 *
 * ── WHY IT IS ITS OWN MODULE ─────────────────────────────────────────────────────
 * It lived in ManagerService, which was fine while the only thing bounded this way was
 * the pass. It is not any more: the PR merge loop is now its OWN registry sweep
 * (`application/repos/prMergeSweep.ts`), precisely so that a mechanical, provider-bound,
 * high-volume loop can no longer starve a judgement pass — and it is bounded by exactly
 * this budget, with the same "check between units, never mid-write" contract. A leaf
 * module lets that happen without a sweep in `repos/` importing the 2,500-line manager
 * pass for a clock. ManagerService re-exports every name below, so every existing
 * `from './ManagerService'` import keeps resolving.
 *
 * Pure: no imports, no IO, one `Date.now()` per question asked.
 */
/**
 * Wall-clock the whole pass may spend before it starts shedding OPTIONAL work to
 * guarantee it reaches its own closing journal.
 *
 * THE FAILURE THIS CLOSES. A pass runs inside ONE Worker invocation, and on a real
 * project (11: 673 tickets, 354 open PRs) it was being evicted partway through:
 * `manager_actions` showed triage journalling every few minutes while the `manager.pass`
 * activity row that CLOSES a pass had not been written since **2026-07-13**, and
 * `lastRunAt` sat 6 hours stale against a 5-minute cadence. Every stage after PR
 * coordination was in a dead zone, and — worse than the lost work — the pass never
 * recorded that it had been cut short. A truncated pass and a clean pass were
 * indistinguishable, so the manager reported health it had not verified.
 *
 * The census stage was moved ahead of the PR loop as a mitigation (see stage 3.5), but
 * reordering only decides WHO gets starved. This budget is the actual fix: past the
 * deadline the pass stops starting new optional work, records exactly which stage it
 * stopped at and why, and still writes its closing row. A short honest pass beats a long
 * silent one — and because the cadence is 5 minutes, the deferred work is picked up
 * almost immediately.
 *
 * 20s against a Worker CPU/wall ceiling comfortably above it: the point is to leave
 * room for the closing journal, not to run to the edge.
 */
export const MANAGER_PASS_BUDGET_MS = 20_000;

/**
 * Wall-clock held back from the discretionary stages and kept for TRIAGE (stage 7).
 *
 * ── THE FAILURE THIS CLOSES ──────────────────────────────────────────────────────
 * A plain deadline decides only WHO gets starved, and the answer was always the same
 * stage: triage runs last, so on any project where stages 1–6 exceed the budget it is
 * shed on EVERY pass, not occasionally. Measured on project 11 once the budget shipped —
 * every observed pass truncated `triage`, and its 12 stuck-register remedies sat at
 * `attempts=0` for 26 days. That is worse than no triage at all: because an attempt that
 * never happens cannot fail, the 3-attempt escalation ceiling is never reached either, so
 * nothing is worked AND nothing is handed to a human. The skip journal even promised "it
 * runs first on the next pass" — a rotation that did not exist, and could not, because
 * every pass restarts at stage 1.
 *
 * A reservation fixes it without a rotation cursor: the discretionary stages stop at
 * `budgetMs - MANAGER_TRIAGE_RESERVE_MS`, so triage always gets its slice and always makes
 * SOME progress. It is a floor, not a promise of completion — triage is itself bounded and
 * paces across passes — but a floor is what turns `attempts=0` forever into progress.
 */
export const MANAGER_TRIAGE_RESERVE_MS = 6_000;

/**
 * The pass's time budget. `over()` is checked BETWEEN units of optional work, never
 * mid-write — a stage that has started a mutation always finishes it, so the budget can
 * shed work but never leave a half-applied action.
 */
export interface PassBudget {
  /**
   * True when the DISCRETIONARY stages must stop. Fires early by
   * {@link MANAGER_TRIAGE_RESERVE_MS} so the reserved stage still has room to run.
   */
  over: () => boolean;
  /**
   * True when the WHOLE budget is gone — the reserved stage's own deadline. Only triage
   * checks this; everything else uses `over()`.
   */
  exhausted: () => boolean;
  elapsedMs: () => number;
  /** Wall-clock left before the DISCRETIONARY deadline; 0 once `over()`. */
  remainingMs: () => number;
  /**
   * True when a unit expected to cost `estimateMs` still fits before the discretionary
   * deadline.
   *
   * `over()` answers "has the deadline passed?", which cannot stop a unit that has not
   * started from running straight through it. Measured on project 11: the PR loop began an
   * iteration at ~11s of a 14s discretionary window, hit a merge conflict, dispatched a
   * recovery run, and returned at 27.6s — 7.6s past the whole 20s budget, reserve and all.
   * A reservation that can only be checked between units is not a reservation, so the
   * expensive units ask whether they FIT.
   */
  canAfford: (estimateMs: number) => boolean;
  /** Stages that were skipped or cut short, in order — journalled on the closing row. */
  truncated: string[];
  /** Record that `stage` was shed, once per stage. Returns true the first time. */
  shed: (stage: string) => boolean;
  /**
   * Close the current segment and attribute its wall-clock to `stage`.
   *
   * ── WHY THE PASS HAD TO START TIMING ITSELF ──────────────────────────────────
   * The pass already reported `elapsedMs` and the list of stages it SHED — enough to
   * prove it overran, and not enough to say WHERE. Diagnosing it from the decision feed
   * alone means inferring cost from which stages appear, and that inference was made
   * twice and was wrong twice: RANK was identified as the culprit from
   * `truncated: ["value", …]` (the budget was gone before `value`, and RANK was the only
   * expensive thing ahead of it), fixed — 300 writes a pass down to ~45, measured — and
   * the pass still overran identically: 20183 / 20827 / 21118 / 22032 / 23957 / 26024 ms
   * against a 20s budget, with `Stall triage skipped this pass` going from 3 to 7 of the
   * last 30 decisions.
   *
   * A budget that can only report that it was exceeded cannot be tuned, only guessed at.
   * These marks cost one `Date.now()` per stage and turn the next capture into an
   * answer instead of another hypothesis.
   */
  mark: (stage: string) => void;
  /** Wall-clock per stage, ms — journalled beside `truncated`. */
  timings: Record<string, number>;
}

export function createPassBudget(
  startedAt: number,
  budgetMs = MANAGER_PASS_BUDGET_MS,
  reserveMs = MANAGER_TRIAGE_RESERVE_MS,
): PassBudget {
  const truncated: string[] = [];
  const timings: Record<string, number> = {};
  let segmentStartedAt = startedAt;
  // Clamped so a caller-supplied budget smaller than the reserve cannot invert the two
  // deadlines and make `over()` fire before the pass has started.
  const discretionaryMs = Math.max(0, budgetMs - Math.min(reserveMs, budgetMs));
  const remainingMs = () => Math.max(0, discretionaryMs - (Date.now() - startedAt));
  return {
    timings,
    mark: (stage: string) => {
      const at = Date.now();
      // Accumulated, not assigned: a stage that runs in two segments (the PR loop's
      // conduct and merge halves) must report its TOTAL, or the one number a reader
      // most needs is the one that silently under-reports.
      timings[stage] = (timings[stage] ?? 0) + (at - segmentStartedAt);
      segmentStartedAt = at;
    },
    over: () => Date.now() - startedAt >= discretionaryMs,
    exhausted: () => Date.now() - startedAt >= budgetMs,
    elapsedMs: () => Date.now() - startedAt,
    remainingMs,
    canAfford: (estimateMs: number) => remainingMs() >= estimateMs,
    truncated,
    shed: (stage: string) => {
      if (truncated.includes(stage)) return false;
      truncated.push(stage);
      return true;
    },
  };
}
/**
 * The discretionary window a dispatch-shaped unit must still have before it may START.
 *
 * ── WHY THIS IS A FLOOR AND NOT THE UNIT'S COST ──────────────────────────────────
 * Starting a billable cloud run is the most expensive thing a pass does, and it is
 * expensive for reasons outside this codebase: the run's creation is preceded by artifact,
 * agent, repo and inference-model resolution, each a round-trip, before any container is
 * touched. Measured on project 11, the PR loop's conflict-recovery dispatch took **16.4s**
 * end to end (decision feed, 11:01:05.921 → 11:01:22.308) — more than the entire 14s
 * discretionary window.
 *
 * So gating on the unit's real cost would refuse every recovery dispatch forever, trading
 * a starved triage stage for a remedy that never runs. The honest reading is that a
 * reserve CANNOT be defended against a unit larger than itself; that guarantee is made
 * structurally instead, by `passRotation.ts`, which gives a starved stage the whole of the
 * next pass.
 *
 * What this floor still buys is real and cheap: it stops a pass beginning a many-second
 * unit with a second of window left, which is indefensible whatever the rotation does.
 */
export const MIN_DISPATCH_WINDOW_MS = 5_000;
