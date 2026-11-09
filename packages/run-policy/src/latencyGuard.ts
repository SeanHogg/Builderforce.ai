/**
 * Latency-aware failover — a turn that is handed over must not land on a model that is
 * many times slower than the run's primary when the primary is still serving.
 *
 * Measured (VS Code chat #60338): the stall failover moved small one-call code and verify
 * turns from `local/kimi-code/kimi-for-coding` (~6s a turn) onto
 * `direct/minimax/MiniMax-M3.1-Flash-Preview` at 97s, 46s and 25s a turn. Nothing was down:
 * the hand-off had no idea what the model it chose cost in wall-clock time.
 *
 * The rule: during a code or verify turn, a candidate whose measured p50 turn latency is
 * more than {@link MAX_FAILOVER_LATENCY_RATIO}× the primary's is passed over for one within
 * that budget. It is an ORDERING preference, never a veto: when every candidate is over budget
 * the fastest of them still takes the turn (a slow model beats none), and when the primary is
 * unavailable (an error, a 429, a model that is down) latency does not apply at all. A model
 * with no measurement is not evidence of slowness and stays eligible. The samples are the run's
 * own durations of turns that ACTED (`turn_succeeded.durationMs` with `acted`), keyed by the
 * RESOLVED model name, optionally seeded by the host from earlier runs (`RunPolicyOptions.latencySeed`).
 *
 * Pure and I/O-free.
 */

/** Per-model turn durations (ms), most recent last. Plain JSON: it rides the durable run state. */
export type LatencySamples = Readonly<Record<string, readonly number[]>>;

/** How many recent turn durations a model keeps — enough for a stable median, small enough to follow a change. */
export const LATENCY_SAMPLE_WINDOW = 9;

/** A failover target may be at most this many times slower (p50) than the primary while the primary serves. */
export const MAX_FAILOVER_LATENCY_RATIO = 3;

/** The median of the samples, or undefined with none. */
export function p50(samples: readonly number[] | undefined): number | undefined {
  const valid = (samples ?? []).filter((n) => Number.isFinite(n) && n >= 0);
  if (valid.length === 0) return undefined;
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The samples with one more turn duration recorded for `model` (bounded to the window). */
export function recordLatency(
  samples: LatencySamples | undefined,
  model: string,
  durationMs: number,
  window: number = LATENCY_SAMPLE_WINDOW,
): LatencySamples {
  const base = samples ?? {};
  if (!model || !Number.isFinite(durationMs) || durationMs < 0) return base;
  const next = [...(base[model] ?? []), durationMs].slice(-Math.max(1, window));
  return { ...base, [model]: next };
}

export interface LatencyGuardInput {
  /** The model the run treats as its primary, by RESOLVED name (what its pin resolved to, else the first that acted). */
  primary: string | undefined;
  latency: LatencySamples | undefined;
  /** The primary errored, was rate-limited (429) or is down: latency no longer restricts the hand-off. */
  primaryUnavailable?: boolean;
  maxRatio?: number;
}

/** May `candidate` take a turn over from the primary? Unmeasured on either side ⇒ yes. */
export function withinLatencyBudget(candidate: string, input: LatencyGuardInput): boolean {
  const { primary } = input;
  if (input.primaryUnavailable || !primary || candidate === primary) return true;
  const base = p50(input.latency?.[primary]);
  const theirs = p50(input.latency?.[candidate]);
  if (base === undefined || theirs === undefined || base <= 0) return true;
  return theirs <= base * (input.maxRatio ?? MAX_FAILOVER_LATENCY_RATIO);
}

/** The candidates that may take a turn over, in the order given. Never adds or reorders. */
export function latencyEligible(candidates: readonly string[], input: LatencyGuardInput): string[] {
  return candidates.filter((m) => withinLatencyBudget(m, input));
}

/**
 * The candidate with the lowest measured p50 (an unmeasured one counts as fastest: no evidence of
 * slowness), ties to the earlier one; undefined with no candidates.
 */
export function fastestCandidate(candidates: readonly string[], latency: LatencySamples | undefined): string | undefined {
  let best: string | undefined;
  let bestP50 = Number.POSITIVE_INFINITY;
  for (const m of candidates) {
    const t = p50(latency?.[m]) ?? 0;
    if (best === undefined || t < bestP50) {
      best = m;
      bestP50 = t;
    }
  }
  return best;
}

/** How many picks a guarded picker walks past before it gives up (a surface is never longer in practice). */
const MAX_GUARDED_PICKS = 32;

/**
 * A picker that PREFERS candidates within the latency budget: asks `pick` again with each
 * over-budget model added to the skip list, until one passes. When the source runs dry with
 * only over-budget models seen, the fastest of them is the answer — latency orders a hand-off,
 * it never cancels one. Undefined only when the source offered nothing at all.
 */
export function guardedPick(
  pick: (skip: readonly string[]) => string | undefined,
  skip: readonly string[],
  input: LatencyGuardInput,
): string | undefined {
  const skipped = [...skip];
  const slow: string[] = [];
  for (let i = 0; i < MAX_GUARDED_PICKS; i++) {
    const next = pick(skipped);
    if (!next) break;
    if (withinLatencyBudget(next, input)) return next;
    slow.push(next);
    skipped.push(next);
  }
  return fastestCandidate(slow, input.latency);
}
