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

import type { AnalyzerMetric, MetricDelta } from '../contract.js';
import { normalizePath } from '../engine/text.js';
import { changedLines } from './changedLines.js';

/** Root-relative POSIX path → 1-based line → executed. */
export type LineHits = ReadonlyMap<string, ReadonlyMap<number, boolean>>;

export const COVERAGE_DIFF_METRIC = 'coverage.diff';
export const COVERAGE_STEP = 0.0001;
export const COVERAGE_THRESHOLD: MetricDelta['threshold'] = { warn: 0.02, error: 0.05, kind: 'abs' };

export interface DiffCoverageFile {
    /** Root-relative (logical, after-side) path. */
    path: string;
    /** Absent: the file is new. */
    before?: string;
    after: string;
}

export interface DiffCoverageFileResult {
    path: string;
    covered: number;
    /** Instrumented changed lines. */
    total: number;
    /** Instrumented changed lines no test executed, ascending. */
    uncovered: number[];
}

export interface DiffCoverage {
    covered: number;
    total: number;
    /** Files with at least one instrumented changed line, by path. */
    files: DiffCoverageFileResult[];
}

export function diffCoverage(files: readonly DiffCoverageFile[], hits: LineHits): DiffCoverage {
    const out: DiffCoverageFileResult[] = [];
    for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
        const lines = hits.get(normalizePath(f.path));
        if (!lines) continue;
        const instrumented = changedLines(f.before, f.after).filter((l) => lines.has(l));
        if (instrumented.length === 0) continue;
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
export function diffCoverageMetric(files: readonly DiffCoverageFile[], hits: LineHits): AnalyzerMetric | undefined {
    const d = diffCoverage(files, hits);
    if (d.total === 0) return undefined;
    return {
        metricId: COVERAGE_DIFF_METRIC, value: Math.round(d.covered / d.total / COVERAGE_STEP), step: COVERAGE_STEP,
        unit: 'ratio', betterWhen: 'higher', threshold: COVERAGE_THRESHOLD,
    };
}
