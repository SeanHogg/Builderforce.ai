/**
 * What a person can act on in the current lens. Every finding has *Show* (focus its
 * nodes) and, when the host has a composer, *Fix with agent* — which hands the host the
 * FIXED, prefilled request for the finding's `requestKey` (`onCompose(text)`); the host
 * puts it in its ONE composer. Never a model call.
 */

import { useMemo } from 'react';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from './labels';
import { nodeIndex } from './graphModel';
import { findingDetail, findingItems, findingRequest, findingTitle } from './findingText';
import { EvidenceList } from './EvidenceList';
import type { FindingEvidence, SourceLocation } from './types';
import { cssVar } from './scene/themeColors';
import { button, card, heading, list, muted, primaryButton } from './styles';

export interface FindingsPanelProps {
    graph: KnowledgeGraph;
    findings: readonly Finding[];
    labels: KnowledgeGraphLabels;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
    /** Where each finding was seen (the host's `evidence`, bound to this graph's side). */
    evidence?: ((f: Finding) => FindingEvidence[]) | undefined;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
}

const SEVERITY_TONE = { error: 'violation', warn: 'cycle', info: 'muted' } as const;

export function FindingsPanel({ graph, findings, labels, onShow, onCompose, evidence, onOpenSource }: FindingsPanelProps) {
    const index = useMemo(() => nodeIndex(graph), [graph]);
    return (
        <section aria-label={labels.findingsTitle} style={{ display: 'grid', gap: 8 }}>
            <h3 style={heading}>{labels.findingsTitle} <span style={muted}>({findings.length})</span></h3>
            {findings.length === 0 ? (
                <p style={muted}>{labels.findingsEmpty}</p>
            ) : (
                <ul style={list}>
                    {findings.map((f) => (
                        <li key={f.id} data-finding={f.kind} style={{ ...card, display: 'grid', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: cssVar(SEVERITY_TONE[f.severity]) }}>
                                    {labels.severity[f.severity]}
                                </span>
                                <strong style={{ fontSize: 13 }}>{findingTitle(f, labels)}</strong>
                            </div>
                            <p style={{ ...muted, margin: 0, overflowWrap: 'anywhere' }}>{findingDetail(f, labels, index) ?? findingItems(f, index)}</p>
                            {evidence && <EvidenceList items={evidence(f)} onOpenSource={onOpenSource} />}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button type="button" style={button} onClick={() => onShow([...f.nodes])}>{labels.showFinding}</button>
                                {onCompose && (
                                    <button type="button" style={primaryButton} onClick={() => onCompose(findingRequest(f, labels, index))}>
                                        {labels.fixWithAgent}
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
