import { describe, expect, it } from 'vitest';
import type { AnalyzerExec, ExecResult } from '../adapters/analyzer.js';
import { runBenchmarks } from './benchmarkRunner.js';
import { shellCommand, type DynamicHost } from './host.js';
import { mutatable, runMutation } from './strykerRunner.js';
import { runTests } from './testRunner.js';

/** A fake host: tools installed in both copies, every changed path present, reports written by each run. */
function host(opts: { benchReport?: string } = {}) {
  const calls: Array<{ argv: readonly string[]; cwd: string }> = [];
  let ran = 0;
  const exec: AnalyzerExec = {
    async run(argv, o): Promise<ExecResult> { calls.push({ argv, cwd: o.cwd }); ran++; return { started: true, exitCode: 0, stdout: '', stderr: '' }; },
    which: async (p) => `/usr/bin/${p}`,
    neutralCwd: () => '/tmp',
    async readText(p) {
      if (p.endsWith('node_modules/vitest/package.json')) return '{"version":"3.2.0","bin":{"vitest":"vitest.mjs"}}';
      if (p.endsWith('node_modules/@stryker-mutator/core/package.json')) return '{"version":"8.7.1","bin":{"stryker":"bin/stryker.js"}}';
      if (p.endsWith('mutation.json')) return '{"files":{}}';
      if (p.includes('bench-')) return opts.benchReport;
      if (p.endsWith('.json')) return '{"testResults":[]}';
      return undefined;
    },
    mtime: async (p) => (p.endsWith('mutation.json') ? (ran > 0 ? ran : undefined) : 1),
    newestMtime: async () => undefined,
    writeText: async () => undefined,
    tempDir: async () => ({ path: '/scratch', dispose: async () => undefined }),
  };
  const h: DynamicHost = {
    exec, root: '/repo', tree: async (side) => `/${side}`, platform: 'linux', env: {}, now: () => 0, benchFiles: ['x.bench.ts'],
  };
  return { h, calls };
}

const CHANGED = ['src/a.ts', '-x.ts', 'a,b.ts', 'src/[id].ts', 'src/b.ts'];
const signal = new AbortController().signal;

describe('argv safety (paths are separate entries, never options or globs)', () => {
  it('`vitest related` passes each changed path as its own argv entry and leaves out one that reads as an option', async () => {
    const { h, calls } = host();
    expect(await runTests(h, CHANGED, signal, 1e9)).toMatchObject({ ok: true });
    for (const c of calls) {
      expect(c.argv).not.toContain('-x.ts');
      expect(c.argv.slice(-4)).toEqual(['src/a.ts', 'a,b.ts', 'src/[id].ts', 'src/b.ts']);
    }
    expect(calls.map((c) => c.cwd)).toEqual(['/before', '/after', '/before', '/after']); // warm-up, coverage, timed, timed
    expect(calls[1]!.argv).toContain('--coverage.reportsDirectory=coverage');
    expect(calls[2]!.argv.some((a) => a.startsWith('--coverage'))).toBe(false); // timings are uninstrumented on both sides
  });

  it('`--mutate` is one list of plain paths: commas, globs and option-like paths are left out', async () => {
    expect(['src/a.ts', '-x.ts', 'a,b.ts', 'src/[id].ts', 'src/{a}.ts', 'src/a!.ts', 'src/(g).ts'].filter(mutatable)).toEqual(['src/a.ts']);
    const { h, calls } = host();
    expect(await runMutation(h, CHANGED, signal, 1e9)).toMatchObject({ ok: true });
    for (const c of calls) {
      const i = c.argv.indexOf('--mutate');
      expect(c.argv[i + 1]).toBe('src/a.ts,src/b.ts');
      expect(c.argv.length).toBe(i + 2);
    }
  });

  it('POSIX: the shell is `sh` from outside the repository (or /bin/sh), the line one argument, not verbatim', async () => {
    const { h } = host();
    expect(await shellCommand(h, 'node b.js "x y"')).toEqual({ argv: ['/usr/bin/sh', '-c', 'node b.js "x y"'], windowsVerbatimArguments: false });
    expect(await shellCommand({ ...h, exec: { ...h.exec, which: async () => undefined } }, 'node b.js'))
      .toEqual({ argv: ['/bin/sh', '-c', 'node b.js'], windowsVerbatimArguments: false });
  });

  it('a non-finite bench value is `non-finite-samples`, never a pass', async () => {
    const { h } = host({ benchReport: '{"files":[{"filepath":"/after/x.bench.ts","groups":[{"fullName":"g","benchmarks":[{"name":"b","median":1e999}]}]}]}' });
    expect(await runBenchmarks(h, [], { rounds: 10, warmup: 1 }, signal, 1e9)).toMatchObject({ ok: false, reason: 'non-finite-samples' });
  });
});
