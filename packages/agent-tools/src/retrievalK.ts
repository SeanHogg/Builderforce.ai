/**
 * `chooseK` — the ONE adaptive retrieval-depth policy (PRD C4, cost lever
 * `c4_adaptive_context`).
 *
 * Every recall path used to send a fixed K (memory 5, project facts 6, semantic search 8)
 * whether the first hit was a near-certain answer or the candidates were a flat field of
 * maybes. A clear head needs only the head; a flat distribution is where more context
 * actually helps. So retrieval starts small and widens to the caller's K only when the
 * score distribution shows no clear head:
 *   • the best score is below `floor` (nothing is a confident match), or
 *   • the best score is not clearly ahead of the first candidate the small cut would drop
 *     (relative gap below `headMargin`) — the cut would land in the middle of a plateau.
 *
 * Pure and runtime-agnostic (the Worker imports the package root), so the api, on-prem and
 * the desktop grounding share it. Callers gate it on
 * `isCostLeverOn(env, "c4_adaptive_context", tenantId)`; this helper does not read the lever.
 */

export interface ChooseKInput {
  /** The caller's K — what the path sends today. Never exceeded. */
  requested: number;
  /** Ranked candidate scores, best first (higher is better). */
  scores: readonly number[];
  /** Optional token budget for what is sent; with `itemTokens` it caps K further. */
  budgetTokens?: number;
  /** Estimated tokens per candidate, aligned with `scores`. */
  itemTokens?: readonly number[];
  /** Hard ceiling (the path's own max). Defaults to `requested`. */
  max?: number;
  /** Where retrieval starts. Default {@link ADAPTIVE_K_START}. */
  start?: number;
  /** Best score below this = no confident match → widen. Default {@link ADAPTIVE_K_FLOOR}. */
  floor?: number;
  /** Relative gap `(s[0] - s[start]) / s[0]` below this = plateau → widen. Default {@link ADAPTIVE_K_HEAD_MARGIN}. */
  headMargin?: number;
}

export const ADAPTIVE_K_START = 3;
export const ADAPTIVE_K_FLOOR = 0.5;
export const ADAPTIVE_K_HEAD_MARGIN = 0.15;

const positiveInt = (n: number | undefined, fallback: number): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;

/** True when the ranked scores have a clear head of size `start`. */
export function hasClearHead(scores: readonly number[], start = ADAPTIVE_K_START, floor = ADAPTIVE_K_FLOOR, headMargin = ADAPTIVE_K_HEAD_MARGIN): boolean {
  const top = Number(scores[0]);
  if (!Number.isFinite(top) || top < floor || top <= 0) return false;
  // Nothing beyond the small cut: the head IS the whole field.
  if (scores.length <= start) return true;
  const firstDropped = Number(scores[start]);
  if (!Number.isFinite(firstDropped)) return true;
  return (top - firstDropped) / top >= headMargin;
}

/** How many candidates to send. Always within [min(1, n), min(requested, max, n)]. */
export function chooseK(input: ChooseKInput): number {
  const n = input.scores.length;
  const requested = positiveInt(input.requested, 0);
  const ceiling = Math.min(requested, positiveInt(input.max, requested), n);
  if (ceiling <= 0) return 0;
  const start = Math.max(1, Math.min(positiveInt(input.start, ADAPTIVE_K_START), ceiling));
  let k = hasClearHead(input.scores, start, input.floor ?? ADAPTIVE_K_FLOOR, input.headMargin ?? ADAPTIVE_K_HEAD_MARGIN)
    ? start
    : ceiling;
  const budget = input.budgetTokens;
  if (typeof budget === "number" && Number.isFinite(budget) && input.itemTokens?.length) {
    let used = 0;
    let fit = 0;
    for (let i = 0; i < k; i++) {
      used += Math.max(0, Number(input.itemTokens[i] ?? 0) || 0);
      if (used > budget) break;
      fit = i + 1;
    }
    // Always send the best candidate, even when it alone exceeds the budget.
    k = Math.max(1, fit);
  }
  return k;
}
