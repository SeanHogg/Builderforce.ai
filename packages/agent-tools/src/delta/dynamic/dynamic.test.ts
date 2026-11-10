import { describe, expect, it } from 'vitest';
import { lcovLineHits, parseLcov } from '../../knowledge/codeCoverage.js';
import type { AnalyzerExec, ExecResult } from '../adapters/analyzer.js';
import { runBenchmarks } from './benchmarkRunner.js';
import { changedCodeOf, type DynamicHost } from './host.js';
import { dynamicRunners } from './runners.js';
import { benchValues, testDurations } from './vitestReports.js';

const LCOV = ['TN:', 'SF:/repo/src/a.ts', 'DA:1,3', 'DA:2,0', 'DA:4,1', 'LF:3', 'LH:2', 'end_of_record', 'SF:/repo/src/b.ts', 'LF:4', 'LH:1', 'end_of_record'].join('\n');

describe('per-line coverage from a fixture lcov', () => {
  it('keeps every DA line with its hit, and the per-file ratio is unchanged', () => {
    const hits = lcovLineHits(LCOV, '/repo', '');
    expect([...hits.get('src/a.ts')!]).toEqual([[1, true], [2, false], [4, true]]);
    expect(hits.has('src/b.ts')).toBe(false); // LF/LH only: no line data
    expect(parseLcov(LCOV, '/repo', '')).toEqual(new Map([['src/a.ts', 0.6667], ['src/b.ts', 0.25]]));
  });
});

describe('vitest reports', () => {
  it('reads bench medians and test durations keyed by root-relative file', () => {
    const bench = { files: [{ filepath: 'C:/w/src/x.bench.ts', groups: [{ fullName: 'src/x.bench.ts > sort', benchmarks: [{ name: 'quick', median: 1.5, mean: 2 }, { name: 'bad' }] }] }] };
    expect(benchValues(bench, 'C:/w')).toEqual(new Map([['src/x.bench.ts#src/x.bench.ts > sort#quick', 1.5]]));
    const tests = { testResults: [{ name: '/w/src/a.test.ts', assertionResults: [{ fullName: 'a works', duration: 12 }, { fullName: 'skipped' }] }] };
    expect(testDurations(tests, '/w')).toEqual(new Map([['src/a.test.ts#a works', 12]]));
    expect(testDurations({ nope: 1 }, '/w')).toBeUndefined();
  });

  it('changed code is JS/TS implementation only', () => {
    expect(changedCodeOf(['src/b.ts', 'src/a.test.ts', 'src/x.bench.ts', 'src/t.d.ts', 'README.md', 'src/a.ts', 'src/a.ts'])).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

/** A fake exec: every run takes `cost(cwd)` ms on the fake clock, and the order of runs is recorded. */
function fakeHost(cost: (cwd: string) => number, opts: { fail?: number } = {}) {
  let clock = 0;
  const order: string[] = [];
  const exec: AnalyzerExec = {
    async run(_argv, o): Promise<ExecResult> {
      order.push(o.cwd);
      clock += cost(o.cwd);
      const failed = opts.fail !== undefined && order.length === opts.fail;
      return { started: true, exitCode: failed ? 1 : 0, stdout: '', stderr: '' };
    },
    which: async (program) => `/usr/bin/${program}`,
    neutralCwd: () => '/tmp',
    readText: async () => undefined,
    mtime: async () => undefined,
    newestMtime: async () => undefined,
    writeText: async () => undefined,
    tempDir: async () => ({ path: '/tmp/x', dispose: async () => undefined }),
  };
  const host: DynamicHost = {
    exec, root: '/repo', tree: async (side) => (side === 'before' ? '/before' : '/after'), platform: 'linux', env: {}, now: () => clock, benchFiles: [],
  };
  return { host, order };
}

const SPEC = { id: 'p', command: 'node b.js', unit: 'ms' as const, threshold: { warn: 0.05, error: 0.05, kind: 'pct' as const }, rounds: 4, warmup: 1 };
const signal = new AbortController().signal;

describe('interleaved benchmarks (C6.2)', () => {
  it('warms both trees up, then alternates AB, BA, … and pairs each round', async () => {
    const { host, order } = fakeHost((cwd) => (cwd === '/before' ? 100 : 130));
    const r = await runBenchmarks(host, [SPEC], { rounds: 10, warmup: 1 }, signal, 1e9);
    expect(order).toEqual(['/before', '/after', '/before', '/after', '/after', '/before', '/before', '/after', '/after', '/before']);
    expect(r).toEqual({ ok: true, tool: 'command', version: '', value: [{ spec: { id: 'p', unit: 'ms', threshold: SPEC.threshold }, samples: { before: [100, 100, 100, 100], after: [130, 130, 130, 130] } }] });
  });

  it('a failing round fails the benchmark (never half-measured); no copy of a tree: tree-unavailable', async () => {
    expect(await runBenchmarks(fakeHost(() => 1, { fail: 4 }).host, [SPEC], { rounds: 10, warmup: 1 }, signal, 1e9)).toMatchObject({ ok: false, reason: 'exit-failed' });
    const { host, order } = fakeHost(() => 1);
    expect(await runBenchmarks({ ...host, tree: async (side) => (side === 'after' ? '/after' : undefined) }, [SPEC], { rounds: 10, warmup: 1 }, signal, 1e9))
      .toMatchObject({ ok: false, reason: 'tree-unavailable' });
    expect(order).toEqual([]); // nothing ran, and nothing ever runs in the working tree
  });

  it('runs a repository command through the shell outside PATH on Windows, verbatim', async () => {
    const calls: Array<{ argv: readonly string[]; verbatim?: boolean }> = [];
    const { host } = fakeHost(() => 1);
    const exec: AnalyzerExec = { ...host.exec, run: async (argv, o) => { calls.push({ argv, verbatim: o.windowsVerbatimArguments }); return { started: true, exitCode: 0, stdout: '', stderr: '' }; } };
    await runBenchmarks({ ...host, exec, platform: 'win32', env: { SystemRoot: 'C:\\Windows' } }, [{ ...SPEC, rounds: 10, warmup: 0 }], { rounds: 10, warmup: 0 }, signal, 1e9);
    expect(calls[0]).toEqual({ argv: ['C:\\Windows\\System32\\cmd.exe', '/d', '/s', '/c', '"node b.js"'], verbatim: true });
    const none = await runBenchmarks({ ...host, exec, platform: 'win32', env: {} }, [SPEC], { rounds: 10, warmup: 0 }, signal, 1e9);
    expect(none).toMatchObject({ ok: false, reason: 'no-shell' });
  });

  it('availability: nothing configured, no tools installed', async () => {
    const { host } = fakeHost(() => 1);
    expect(await dynamicRunners(host, 1e9).availability({ benchmarks: [] }, ['src/a.ts'])).toEqual({
      benchmark: 'not-configured', 'diff-coverage': 'tool-unavailable', mutation: 'tool-unavailable',
    });
  });
});

describe('sequential benchmarks (D9.2)', () => {
  // A stand-in for run-delta's sign-test SPRT (agent-tools cannot import it): cap max(30, rounds), decided at `n` pairs.
  const decidedAt = (n: number) => ({ cap: (rounds: number) => Math.max(30, rounds), decided: (_s: unknown, p: { before: readonly number[] }) => p.before.length >= n });

  it('stops the rounds as soon as the test decides', async () => {
    const seen: Array<{ id: string; threshold?: unknown }> = [];
    const test = { ...decidedAt(12), decided: (s: { id: string; threshold?: unknown }, p: { before: readonly number[] }) => (seen.push(s), p.before.length >= 12) };
    const r = await runBenchmarks(fakeHost((cwd) => (cwd === '/before' ? 100 : 120)).host, [SPEC], { rounds: 10, warmup: 0 }, signal, 1e9, test);
    expect(r).toMatchObject({ ok: true, value: [{ samples: { before: Array(12).fill(100), after: Array(12).fill(120) } }] });
    expect(seen[0]).toEqual({ id: 'p', threshold: SPEC.threshold }); // a configured spec's own threshold
  });

  // The rule changed in the WS20 fix round: the cap is max(30, spec rounds), never a fixed 30 that cuts a 60-round spec.
  it('regression: an undecided benchmark runs to max(30, spec rounds)', async () => {
    const undecided = decidedAt(Infinity);
    const at = async (rounds: number) =>
      runBenchmarks(fakeHost(() => 1).host, [{ ...SPEC, rounds, warmup: 0 }], { rounds: 10, warmup: 0 }, signal, 1e9, undecided);
    expect(await at(4)).toMatchObject({ ok: true, value: [{ samples: { before: Array(30).fill(1) } }] });
    expect(await at(60)).toMatchObject({ ok: true, value: [{ samples: { before: Array(60).fill(1) } }] });
  });

  it('regression: a budget that cannot afford the cap runs the fixed rounds instead', async () => {
    // Each round costs 200 on the fake clock; 30 rounds would need ~6000, the deadline leaves 1000.
    const r = await runBenchmarks(fakeHost(() => 100).host, [SPEC], { rounds: 10, warmup: 0 }, signal, 1_000, decidedAt(Infinity));
    expect(r).toMatchObject({ ok: true, value: [{ samples: { before: Array(SPEC.rounds).fill(100) }, sequential: false }] });
    // Affordable: no flag, the tier reads the SPRT.
    const afforded = await runBenchmarks(fakeHost(() => 1).host, [SPEC], { rounds: 10, warmup: 0 }, signal, 1e9, decidedAt(Infinity));
    expect(afforded.ok && 'sequential' in afforded.value[0]!).toBe(false);
  });
});
