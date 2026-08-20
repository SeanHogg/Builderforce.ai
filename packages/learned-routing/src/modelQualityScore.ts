/**
 * HOW GOOD IS THIS MODEL AT THIS KIND OF WORK — one number, from two independent
 * kinds of evidence. Pure, dependency-free, and deliberately a LEAF so the router
 * (`rankModelsForAction`), the routing-table blob (`sortStats`) and the ratings
 * rollup can all import it without a cycle.
 *
 * ── THE TWO SIGNALS ─────────────────────────────────────────────────────────
 *   • OUTCOMES  — `run_model_outcomes.score`: a composite of merge, CI, completion
 *     and efficiency over terminal cloud runs. Objective, but it only exists for
 *     work that produced a run and a pull request.
 *   • RATINGS   — `llm_action_ratings`: a human pressing a thumb on a reply. The
 *     ONLY quality evidence that exists for chat, canvas and tool turns, which are
 *     the majority of model calls and the ones a person actually reads.
 *
 * Neither is a superset of the other, and neither is trustworthy alone: outcomes
 * are blind to everything that is not a code change, and ratings are sparse and
 * arrive in ones and twos.
 *
 * ── HOW THEY COMBINE ────────────────────────────────────────────────────────
 * Each side is weighted by HOW MUCH EVIDENCE IT ACTUALLY HAS, so no constant has
 * to be invented to declare one more important than the other:
 *
 *     blended = (n·outcomeScore + r·ratingScore) / (n + r)
 *
 * With no ratings this is exactly the previous behaviour (`avgScore`). With no
 * runs it is pure human satisfaction. In between, forty runs are not overruled by
 * two thumbs, and forty thumbs are not overruled by two runs.
 *
 * Ratings are additionally SMOOTHED toward neutral (see {@link ratingScore}) so a
 * single thumbs-up cannot score a perfect 1.0 and leapfrog a model with a long,
 * good record — which is exactly how a ranking built on sparse feedback ends up
 * recommending whatever was tried once and happened to please.
 */

/**
 * Human satisfaction as a 0..1 score, shrunk toward neutral by how little evidence
 * it has (Laplace smoothing, one pseudo-vote each way): 1 up = 0.67, 9 up = 0.91,
 * 0 votes = 0.5. PURE.
 */
export function ratingScore(up: number, down: number): number {
  const u = Math.max(0, up || 0);
  const d = Math.max(0, down || 0);
  return (u + 1) / (u + d + 2);
}

/** The evidence a model has accumulated for one action type. A structural subset of
 *  `routingTable.ActionModelStat`, so both the blob and the router can pass their
 *  own row straight in. */
export interface ModelQualitySignals {
  /** Terminal cloud runs scored for this (action, model). */
  n: number;
  /** Mean composite outcome score over those runs, 0..1. */
  avgScore: number;
  ratedUp?: number;
  ratedDown?: number;
  /**
   * Share of this model's scored runs that ended on a PROVIDER RATE LIMIT — the 0/1
   * `run_model_outcomes.rate_limited` flag, averaged. Optional: absent on blobs
   * written before migration 0485.
   *
   * Deliberately NOT folded into {@link blendedQualityScore}. A rate-limited model is
   * not a BAD model — it is an UNREACHABLE one, and the two demand opposite responses.
   * Scoring it as low quality would teach the router that a strong coder is weak, and
   * that lesson would outlive the throttling by the full 60-day routing window. So the
   * signal is carried beside the quality score and consumed only by
   * {@link isChronicallyRateLimited}, which reorders — it never rescores.
   */
  rateLimitRate?: number;
}

/**
 * A model is chronically rate-limited for this kind of work when MOST of its recent
 * runs died on a provider 429 — not when one did.
 *
 * MEASURED (project 11, 2026-07-31): 150 of 164 terminal runs in a day were 429s from
 * the free coder pool, and the router kept seeding the same saturated models because
 * nothing in the learned table knew the difference between "tried and failed" and
 * "could not be tried at all". The per-model cooldown handles the next few minutes;
 * this is the STANDING preference that stops the router leading with a model whose
 * pool is saturated for this tenant day after day.
 */
export const RATE_LIMIT_DEMOTE_THRESHOLD = 0.5;

/** Minimum runs behind a rate-limit share before it may demote a model. Two 429s on a
 *  model that has only ever run twice is not a pattern; it is a bad afternoon. */
export const RATE_LIMIT_MIN_RUNS = 4;

/** True when the model's recent history says the provider will refuse it again. PURE. */
export function isChronicallyRateLimited(s: ModelQualitySignals): boolean {
  return (s.n || 0) >= RATE_LIMIT_MIN_RUNS && (s.rateLimitRate ?? 0) >= RATE_LIMIT_DEMOTE_THRESHOLD;
}

/** Total independent observations behind a model's score — runs PLUS human presses.
 *  This is what an eligibility floor should count: a model with no runs but twelve
 *  thumbs is far from cold, and treating it as cold is how chat-quality feedback
 *  ends up changing nothing. */
export function qualityEvidence(s: ModelQualitySignals): number {
  return (s.n || 0) + (s.ratedUp ?? 0) + (s.ratedDown ?? 0);
}

/** The evidence-weighted blend of outcome score and human satisfaction (see the
 *  module header). Returns `avgScore` unchanged when there are no ratings. */
export function blendedQualityScore(s: ModelQualitySignals): number {
  const n = Math.max(0, s.n || 0);
  const r = (s.ratedUp ?? 0) + (s.ratedDown ?? 0);
  if (r === 0) return s.avgScore || 0;
  const human = ratingScore(s.ratedUp ?? 0, s.ratedDown ?? 0);
  if (n === 0) return human;
  return (n * (s.avgScore || 0) + r * human) / (n + r);
}
