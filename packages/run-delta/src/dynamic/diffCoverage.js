/**
 * dynamic/diffCoverage.ts — C8.4 diff coverage: the share of the lines a run CHANGED (dynamic/changedLines.ts)
 * that a test executed, from the per-line hits of a coverage report (lcov / istanbul, parsed by the host with
 * agent-tools `lcovLineHits` / `istanbulLineHits`).
 *
 * It is THE `coverage.diff` measurement of the L3 `coverage` analyzer row (registry/analyzers.ts, after side
 * only): the coverage adapter reads the report a test run left — the dynamic tier's coverage run produces it
 * when no run did — and reports {@link diffCoverageMetric} through `DeltaPorts.analyze`. A changed line the
 * report does not instrument (a comment, a type) is not counted: no data is not "uncovered".
 */
import { normalizePath } from '../engine/text.js';
import { changedLines } from './changedLines.js';
export const COVERAGE_DIFF_METRIC = 'coverage.diff';
export const COVERAGE_STEP = 0.0001;
export const COVERAGE_THRESHOLD = { warn: 0.02, error: 0.05, kind: 'abs' };
export function diffCoverage(files, hits) {
    const out = [];
    for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
        const lines = hits.get(normalizePath(f.path));
        if (!lines)
            continue;
        const instrumented = changedLines(f.before, f.after).filter((l) => lines.has(l));
        if (instrumented.length === 0)
            continue;
        const uncovered = instrumented.filter((l) => !lines.get(l));
        out.push({ path: f.path, covered: instrumented.length - uncovered.length, total: instrumented.length, uncovered });
    }
    return {
        covered: out.reduce((s, f) => s + f.covered, 0),
        total: out.reduce((s, f) => s + f.total, 0),
        files: out,
    };
}
/** The `coverage.diff` metric of the after side; undefined when no changed line is instrumented (not measured, never 0%). */
export function diffCoverageMetric(files, hits) {
    const d = diffCoverage(files, hits);
    if (d.total === 0)
        return undefined;
    return {
        metricId: COVERAGE_DIFF_METRIC, value: Math.round(d.covered / d.total / COVERAGE_STEP), step: COVERAGE_STEP,
        unit: 'ratio', betterWhen: 'higher', threshold: COVERAGE_THRESHOLD,
    };
}
//# sourceMappingURL=diffCoverage.js.map