/**
 * THOMPSON EXPLORATION for learned routing (cost PRD D3). Pure, I/O-free, and driven
 * by an INJECTED random source so every decision is reproducible in a test.
 *
 * The deterministic ranker always seeds the current best, so a model that has never
 * been tried — or a cheaper one whose early runs were unlucky — never gets the samples
 * that would let it lead. Thompson sampling fixes that without a tuning constant per
 * model: each candidate's blended quality is a Beta posterior over its evidence, one
 * draw per candidate per request, and the highest draw leads. A model with a long, good
 * record has a tight posterior and almost always wins; two close models trade the lead
 * in proportion to how likely each is to actually be better.
 *
 * Cold models (below the evidence floor) are NOT ranked by a draw — their posterior is
 * wide enough that they would lead constantly. They get their own bounded slot instead:
 * at most `coldShare` (default 5%) of picks lead with a cold model, chosen uniformly.
 * That is the ONLY way a cold model reaches the front, so the cap is exact.
 */

import { blendedQualityScore, type ModelQualitySignals } from './modelQualityScore.js';
import { decaySince } from './recencyDecay.js';

/** Share of picks that may lead with a below-floor model. */
export const DEFAULT_COLD_EXPLORATION_SHARE = 0.05;

/** A uniform [0, 1) random source. `Math.random` in production; seeded in tests. */
export type RandomSource = () => number;

/**
 * Exploration settings for one ranking call. Passed only when the caller has decided
 * exploration is allowed for THIS request — the D3 lever is on, and the request is not
 * a strict pin, a BYO-strict chain or a premium override (the caller owns those flags;
 * this module never sees them). Absent = the deterministic ranking, byte-for-byte.
 */
export interface RoutingExploration {
  rng: RandomSource;
  /** Max share (0..1) of picks that lead with a cold model. Default 5%. */
  coldShare?: number;
  /** Read time, for decaying evidence by each stat's `at`. Absent = no read-time decay. */
  nowMs?: number;
}

/** The decay-aware fields a routing stat may carry (written by the decayed table). */
export interface DecayedEvidence {
  /** Effective (decayed) run count behind `avgScore`, when the table decays. */
  effectiveN?: number;
  /** Epoch ms of the last fold into this stat. */
  at?: number;
}

/** Posterior concentration: how many observations the draw believes, decayed to now. */
export function posteriorEvidence(s: ModelQualitySignals & DecayedEvidence, nowMs?: number): number {
  const runs = s.effectiveN ?? s.n ?? 0;
  const ratings = (s.ratedUp ?? 0) + (s.ratedDown ?? 0);
  return Math.max(0, (runs + ratings) * decaySince(s.at, nowMs));
}

/** One standard normal draw (Box–Muller) from the injected source. PURE given `rng`. */
function standardNormal(rng: RandomSource): number {
  const u = Math.max(Number.EPSILON, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * One Thompson draw of a model's quality: a Beta(q·e + 1, (1−q)·e + 1) posterior over
 * the blended score `q` with evidence `e`, sampled by its normal approximation (mean and
 * variance of the Beta, clamped to [0, 1]). The approximation is tight at the evidence
 * floor and above, which is the only band it ranks. PURE given `rng`.
 */
export function sampleQuality(s: ModelQualitySignals & DecayedEvidence, rng: RandomSource, nowMs?: number): number {
  const q = Math.min(1, Math.max(0, blendedQualityScore(s)));
  const e = posteriorEvidence(s, nowMs);
  const a = q * e + 1;
  const b = (1 - q) * e + 1;
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) * (a + b) * (a + b + 1)));
  return Math.min(1, Math.max(0, mean + sd * standardNormal(rng)));
}

/** Does this pick spend its exploration slot on a cold model? PURE given `rng`. */
export function shouldExploreCold(explore: RoutingExploration, coldCount: number): boolean {
  if (coldCount <= 0) return false;
  const share = Math.min(1, Math.max(0, explore.coldShare ?? DEFAULT_COLD_EXPLORATION_SHARE));
  return share > 0 && explore.rng() < share;
}

/** Uniform index into `count` items from the injected source. */
export function pickIndex(rng: RandomSource, count: number): number {
  return Math.min(count - 1, Math.floor(rng() * count));
}
