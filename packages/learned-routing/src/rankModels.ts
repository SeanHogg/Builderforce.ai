/**
 * Learned Model Routing (PRD 13) — the PURE RANKER.
 *
 * Extracted out of the Worker-side `LlmProxyService` so BOTH engines can seed from
 * the same learned ranking with the same code: the cloud router (`pickCloudModel`)
 * and the on-prem / IDE host (`agent-runtime`, which must not import a Worker
 * application service). Dependency-free and I/O-free by contract — its only input is
 * a curated pool plus per-model stats, its only output a permutation of that pool.
 */

import { blendedQualityScore, isChronicallyRateLimited, qualityEvidence } from './modelQualityScore.js';

/** Minimal per-model stat shape the learned router ranks on — a structural subset
 *  of `routingTable.ActionModelStat`, declared here so this pure module never imports
 *  the routing-table/DB layer (keeps `rankModelsForAction` I/O-free + unit-testable). */
export interface ActionModelRankStat {
  model: string;
  n: number;
  avgScore: number;
  avgCostMc: number;
  /** Human thumbs on this (action, model) — see `modelQualityScore.ts`. Optional:
   *  absent on blobs written before migration 0468. */
  ratedUp?: number;
  ratedDown?: number;
  /** Share of this bucket's runs that died on a provider 429 (migration 0485).
   *  An AVAILABILITY signal — see `modelQualityScore.isChronicallyRateLimited`. */
  rateLimitRate?: number;
}

export interface RankModelsOptions {
  /** Minimum samples a (action_type, model) bucket needs before it can lead. */
  minSamples?: number;
  /** Optional client-computed SSM recall nudge (model → +/- weight) applied to the
   *  learned score BEFORE the sort. Personalization on top of the shared table. */
  bias?: Record<string, number>;
}

export const DEFAULT_MIN_SAMPLES = 8;

/**
 * Learned-routing reorder (PURE — no I/O). Stable-reorders the curated, plan-reachable
 * coding pool so the empirically-best model for this action type leads:
 *   • a model is ELIGIBLE to lead only with `minSamples` observations, counting BOTH
 *     scored runs and human thumbs ({@link qualityEvidence}) — a model with no runs
 *     but a dozen ratings is not cold, and treating it as cold is how chat-quality
 *     feedback ends up changing nothing;
 *   • eligible models sort by `blendedQualityScore (+ bias)` desc — run outcomes and
 *     human satisfaction, each weighted by how much evidence it has — ties broken by
 *     lower `avgCostMc`, then by the curated index (stable);
 *   • every model below the floor keeps the curated order, appended after;
 *   • when NO model clears the floor, the curated order is returned UNCHANGED
 *     (cold-start safety — routing degrades to today's static order).
 * The optional `bias` only nudges ordering AMONG already-eligible models (a nudge on
 * top of the table, never a way to surface a cold model). Never invents a model: the
 * output is always a permutation of `reachable`.
 */
export function rankModelsForAction(
  reachable: readonly string[],
  stats: ReadonlyArray<ActionModelRankStat> | undefined,
  opts?: RankModelsOptions,
): string[] {
  const minSamples = opts?.minSamples ?? DEFAULT_MIN_SAMPLES;
  const bias = opts?.bias ?? {};
  const statByModel = new Map<string, ActionModelRankStat>();
  for (const s of stats ?? []) statByModel.set(s.model, s);

  const curatedIndex = new Map<string, number>();
  reachable.forEach((m, i) => curatedIndex.set(m, i));

  // THROTTLED models are pulled out FIRST, before eligibility is even asked, and
  // appended last. A model whose recent history is mostly 429s is not a low scorer to
  // be ranked below the good ones — it is one the provider will refuse again, and
  // seeding it costs a real dispatch and a failed run to rediscover that. It is never
  // DROPPED: the cascade must always have somewhere to land, and "the only model left
  // is one that keeps getting throttled" beats returning nothing. Applied across both
  // bands because a chronically-refused model is frequently ALSO cold on quality
  // evidence (its runs never produced a deliverable to score), and leaving it in the
  // curated `rest` in its original position is exactly how it kept getting seeded.
  const throttled: string[] = [];
  const eligible: string[] = [];
  const rest: string[] = [];
  for (const m of reachable) {
    const s = statByModel.get(m);
    if (s && isChronicallyRateLimited(s)) throttled.push(m);
    else if (s && qualityEvidence(s) >= minSamples) eligible.push(m);
    else rest.push(m);
  }
  // Cold-start safety: with nothing ranked AND nothing throttled, the curated order
  // stands unchanged. A throttled model alone is still worth demoting.
  if (eligible.length === 0 && throttled.length === 0) return [...reachable];

  const scoreOf = (m: string): number => blendedQualityScore(statByModel.get(m)!) + (bias[m] ?? 0);
  eligible.sort((a, b) => {
    const d = scoreOf(b) - scoreOf(a);
    if (d !== 0) return d;
    const c = statByModel.get(a)!.avgCostMc - statByModel.get(b)!.avgCostMc;
    if (c !== 0) return c;
    return (curatedIndex.get(a)! - curatedIndex.get(b)!);
  });
  return [...eligible, ...rest, ...throttled];
}

/**
 * Does this scope's stat slice carry REAL evidence — at least one model that clears
 * the eligibility floor? The test that drives scope precedence (project → tenant →
 * global): the finest scope that answers true is the one whose ranking is used, and
 * a scope with only cold buckets is skipped rather than being allowed to shadow a
 * coarser scope that actually knows something.
 *
 * Shared because BOTH engines walk that ladder — the cloud router over KV blobs and
 * the on-prem host over its cached read of the same table — and a client that stopped
 * one scope earlier would seed a different model from identical evidence. PURE.
 */
export function scopeHasSignal(
  stats: ReadonlyArray<ActionModelRankStat> | undefined,
  minSamples: number = DEFAULT_MIN_SAMPLES,
): boolean {
  return !!stats && stats.some((s) => qualityEvidence(s) >= minSamples);
}
