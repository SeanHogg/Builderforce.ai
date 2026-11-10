/**
 * registry/analyzers.ts — the built-in L3 analyzer ROWS (PRD 41 §B7, §4 "Analyzer adapters"): which tool the
 * host runs and what each of its finding kinds and metrics measures. Data only — the adapters that run the tools
 * and normalize their output live in agent-tools (`delta/adapters/*`), one per tool, and emit exactly these kinds.
 *
 * `clone-group` and `unused-*` are the static-tier fact kinds too (`rules/factFindings.ts`, read from the last
 * review's graph); while a host runs this tier, the tool's measurement of BOTH sides of the run supersedes them.
 */

import type { AnalyzerRule } from '../contract.js';

/** The tool names (`DeltaPorts.analyze`, `MeasuredBy.tool`, the C9 producers). */
export const ANALYZER_TOOLS = {
    osv: 'osv-scanner',
    gitleaks: 'gitleaks',
    jscpd: 'jscpd',
    knip: 'knip',
    dependencyCruiser: 'dependency-cruiser',
    typescript: 'typescript',
    coverage: 'coverage',
    semgrep: 'semgrep',
    codeql: 'codeql',
} as const;

/** C5.4: an offline vulnerability database older than this makes the vulnerability kind `not_comparable`. */
export const OSV_MAX_DATA_AGE_DAYS = 14;

export const ANALYZER_RULES: readonly AnalyzerRule[] = [
    // C5.4: known vulnerabilities of the lockfiles' packages, from the offline database (stale after 14 days).
    { tool: ANALYZER_TOOLS.osv, kinds: { 'vulnerable-dependency': { dimension: 'security', version: 1 } }, maxDataAgeDays: OSV_MAX_DATA_AGE_DAYS },
    // C5.5: secrets in the run's changed files (both sides, so a removed secret reads as resolved).
    { tool: ANALYZER_TOOLS.gitleaks, kinds: { 'secret-leak': { dimension: 'security', version: 1 } }, scope: 'impact' },
    // C7 reusability: clone groups (a group gaining a member is `changed (grew)`).
    { tool: ANALYZER_TOOLS.jscpd, kinds: { 'clone-group': { dimension: 'ilities.maintainability', version: 1 } } },
    // C8.1 unused exports, files and dependencies (kept in maintainability, where the static-tier kinds sit).
    {
        tool: ANALYZER_TOOLS.knip,
        kinds: {
            'unused-dependency': { dimension: 'ilities.maintainability', version: 1 },
            'unused-export': { dimension: 'ilities.maintainability', version: 1 },
            'unused-file': { dimension: 'ilities.maintainability', version: 1 },
        },
    },
    // C7 modularity: the L3 cross-check of the B5 graph rules.
    {
        tool: ANALYZER_TOOLS.dependencyCruiser,
        kinds: {
            'dependency-cycle': { dimension: 'ilities.maintainability', version: 1 },
            'forbidden-dependency': { dimension: 'ilities.maintainability', version: 1 },
        },
    },
    // C5.2 / C12 deep analysis through SARIF, when the tool is installed (Semgrep on the repo's own rules; CodeQL on a database).
    { tool: ANALYZER_TOOLS.semgrep, kinds: { 'semgrep-finding': { dimension: 'security', version: 1 } }, scope: 'impact' },
    { tool: ANALYZER_TOOLS.codeql, kinds: { 'codeql-finding': { dimension: 'security', version: 1 } } },
    // C8.1 type errors in the changed files.
    { tool: ANALYZER_TOOLS.typescript, kinds: { 'type-error': { dimension: 'quality', version: 1 } }, scope: 'impact' },
    // C8.4 diff coverage: the share of the run's changed lines a test executed (after side only).
    { tool: ANALYZER_TOOLS.coverage, kinds: {}, metrics: { 'coverage.diff': 'quality' }, scope: 'impact', sides: 'after' },
];
