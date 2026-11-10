/**
 * rules/ilities/hotspotMetric.ts — `hotspot.touched` (ilities.maintainability metric; C7 modifiability,
 * churn × complexity): for each changed file, its 90-day churn ({@link RuleInput.churn}) times its
 * complexity badge on that side; the metric is the MAX over the changed files — the riskiest hotspot the
 * run touched, before vs after (a run that adds complexity to a high-churn file reads as worse).
 *
 * Not measured (`null`) on a side with no complexity badge for any changed file; no row at all when churn
 * is unknown (empty map) — a zero would claim the files never change.
 */

import type { MetricRule, SideFacts } from '../../contract.js';

function hotspot(facts: SideFacts, paths: readonly string[], churn: ReadonlyMap<string, number>): number | null {
    let best: number | null = null;
    for (const p of paths) {
        const c = facts.badges.get(p)?.['complexity'];
        if (typeof c !== 'number') continue;
        best = Math.max(best ?? 0, Math.round(c * (churn.get(p) ?? 0)));
    }
    return best;
}

export const hotspotMetric: MetricRule = {
    id: 'hotspot',
    version: 1,
    dimension: 'ilities.maintainability',
    reads: ['structure'],
    derive(input) {
        if (input.churn.size === 0) return [];
        const paths = input.changed.map((f) => f.path);
        return [{
            metricId: 'hotspot.touched',
            before: hotspot(input.beforeFacts, paths, input.churn),
            after: hotspot(input.afterFacts, paths, input.churn),
            step: 1,
            unit: 'count',
            betterWhen: 'lower',
            threshold: { warn: 0.25, error: 1, kind: 'pct' },
        }];
    },
};
