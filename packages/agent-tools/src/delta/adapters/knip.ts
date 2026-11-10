/**
 * delta/adapters/knip.ts — unused files, exports and dependencies (PRD 41 §C8.1) from the bundled knip, on one side's
 * tree. The report is normalized by memory's `normalizeAnalysis` and identified by its `identityOfIssue` — the SAME
 * ids and anchors the codebase analysis and its compare use (§C3), so a knip finding is one finding everywhere.
 */

import { identityOfIssue, normalizeAnalysis } from '@seanhogg/builderforce-memory/knowledge';
import { okResult, type AnalyzerRunFinding, type DeltaAnalyzer } from './analyzer.js';
import { isRunResult, runBundled } from './bundledTool.js';

export const KNIP_TOOL = 'knip';

const SEVERITY: Readonly<Record<string, AnalyzerRunFinding['severity']>> = {
  'unused-export': 'info',
  'unused-file': 'warn',
  'unused-dependency': 'warn',
};

/** knip's JSON report → findings (pure). */
export function knipFindings(report: unknown, side: 'before' | 'after'): AnalyzerRunFinding[] {
  return normalizeAnalysis(undefined, undefined, report).issues
    .filter((issue) => SEVERITY[issue.kind] !== undefined)
    .map((issue): AnalyzerRunFinding => {
      const loc = issue.locations[0];
      return {
        kind: issue.kind,
        identity: identityOfIssue(issue),
        severity: SEVERITY[issue.kind]!,
        confidence: 'measured',
        params: { ...(issue.symbol !== undefined ? { symbol: issue.symbol } : {}), ...(loc ? { file: loc.path } : {}) },
        evidence: issue.locations.map((l) => ({ side, path: l.path, ...(l.startLine > 1 ? { line: l.startLine } : {}) })),
      };
    });
}

export const knipAnalyzer: DeltaAnalyzer = {
  tool: KNIP_TOOL,
  inputs: ['package.json', 'knip.json', 'knip.jsonc', '.knip.json', '.knip.jsonc', 'knip.config.ts', 'knip.config.js', 'tsconfig.json'],
  async run(side, exec, signal) {
    const r = await runBundled('knip', side, exec, signal);
    if (isRunResult(r)) return r;
    if (!Array.isArray(r.report.files) || !Array.isArray(r.report.issues)) return { tool: KNIP_TOOL, version: r.version, status: 'failed', reason: 'invalid-report', findings: [] };
    return { ...okResult(KNIP_TOOL, r.version, knipFindings(r.report, side.side)), raw: r.report };
  },
};
