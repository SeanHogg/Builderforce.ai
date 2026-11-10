/**
 * Codes → localized words for the run delta (PRD 41 §C11). Pure: the engine's codes and counts
 * go in, the catalog's templates come out. An unknown code (a rule added after this build)
 * renders as the code itself rather than blank, and never throws.
 */

import type { DeltaFinding, DimensionId, HeadlineModel, MetricDelta, Verdict } from '@builderforce/run-delta/contract';
import { fillTemplate } from '../template';
import { labelKey, type RunDeltaLabels } from './labels';
import { RUN_DELTA_TOOL_REASON_PREFIXES } from './codes';

const pick = (map: Record<string, string>, code: string): string | undefined => map[labelKey(code)];

/** The lineage a finding is shown under. `present` = "present now" WITHOUT lineage (C9): it never counts as new or resolved. */
export type LineageGroup = 'introduced' | 'resolved' | 'changed' | 'persisting' | 'present';

/**
 * A finding's {@link LineageGroup}. The contract is mid-move from a `presentNow` flag to a `present` lineage
 * value; both read as `present`, so the card is right whichever shape the engine sends.
 */
export function lineageGroup(f: DeltaFinding): LineageGroup {
    const lineage = f.lineage as string;
    if (lineage === 'present' || (f as { presentNow?: boolean }).presentNow === true) return 'present';
    return lineage as LineageGroup;
}

export const verdictLabel = (l: RunDeltaLabels, v: Verdict): string => l.verdicts[labelKey(v) as keyof RunDeltaLabels['verdicts']] ?? v;

export const dimensionLabel = (l: RunDeltaLabels, d: DimensionId | string): string =>
    (l.dimensions as Record<string, string>)[labelKey(d)] ?? d;

export const ruleLabel = (l: RunDeltaLabels, ruleId: string): string => pick(l.rules, ruleId) ?? ruleId;

export const metricLabel = (l: RunDeltaLabels, metricId: string): string => pick(l.metrics, metricId) ?? metricId;

/** A reason code, including memory's `tool-missing:<tool>` family. */
export function reasonLabel(l: RunDeltaLabels, code: string): string {
    const colon = code.indexOf(':');
    if (colon > 0) {
        const prefix = code.slice(0, colon);
        if ((RUN_DELTA_TOOL_REASON_PREFIXES as readonly string[]).includes(prefix)) {
            const template = pick(l.reasons, prefix);
            if (template) return fillTemplate(template, { tool: code.slice(colon + 1) });
        }
    }
    return pick(l.reasons, code) ?? code;
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
