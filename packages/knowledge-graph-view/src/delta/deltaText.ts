/**
 * Codes → localized words for the run delta (PRD 41 §C11). Pure: the engine's codes and counts
 * go in, the catalog's templates come out. An unknown code (a rule added after this build)
 * renders as the code itself rather than blank, and never throws.
 */

import type { DeltaFinding, DimensionId, DroppedOverride, HeadlineModel, MetricDelta, Verdict } from '@builderforce/run-delta/contract';
import { fillTemplate } from '../template';
import { labelKey, type RunDeltaLabels } from './labels';
import { RUN_DELTA_TOOL_REASON_PREFIXES } from './codes';

const pick = (map: Record<string, string>, code: string): string | undefined => map[labelKey(code)];

/** The lineage a finding is shown under. `present` = "present now" WITHOUT lineage (C9): it never counts as new or resolved. */
export type LineageGroup = 'introduced' | 'resolved' | 'changed' | 'persisting' | 'present';

/** A finding's {@link LineageGroup}: its lineage, `present` included. */
export const lineageGroup = (f: DeltaFinding): LineageGroup => f.lineage;

export const verdictLabel = (l: RunDeltaLabels, v: Verdict): string => l.verdicts[labelKey(v) as keyof RunDeltaLabels['verdicts']] ?? v;

export const dimensionLabel = (l: RunDeltaLabels, d: DimensionId | string): string =>
    (l.dimensions as Record<string, string>)[labelKey(d)] ?? d;

export const ruleLabel = (l: RunDeltaLabels, ruleId: string): string => pick(l.rules, ruleId) ?? ruleId;

export const metricLabel = (l: RunDeltaLabels, metricId: string): string => pick(l.metrics, metricId) ?? metricId;

/**
 * A reason code. Prefixed families carry their subject after the colon: memory's `tool-missing:<tool>` /
 * `tool-version-changed:<tool>`, `analyzer-failed:<ruleId>` and `not-comparable:<ruleId>` (the id read as a rule
 * label), and an override's `unsafe-regex:<key>.<reason>`.
 */
export function reasonLabel(l: RunDeltaLabels, code: string): string {
    const colon = code.indexOf(':');
    if (colon > 0) {
        const prefix = code.slice(0, colon);
        const subject = code.slice(colon + 1);
        if (prefix === 'not-comparable' && l.reasons.notComparableRule) return fillTemplate(l.reasons.notComparableRule, { rule: ruleLabel(l, subject) });
        if (prefix === 'unsafe-regex' && l.reasons.unsafeRegex) {
            const dot = subject.lastIndexOf('.');
            const reason = dot > 0 ? subject.slice(dot + 1) : '';
            return fillTemplate(l.reasons.unsafeRegex, { key: dot > 0 ? subject.slice(0, dot) : subject, reason: pick(l.unsafeReasons, reason) ?? reason });
        }
        if ((RUN_DELTA_TOOL_REASON_PREFIXES as readonly string[]).includes(prefix)) {
            const template = pick(l.reasons, prefix);
            // A rule's or a dynamic check's id reads as its label; a tool's name is a name.
            const named = prefix === 'analyzer-failed' || prefix === 'dynamic-not-run';
            if (template) return fillTemplate(template, { tool: named ? ruleLabel(l, subject) : subject });
        }
    }
    return pick(l.reasons, code) ?? code;
}

/** A blocking code (`RunDelta.blocking`): a rule id, `not-comparable:<ruleId>` or `head-switched`. */
export const blockingLabel = (l: RunDeltaLabels, code: string): string => pick(l.rules, code) ?? reasonLabel(l, code);

/** An ignored override (`RunDeltaOverrides.dropped`): its code's label; an `unsafe-regex` with a reason reads like the reason code. */
export function overrideLabel(l: RunDeltaLabels, d: DroppedOverride): string {
    if (d.code === 'unsafe-regex' && d.reason) return reasonLabel(l, `unsafe-regex:${d.section}.${d.reason}`);
    const reason = d.reason ? (pick(l.excluded, d.reason) ?? d.reason) : undefined;
    const template = (l.overrides as Record<string, string>)[labelKey(d.code)];
    return template ? fillTemplate(template, { section: d.section, reason, count: d.count }) : d.code;
}

/** The rules that held a run, each through {@link ruleLabel} (a `not-comparable:<rule>` / `head-switched` code as a reason). */
export const heldRulesText = (l: RunDeltaLabels, rules: readonly string[]): string =>
    rules.map((r) => blockingLabel(l, r)).join(l.headline.listSeparator);

/** The "Release run" confirmation's body, naming the rules that hold the run. */
export const releaseConfirmText = (l: RunDeltaLabels, rules: readonly string[]): string =>
    fillTemplate(l.releaseConfirmMessage, { rules: heldRulesText(l, rules) });

/** A finding param's name. */
export const paramLabel = (l: RunDeltaLabels, key: string): string => pick(l.params, key) ?? key;

/** A param value: localized when the param is a coded one (`via`, `change`, `kind`, `crossed`) and the value is known, else as is. */
export function paramValueLabel(l: RunDeltaLabels, key: string, value: string | number): string {
    const values = l.paramValues[labelKey(key)];
    return (values && pick(values, String(value))) ?? String(value);
}

/** An evidence note: the finding's own rule id (fact findings) or its `change` code reads localized; any other note is data. */
export function noteLabel(l: RunDeltaLabels, finding: Pick<DeltaFinding, 'ruleId' | 'params'>, note: string): string {
    if (note === finding.ruleId) return ruleLabel(l, note);
    if (finding.params.change !== undefined && String(finding.params.change) === note) return paramValueLabel(l, 'change', note);
    return note;
}

/** A headline clause code: a rule id, `metric:<id>`, a clause code or a reason. */
export function clauseLabel(l: RunDeltaLabels, code: string): string {
    if (code.startsWith('metric:')) return fillTemplate(l.headline.metricRegressed, { metric: metricLabel(l, code.slice('metric:'.length)) });
    return pick(l.rules, code) ?? pick(l.clauses, code) ?? reasonLabel(l, code);
}

/** "Worse: Security (1 × Route lost its auth guard); Quality (2 × Tests weakened). Unchanged: Performance." */
export function headlineText(l: RunDeltaLabels, s: HeadlineModel): string {
    const lead = verdictLabel(l, s.verdict);
    const clauses = s.clauses.map((c) => fillTemplate(l.headline.clause, {
        dimension: dimensionLabel(l, c.dimension),
        detail: fillTemplate(l.headline.detail, { count: c.count > 0 ? c.count : undefined, label: clauseLabel(l, c.code) }),
    }));
    const parts = [clauses.length > 0
        ? fillTemplate(l.headline.sentence, { lead, clauses: clauses.join(l.headline.clauseSeparator) })
        : fillTemplate(l.headline.sentenceNoClauses, { lead })];
    const list = (ids: readonly DimensionId[]) => ids.map((d) => dimensionLabel(l, d)).join(l.headline.listSeparator);
    // Unchanged dimensions are named only when something else is the headline; "Unchanged. Unchanged: …" says nothing.
    if (s.unchanged.length > 0 && s.verdict !== 'same') parts.push(fillTemplate(l.headline.unchanged, { dimensions: list(s.unchanged) }));
    if (s.notMeasured.length > 0 && s.verdict !== 'not_measured') parts.push(fillTemplate(l.headline.notMeasured, { dimensions: list(s.notMeasured) }));
    return parts.join(' ');
}

/** A quantized integer of `step` → its decimal value, with no float noise (`step` 0.01 ⇒ 2 decimals). */
export function quantizedValue(value: number, step: number): string {
    const decimals = step > 0 && step < 1 ? Math.min(6, Math.max(0, Math.round(-Math.log10(step)))) : 0;
    return (value * step).toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** "3 → 7 cyclomatic"; a side that was not measured reads as such, never as 0. */
export function metricValueText(l: RunDeltaLabels, m: MetricDelta): string {
    const side = (v: number | null) => (v === null ? l.notMeasuredValue : quantizedValue(v, m.step));
    return fillTemplate(l.metricValue, { before: side(m.before), after: side(m.after), unit: pick(l.units, m.unit) });
}
