/**
 * The run delta as TEXT the user can act on (PRD 41 §C11): `runDeltaDiagnosticsText` is what
 * *Copy diagnostics* puts on the clipboard — the full delta results, like `graphDiagnostics.ts`
 * (pure, the caller supplies the ISO time, English on purpose: it is read by whoever triages the
 * report). `resolveDirectiveText` is the ready-to-send fix directive *Resolve* seeds the host's
 * composer with. Every word comes through `deltaText`'s helpers — codes are never mapped here.
 */

import type { DeltaFinding, RunDelta } from '@builderforce/run-delta/contract';
import {
    blockingLabel, dimensionLabel, headlineText, lineageGroup, metricValueText, paramLabel, paramValueLabel, reasonLabel, ruleLabel,
} from './deltaText';
import { labelKey, type RunDeltaLabels } from './labels';

const TITLE = 'Run delta diagnostics';

function severitiesOf(labels: RunDeltaLabels): Record<string, string> {
    return labels.severities as unknown as Record<string, string>;
}
function lineagesOf(labels: RunDeltaLabels): Record<string, string> {
    return labels.lineages as unknown as Record<string, string>;
}
function bandsOf(labels: RunDeltaLabels): Record<string, string> {
    return labels.bands as unknown as Record<string, string>;
}
function verdictsOf(labels: RunDeltaLabels): Record<string, string> {
    return labels.verdicts as unknown as Record<string, string>;
}

/** One finding, one line: rule, severity, lineage, after-side location, params. */
function findingLine(labels: RunDeltaLabels, f: DeltaFinding): string {
    const parts = [
        ruleLabel(labels, f.ruleId),
        `(${severitiesOf(labels)[labelKey(f.severity)] ?? f.severity})`,
        lineagesOf(labels)[labelKey(lineageGroup(f))] ?? lineageGroup(f),
    ];
    const after = f.evidence.find((e) => e.side === 'after');
    if (after) parts.push(`at ${after.path}${after.line !== undefined ? `:${after.line}` : ''}`);
    const params = Object.entries(f.params).map(([k, v]) => `${paramLabel(labels, k)}=${paramValueLabel(labels, k, v)}`);
    if (params.length) parts.push(`[${params.join(', ')}]`);
    return parts.join(' ');
}

/**
 * The full delta results as diagnostic text: title, run id, the localized headline, blast radius,
 * one section per dimension (verdict, reasons, findings, metrics), the blocking and excluded
 * sections, and the caller-supplied `time` footer.
 */
export function runDeltaDiagnosticsText(labels: RunDeltaLabels, delta: RunDelta, time: string): string {
    const lines = [
        TITLE,
        `run: ${delta.runId}`,
        `headline: ${headlineText(labels, delta.summary)}`,
        `blast: band=${bandsOf(labels)[labelKey(delta.blastRadius.band)] ?? delta.blastRadius.band} reasons=${delta.blastRadius.reasons.map((r) => reasonLabel(labels, r)).join(', ') || 'none'}`,
    ];
    for (const d of delta.dimensions) {
        lines.push('', `dimension: ${dimensionLabel(labels, d.id)}`);
        lines.push(`verdict: ${verdictsOf(labels)[labelKey(d.verdict)] ?? d.verdict}`);
        if (d.reasons.length > 0) lines.push(`reasons: ${d.reasons.map((r) => reasonLabel(labels, r)).join(' · ')}`);
        for (const f of d.findings) lines.push(`  - ${findingLine(labels, f)}`);
        for (const m of d.metrics) lines.push(`  - ${metricValueText(labels, m)}`);
    }
    if (delta.blocking.length > 0) {
        lines.push('', 'blocking:');
        for (const code of delta.blocking) lines.push(`  - ${blockingLabel(labels, code)}`);
    }
    if (delta.excluded.length > 0) {
        lines.push('', 'excluded:');
        for (const e of delta.excluded) lines.push(`  - ${e.path} (${labels.excluded[labelKey(e.reason)] ?? e.reason})`);
    }
    lines.push(`time: ${time}`);
    return lines.join('\n');
}

/**
 * The ready-to-send fix directive behind *Resolve*: names the run, instructs fixing the listed
 * issues without regressing what the run resolved, and lists one bullet per actionable finding —
 * `introduced`, or `changed` at warn/error severity — at its after-side location. Resolved,
 * persisting and present findings are context, not work, so they are never listed.
 */
export function resolveDirectiveText(labels: RunDeltaLabels, delta: RunDelta): string {
    const actionable = delta.dimensions.flatMap((d) => d.findings.filter((f) => {
        if (f.lineage === 'introduced') return true;
        return f.lineage === 'changed' && (f.severity === 'error' || f.severity === 'warn');
    }));
    const bullets = actionable.flatMap((f) => {
        const after = f.evidence.find((e) => e.side === 'after');
        if (!after) return [];
        const severity = severitiesOf(labels)[labelKey(f.severity)] ?? f.severity;
        return [`- ${ruleLabel(labels, f.ruleId)} (${severity}) at ${after.path}${after.line !== undefined ? `:${after.line}` : ''}`];
    });
    const dimensionNames = [...new Set(delta.dimensions.filter((d) => d.verdict === 'better' || d.verdict === 'same').map((d) => dimensionLabel(labels, d.id)))];
    const guard = dimensionNames.length > 0
        ? ` Fix them without regressing what the run resolved or leaving an unchanged dimension worse (${dimensionNames.join(', ')}).`
        : '';
    return [
        `Run ${delta.runId} introduced issues this run's delta measured. Fix the issues listed below.${guard}`,
        ...bullets,
    ].join('\n');
}
