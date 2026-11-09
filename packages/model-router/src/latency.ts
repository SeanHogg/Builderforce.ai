/**
 * THE measured per-model latency store for `@builderforce/model-router` — the one
 * place failover ranking reads (`latencySnapshot`) and hosts write (`recordLatency`).
 * Fix #8 (LATENCY-AWARE FAILOVER): a small turn must not fail over to a model many
 * times slower than the primary while the primary is still serving, so the ordering
 * needs real per-model turn durations, not just tiers and prices.
 *
 * Deliberately mirrors the sample semantics of `packages/run-policy/src/latencyGuard.ts`
 * (same window, same median) so a host can seed this store straight from its run state.
 * This module owns the store for ROUTING; run-policy keeps owning it for POLICY — the
 * ranking here only ever reads what it is handed, so the two never fight.
 */

/** Per-model turn durations (ms), most recent last. */
export type LatencySamples = Readonly<Record<string, readonly number[]>>;

/** How many recent turn durations a model keeps — enough for a stable median, small enough to follow a change. */
export const LATENCY_SAMPLE_WINDOW = 9;

let store: LatencySamples = {};

/** Record one measured turn duration for `model` (bounded to the sample window). Ignores empty models and non-finite/negative durations. */
export function recordLatency(model: string, durationMs: number): void {
  if (!model || !Number.isFinite(durationMs) || durationMs < 0) return;
  store = { ...store, [model]: [...(store[model] ?? []), durationMs].slice(-LATENCY_SAMPLE_WINDOW) };
}

/** The recorded samples, keyed by resolved model name. Read-side of the store; never mutate the result. */
export function latencySnapshot(): LatencySamples {
  return store;
}

/** The median of the samples, or undefined with none. */
export function p50(samples: readonly number[] | undefined): number | undefined {
  const valid = (samples ?? []).filter((n) => Number.isFinite(n) && n >= 0);
  if (valid.length === 0) return undefined;
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Forget every recorded sample — test and host-lifecycle reset. */
export function clearLatency(): void {
  store = {};
}
