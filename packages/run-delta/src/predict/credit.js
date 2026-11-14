/**
 * predict/credit.ts — D9.1 credit: whether a dynamic check that ran was DECISIVE for a dimension's verdict.
 *
 * Over the final delta, with the engine's own `dimensionVerdict`, a check is credited for a dimension when it is
 * decisive by EITHER test:
 *  - leave-one-out: the verdict with everything differs from the verdict without this check's contributions;
 *  - alone: the verdict without ANY dynamic check's contributions differs from that same baseline plus this check's
 *    alone — so two checks that both catch one regression are both credited (leave-one-out alone would credit neither).
 * A transition out of `not_measured` (the check merely measured a dimension nothing else measured) is not a verdict
 * change in either test, and a dimension that is `not_comparable` credits nobody.
 *
 * "Without the check" removes EVERYTHING the check produced: its own rules and metrics, and every analyzer row whose
 * provenance names it (`MeasuredBy.producedBy` — the `coverage` row the tier re-measured after `diff-coverage`'s tests),
 * with that analyzer's metrics and finding kinds (registry `ANALYZER_RULES`).
 *
 * Both evaluations are rebuilt from the stored {@link DimensionResult} alone (findings, metrics, `measuredBy`, reasons),
 * the same way, so whatever the stored row cannot say (which analyzer is not comparable) cancels out.
 */
import { DYNAMIC_CHECK_DIMENSION } from '../dynamic/contract.js';
import { metricRuleId } from '../dynamic/fold.js';
import { dimensionVerdict } from '../engine/verdict.js';
import { ANALYZER_RULES } from '../registry/analyzers.js';
const NOTHING = { rules: new Set(), metrics: new Set() };
function evaluationOf(d, drop) {
    return {
        id: d.id,
        ran: d.measuredBy.filter((row) => row.status === 'ok' && !drop.rules.has(row.tool)).length,
        failed: d.reasons.includes('rule-failed') ? ['carried'] : [],
        notComparable: [],
        findings: d.findings.filter((f) => !drop.rules.has(f.ruleId)),
        metrics: d.metrics.filter((m) => !drop.metrics.has(m.metricId)),
        metricsNotComparable: new Set(),
        integrityRules: new Set(),
    };
}
/**
 * What the check contributed to the delta: its rule ids (finding and metric rules) and metric ids, plus every analyzer
 * the delta says it produced (`producedBy`) with that analyzer's finding kinds and metric ids.
 */
function droppedOf(result, delta) {
    const rules = new Set();
    const metrics = new Set();
    for (const m of result.measurements) {
        rules.add(m.ruleId);
        rules.add(metricRuleId(m.ruleId));
        for (const metric of m.metrics)
            metrics.add(metric.metricId);
    }
    const produced = new Set(delta.dimensions.flatMap((d) => d.measuredBy.filter((row) => row.producedBy === result.check).map((row) => row.tool)));
    for (const row of ANALYZER_RULES) {
        if (!produced.has(row.tool))
            continue;
        rules.add(row.tool);
        for (const kind of Object.keys(row.kinds))
            rules.add(kind);
        for (const metricId of Object.keys(row.metrics ?? {}))
            metrics.add(metricId);
    }
    return { rules, metrics };
}
const union = (sets) => ({
    rules: new Set(sets.flatMap((s) => [...s.rules])),
    metrics: new Set(sets.flatMap((s) => [...s.metrics])),
});
const minus = (a, b) => ({
    rules: new Set([...a.rules].filter((x) => !b.rules.has(x))),
    metrics: new Set([...a.metrics].filter((x) => !b.metrics.has(x))),
});
/**
 * The dimensions an `ok` check was decisive for, sorted. Empty for a check that did not run `ok`. `all` are the run's
 * dynamic-check results (this one included), for the "alone" test; default: this check only.
 */
export function decisiveDimensions(result, finalDelta, all = [result]) {
    if (result.status !== 'ok')
        return [];
    const dims = new Set([DYNAMIC_CHECK_DIMENSION[result.check], ...result.measurements.map((m) => m.dimension)]);
    const own = droppedOf(result, finalDelta);
    const everyCheck = union([own, ...all.filter((r) => r.status === 'ok' && r !== result).map((r) => droppedOf(r, finalDelta))]);
    const onlyThis = minus(everyCheck, own);
    const out = [];
    for (const id of dims) {
        const d = finalDelta.dimensions.find((x) => x.id === id);
        if (!d || d.verdict === 'not_comparable')
            continue;
        const verdict = (drop) => dimensionVerdict(evaluationOf(d, drop)).verdict;
        const full = verdict(NOTHING), without = verdict(own);
        const baseline = verdict(everyCheck), alone = verdict(onlyThis);
        const leaveOneOut = full !== without && without !== 'not_measured';
        const decisiveAlone = alone !== baseline && baseline !== 'not_measured';
        if (leaveOneOut || decisiveAlone)
            out.push(id);
    }
    return out.sort();
}
//# sourceMappingURL=credit.js.map