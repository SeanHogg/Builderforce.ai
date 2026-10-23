/**
 * RECENCY DECAY for learned routing (cost PRD D3) — how much an old observation still
 * counts. Pure and dependency-free so the routing-table rebuild (SQL weights), its
 * incremental fold (running means) and the ranker (evidence at read time) all decay
 * with the SAME half-life.
 *
 * Why a half-life rather than the hard 60-day window alone: a window treats a run from
 * yesterday and one from day 59 as equally informative, then forgets the day-59 run
 * entirely on day 61. A model that improved (or regressed) last week keeps being ranked
 * on two months of stale evidence. Exponential decay lets recent evidence dominate
 * while old evidence fades instead of falling off a cliff.
 */

/** Days for an observation's weight to halve. */
export const ROUTING_HALF_LIFE_DAYS = 30;

/** How far back the decayed rebuild scans. At 4 half-lives an observation weighs 1/16 —
 *  past that it no longer moves a mean, so the scan stays bounded. */
export const DECAYED_WINDOW_DAYS = 4 * ROUTING_HALF_LIFE_DAYS;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Weight of an observation `ageMs` old: 1 now, 0.5 one half-life ago. Future or
 *  non-finite ages weigh 1 (a clock skew never inflates or erases evidence). PURE. */
export function decayWeight(ageMs: number, halfLifeDays: number = ROUTING_HALF_LIFE_DAYS): number {
  if (!Number.isFinite(ageMs) || ageMs <= 0 || !(halfLifeDays > 0)) return 1;
  return Math.pow(0.5, ageMs / (halfLifeDays * DAY_MS));
}

/** One decayed running mean: the previous mean carried at its (already decayed)
 *  weight plus one fresh observation at weight 1. */
export interface DecayedMean {
  mean: number;
  weight: number;
}

/**
 * Fold one observation into an exponentially-decayed running mean. `prevWeight` is the
 * effective sample size at `prevAtMs`; it decays to `nowMs` before the new point lands.
 * With no age (both clocks equal) this is exactly Welford's incremental mean. PURE.
 */
export function foldDecayedMean(
  prevMean: number,
  prevWeight: number,
  x: number,
  ageMs: number,
  halfLifeDays: number = ROUTING_HALF_LIFE_DAYS,
): DecayedMean {
  const carried = Math.max(0, prevWeight) * decayWeight(ageMs, halfLifeDays);
  const weight = carried + 1;
  return { mean: prevMean + (x - prevMean) / weight, weight };
}

/** The decay factor for a stat last folded at `atMs`, read at `nowMs` (1 when either
 *  clock is unknown — an old blob with no timestamp is read as-is). PURE. */
export function decaySince(atMs: number | undefined, nowMs: number | undefined, halfLifeDays: number = ROUTING_HALF_LIFE_DAYS): number {
  if (atMs == null || nowMs == null) return 1;
  return decayWeight(nowMs - atMs, halfLifeDays);
}
