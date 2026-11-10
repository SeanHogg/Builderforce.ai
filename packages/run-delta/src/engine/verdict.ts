/**
 * engine/verdict.ts — the per-dimension verdict rules, exactly as PRD 41 states them, as DATA
 * ({@link VERDICT_POLICIES}) over one evaluator:
 *
 *  - `attack-surface` (C5, also the default): `worse` when an introduced or changed finding is
 *    error-level, or more than one warn was introduced; heuristic-only errors still give `worse`, with
 *    the `heuristic` reason. `better` when findings were resolved and no warn/error was introduced.
 *  - `static-tier` (C6): `worse` on an introduced/changed error-level static finding or a metric
 *    regression beyond its error threshold; `better` symmetrically (an error-level finding resolved, or
 *    an improvement beyond the error threshold). Always carries `static-only` (no dynamic tier yet).
 *  - `integrity` (C8): any C8.2 error makes the dimension `worse` whatever else improved, with the
 *    `tests-weakened` reason; otherwise the default rule.
 *
 * Shared: a metric regression beyond its `error` threshold counts as an error-level introduction; one
 * beyond `warn` only prevents `better`; an improvement beyond `warn` counts as a resolution. A dimension where no rule ran
 * is `not_measured` (`rule-not-built`, or `rule-failed`). A rule whose kind is not comparable (C9) folds
 * `not_comparable` into the verdict by {@link HEADLINE_ORDER}. Presented-now and waived findings never
 * count.
 */

import { HEADLINE_ORDER, type DeltaFinding, type DimensionId, type MetricDelta, type Verdict } from '../contract.js';
import { sortedUnique } from './text.js';

export type VerdictPolicy = 'attack-surface' | 'static-tier' | 'integrity';

export const VERDICT_POLICIES: Readonly<Partial<Record<DimensionId, VerdictPolicy>>> = {
    security: 'attack-surface',
    performance: 'static-tier',
    quality: 'integrity',
};
const DEFAULT_POLICY: VerdictPolicy = 'attack-surface';

/** The worst verdict by {@link HEADLINE_ORDER}; `not_measured` for none. */
export function worst(verdicts: Iterable<Verdict>): Verdict {
    let best = HEADLINE_ORDER.length - 1;
    for (const v of verdicts) best = Math.min(best, HEADLINE_ORDER.indexOf(v));
    return HEADLINE_ORDER[best]!;
}

export interface DimensionEvaluation {
    id: DimensionId;
    /** Rules and metric rules that ran to completion. */
    ran: number;
    /** Rule ids that threw. */
    failed: readonly string[];
    /** Reasons of the rules whose kind is not comparable (empty = all comparable). */
    notComparable: readonly string[];
    findings: readonly DeltaFinding[];
    metrics: readonly MetricDelta[];
    /** Metric ids that are not comparable (excluded from the verdict). */
    metricsNotComparable: ReadonlySet<string>;
    /** C8.2 rule ids (test integrity). */
    integrityRules: ReadonlySet<string>;
}

type Level = 'error' | 'warn' | undefined;

/** How far a metric moved past its thresholds, in the worse and the better direction. */
export function metricLevels(m: MetricDelta): { regression: Level; improvement: Level } {
    const { before, after } = m;
    if (before === null || after === null) return { regression: undefined, improvement: undefined };
    const delta = (after - before) * m.step;
    const worseBy = m.betterWhen === 'lower' ? delta : -delta;
    const size = (v: number): number => m.threshold.kind === 'abs' ? v : before === 0 ? (v > 0 ? Infinity : 0) : v / Math.abs(before * m.step);
    const level = (v: number): Level => v <= 0 ? undefined : size(v) >= m.threshold.error ? 'error' : size(v) >= m.threshold.warn ? 'warn' : undefined;
    return { regression: level(worseBy), improvement: level(-worseBy) };
}

export function dimensionVerdict(ev: DimensionEvaluation): { verdict: Verdict; reasons: string[] } {
    const policy = VERDICT_POLICIES[ev.id] ?? DEFAULT_POLICY;
    const reasons: string[] = policy === 'static-tier' ? ['static-only'] : [];
    if (ev.failed.length > 0) reasons.push('rule-failed');
    if (ev.ran === 0) return { verdict: 'not_measured', reasons: sortedUnique([...reasons, ev.failed.length > 0 ? 'rule-failed' : 'rule-not-built']) };

    const open = ev.findings.filter((f) => !f.presentNow && !f.waiver);
    const fresh = open.filter((f) => f.lineage === 'introduced' || f.lineage === 'changed');
    const errors = fresh.filter((f) => f.severity === 'error');
    const introducedWarns = open.filter((f) => f.lineage === 'introduced' && f.severity === 'warn').length;
    const introducedAny = open.some((f) => f.lineage === 'introduced' && f.severity !== 'info');
    const resolved = open.filter((f) => f.lineage === 'resolved');

    let metricError = false, metricWarns = 0, metricImproved: Level;
    for (const m of ev.metrics) {
        if (ev.metricsNotComparable.has(m.metricId)) continue;
        if (m.before === null || m.after === null) { reasons.push('metric-not-measured'); continue; }
        const { regression, improvement } = metricLevels(m);
        if (regression === 'error') metricError = true;
        else if (regression === 'warn') metricWarns++;
        if (improvement === 'error' || (improvement === 'warn' && metricImproved !== 'error')) metricImproved = improvement;
    }

    let verdict: Verdict = 'same';
    if (policy === 'static-tier') {
        if (errors.length > 0 || metricError) verdict = 'worse';
        else if (resolved.some((f) => f.severity === 'error') || metricImproved === 'error') verdict = 'better';
    } else {
        const integrity = policy === 'integrity' && errors.some((f) => ev.integrityRules.has(f.ruleId));
        if (integrity) reasons.push('tests-weakened');
        if (integrity || errors.length > 0 || metricError || introducedWarns > 1) verdict = 'worse';
        else if ((resolved.length > 0 || metricImproved !== undefined) && !introducedAny && metricWarns === 0) verdict = 'better';
    }
    if (verdict === 'worse' && errors.length > 0 && errors.every((f) => f.confidence === 'heuristic')) reasons.push('heuristic');

    if (ev.notComparable.length > 0 || ev.metricsNotComparable.size > 0) {
        verdict = worst([verdict, 'not_comparable']);
        reasons.push('not-comparable', ...ev.notComparable);
    }
    return { verdict, reasons: sortedUnique(reasons) };
}
