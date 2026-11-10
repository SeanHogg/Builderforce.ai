/**
 * rules/support/metric.ts — the C8.1 metric shape: one integer value per side over the changed
 * files (`null` = not measured on that side), as a {@link MetricDelta} at step 1.
 */

import type { MetricDelta, RuleInput } from '../../contract.js';
import { filePairs, type TextView } from './files.js';

export interface MetricSpec {
    metricId: string;
    unit: string;
    threshold: MetricDelta['threshold'];
    files(path: string): boolean;
    /** The file's value on one side, or `null` when that side cannot measure it. */
    value(view: TextView, side: 'before' | 'after'): number | null;
    combine: 'sum' | 'max';
}

export function sideMetric(input: RuleInput, spec: MetricSpec): MetricDelta {
    const total = { before: 0 as number | null, after: 0 as number | null };
    for (const pair of filePairs(input)) {
        if (!spec.files(pair.path)) continue;
        for (const side of ['before', 'after'] as const) {
            const view = pair[side];
            if (!view || total[side] === null) continue;
            const v = spec.value(view, side);
            if (v === null) { total[side] = null; continue; }
            total[side] = spec.combine === 'sum' ? total[side]! + v : Math.max(total[side]!, v);
        }
    }
    return {
        metricId: spec.metricId, before: total.before, after: total.after, step: 1, unit: spec.unit,
        betterWhen: 'lower', threshold: spec.threshold,
    };
}
