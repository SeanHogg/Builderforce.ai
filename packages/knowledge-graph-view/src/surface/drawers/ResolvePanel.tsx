/**
 * The Resolve drawer: the finding chosen with *Resolve*, where it comes from, and how to
 * close it. A kind with a deterministic codemod (`unused-export`, `unused-file`) offers *Apply
 * the fix* when the host's source can (`applyFix`), and shows the branch it landed on; every
 * other kind (or a host without `applyFix`) hands the agent the finding's fixed request through
 * the composer. Undo is not offered: the branch is the undo.
 */

import { useMemo, useState } from 'react';
import { findingRequest, findingTitle } from '../../findingText';
import { nodeIndex } from '../../graphModel';
import { fillTemplate } from '../../labels';
import { button, card, heading, muted, primaryButton } from '../../styles';
import { ProvenanceBadge } from '../ActPanel';
import { findingProvenance } from '../scope';
import { stationOfRef } from '../stations';
import type { PanelProps } from '../registry';
import { Section } from './ui';

/** The finding kinds a deterministic codemod exists for. */
export const CODEMOD_KINDS: ReadonlySet<string> = new Set(['unused-export', 'unused-file']);

type Applied = { state: 'idle' } | { state: 'applying' } | { state: 'done'; branch?: string; changed: string[] } | { state: 'failed' };

export function ResolvePanel({ graph, labels, surface, source, onShow, onCompose, onChanged }: PanelProps) {
    const t = labels.surface.resolve;
    const finding = surface.resolving;
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const [applied, setApplied] = useState<{ id: string; result: Applied }>({ id: '', result: { state: 'idle' } });
    if (!finding) return <p style={{ ...muted, margin: 0 }}>{t.empty}</p>;

    const result: Applied = applied.id === finding.id ? applied.result : { state: 'idle' };
    const canFix = !!source?.applyFix && CODEMOD_KINDS.has(finding.kind);
    const stations = new Set(finding.nodes.flatMap((r) => stationOfRef(surface.stations, r) ?? []));
    const apply = async () => {
        setApplied({ id: finding.id, result: { state: 'applying' } });
        try {
            const out = await source!.applyFix!(finding);
            setApplied({ id: finding.id, result: { state: 'done', changed: out.changed, ...(out.branch ? { branch: out.branch } : {}) } });
            onChanged?.(); // reload the graph, so the finding the codemod fixed disappears
        } catch {
            setApplied({ id: finding.id, result: { state: 'failed' } });
        }
    };

    return (
        <div data-testid="kg-resolve" style={{ display: 'grid', gap: 16 }}>
            <section style={{ ...card, display: 'grid', gap: 6 }}>
                <h3 style={heading}>{findingTitle(finding, labels)}</h3>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={muted}>{t.provenanceLabel}</span>
                    <ProvenanceBadge provenance={findingProvenance(finding)} labels={labels} />
                </div>
                <p style={{ ...muted, margin: 0 }}>{findingRequest(finding, labels, index)}</p>
                <div><button type="button" style={button} onClick={() => onShow([...finding.nodes])}>{t.show}</button></div>
            </section>

            {canFix ? (
                <Section title={t.fixTitle}>
                    <p style={{ ...muted, margin: 0 }}>{t.fixIntro}</p>
                    <div><button type="button" style={primaryButton} disabled={result.state === 'applying'} onClick={() => void apply()}>{result.state === 'applying' ? t.applying : t.applyFix}</button></div>
                    {result.state === 'done' && (
                        <div role="status" data-testid="kg-resolve-done" style={{ display: 'grid', gap: 4 }}>
                            <span>{result.branch ? fillTemplate(t.applied, { branch: result.branch }) : t.appliedNoBranch}</span>
                            <span style={muted}>{fillTemplate(t.changedFiles, { count: result.changed.length })}</span>
                            <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12 }}>{result.changed.map((p) => <li key={p} style={{ overflowWrap: 'anywhere' }}>{p}</li>)}</ul>
                        </div>
                    )}
                    {result.state === 'failed' && <p role="alert" style={{ margin: 0, color: 'inherit' }}>{t.failed}</p>}
                </Section>
            ) : (
                <Section title={t.promptTitle}>
                    <p style={{ ...muted, margin: 0 }}>{t.promptIntro}</p>
                    <div>
                        <button type="button" style={primaryButton} disabled={!onCompose} onClick={() => onCompose?.(findingRequest(finding, labels, index))}>{t.prompt}</button>
                    </div>
                    {!onCompose && <p style={{ ...muted, margin: 0 }}>{t.noComposer}</p>}
                </Section>
            )}

            <Section title={t.checksTitle}>
                <ul style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 4, fontSize: 13 }}>
                    <li>{fillTemplate(t.checkFiles, { count: finding.nodes.length })}</li>
                    <li>{fillTemplate(t.checkStations, { count: stations.size })}</li>
                    <li>{t.checkReview}</li>
                    {canFix && <li>{t.undoNote}</li>}
                </ul>
            </Section>
        </div>
    );
}
