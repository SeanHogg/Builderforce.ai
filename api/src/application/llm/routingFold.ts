/**
 * The routing blob's shapes and the pure arithmetic that folds a run (or a human thumb) into it:
 * the per-model running stats, the best-first sort, and the plain (Welford) and recency-decayed
 * folds. Split out of `routingTable.ts`, which owns the cache, the reconcile and the scope ladder.
 *
 * ONE rule for a run that reported no cost: it is UNKNOWN, not free. The live fold here skips it
 * (the cost mean and its count `costN` move only on a priced run) exactly as the reconcile's SQL
 * does (`avg` / the weighted mean skip NULLs), so the two writers agree.
 */

import {
  blendedQualityScore,
  costForTieBreak,
  decayWeight,
  foldDecayedMean,
  isChronicallyRateLimited,
  rankWithCostTieBreak,
  type ActionType,
} from '@builderforce/learned-routing';
import type { ModelRole } from '@builderforce/agent-tools';

/** Per-model running stats for one action type. n/avgScore/avgCost are maintained
 *  incrementally (Welford); the array is kept sorted best-first (avgScore desc,
 *  then avgCost asc as the tie-break). */
export interface ActionModelStat {
  model: string;
  n: number;
  avgScore: number;
  /** Running merge rate (mean of the 0/1 merged flag) — a corroborating signal. */
  mergeRate: number;
  /** Running mean per-run cost in millicents over the runs that REPORTED one — the tie-break between
   *  equal scorers. Meaningless while `costN` is 0 (no priced run: unknown, not free). */
  avgCostMc: number;
  /** Runs behind `avgCostMc` that reported a cost. A run that did not is unknown and is skipped, here
   *  and by the reconcile alike. Absent on blobs written before cost could be unknown: every run counted. */
  costN?: number;
  /** The decayed weight of those priced runs (decay mode), as `effectiveN` is for all runs. */
  costEffectiveN?: number;
  /**
   * HUMAN thumbs on this (action, model), from `llm_action_ratings` (migration 0468).
   *
   * Kept as raw counts rather than a pre-blended score because the blend depends on
   * how much evidence the OTHER side has, and that is a read-time decision
   * (`rankModelsForAction`). They are a genuinely independent signal: a chat or
   * canvas turn has no merge and no CI, so for most model calls these are the ONLY
   * quality evidence that exists. Optional — blobs written before 0468 have none.
   */
  ratedUp?: number;
  ratedDown?: number;
  /**
   * Share of this bucket's runs that died on a provider 429 (migration 0485).
   *
   * An AVAILABILITY signal, kept strictly beside the quality score rather than inside
   * it — see `modelQualityScore.ts` for why conflating the two poisons the ranking.
   * Optional: blobs written before 0485 have none, and absent reads as 0 (not
   * rate-limited), which under-reports rather than demoting on evidence nobody has.
   */
  rateLimitRate?: number;
  /**
   * Effective (recency-decayed) run count behind the means, and the epoch ms they were
   * last folded at (cost PRD D3). Written only while the table decays; absent means the
   * means are plain window averages, read exactly as before. `n` stays the RAW count so
   * the evidence floor and the rate-limit minimum keep their meaning.
   */
  effectiveN?: number;
  at?: number;
}

export interface RoutingTable {
  updatedAt: string;
  /** action_type → models ranked best-first. */
  byAction: Partial<Record<ActionType, ActionModelStat[]>>;
  /** model ROLE → models ranked best-first, from the outcomes that recorded which role
   *  their model played (migration 1169). Optional: blobs written before it have none. */
  byRole?: Partial<Record<ModelRole, ActionModelStat[]>>;
}

/** Re-sort a per-action stat list best-first on the BLENDED quality score (run
 *  outcomes + human thumbs, each weighted by how much evidence it has — see
 *  modelQualityScore.ts); ties break to the cheaper model (lower avgCostMc) among those that know their cost — an
 *  unknown cost is no information and keeps its place (`rankWithCostTieBreak`).
 *  Stable for deterministic output, and the same ordering `rankModelsForAction`
 *  applies, so the blob and the router never disagree. */
export function sortStats(stats: ActionModelStat[]): ActionModelStat[] {
  return rankWithCostTieBreak(
    stats.map((s, i) => ({ s, i, q: blendedQualityScore(s), rl: isChronicallyRateLimited(s) ? 1 : 0 })),
    {
      // Rate-limited models form a TRAILING BAND, ranked normally within it. They are not
      // removed — "the only model left is one the provider keeps refusing" is still
      // strictly better than returning nothing, and the cascade needs somewhere to land.
      band: (e) => e.rl,
      score: (e) => e.q,
      index: (e) => e.i,
      cost: (e) => costForTieBreak(e.s),
    },
  ).map(({ s }) => s);
}

/** One terminal run, as the blob folds it. `rateLimited` rides alongside `merged`
 *  because it is the same grain — a property of THIS run — and giving it its own
 *  fold path would mean two writers racing on one bucket. */
export interface RoutingObservation {
  actionType: ActionType;
  model: string;
  score: number;
  /** Millicents the run cost. Absent = the run reported none: unknown, folded into nothing. */
  costMc?: number;
  merged: boolean;
  /** The run died on a provider rate limit (`classifyRunFailure === 'rate_limited'`). */
  rateLimited?: boolean;
  /** The role the model played, when known — also folds into `byRole`. */
  role?: ModelRole | null;
}

/** How one fold treats age: absent = plain Welford (today), present = decayed means. */
export interface FoldDecay {
  nowMs: number;
}

/** Recency-decayed fold (cost PRD D3): every running mean carries its effective weight,
 *  decayed from the stat's last fold to now, before the fresh point lands. A stat with
 *  no `at` (written before decay was on) carries its raw `n` undecayed — no age is
 *  invented for it. */
function foldDecayed(prev: ActionModelStat, score: number, costMc: number | undefined, merged: boolean, rl: number, nowMs: number): ActionModelStat {
  const weight = prev.effectiveN ?? prev.n;
  const age = prev.at != null ? nowMs - prev.at : 0;
  const fold = (mean: number, x: number) => foldDecayedMean(mean, weight, x, age);
  const scored = fold(prev.avgScore, score);
  return {
    ...prev,
    n: prev.n + 1,
    avgScore: scored.mean,
    mergeRate: fold(prev.mergeRate, merged ? 1 : 0).mean,
    ...foldedCostDecayed(prev, costMc, age),
    rateLimitRate: fold(prev.rateLimitRate ?? 0, rl).mean,
    effectiveN: scored.weight,
    at: nowMs,
  };
}

/** The cost mean after one decayed fold. A run with no cost leaves the mean alone and only ages the
 *  weight behind it (the stat's clock moves to now either way). */
function foldedCostDecayed(prev: ActionModelStat, costMc: number | undefined, age: number): Pick<ActionModelStat, 'avgCostMc' | 'costN' | 'costEffectiveN'> {
  const costN = prev.costN ?? prev.n;
  // The weight behind the cost mean: its own decayed weight, else the priced SHARE of the decayed run
  // weight (a plain fold in between moved `n` and `costN` but not the weights), else the raw count.
  const weight = prev.costEffectiveN ?? (prev.effectiveN != null && prev.n > 0 ? prev.effectiveN * (costN / prev.n) : costN);
  if (costMc === undefined) return { avgCostMc: prev.avgCostMc, costN, costEffectiveN: weight * decayWeight(age) };
  const folded = foldDecayedMean(prev.avgCostMc, weight, costMc, age);
  return { avgCostMc: folded.mean, costN: costN + 1, costEffectiveN: folded.weight };
}

/** Welford-style update of one model's running stats with a fresh observation — or the
 *  decayed fold when `decay` is given. */
function foldObservation(prev: ActionModelStat | undefined, model: string, score: number, costMc: number | undefined, merged: boolean, rateLimited: boolean, decay?: FoldDecay): ActionModelStat {
  const rl = rateLimited ? 1 : 0;
  if (!prev) {
    return {
      model, n: 1, avgScore: score, mergeRate: merged ? 1 : 0, avgCostMc: costMc ?? 0, costN: costMc === undefined ? 0 : 1, rateLimitRate: rl,
      ...(decay ? { effectiveN: 1, costEffectiveN: costMc === undefined ? 0 : 1, at: decay.nowMs } : {}),
    };
  }
  if (decay) return { ...foldDecayed(prev, score, costMc, merged, rl, decay.nowMs), model };
  const n = prev.n + 1;
  // The cost mean runs over the PRICED runs only: a run with no cost is skipped, not counted as free.
  const costN = (prev.costN ?? prev.n) + (costMc === undefined ? 0 : 1);
  return {
    ...prev,
    model,
    n,
    avgScore: prev.avgScore + (score - prev.avgScore) / n,
    mergeRate: prev.mergeRate + ((merged ? 1 : 0) - prev.mergeRate) / n,
    avgCostMc: costMc === undefined ? prev.avgCostMc : prev.avgCostMc + (costMc - prev.avgCostMc) / costN,
    costN,
    rateLimitRate: (prev.rateLimitRate ?? 0) + (rl - (prev.rateLimitRate ?? 0)) / n,
  };
}

/** Fold an observation into one stat list (pure) — returns a NEW list, re-sorted. */
function foldIntoList(list: ActionModelStat[] | undefined, obs: RoutingObservation, decay?: FoldDecay): ActionModelStat[] {
  const next = (list ?? []).slice();
  const idx = next.findIndex((s) => s.model === obs.model);
  const updated = foldObservation(idx >= 0 ? next[idx] : undefined, obs.model, obs.score, obs.costMc, obs.merged, obs.rateLimited === true, decay);
  if (idx >= 0) next[idx] = updated;
  else next.push(updated);
  return sortStats(next);
}

/** Apply one fresh observation to a blob (pure) — returns a NEW table, re-sorted. A
 *  role-bearing observation also folds into that role's list. */
export function applyObservation(
  table: RoutingTable,
  obs: RoutingObservation,
  decay?: FoldDecay,
): RoutingTable {
  const byAction = { ...table.byAction, [obs.actionType]: foldIntoList(table.byAction[obs.actionType], obs, decay) };
  const byRole = obs.role
    ? { ...table.byRole, [obs.role]: foldIntoList(table.byRole?.[obs.role], obs, decay) }
    : table.byRole;
  return { updatedAt: new Date().toISOString(), byAction, ...(byRole ? { byRole } : {}) };
}

/** Apply one human thumb to a blob (pure) — returns a NEW table, re-sorted. A model
 *  with no outcome row yet gets one at `n: 0`: for a chat or canvas turn there is no
 *  run to score, and the rating is the only evidence there will ever be. */
export function applyRatingObservation(
  table: RoutingTable,
  obs: { actionType: ActionType; model: string; up: boolean },
): RoutingTable {
  const byAction = { ...table.byAction };
  const list = (byAction[obs.actionType] ?? []).slice();
  const idx = list.findIndex((s) => s.model === obs.model);
  const prev: ActionModelStat = idx >= 0 ? list[idx]! : { model: obs.model, n: 0, avgScore: 0, mergeRate: 0, avgCostMc: 0, costN: 0, rateLimitRate: 0 };
  const updated: ActionModelStat = {
    ...prev,
    ratedUp: (prev.ratedUp ?? 0) + (obs.up ? 1 : 0),
    ratedDown: (prev.ratedDown ?? 0) + (obs.up ? 0 : 1),
  };
  if (idx >= 0) list[idx] = updated;
  else list.push(updated);
  byAction[obs.actionType] = sortStats(list);
  // A thumb carries no role, so the per-role lists pass through untouched.
  return { updatedAt: new Date().toISOString(), byAction, ...(table.byRole ? { byRole: table.byRole } : {}) };
}
