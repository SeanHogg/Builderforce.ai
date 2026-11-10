/**
 * rules/anyCastMetric.ts — `any-cast.added` (quality metric; C8.1): `as any` / `as unknown` casts and
 * `<any>` assertions across the changed JS/TS files, over masked source (strings and comments blanked).
 *
 * Heuristic: text-level; WS4 tree-sitter cast facts replace it.
 */

import type { MetricRule } from '../contract.js';
import { isJsPath } from './support/files.js';
import { sideMetric } from './support/metric.js';

const CAST = /\bas\s+(?:any|unknown)\b|<any>/g;

export const anyCastMetric: MetricRule = {
    id: 'any-cast',
    version: 1,
    dimension: 'quality',
    reads: ['content'],
    derive(input) {
        return [sideMetric(input, {
            metricId: 'any-cast.added', unit: 'count', threshold: { warn: 1, error: 5, kind: 'abs' }, files: isJsPath, combine: 'sum',
            value: (view) => [...view.bare.matchAll(CAST)].length,
        })];
    },
};
