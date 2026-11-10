/**
 * rules/ilities/couplingMetric.ts — Martin's coupling of the run's changed files (ilities.maintainability
 * metrics; C7 modularity), per side from that side's import facts, each the MAX over the changed files
 * (one file that became a hub is the signal; a sum would grow with the size of the run):
 *
 *  - `coupling.efferent` (Ce): distinct modules the file imports;
 *  - `coupling.afferent` (Ca): distinct files importing it (reverse edges over the whole side);
 *  - `coupling.instability` (I = Ce / (Ca + Ce), at step 0.01; a file with neither edge counts 0).
 *
 * A side whose import facts are empty is not measured (`null`); with none on either side no row is emitted.
 *
 * Measured: the extractors' resolved import edges. Per-partition values need partition facts the delta
 * input does not carry; these are the changed files' own values.
 */

import type { MetricDelta, MetricRule, SideFacts } from '../../contract.js';

interface Side { ce: number; ca: number; instability: number }

function sideOf(facts: SideFacts, paths: readonly string[]): Side | null {
    if (facts.imports.size === 0) return null;
    const wanted = new Set(paths);
    const importers = new Map<string, Set<string>>();
    for (const [from, tos] of facts.imports) {
        for (const to of tos) if (wanted.has(to) && to !== from) (importers.get(to) ?? importers.set(to, new Set()).get(to)!).add(from);
    }
    let ce = 0, ca = 0, instability = 0;
    for (const p of paths) {
        const e = new Set(facts.imports.get(p) ?? []).size, a = importers.get(p)?.size ?? 0;
        ce = Math.max(ce, e);
        ca = Math.max(ca, a);
        if (e + a > 0) instability = Math.max(instability, Math.round((100 * e) / (e + a)));
    }
    return { ce, ca, instability };
}

const row = (metricId: string, before: number | null, after: number | null, step: number, threshold: MetricDelta['threshold'], unit: string): MetricDelta =>
    ({ metricId, before, after, step, unit, betterWhen: 'lower', threshold });

export const couplingMetric: MetricRule = {
    id: 'coupling',
    version: 2,
    dimension: 'ilities.maintainability',
    reads: ['structure'],
    derive(input) {
        if (input.beforeFacts.imports.size === 0 && input.afterFacts.imports.size === 0) return [];
        const paths = input.changed.map((f) => f.path);
        const b = sideOf(input.beforeFacts, paths), a = sideOf(input.afterFacts, paths);
        return [
            row('coupling.efferent', b?.ce ?? null, a?.ce ?? null, 1, { warn: 5, error: 15, kind: 'abs' }, 'count'),
            row('coupling.afferent', b?.ca ?? null, a?.ca ?? null, 1, { warn: 10, error: 50, kind: 'abs' }, 'count'),
            row('coupling.instability', b?.instability ?? null, a?.instability ?? null, 0.01, { warn: 0.25, error: 0.5, kind: 'abs' }, 'ratio'),
        ];
    },
};
