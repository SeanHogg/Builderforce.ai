/**
 * delta/adapters/bundledTool.ts — one run of a BUNDLED analyzer (dependency-cruiser, jscpd, knip; PRD 41 A3) on one
 * side's tree, with the pinned invocation the codebase analysis uses (`codeAnalysisTool.ts` `ANALYZERS`), its
 * artifacts redirected to a scratch directory instead of the tree. Never `npm exec`: a tool the host has no entry for
 * is `skipped` (`analyzer-unavailable` / `tool-absent`).
 */

import { ANALYZERS, parseAnalyzerJson, type AnalyzerName } from '../../codeAnalysisTool.js';
import {
  ANALYZER_TIMEOUT_MS, bundledArgv, cutShort, failed, missingReason, runFailure, skipped, type AnalyzerExec, type AnalyzerRunResult, type AnalyzerSide,
} from './analyzer.js';

const ARTIFACTS = '.builderforce/code-analysis';

export interface BundledRun {
  version: string;
  /** The parsed JSON report. */
  report: Record<string, unknown>;
}

/**
 * Runs the pinned tool over the side's tree. `prepare` writes inputs into the scratch directory first (the
 * dependency-cruiser config); `reportFile` names a report the tool writes there instead of stdout (jscpd).
 */
export async function runBundled(
  name: AnalyzerName, side: AnalyzerSide, exec: AnalyzerExec, signal: AbortSignal | undefined,
  opts: { prepare?(scratch: string): Promise<void>; reportFile?: string; args?(args: string[]): string[] } = {},
): Promise<BundledRun | AnalyzerRunResult> {
  const spec = ANALYZERS.find((a) => a.name === name)!;
  const scratch = await exec.tempDir();
  try {
    const base = spec.args.split(' ').map((a) => a.replace('{scope}', '.').replace(ARTIFACTS, scratch.path));
    const argv = bundledArgv(side, name, opts.args ? opts.args(base) : base);
    if (!argv) return skipped(name, missingReason(side), spec.version);
    await opts.prepare?.(scratch.path);
    const r = await exec.run(argv, { cwd: side.dir, timeoutMs: ANALYZER_TIMEOUT_MS, ...(signal ? { signal } : {}) });
    if (!r.started) return skipped(name, 'analyzer-unavailable', spec.version);
    if (cutShort(r)) return failed(name, runFailure(r), spec.version);
    const text = opts.reportFile ? await exec.readText(`${scratch.path}/${opts.reportFile}`) : r.stdout;
    if (!text) return failed(name, 'exit-failed', spec.version);
    try {
      const report = parseAnalyzerJson(text) as unknown;
      if (!report || typeof report !== 'object') return failed(name, 'invalid-report', spec.version);
      return { version: spec.version, report: report as Record<string, unknown> };
    } catch {
      return failed(name, 'invalid-report', spec.version);
    }
  } finally {
    void scratch.dispose().catch(() => undefined);
  }
}

export const isRunResult = (v: BundledRun | AnalyzerRunResult): v is AnalyzerRunResult => 'status' in v;
