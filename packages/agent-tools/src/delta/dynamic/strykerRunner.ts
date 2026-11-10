/**
 * delta/dynamic/strykerRunner.ts — C8.4 incremental mutation testing: StrykerJS (`@stryker-mutator/core`, the
 * project's own install) with `--incremental`, mutating ONLY the run's changed code files, in the after COPY and in the
 * before COPY — each leaves its `reports/mutation/mutation.json` (mutation-testing-report-schema) and its sandbox in
 * the copy, never in the user's working tree. The incremental file is the copy's own (`reports/stryker-incremental.json`,
 * the one the project committed when it did). The raw reports go back to run-delta (`parseMutationReport`,
 * `mutationMeasurement`); nothing is parsed here.
 *
 * `--mutate` takes one comma-separated glob list (StrykerJS has no escape): see {@link mutatable}.
 */

import { bothTrees, joinPath, packageBin, readJson, remaining, stepFailure, type DynamicHost } from './host.js';
import type { Outcome, ReportLike } from './runnerTypes.js';

export const STRYKER_PACKAGE = '@stryker-mutator/core';
export const STRYKER_REPORT = 'reports/mutation/mutation.json';

/**
 * Whether a changed path can go on `--mutate`: one comma-separated list of GLOBS, with no escape for a comma, so a path
 * holding a comma or a glob metacharacter (`[]{}*?!()` — it would match other files), or that could read as an option,
 * is left out.
 */
export const mutatable = (path: string): boolean => !path.startsWith('-') && !/[,[\]{}*?!()]/.test(path);

/** Whether the project has StrykerJS installed (read-only probe of the working tree). */
export async function strykerAvailable(host: Pick<DynamicHost, 'exec' | 'root'>): Promise<boolean> {
  return (await packageBin(host.exec, host.root, STRYKER_PACKAGE, 'stryker')) !== undefined;
}

async function runSide(host: DynamicHost, dir: string, files: readonly string[], signal: AbortSignal, deadline: number): Promise<{ report: ReportLike; version: string } | string> {
  const bin = await packageBin(host.exec, dir, STRYKER_PACKAGE, 'stryker');
  if (!bin) return 'tool-unavailable';
  const present: string[] = [];
  for (const f of files) {
    if (!mutatable(f)) continue;
    if (await host.exec.mtime(joinPath(dir, f)).catch(() => undefined) !== undefined) present.push(f);
  }
  const reportPath = joinPath(dir, STRYKER_REPORT);
  // A report from an earlier run (copied with the tree) must never stand in for this one.
  const before = await host.exec.mtime(reportPath).catch(() => undefined);
  if (present.length === 0) return { report: { json: { files: {} }, root: dir }, version: bin.version };
  const r = await host.exec.run(
    ['node', bin.entry, 'run', '--incremental', '--reporters', 'json', '--mutate', present.join(',')],
    { cwd: dir, timeoutMs: remaining(host, deadline), signal },
  );
  if (!r.started || r.timedOut || signal.aborted) return stepFailure(r, signal);
  const written = await host.exec.mtime(reportPath).catch(() => undefined);
  if (written === undefined || (before !== undefined && written <= before)) return r.exitCode === 0 ? 'no-report' : 'exit-failed';
  const json = await readJson(host.exec, reportPath);
  return json === undefined ? 'invalid-report' : { report: { json, root: dir }, version: bin.version };
}

/** StrykerJS on both copies (after first), restricted to `changedCode`. */
export async function runMutation(
  host: DynamicHost, changedCode: readonly string[], signal: AbortSignal, deadline: number,
): Promise<Outcome<{ before?: ReportLike; after: ReportLike }>> {
  const trees = await bothTrees(host);
  if (typeof trees === 'string') return { ok: false, tool: 'stryker', version: '', reason: trees };
  const after = await runSide(host, trees.after, changedCode, signal, deadline);
  if (typeof after === 'string') return { ok: false, tool: 'stryker', version: '', reason: after };
  const before = await runSide(host, trees.before, changedCode, signal, deadline);
  if (typeof before === 'string') return { ok: false, tool: 'stryker', version: after.version, reason: before };
  return { ok: true, tool: 'stryker', version: after.version, value: { before: before.report, after: after.report } };
}
