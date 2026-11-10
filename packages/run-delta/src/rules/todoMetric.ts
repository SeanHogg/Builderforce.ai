/**
 * rules/todoMetric.ts — `todo.added` (quality metric; C8.1): TODO/FIXME/XXX/HACK markers across the
 * changed code files, before vs after.
 *
 * Heuristic: text-level over the raw text; WS4 tree-sitter comment facts replace it.
 */

import type { MetricRule } from '../contract.js';
import { isCodePath } from './support/files.js';
import { sideMetric } from './support/metric.js';

const MARKER = /\b(?:TODO|FIXME|XXX|HACK)\b/g;

export const todoMetric: MetricRule = {
    id: 'todo',
    version: 1,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        return [sideMetric(input, {
            metricId: 'todo.added', unit: 'count', threshold: { warn: 1, error: 10, kind: 'abs' }, files: isCodePath, combine: 'sum',
            value: (view) => [...view.text.matchAll(MARKER)].length,
        })];
    },
};
