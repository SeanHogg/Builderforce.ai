/**
 * delta/dynamic/runnerTypes.ts — run-delta's dynamic-tier runner types (`dynamic/contract.ts`, `dynamic/tier.ts`),
 * restated STRUCTURALLY: run-delta imports agent-tools, so an import back would be a source-package cycle (the
 * same rule as `adapters/analyzer.ts`). The host that imports both (the VSIX's `runDelta/dynamicTier.ts`) asserts,
 * at the type level and both ways, that these equal run-delta's — a drift fails its type check, not a run.
 */

export type DynamicCheckIdLike = 'benchmark' | 'diff-coverage' | 'mutation';

/** run-delta `DynamicSkipReason`. */
export type SkipReasonLike =
  | 'opt-in-off' | 'not-scheduled' | 'not-configured' | 'tool-unavailable' | 'no-changed-code' | 'policy-never'
  | 'untrusted-workspace' | 'budget-exhausted';

export interface ThresholdLike { warn: number; error: number; kind: 'abs' | 'pct' }

/** run-delta `BenchmarkSpec`. */
export interface BenchSpecLike {
  id: string;
  command: string;
  unit: 'ms' | 'instructions';
  threshold: ThresholdLike;
  rounds: number;
  warmup: number;
}

/** run-delta `BenchmarkSamples`. */
export interface BenchSamplesLike {
  spec: { id: string; unit: 'ms' | 'instructions'; threshold?: ThresholdLike };
  samples: { before: readonly number[]; after: readonly number[] };
  /** run-delta `BenchmarkSamples.sequential`: false when the budget forced the fixed rounds instead of the SPRT. */
  sequential?: boolean;
}

/** run-delta `SequentialBenchmarkTest` (D9.2): rounds up to `cap(rounds)`, stopped once every series is `decided`. */
export interface SequentialLike {
  cap(rounds: number): number;
  decided(spec: { id: string; threshold?: ThresholdLike }, samples: { before: readonly number[]; after: readonly number[] }): boolean;
}

/** run-delta `RunnerOutcome`. */
export type Outcome<T> =
  | { ok: true; tool: string; version: string; value: T }
  | { ok: false; tool: string; version: string; reason: string };

/** run-delta `ReportOf`. */
export interface ReportLike { json: unknown; root: string }

/** run-delta `DynamicRunners`. */
export interface DynamicRunnersLike {
  availability(policy: { benchmarks: readonly BenchSpecLike[] }, changedCode: readonly string[]): Promise<Partial<Record<DynamicCheckIdLike, SkipReasonLike>>>;
  benchmarks(
    specs: readonly BenchSpecLike[], discovered: { rounds: number; warmup: number }, signal: AbortSignal, sequential?: SequentialLike,
  ): Promise<Outcome<BenchSamplesLike[]>>;
  tests(changedCode: readonly string[], signal: AbortSignal): Promise<Outcome<{ before?: ReadonlyMap<string, number>; after: ReadonlyMap<string, number> }>>;
  mutation(changedCode: readonly string[], signal: AbortSignal): Promise<Outcome<{ before?: ReportLike; after: ReportLike }>>;
}
