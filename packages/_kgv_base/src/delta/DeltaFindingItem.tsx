/**
 * One finding of a run delta in the panel (PRD 41 §C11.2): its rule label, severity, ≈ when it is
 * heuristic, its params and its evidence. Evidence reuses the view's `EvidenceList`: the snippet
 * (already redacted by the engine) is rendered as TEXT in a `<pre>` — never as HTML — and only
 * the snippet box scrolls sideways. An after-side location opens in the editor through the
 * host's `onOpenCode`; a before-side one is an old revision and is shown, not offered.
 */

import type { DeltaFinding, Evidence } from '@builderforce/run-delta/contract';
import { EvidenceList } from '../EvidenceList';
import { cssVar } from '../scene/themeColors';
import { quietButton } from '../styles';
import { TYPE } from '../surface/ui/type';
import { fillTemplate } from '../template';
import type { FindingEvidence } from '../types';
import { noteLabel, paramLabel, paramValueLabel, ruleLabel } from './deltaText';
import type { RunDeltaLabels } from './labels';
import { reasonTag } from './VerdictMark';

/** What "Open code" asks the host to open: a root-relative path on the after side, at a line when known. */
export interface RunDeltaCodeTarget {
    path: string;
    line?: number | undefined;
}

const SEVERITY_TONE = { error: cssVar('sev5'), warn: cssVar('sev3'), info: cssVar('muted') } as const;

function evidenceItems(finding: DeltaFinding, labels: RunDeltaLabels, canOpen: boolean): FindingEvidence[] {
    return finding.evidence.map((e: Evidence) => ({
        label: [e.side === 'before' ? labels.sideBefore : labels.sideAfter, e.note ? noteLabel(labels, finding, e.note) : undefined].filter(Boolean).join(' · '),
        locations: [{ path: e.path, startLine: e.line ?? 0, endLine: e.line ?? 0, openable: canOpen && e.side === 'after' }],
        ...(e.snippet ? { excerpt: e.snippet } : {}),
    }));
}

export interface DeltaFindingItemProps {
    finding: DeltaFinding;
    labels: RunDeltaLabels;
    onOpenCode?: ((target: RunDeltaCodeTarget) => void) | undefined;
}

export function DeltaFindingItem({ finding, labels, onOpenCode }: DeltaFindingItemProps) {
    // `aggregated: 1` is not a detail to read: it marks hits folded into one finding, shown as an ≈ chip with their count.
    const aggregated = finding.params.aggregated === 1;
    const params = Object.entries(finding.params).filter(([k]) => k !== 'aggregated' && !(aggregated && k === 'count'));
    const firstAfter = finding.evidence.find((e) => e.side === 'after');
    return (
        <li data-rule={finding.ruleId} style={{ display: 'grid', gap: 6, minWidth: 0, padding: '8px 0', borderTop: `1px solid ${cssVar('border')}` }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ ...TYPE.subtitle, color: cssVar('text'), flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>
                    {ruleLabel(labels, finding.ruleId)}
                    {finding.change ? <span style={{ ...TYPE.meta, marginInlineStart: 6 }}>{labels.changes[finding.change]}</span> : null}
                </span>
                <span style={{ ...TYPE.status, color: SEVERITY_TONE[finding.severity] }}>{labels.severities[finding.severity]}</span>
                {aggregated && (
                    <span data-aggregated style={reasonTag} title={labels.heuristicHint}>
                        {labels.heuristicMark} {fillTemplate(labels.aggregated, { count: finding.params.count })}
                    </span>
                )}
                {finding.confidence === 'heuristic' && !aggregated && (
                    <span style={reasonTag} title={labels.heuristicHint} aria-label={labels.heuristicHint}>{labels.heuristicMark}</span>
                )}
            </div>
            {finding.waiver && <p style={{ ...TYPE.meta, margin: 0, overflowWrap: 'anywhere' }}>{fillTemplate(labels.waived, { reason: finding.waiver.reason })}</p>}
            {params.length > 0 && (
                <dl aria-label={labels.paramsHeading} style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)', columnGap: 8, rowGap: 2 }}>
                    {params.map(([k, v]) => (
                        <div key={k} style={{ display: 'contents' }}>
                            <dt style={{ ...TYPE.meta, overflowWrap: 'anywhere' }}>{paramLabel(labels, k)}</dt>
                            <dd style={{ ...TYPE.monoValue, margin: 0, color: cssVar('text'), overflowWrap: 'anywhere' }}>{paramValueLabel(labels, k, v)}</dd>
                        </div>
                    ))}
                </dl>
            )}
            <EvidenceList
                items={evidenceItems(finding, labels, !!onOpenCode)}
                onOpenSource={onOpenCode ? (l) => onOpenCode({ path: l.path, line: l.startLine > 0 ? l.startLine : undefined }) : undefined}
            />
            {onOpenCode && firstAfter && (
                <div>
                    <button type="button" onClick={() => onOpenCode({ path: firstAfter.path, line: firstAfter.line })} style={quietButton}>
                        {labels.openCode}
                    </button>
                </div>
            )}
        </li>
    );
}
