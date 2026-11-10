/**
 * The Run Delta panel (PRD 41 §C11.2): a side sheet, never a modal, built on the view's `Panel`
 * (the host's slide-out when it passes one, else the package `Sheet`). Findings are grouped by
 * dimension, then by lineage; each dimension lists its metrics before → after (quantized values
 * divided back by their `step`), and the files outside the verdicts and the checks that did not
 * run are listed with their reasons. Props only: "Open code" is a callback.
 */

import type { DeltaFinding, DimensionResult, RunDelta } from '@builderforce/run-delta/contract';
import { cssVar } from '../scene/themeColors';
import { Panel } from '../Sheet';
import { list, muted } from '../styles';
import { TYPE } from '../surface/ui/type';
import type { KnowledgePanelRenderer } from '../types';
import { blockingLabel, dimensionLabel, headlineText, lineageGroup, metricLabel, metricValueText, reasonLabel, type LineageGroup } from './deltaText';
import { DeltaFindingItem, type RunDeltaCodeTarget } from './DeltaFindingItem';
import { labelKey, type RunDeltaLabels } from './labels';
import { VerdictMark } from './VerdictMark';

/** Lineage groups in reading order; `present` (C9: no lineage) is its own last group. */
const GROUPS: readonly LineageGroup[] = ['introduced', 'changed', 'resolved', 'persisting', 'present'];

/** A dimension's findings by lineage group, in {@link GROUPS} order, empty groups dropped. */
export function groupFindings(findings: readonly DeltaFinding[]): Array<{ group: LineageGroup; findings: DeltaFinding[] }> {
    return GROUPS.map((group) => ({ group, findings: findings.filter((f) => lineageGroup(f) === group) })).filter((g) => g.findings.length > 0);
}

const subheading = { ...TYPE.sectionHeading, marginTop: 4 } as const;

function DimensionSection({ dimension, labels, onOpenCode }: { dimension: DimensionResult; labels: RunDeltaLabels; onOpenCode?: ((t: RunDeltaCodeTarget) => void) | undefined }) {
    const groups = groupFindings(dimension.findings);
    return (
        <section data-dimension={dimension.id} style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <h3 style={{ ...TYPE.title, flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>{dimensionLabel(labels, dimension.id)}</h3>
                <VerdictMark verdict={dimension.verdict} labels={labels} />
            </header>
            {dimension.reasons.length > 0 && (
                <p style={{ ...muted, margin: 0, overflowWrap: 'anywhere' }}>{dimension.reasons.map((r) => reasonLabel(labels, r)).join(' · ')}</p>
            )}
            {groups.length === 0 && dimension.metrics.length === 0 && <p style={{ ...muted, margin: 0 }}>{labels.noFindings}</p>}
            {groups.map(({ group, findings }) => (
                <div key={group} data-lineage={group} style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                    <h4 style={subheading}>{labels.lineages[group]}</h4>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, minWidth: 0 }}>
                        {findings.map((f) => <DeltaFindingItem key={f.identity.id} finding={f} labels={labels} onOpenCode={onOpenCode} />)}
                    </ul>
                </div>
            ))}
            {dimension.metrics.length > 0 && (
                <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                    <h4 style={subheading}>{labels.metricsHeading}</h4>
                    <ul style={{ ...list, gap: 2 }}>
                        {dimension.metrics.map((m) => (
                            <li key={m.metricId} data-metric={m.metricId} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
                                <span style={{ ...TYPE.body, color: cssVar('text') }}>{metricLabel(labels, m.metricId)}</span>
                                <span style={TYPE.monoValue}>{metricValueText(labels, m)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}

/** A before side that could not be read: the file is still analyzed on its after side (lineage `present`), so it is not "excluded". */
const UNRESOLVED: ReadonlySet<string> = new Set(['preimage-too-large', 'preimage-missing', 'git-unavailable']);

function FileList({ heading, files, labels }: { heading: string; files: RunDelta['excluded']; labels: RunDeltaLabels }) {
    if (files.length === 0) return null;
    return (
        <section style={{ display: 'grid', gap: 4 }}>
            <h3 style={TYPE.title}>{heading}</h3>
            <ul style={{ ...list, gap: 2 }}>
                {files.map((e) => (
                    <li key={e.path} data-excluded={e.reason} style={{ ...TYPE.meta, overflowWrap: 'anywhere' }}>
                        <code style={TYPE.monoValue}>{e.path}</code> · {labels.excluded[labelKey(e.reason)] ?? e.reason}
                    </li>
                ))}
            </ul>
        </section>
    );
}

export interface RunDeltaPanelProps {
    open: boolean;
    delta: RunDelta;
    labels: RunDeltaLabels;
    onClose(): void;
    /** Opens a root-relative after-side path in the host's editor. Absent ⇒ locations are plain text. */
    onOpenCode?: ((target: RunDeltaCodeTarget) => void) | undefined;
    /** A narrow container: the sheet becomes a full-width bottom sheet. */
    compact: boolean;
    /** The host's slide-out (web: `SlideOutPanel`); absent ⇒ the package sheet. */
    renderPanel?: KnowledgePanelRenderer | undefined;
}

export function RunDeltaPanel({ open, delta, labels, onClose, onOpenCode, compact, renderPanel }: RunDeltaPanelProps) {
    const failed = delta.dimensions.flatMap((d) => d.measuredBy.filter((m) => m.status === 'failed').map((m) => ({ ...m, dimension: d.id })));
    return (
        <Panel open={open} title={labels.panelTitle} closeLabel={labels.close} onClose={onClose} compact={compact} width={440} render={renderPanel}>
            <p style={{ ...TYPE.body, margin: 0, color: cssVar('text'), overflowWrap: 'anywhere' }}>{headlineText(labels, delta.summary)}</p>
            {delta.dimensions.map((d) => <DimensionSection key={d.id} dimension={d} labels={labels} onOpenCode={onOpenCode} />)}
            {failed.length > 0 && (
                <section style={{ display: 'grid', gap: 4 }}>
                    <h3 style={TYPE.title}>{labels.failedHeading}</h3>
                    <ul style={{ ...list, gap: 2 }}>
                        {failed.map((m) => (
                            <li key={`${m.dimension}:${m.tool}`} style={{ ...TYPE.meta, overflowWrap: 'anywhere' }}>
                                <code style={TYPE.monoValue}>{m.tool}</code> · {reasonLabel(labels, m.reason ?? 'rule-failed')}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {delta.blocking.length > 0 && (
                <section data-blocking style={{ display: 'grid', gap: 4 }}>
                    <h3 style={TYPE.title}>{labels.blockingHeading}</h3>
                    <ul style={{ ...list, gap: 2 }}>
                        {delta.blocking.map((code) => <li key={code} style={{ ...TYPE.meta, overflowWrap: 'anywhere' }}>{blockingLabel(labels, code)}</li>)}
                    </ul>
                </section>
            )}
            <FileList heading={labels.unresolvedHeading} files={delta.excluded.filter((e) => UNRESOLVED.has(e.reason))} labels={labels} />
            <FileList heading={labels.excludedHeading} files={delta.excluded.filter((e) => !UNRESOLVED.has(e.reason))} labels={labels} />
        </Panel>
    );
}
