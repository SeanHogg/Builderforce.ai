/**
 * rules/complexityMetric.ts — `complexity.max` and `complexity.sum` (quality metrics; C8.1) over the
 * changed code files, from the extractors' file badges (`maxComplexity`, `complexity`; agent-tools
 * `CODE_BADGES`). Measured facts, not text: a file that exists on a side without the badge makes that
 * side `null` (not measured), never 0.
 */
import { isCodePath, isTestPath } from './support/files.js';
import { sideMetric } from './support/metric.js';
const badge = (facts, path, key) => {
    const v = facts.badges.get(path)?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
};
const factsOf = (input, side) => (side === 'before' ? input.beforeFacts : input.afterFacts);
export const complexityMetric = {
    id: 'complexity',
    version: 1,
    dimension: 'quality',
    reads: ['structure'],
    derive(input) {
        const files = (p) => isCodePath(p) && !isTestPath(p);
        return [
            sideMetric(input, {
                metricId: 'complexity.max', unit: 'cyclomatic', threshold: { warn: 5, error: 10, kind: 'abs' }, files, combine: 'max',
                value: (view, side) => badge(factsOf(input, side), view.sidePath, 'maxComplexity'),
            }),
            sideMetric(input, {
                metricId: 'complexity.sum', unit: 'cyclomatic', threshold: { warn: 10, error: 30, kind: 'abs' }, files, combine: 'sum',
                value: (view, side) => badge(factsOf(input, side), view.sidePath, 'complexity'),
            }),
        ];
    },
};
//# sourceMappingURL=complexityMetric.js.map