/**
 * delta/adapters — the run delta's L3 analyzer adapters (PRD 41 §B7, §4), one file per tool. Each runs its tool on
 * one side's tree through the host's {@link AnalyzerExec} and returns run-delta's `AnalyzerResult`, sorted and
 * canonical. Two measurements live in the host because they need it: TypeScript diagnostics (the bundled compiler in
 * an isolated worker over an in-memory overlay; this package keeps the pure mapping, `typeErrorFindings`) and the
 * changed-line coverage (agent-tools' line-hit parsers with run-delta's `diffCoverageMetric`).
 */

import type { DeltaAnalyzer } from './analyzer.js';
import { dependencyCruiserAnalyzer } from './dependencyCruiser.js';
import { gitleaksAnalyzer } from './gitleaks.js';
import { jscpdAnalyzer } from './jscpd.js';
import { knipAnalyzer } from './knip.js';
import { osvAnalyzer } from './osv.js';
import { codeqlAnalyzer, semgrepAnalyzer } from './sarifTools.js';

export * from './analyzer.js';
export * from './l3Cache.js';
export { dependencyCruiserAnalyzer } from './dependencyCruiser.js';
export { knipAnalyzer } from './knip.js';
export { dependencyCruiserFindings } from './dependencyCruiser.js';
export { gitleaksFindings } from './gitleaks.js';
export { jscpdAnalyzer, jscpdFindings } from './jscpd.js';
export { knipFindings } from './knip.js';
export { OSV_DB_ENV, osvFindings } from './osv.js';
export { CODEQL_TOOL, SARIF_KINDS, sarifFindings, SEMGREP_TOOL } from './sarifTools.js';
export { MAX_PROJECTS, tsProjectsOf, typeErrorFindings, TYPESCRIPT_TOOL, TYPESCRIPT_VERSION, type TscDiagnostic } from './typescript.js';

/** Every adapter of this package, by tool name (run-delta `ANALYZER_TOOLS`). */
export const DELTA_ANALYZERS: readonly DeltaAnalyzer[] = [
  osvAnalyzer, gitleaksAnalyzer, jscpdAnalyzer, knipAnalyzer, dependencyCruiserAnalyzer, semgrepAnalyzer, codeqlAnalyzer,
];
