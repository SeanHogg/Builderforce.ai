/**
 * delta/adapters/analyzer.ts — what every L3 analyzer adapter of the run delta is (PRD 41 §B7, §4 "Analyzer
 * adapters"): ONE tool, run on ONE side's tree through the host's {@link AnalyzerExec}, its output normalized to
 * run-delta's `AnalyzerResult` — sorted and canonical (B8.1), so the same tree always gives the same result.
 *
 * The result is structurally run-delta's `AnalyzerResult` (and each finding its `AnalyzerFinding`), declared
 * here because run-delta imports agent-tools: an import back would be a source-package cycle. The host hands it
 * to `DeltaPorts.analyze`; run-delta's `analyzerShape.test.ts` asserts the structural match at compile time.
 *
 * Never throws: a tool that is not bundled or present is `skipped` (`tool-absent`, `analyzer-unavailable`), one
 * that ran and broke is `failed` (`timeout`, `exit-failed`, `invalid-report`). No findings then — a missing
 * measurement is never zero findings.
 */
/** One tool run's ceiling (L3 is async and minutes on a cold run; the host bounds the whole tier as well). */
export const ANALYZER_TIMEOUT_MS = 5 * 60_000;
export const skipped = (tool, reason, version = '') => ({ tool, version, status: 'skipped', reason, findings: [] });
export const failed = (tool, reason, version = '') => ({ tool, version, status: 'failed', reason, findings: [] });
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** A successful result, canonical: findings sorted by identity id (then kind), evidence sorted, metrics by id. */
export function okResult(tool, version, findings, metrics) {
    const sorted = findings
        .map((f) => ({ ...f, evidence: [...f.evidence].sort((a, b) => cmp(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0)) }))
        .sort((a, b) => cmp(a.identity.id, b.identity.id) || cmp(a.kind, b.kind));
    return { tool, version, status: 'ok', findings: sorted, ...(metrics ? { metrics: [...metrics].sort((a, b) => cmp(a.metricId, b.metricId)) } : {}) };
}
/** A tool path → root-relative POSIX (absolute paths under `dir` are relativized; `./` dropped). */
export function relPath(dir, file) {
    const d = dir.replace(/\\/g, '/').replace(/\/+$/, '');
    let f = file.replace(/\\/g, '/');
    const fold = /^[A-Za-z]:/.test(d) ? (s) => s.toLowerCase() : (s) => s;
    if (fold(f).startsWith(`${fold(d)}/`))
        f = f.slice(d.length + 1);
    return f.replace(/^\.\//, '');
}
/** Why a run that started did not give a report. */
export const runFailure = (r) => (r.overflow ? 'output-too-large' : r.timedOut ? 'timeout' : 'exit-failed');
/** The run did not finish usably (timed out, aborted, or its output overflowed). */
export const cutShort = (r) => !!r.timedOut || !!r.overflow;
/** `[<absolute program>, ...args]` from the user's PATH, or undefined when the program is not there. */
export async function resolvedArgv(exec, program, args) {
    const abs = await exec.which(program);
    return abs ? [abs, ...args] : undefined;
}
/** Root-relative folders as glob excludes (`dist` → `**\/dist/**` is NOT used: a folder is matched from the root). */
export const ignoredGlobs = (ignored) => (ignored ?? []).map((d) => `${d.replace(/\/+$/, '')}/**`);
/** A regex source matching any of the root-relative folders (dependency-cruiser's `exclude.path`). */
export function ignoredRegex(ignored) {
    const dirs = (ignored ?? []).map((d) => d.replace(/\/+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return dirs.length > 0 ? `^(?:${dirs.join('|')})(?:/|$)` : undefined;
}
/** `node <entry> …args` for a bundled tool; undefined when the host has no entry for it. */
export function bundledArgv(side, tool, args) {
    const entry = side.entries[tool];
    return entry ? ['node', entry, ...args] : undefined;
}
/** The reason a bundled tool is missing: `analyzer-unavailable` on a host that bundles (A3), else `tool-absent`. */
export const missingReason = (side) => (side.bundled ? 'analyzer-unavailable' : 'tool-absent');
//# sourceMappingURL=analyzer.js.map