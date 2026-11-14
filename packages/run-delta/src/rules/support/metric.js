/**
 * rules/support/metric.ts — the C8.1 metric shape: one integer value per side over the changed
 * files (`null` = not measured on that side), as a {@link MetricDelta} at step 1.
 */
import { filePairs } from './files.js';
export function sideMetric(input, spec) {
    const total = { before: 0, after: 0 };
    for (const pair of filePairs(input)) {
        if (!spec.files(pair.path))
            continue;
        for (const side of ['before', 'after']) {
            const view = pair[side];
            if (!view || total[side] === null)
                continue;
            const v = spec.value(view, side);
            if (v === null) {
                total[side] = null;
                continue;
            }
            total[side] = spec.combine === 'sum' ? total[side] + v : Math.max(total[side], v);
        }
    }
    return {
        metricId: spec.metricId, before: total.before, after: total.after, step: 1, unit: spec.unit,
        betterWhen: 'lower', threshold: spec.threshold,
    };
}
//# sourceMappingURL=metric.js.map