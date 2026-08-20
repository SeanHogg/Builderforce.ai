/**
 * Learned Model Routing (PRD 13 §6.4) — THE LOCAL BIAS.
 *
 * `rankModelsForAction` takes an optional `bias` map: a per-model additive nudge
 * applied to the learned score before the sort. In the browser that nudge is an SSM
 * recall over the tenant's scored outcomes. On a self-hosted host the equivalent
 * local signal is the host's OWN recent history — which models actually finish work
 * HERE, on this machine, against this repo, through these credentials.
 *
 * That signal is real and the fleet cannot see it: a model that the fleet ranks first
 * may be the one whose provider key is rate-limited on this box, pointed at a local
 * endpoint that is down, or simply weak on this codebase. But it is also THIN — a
 * handful of runs against a table built from thousands — so it is allowed to nudge
 * and never to decide:
 *
 *   • bounded to ±{@link MAX_LOCAL_BIAS} (0.05) against a learned score that spans
 *     0..1, so it can only reorder models the fleet already considers close;
 *   • shrunk by how little evidence it has, so one lucky run is worth almost nothing;
 *   • scoped to the SAME action type, so success at writing docs never promotes a
 *     model for SQL;
 *   • it never introduces a model — the ranker only applies a bias to models already
 *     eligible on fleet evidence, so a locally-lucky unknown cannot leapfrog.
 *
 * PURE — history in, map out. No clock, no I/O; the caller supplies `now`.
 */

/** One terminal run this host observed. Deliberately the minimum: enough to score a
 *  model for a kind of work, nothing that could identify a prompt or a person. */
export interface LocalOutcome {
  /** The candidate key the ranker sorts on (see `candidate-keys.ts`). */
  model: string;
  /** The shared-taxonomy bucket the run was labelled with. */
  actionType: string;
  /** Did the run reach a terminal success. */
  succeeded: boolean;
  /** The run died on a provider rate limit — counted as a failure for the local
   *  nudge (this host could not USE the model), never as a quality verdict. */
  rateLimited?: boolean;
  /** Epoch ms the run ended. */
  at: number;
}

/** Hard ceiling on the nudge, in learned-score units (the score itself is 0..1). */
export const MAX_LOCAL_BIAS = 0.05;

/** Runs (per model, per action) at which the local signal reaches full strength.
 *  Below it the nudge is scaled down proportionally. */
export const FULL_STRENGTH_RUNS = 5;

/** How far back local history counts. A model that failed here three weeks ago has
 *  probably been upgraded, re-keyed, or fixed since. */
export const LOCAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export interface LocalBiasOptions {
  /** Epoch ms "now" — supplied so the function stays pure and testable. */
  now: number;
  /** Only outcomes for this action type contribute. */
  actionType: string;
  maxBias?: number;
  fullStrengthRuns?: number;
  windowMs?: number;
}

/**
 * Compute the per-model nudge map from this host's own recent outcomes.
 *
 * Per model: the Laplace-smoothed local success rate (one pseudo-run each way, so a
 * single result cannot read as 0% or 100%) is centred on 0.5 to give a direction,
 * then scaled by evidence and clamped to `maxBias`. A model with no local history
 * gets no entry at all — absent means "no opinion", which is different from 0 only in
 * that it costs nothing to carry.
 */
export function computeLocalBias(
  history: readonly LocalOutcome[],
  opts: LocalBiasOptions,
): Record<string, number> {
  const maxBias = opts.maxBias ?? MAX_LOCAL_BIAS;
  const fullStrength = Math.max(1, opts.fullStrengthRuns ?? FULL_STRENGTH_RUNS);
  const windowMs = opts.windowMs ?? LOCAL_WINDOW_MS;
  const cutoff = opts.now - windowMs;

  const tally = new Map<string, { wins: number; runs: number }>();
  for (const o of history) {
    if (!o.model || o.actionType !== opts.actionType) {
      continue;
    }
    if (!Number.isFinite(o.at) || o.at < cutoff || o.at > opts.now) {
      continue;
    }
    const t = tally.get(o.model) ?? { wins: 0, runs: 0 };
    t.runs += 1;
    // A rate-limited run is not a success here even if it eventually completed on a
    // retry: this host could not reach the model when it needed it.
    if (o.succeeded && o.rateLimited !== true) {
      t.wins += 1;
    }
    tally.set(o.model, t);
  }

  const bias: Record<string, number> = {};
  for (const [model, { wins, runs }] of tally) {
    const rate = (wins + 1) / (runs + 2); // Laplace-smoothed, 0..1, neutral at 0.5
    const direction = (rate - 0.5) * 2; // -1..1
    const strength = Math.min(1, runs / fullStrength);
    const raw = direction * strength * maxBias;
    // Guard the ceiling explicitly rather than trusting the arithmetic — this number
    // is the ONE thing standing between a thin local record and the fleet's ranking.
    bias[model] = Math.max(-maxBias, Math.min(maxBias, Number(raw.toFixed(6))));
  }
  return bias;
}
