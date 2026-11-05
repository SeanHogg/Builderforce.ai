/**
 * The Coverage drawer's numbers, read from the `complexity` / `maxComplexity` / `coverage`
 * badges the code pack puts on file nodes. Nothing is assumed: a file without a badge is
 * "not measured", not zero, and a folder with no coverage badge anywhere is "not set up".
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../../order';
import { UNTESTED_BELOW } from '../../scene/channels';

export const MAX_GAPS = 12;

export interface FileMeasure {
    ref: string;
    name: string;
    complexity?: number;
    coverage?: number;
}

export interface CoverageModel {
    /** Code files in the graph. */
    files: number;
    withCoverage: number;
    withComplexity: number;
    /** Mean line coverage over the files that report it; undefined when none do. */
    meanCoverage?: number;
    totalComplexity: number;
    /** Files with both numbers, for the scatter. */
    points: Array<Required<Pick<FileMeasure, 'ref' | 'complexity' | 'coverage'>>>;
    maxComplexity: number;
    /** Complex files with thin coverage, riskiest first. */
    gaps: Array<Required<FileMeasure>>;
    /** How many such files exist (the list is capped). */
    gapCount: number;
}

const num = (v: number | string | undefined): number | undefined => {
    if (v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};

export const measureOf = (n: KNode): FileMeasure => {
    const complexity = num(n.badges?.complexity), coverage = num(n.badges?.coverage);
    return { ref: n.ref, name: n.label, ...(complexity !== undefined ? { complexity } : {}), ...(coverage !== undefined ? { coverage } : {}) };
};

/** Riskiness of a gap: the complexity left uncovered. */
export const risk = (m: Required<Pick<FileMeasure, 'complexity' | 'coverage'>>): number => m.complexity * (1 - m.coverage);

export function coverageModel(graph: Pick<KnowledgeGraph, 'nodes'>): CoverageModel {
    const files = graph.nodes.filter((n) => n.kind === 'file' && n.pack === 'code').map(measureOf);
    const covs = files.flatMap((f) => (f.coverage === undefined ? [] : [f.coverage]));
    const cxs = files.flatMap((f) => (f.complexity === undefined ? [] : [f.complexity]));
    const both = files.filter((f): f is Required<FileMeasure> => f.complexity !== undefined && f.coverage !== undefined);
    const gaps = both.filter((f) => f.complexity > 0 && f.coverage < UNTESTED_BELOW).sort((a, b) => risk(b) - risk(a) || cmp(a.ref, b.ref));
    return {
        files: files.length, withCoverage: covs.length, withComplexity: cxs.length,
        ...(covs.length ? { meanCoverage: covs.reduce((a, b) => a + b, 0) / covs.length } : {}),
        totalComplexity: cxs.reduce((a, b) => a + b, 0),
        points: both.map(({ ref, complexity, coverage }) => ({ ref, complexity, coverage })),
        maxComplexity: Math.max(0, ...cxs),
        gaps: gaps.slice(0, MAX_GAPS), gapCount: gaps.length,
    };
}
