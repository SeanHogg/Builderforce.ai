/**
 * Latency-aware failover (fix #8) — the ORDERING half of the rule.
 *
 * Measured incident (VS Code chat #60338): failover moved small one-call code and
 * verify turns from a ~6s primary onto a model at 97s/46s/25s a turn. The hand-off
 * ranked by tier and price alone; it had no idea what the model it chose cost in
 * wall-clock time.
 *
 * The rule applied here: while ordering failover candidates for a CODE or VERIFY
 * role, a candidate whose recorded p50 turn latency is more than
 * {@link MAX_FAILOVER_LATENCY_RATIO}× the primary's p50 is demoted below every
 * candidate within the budget. Ordering only — never adds, drops or vetoes a model,
 * and when every candidate is over budget they keep their relative order rather than
 * all collapsing (a slow model still beats none). The guard lifts entirely when the
 * primary is down or unreachable, and a model with no recorded latency is not
 * evidence of slowness: it stays exactly where the rest of the ranking put it.
 */

import type { ModelRole } from '@builderforce/agent-tools';
import { p50, type LatencySamples } from './latency.js';

/** A failover target may be at most this many times slower (p50) than the primary while the primary serves. */
export const MAX_FAILOVER_LATENCY_RATIO = 3;

export interface LatencyGuardInput {
  /** The run's primary, by resolved model name — its p50 is the baseline. */
  primary?: string;
  /** Measured per-model turn durations, e.g. `latencySnapshot()`. Absent side => unmeasured => neutral. */
  samples?: LatencySamples;
  /** The primary is down / unreachable / rate-limited: any model beats none, so the guard lifts. */
  primaryDown?: boolean;
  /** Override for {@link MAX_FAILOVER_LATENCY_RATIO} (tests, experiments). */
  maxRatio?: number;
}

/** The roles whose failover ranking must respect measured latency (code and verify turns). Pure. */
export function roleAppliesLatencyGuard(role: ModelRole | undefined): boolean {
  return role === 'code' || role === 'verify';
}

/**
 * 0 when the model keeps its place (guard lifted, unmeasured on either side, the
 * primary itself, or within budget) and 1 when it is over budget and must sort
 * behind every 0. Feeds one extra sort key; it never adds or drops a model.
 */
export function latencyDemotion(model: string, input: LatencyGuardInput | undefined): number {
  if (!input || input.primaryDown || !input.primary || model === input.primary) return 0;
  const base = p50(input.samples?.[input.primary]);
  const theirs = p50(input.samples?.[model]);
  if (base === undefined || base <= 0 || theirs === undefined) return 0;
  return theirs <= base * (input.maxRatio ?? MAX_FAILOVER_LATENCY_RATIO) ? 0 : 1;
}
