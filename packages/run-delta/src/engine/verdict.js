/**
 * engine/verdict.ts — the per-dimension verdict rules, exactly as PRD 41 states them, as DATA
 * ({@link VERDICT_POLICIES}) over one evaluator:
 *
 *  - `attack-surface` (C5, also the default): `worse` when an introduced or changed finding is
 *    error-level, or more than one warn was introduced. In SECURITY, a heuristic error counts as a warn
 *    unless a measured error there corroborates it (C4: heuristic never alone sets `worse` at error),
 *    except a §12.5 blocking or C8.2 integrity rule; either way the `heuristic` reason. `better` when findings were resolved and NOTHING was introduced — C5 says
 *    "nothing", so an introduced finding of ANY severity, info included, prevents `better`.
 *  - `static-tier` (C6): `worse` on an introduced/changed error-level static finding or a metric
 *    regression beyond its error threshold; `better` symmetrically (an error-level finding resolved, or
 *    an improvement beyond the error threshold). Always carries `static-only` (no dynamic tier yet).
 *  - `integrity` (C8): any C8.2 error makes the dimension `worse` whatever else improved, with the
 *    `tests-weakened` reason; otherwise the default rule.
 *
 * Shared: a metric regression beyond its `error` threshold counts as an error-level introduction; one
 * beyond `warn` only prevents `better`; an improvement beyond `warn` counts as a resolution. A dimension
 * where no rule exists is `not_measured` (`rule-not-built`). A rule whose kind is not comparable (C9),
 * or that threw (`analyzer-failed:<ruleId>`), folds `not_comparable` into the verdict by
 * {@link HEADLINE_ORDER}. `present` and waived findings never count.
 */
import { HEADLINE_ORDER } from '../contract.js';
import { isFresh, isOpen } from './findingFacts.js';
import { sortedUnique } from './text.js';
import { withinNoise } from './noise.js';
export const VERDICT_POLICIES = {
    security: 'attack-surface',
    performance: 'static-tier',
    quality: 'integrity',
};
const DEFAULT_POLICY = 'attack-surface';
/** The worst verdict by {@link HEADLINE_ORDER}; `not_measured` for none. */
export function worst(verdicts) {
    let best = HEADLINE_ORDER.length - 1;
    for (const v of verdicts)
        best = Math.min(best, HEADLINE_ORDER.indexOf(v));
    return HEADLINE_ORDER[best];
}
/** A C8.2 test-integrity error: an error-severity finding of a C8.2 rule. */
export const isIntegrityError = (f, integrityRules) => f.severity === 'error' && integrityRules.has(f.ruleId);
/** How far a metric moved past its thresholds, in the worse and the better direction. */
export function metricLevels(m) {
    const { before, after } = m;
    // C6.2: a sampled metric (benchmarks) whose change is not significant is `same (within noise)`.
    if (before === null || after === null || withinNoise(m))
        return { regression: undefined, improvement: undefined };
    const delta = (after - before) * m.step;
    const worseBy = m.betterWhen === 'lower' ? delta : -delta;
    const size = (v) => m.threshold.kind === 'abs' ? v : before === 0 ? (v > 0 ? Infinity : 0) : v / Math.abs(before * m.step);
    const level = (v) => v <= 0 ? undefined : size(v) >= m.threshold.error ? 'error' : size(v) >= m.threshold.warn ? 'warn' : undefined;
    return { regression: level(worseBy), improvement: level(-worseBy) };
}
export function dimensionVerdict(ev) {
    const policy = VERDICT_POLICIES[ev.id] ?? DEFAULT_POLICY;
    const reasons = policy === 'static-tier' ? ['static-only'] : [];
    if (ev.failed.length > 0)
        reasons.push('rule-failed');
    if (ev.ran === 0 && ev.failed.length === 0)
        return { verdict: 'not_measured', reasons: sortedUnique([...reasons, 'rule-not-built']) };
    const open = ev.findings.filter(isOpen);
    const rawErrors = ev.findings.filter((f) => isFresh(f) && f.severity === 'error');
    // C4 / C5 verdict: in the SECURITY dimension a heuristic finding never alone sets `worse` at error. A
    // heuristic error counts as a warn unless a measured error in the dimension corroborates it — except a
    // §12.5 blocking rule or a C8.2 integrity rule, whose error is the gate itself. (Other dimensions keep
    // their §8 done-checks: e.g. a text-detected `api-breaking` makes compatibility `worse`.)
    const corroborated = ev.id !== 'security' || rawErrors.some((f) => f.confidence === 'measured');
    const keepsError = (f) => f.confidence === 'measured' || corroborated
        || (ev.blockingRules?.has(f.ruleId) ?? false) || ev.integrityRules.has(f.ruleId);
    const errors = rawErrors.filter(keepsError);
    const demoted = rawErrors.filter((f) => !keepsError(f));
    const introduced = open.filter((f) => f.lineage === 'introduced');
    const introducedWarns = introduced.filter((f) => f.severity === 'warn' || demoted.includes(f)).length;
    if (demoted.length > 0)
        reasons.push('heuristic');
    const resolved = open.filter((f) => f.lineage === 'resolved');
    let metricError = false, metricWarns = 0, metricImproved;
    for (const m of ev.metrics) {
        if (ev.metricsNotComparable.has(m.metricId))
            continue;
        if (m.before === null || m.after === null) {
            reasons.push('metric-not-measured');
            continue;
        }
        const { regression, improvement } = metricLevels(m);
        if (regression === 'error')
            metricError = true;
        else if (regression === 'warn')
            metricWarns++;
        if (improvement === 'error' || (improvement === 'warn' && metricImproved !== 'error'))
            metricImproved = improvement;
    }
    let verdict = 'same';
    if (policy === 'static-tier') {
        if (errors.length > 0 || metricError)
            verdict = 'worse';
        else if ((resolved.some((f) => f.severity === 'error') || metricImproved === 'error') && introduced.length === 0)
            verdict = 'better';
    }
    else {
        const integrity = policy === 'integrity' && errors.some((f) => isIntegrityError(f, ev.integrityRules));
        if (integrity)
            reasons.push('tests-weakened');
        if (integrity || errors.length > 0 || metricError || introducedWarns > 1)
            verdict = 'worse';
        else if ((resolved.length > 0 || metricImproved !== undefined) && introduced.length === 0 && metricWarns === 0)
            verdict = 'better';
    }
    if (verdict === 'worse' && errors.length > 0 && errors.every((f) => f.confidence === 'heuristic'))
        reasons.push('heuristic');
    if (ev.notComparable.length > 0 || ev.metricsNotComparable.size > 0) {
        verdict = worst([verdict, 'not_comparable']);
        reasons.push('not-comparable', ...ev.notComparable);
    }
    return { verdict, reasons: sortedUnique(reasons) };
}
//# sourceMappingURL=verdict.js.map