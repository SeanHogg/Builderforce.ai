/**
 * evermind-benchmark.ts — in-browser benchmarking for the Studio.
 *
 * Builds a fresh EvermindLM from a corpus, holds out a slice the model never
 * trains on, and scores it with the standard language-model yardsticks
 * (perplexity, bits-per-token, top-1/top-k next-token accuracy, throughput) plus
 * a qualitative generation sample. Runs entirely on-device (pure CPU) via
 * @seanhogg/builderforce-memory-engine — no WebGPU and no network required, so
 * it works in every browser.
 *
 * Delegates to the engine's canonical `trainAndBenchmark` harness (shipped in
 * @seanhogg/builderforce-memory-engine ≥ 2026.6.34), dynamically imported so the
 * heavy engine bundle only loads when a benchmark is actually run.
 */

import type {
  TrainAndBenchmarkOptions,
  TrainAndBenchmarkResult,
} from '@seanhogg/builderforce-memory-engine';

export type EvermindBenchmarkOptions = TrainAndBenchmarkOptions;
export type EvermindBenchmarkResult = TrainAndBenchmarkResult;

/**
 * Train + benchmark an EvermindLM on the given corpus, on-device. Yields once
 * before the synchronous CPU work so the caller's "running" UI can paint first.
 */
export async function runEvermindBenchmark(
  corpus: string,
  opts: EvermindBenchmarkOptions = {},
): Promise<EvermindBenchmarkResult> {
  const engine = await import('@seanhogg/builderforce-memory-engine');
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return engine.trainAndBenchmark(corpus, opts);
}
