/**
 * rules/complexityMetric.ts — `complexity.max` and `complexity.sum` (quality metrics; C8.1) over the
 * changed code files, from the extractors' file badges (`maxComplexity`, `complexity`; agent-tools
 * `CODE_BADGES`). Measured facts, not text: a file that exists on a side without the badge makes that
 * side `null` (not measured), never 0.
 */

import type { MetricRule, RuleInput, SideFacts } from '../contract.js';
import { isCodePath, isTestPath } from './support/files.js';
import { sideMetric } from './support/metric.js';

const badge = (facts: SideFacts, path: string, key: string): number | null => {
    const v = facts.badges.get(path)?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
};

const factsOf = (input: RuleInput, side: 'before' | 'after') => (side === 'before' ? input.beforeFacts : input.afterFacts);

export const complexityMetric: MetricRule = {
    id: 'complexity',
    version: 1,
    dimension: 'quality',
    reads: ['structure'],
    derive(input) {
        const files = (p: string) => isCodePath(p) && !isTestPath(p);
        return [
            sideMetric(input, {
                metricId: 'complexity.max', unit: 'cyclomatic', threshold: { warn: 5, error: 10, kind: 'abs' }, files, combine: 'max',
                value: (_t, _p, side, sidePath) => badge(factsOf(input, side), sidePath, 'maxComplexity'),
            }),
            sideMetric(input, {
                metricId: 'complexity.sum', unit: 'cyclomatic', threshold: { warn: 10, error: 30, kind: 'abs' }, files, combine: 'sum',
                value: (_t, _p, side, sidePath) => badge(factsOf(input, side), sidePath, 'complexity'),
            }),
        ];
    },
};
