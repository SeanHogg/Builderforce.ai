/**
 * delta/dynamic/testRunner.ts — the `diff-coverage` check's run (PRD 41 C8.4, C6.2): the vitest tests RELATED to
 * the run's changed code (`vitest related`), never the whole suite (§9), in the scratch COPIES only.
 *
 *  - Coverage: one instrumented run in the after copy, its report forced into the copy's own `coverage/`
 *    (`--coverage.reportsDirectory=coverage`, whatever the project configures) — the report the L3 `coverage`
 *    analyzer then reads from that copy for `coverage.diff`. The user's `coverage/` is never written.
 *  - Timings (C6.2 proxy), without bias: both sides run the SAME way — uninstrumented, JSON reporter — after the same
 *    warm-up (one untimed run each; the after side's warm-up is the coverage run). The instrumented durations are never
 *    compared with uninstrumented ones.
 *
 * Failing tests are not a failed check (their durations still count); a run that leaves no report is.
 */

import { hasPackage, joinPath, packageBin, readJson, remaining, stepFailure, type DynamicHost } from './host.js';
import type { Outcome } from './runnerTypes.js';
import { testDurations } from './vitestReports.js';

/** The coverage providers vitest can use; one must be installed for the check to be available. */
export const COVERAGE_PROVIDERS = ['@vitest/coverage-v8', '@vitest/coverage-istanbul'] as const;
/** Where the after copy's coverage report goes, relative to the copy (the coverage analyzer's `coverage/` of the root). */
export const COVERAGE_DIR = 'coverage';

/** Whether the project can run the check: vitest and a coverage provider installed (read-only probe of the working tree). */
export async function testsAvailable(host: Pick<DynamicHost, 'exec' | 'root'>): Promise<boolean> {
  if (!await packageBin(host.exec, host.root, 'vitest', 'vitest')) return false;
  for (const p of COVERAGE_PROVIDERS) if (await hasPackage(host.exec, host.root, p)) return true;
  return false;
}

interface SideRun {
  dir: string;
  entry: string;
  version: string;
  files: string[];
}

async function sideOf(host: DynamicHost, dir: string, changed: readonly string[]): Promise<SideRun | string> {
  const bin = await packageBin(host.exec, dir, 'vitest', 'vitest');
  if (!bin) return 'tool-unavailable';
  const files: string[] = [];
  // Each path is its own argument (execFile, no shell); one that could read as an option is left out.
  for (const f of changed) if (!f.startsWith('-') && await host.exec.mtime(joinPath(dir, f)).catch(() => undefined) !== undefined) files.push(f);
  return { dir, entry: bin.entry, version: bin.version, files };
}

/** One `vitest related` run of a side; its per-test durations. */
async function run(
  host: DynamicHost, side: SideRun, out: string, coverage: boolean, signal: AbortSignal, deadline: number,
): Promise<Map<string, number> | string> {
  if (side.files.length === 0) return new Map();
  const argv = [
    'node', side.entry, 'related', '--run', '--passWithNoTests', '--reporter=json', `--outputFile=${out}`,
    ...(coverage ? ['--coverage.enabled=true', `--coverage.reportsDirectory=${COVERAGE_DIR}`, '--coverage.reporter=lcov', '--coverage.reporter=json'] : []),
    ...side.files,
  ];
  const r = await host.exec.run(argv, { cwd: side.dir, timeoutMs: remaining(host, deadline), signal });
  if (!r.started || r.timedOut || signal.aborted) return stepFailure(r, signal);
  return testDurations(await readJson(host.exec, out), side.dir) ?? 'no-report';
}

/** Coverage in the after copy, then the timed runs of both copies under the same conditions. */
export async function runTests(
  host: DynamicHost, changedCode: readonly string[], signal: AbortSignal, deadline: number,
): Promise<Outcome<{ before?: Map<string, number>; after: Map<string, number> }>> {
  const afterDir = await host.tree('after');
  if (!afterDir) return { ok: false, tool: 'vitest', version: '', reason: 'tree-unavailable' };
  const after = await sideOf(host, afterDir, changedCode);
  if (typeof after === 'string') return { ok: false, tool: 'vitest', version: '', reason: after };
  const failed = (reason: string) => ({ ok: false as const, tool: 'vitest', version: after.version, reason });
  const scratch = await host.exec.tempDir();
  try {
    const beforeDir = await host.tree('before');
    const before = beforeDir ? await sideOf(host, beforeDir, changedCode) : undefined;
    if (typeof before === 'string') return failed(before);
    // Warm-up: one untimed run per side (the after side's is the instrumented coverage run).
    if (before) {
      const warm = await run(host, before, `${scratch.path}/warm-before.json`, false, signal, deadline);
      if (typeof warm === 'string') return failed(warm);
    }
    const covered = await run(host, after, `${scratch.path}/coverage-after.json`, true, signal, deadline);
    if (typeof covered === 'string') return failed(covered);
    if (!before) return { ok: true, tool: 'vitest', version: after.version, value: { after: covered } };
    // Timed: both sides uninstrumented, the same reporter, back to back.
    const b = await run(host, before, `${scratch.path}/before.json`, false, signal, deadline);
    if (typeof b === 'string') return failed(b);
    const a = await run(host, after, `${scratch.path}/after.json`, false, signal, deadline);
    if (typeof a === 'string') return failed(a);
    return { ok: true, tool: 'vitest', version: after.version, value: { before: b, after: a } };
  } finally {
    await scratch.dispose().catch(() => undefined);
  }
}
