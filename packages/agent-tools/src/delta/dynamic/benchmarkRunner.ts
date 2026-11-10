/**
 * delta/dynamic/benchmarkRunner.ts — C6.2 interleaved A/B benchmarks of the before and after trees (both scratch
 * copies: the same filesystem, the same depth, so neither side is favoured by where it lives).
 *
 * Each round measures both trees back to back, alternating which goes first (AB, BA, AB, …) so drift and
 * thermal effects fall evenly on both sides; the two values of a round are one PAIR. Warm-up runs come first, one
 * per side each, and are not measured. A round where either side fails stops the benchmark (`exit-failed`,
 * `timeout`, …): a broken benchmark is never half-measured.
 *
 *  - Configured benchmarks (`.builderforce/delta.json → benchmarks`): the command through the platform shell
 *    ({@link shellCommand}), timed by the host's monotonic clock. An `instructions` benchmark counts instructions under
 *    `perf stat` (Linux), when a one-off probe (`perf stat -e instructions -- true`) shows the counter works; otherwise
 *    it is timed and reports `ms`. The check's `tool` is `perf` only when a benchmark was actually counted.
 *  - None configured: the vitest `bench` files, one `vitest bench --run --outputJson` per tree per round; every
 *    benchmark in the report is one paired series.
 *
 * The statistics (Wilcoxon signed-rank, Hodges–Lehmann, bootstrap CI) are run-delta's, over these samples. So is the
 * D9.2 sequential test: handed one ({@link SequentialLike}, run-delta's sign-test SPRT), the rounds stop as soon as it
 * decides every series, up to its cap.
 */

import { bothTrees, packageBin, readJson, remaining, shellCommand, stepFailure, type DynamicHost } from './host.js';
import type { BenchSamplesLike, BenchSpecLike, Outcome, SequentialLike, ThresholdLike } from './runnerTypes.js';
import { benchValues } from './vitestReports.js';

type Side = 'before' | 'after';
/** One measurement of one tree: a value per benchmark key, or why it failed. */
type Measure = (side: Side) => Promise<Map<string, number> | string>;

const INSTRUCTIONS = /^\s*(\d+)\s*,[^,]*,\s*instructions/m;

type Series = Map<string, { before: number[]; after: number[] }>;

/**
 * D9.2 sequential stopping: with a {@link SequentialLike} test the rounds run up to its `cap` (never fewer than the fixed
 * rounds), and stop after a round once every series so far is decided (the test itself only stops at even rounds).
 * Without one: the fixed rounds, never stopped.
 */
interface Rounds {
  fixed: number;
  cap: number;
  stop?(series: Series): boolean;
}

/** The host clock and the tier's deadline: whether the remaining budget can afford the cap. */
interface Budget {
  now(): number;
  deadline: number;
}

function roundsOf(fixed: number, sequential: SequentialLike | undefined, thresholdOf: (id: string) => ThresholdLike | undefined): Rounds {
  if (!sequential) return { fixed, cap: fixed };
  return {
    fixed,
    cap: Math.max(fixed, sequential.cap(fixed)),
    stop: (series) => series.size > 0
      && [...series].every(([id, samples]) => {
        const threshold = thresholdOf(id);
        return sequential.decided(threshold ? { id, threshold } : { id }, samples);
      }),
  };
}

/**
 * Rounds of interleaved pairs per benchmark key (a key missing on either side of a round adds no pair). Fails on the first
 * failing step. Sequential: after the first round, when that round's time × the cap would overrun the remaining budget,
 * the fixed rounds run instead (reported by C6.2), so the SPRT never spends a budget it cannot afford.
 */
async function interleave(plan: Rounds, warmup: number, measure: Measure, budget?: Budget): Promise<{ series: Series; fellBack: boolean } | string> {
  let fellBack = false;
  let rounds = plan.cap;
  let stop = plan.stop;
  for (let i = 0; i < warmup; i++) {
    for (const side of ['before', 'after'] as const) {
      const w = await measure(side);
      if (typeof w === 'string') return w;
    }
  }
  const series: Series = new Map();
  for (let i = 0; i < rounds && !stop?.(series); i++) {
    const t0 = budget?.now();
    const order: Side[] = i % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
    const got: Partial<Record<Side, Map<string, number>>> = {};
    for (const side of order) {
      const m = await measure(side);
      if (typeof m === 'string') return m;
      got[side] = m;
    }
    for (const [key, b] of got.before!) {
      const a = got.after!.get(key);
      if (a === undefined) continue;
      const s = series.get(key) ?? { before: [], after: [] };
      s.before.push(b);
      s.after.push(a);
      series.set(key, s);
    }
    if (i === 0 && stop && budget && t0 !== undefined) {
      const perRound = budget.now() - t0;
      if (perRound * (plan.cap - 1) > budget.deadline - budget.now()) {
        rounds = plan.fixed;
        stop = undefined;
        fellBack = true;
      }
    }
  }
  return { series, fellBack };
}

/** `perf` (Linux, outside the repository) when its instruction counter works here; else undefined (wall time). */
async function workingPerf(host: DynamicHost, cwd: string, scratch: string, signal: AbortSignal): Promise<string | undefined> {
  if (host.platform !== 'linux') return undefined;
  const perf = await host.exec.which('perf').catch(() => undefined);
  if (!perf) return undefined;
  const out = `${scratch}/perf-probe.txt`;
  const r = await host.exec.run([perf, 'stat', '-x', ',', '-e', 'instructions', '-o', out, '--', 'true'], { cwd, timeoutMs: 10_000, signal }).catch(() => undefined);
  if (!r || !r.started || r.exitCode !== 0) return undefined;
  return INSTRUCTIONS.test((await host.exec.readText(out).catch(() => undefined)) ?? '') ? perf : undefined;
}

async function runConfigured(
  host: DynamicHost, trees: Record<Side, string>, specs: readonly BenchSpecLike[], signal: AbortSignal, deadline: number, sequential?: SequentialLike,
): Promise<Outcome<BenchSamplesLike[]>> {
  const { exec } = host;
  const scratch = await exec.tempDir();
  try {
    const perf = specs.some((s) => s.unit === 'instructions') ? await workingPerf(host, trees.after, scratch.path, signal) : undefined;
    const tool = perf && specs.some((s) => s.unit === 'instructions') ? 'perf' : 'command';
    const out: BenchSamplesLike[] = [];
    for (const spec of specs) {
      const shell = await shellCommand(host, spec.command);
      if (!shell) return { ok: false, tool, version: '', reason: 'no-shell' };
      const counted = perf !== undefined && spec.unit === 'instructions';
      const measure: Measure = async (side) => {
        const file = `${scratch.path}/perf-${side}.txt`;
        const argv = counted ? [perf!, 'stat', '-x', ',', '-e', 'instructions', '-o', file, '--', ...shell.argv] : shell.argv;
        const t0 = host.now();
        const r = await exec.run(argv, {
          cwd: trees[side], timeoutMs: remaining(host, deadline), signal, ...(shell.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
        });
        const ms = host.now() - t0;
        if (!r.started || r.timedOut || r.exitCode !== 0 || signal.aborted) return stepFailure(r, signal);
        if (!counted) return new Map([[spec.id, ms]]);
        const m = INSTRUCTIONS.exec((await exec.readText(file).catch(() => undefined)) ?? '');
        return m ? new Map([[spec.id, Number(m[1])]]) : 'no-report';
      };
      const run = await interleave(roundsOf(spec.rounds, sequential, () => spec.threshold), spec.warmup, measure, { now: () => host.now(), deadline });
      if (typeof run === 'string') return { ok: false, tool, version: '', reason: run };
      const s = run.series.get(spec.id);
      // `sequential: false`: the budget forced the fixed rounds, so the tier must not read the SPRT on these samples.
      if (s) out.push({ spec: { id: spec.id, unit: counted ? 'instructions' : 'ms', threshold: spec.threshold }, samples: s, ...(run.fellBack ? { sequential: false } : {}) });
    }
    return { ok: true, tool, version: '', value: out };
  } finally {
    await scratch.dispose().catch(() => undefined);
  }
}

async function runVitestBench(
  host: DynamicHost, trees: Record<Side, string>, rounds: { rounds: number; warmup: number }, signal: AbortSignal, deadline: number,
  sequential?: SequentialLike,
): Promise<Outcome<BenchSamplesLike[]>> {
  const { exec } = host;
  const bins = { before: await packageBin(exec, trees.before, 'vitest', 'vitest'), after: await packageBin(exec, trees.after, 'vitest', 'vitest') };
  if (!bins.before || !bins.after) return { ok: false, tool: 'vitest-bench', version: '', reason: 'tool-unavailable' };
  const version = bins.after.version;
  const scratch = await exec.tempDir();
  try {
    const measure: Measure = async (side) => {
      const file = `${scratch.path}/bench-${side}.json`;
      const r = await exec.run(['node', bins[side]!.entry, 'bench', '--run', '--outputJson', file], { cwd: trees[side], timeoutMs: remaining(host, deadline), signal });
      if (!r.started || r.timedOut || signal.aborted) return stepFailure(r, signal);
      const values = benchValues(await readJson(exec, file), trees[side]);
      if (values && [...values.values()].some((v) => !Number.isFinite(v))) return 'non-finite-samples';
      return values && values.size > 0 ? values : r.exitCode === 0 ? 'no-report' : 'exit-failed';
    };
    // A discovered benchmark has no threshold of its own: the sequential test applies its default.
    const run = await interleave(roundsOf(rounds.rounds, sequential, () => undefined), rounds.warmup, measure, { now: () => host.now(), deadline });
    if (typeof run === 'string') return { ok: false, tool: 'vitest-bench', version, reason: run };
    const value = [...run.series].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([id, samples]) => ({ spec: { id, unit: 'ms' as const }, samples, ...(run.fellBack ? { sequential: false } : {}) }));
    return { ok: true, tool: 'vitest-bench', version, value };
  } finally {
    await scratch.dispose().catch(() => undefined);
  }
}

/** Every benchmark's interleaved pairs: the configured ones, else the discovered vitest `bench` files. */
export async function runBenchmarks(
  host: DynamicHost, specs: readonly BenchSpecLike[], discovered: { rounds: number; warmup: number }, signal: AbortSignal, deadline: number,
  sequential?: SequentialLike,
): Promise<Outcome<BenchSamplesLike[]>> {
  const trees = await bothTrees(host);
  if (typeof trees === 'string') return { ok: false, tool: specs.length > 0 ? 'command' : 'vitest-bench', version: '', reason: trees };
  return specs.length > 0
    ? runConfigured(host, trees, specs, signal, deadline, sequential)
    : runVitestBench(host, trees, discovered, signal, deadline, sequential);
}
