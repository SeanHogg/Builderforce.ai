/**
 * Compare (PRD 38 §3.3): findings per kind before and after two reviews of the same
 * folder, each row read as better, worse or the same, then what appeared and what was
 * resolved. Fewer findings is better — the headline is that debt goes down.
 *
 * A baseline the host marks not comparable (an analyzer failed or changed on one side)
 * says so instead: a finding missing from an incomplete measurement is never "resolved".
 */

import { useMemo } from 'react';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from './labels';
import { compareGraphs, nodeIndex } from './graphModel';
import { findingItems, findingTitle } from './findingText';
import { EvidenceList } from './EvidenceList';
import { cssVar } from './scene/themeColors';
import { card, heading, list, muted } from './styles';
import type { EvidenceSide, FindingEvidence, KnowledgeBaseline, SourceLocation } from './types';

export interface ComparePanelProps {
    before: KnowledgeBaseline | null;
    after: KnowledgeGraph;
    labels: KnowledgeGraphLabels;
    evidence?: ((f: Finding, side: EvidenceSide) => FindingEvidence[]) | undefined;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
}

export function ComparePanel({ before, after, labels, evidence, onOpenSource }: ComparePanelProps) {
    const cmp = useMemo(() => (before ? compareGraphs(before.graph, after) : null), [before, after]);
    if (!before || !cmp) return <p style={muted}>{labels.compareEmpty}</p>;
    const comparable = before.comparable !== false;
    const cell = { padding: '6px 8px', borderBottom: `1px solid ${cssVar('border')}`, textAlign: 'end' as const };
    const verdict = (b: number, a: number) =>
        a < b ? { text: labels.compareBetter, tone: cssVar('agrees') } : a > b ? { text: labels.compareWorse, tone: cssVar('violation') } : { text: labels.compareSame, tone: cssVar('muted') };
    return (
        <section aria-label={labels.compareTitle} style={{ display: 'grid', gap: 8 }}>
            <h3 style={heading}>{labels.compareTitle}</h3>
            {!comparable && <p role="status" style={{ ...muted, margin: 0 }}>{labels.compareIncomparable}</p>}
            <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, color: cssVar('text'), width: '100%' }}>
                    <thead>
                        <tr>
                            <th scope="col" style={{ ...cell, textAlign: 'start' }} />
                            <th scope="col" style={cell}>{labels.compareBefore}</th>
                            <th scope="col" style={cell}>{labels.compareAfter}</th>
                            <th scope="col" style={cell} />
                        </tr>
                    </thead>
                    <tbody>
                        {[{ kind: '', label: labels.compareNodes, before: cmp.nodes.before, after: cmp.nodes.after, neutral: true },
                            ...cmp.kinds.map((k) => ({ ...k, label: findingTitle(k, labels), neutral: !comparable }))].map((row) => {
                            const v = verdict(row.before, row.after);
                            return (
                                <tr key={row.kind || 'nodes'} data-kind={row.kind}>
                                    <th scope="row" style={{ ...cell, textAlign: 'start', fontWeight: 600 }}>{row.label}</th>
                                    <td style={cell}>{row.before}</td>
                                    <td style={cell}>{row.after}</td>
                                    <td style={{ ...cell, color: row.neutral ? cssVar('muted') : v.tone, fontWeight: 700 }}>{row.neutral ? '' : v.text}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {comparable && (
                <>
                    <ChangedFindings title={labels.compareAdded} findings={cmp.added} graph={after} labels={labels}
                        evidence={evidence && ((f) => evidence(f, 'current'))} onOpenSource={onOpenSource} />
                    <ChangedFindings title={labels.compareResolved} findings={cmp.resolved} graph={before.graph} labels={labels}
                        evidence={evidence && ((f) => evidence(f, 'baseline'))} onOpenSource={onOpenSource} />
                </>
            )}
        </section>
    );
}

function ChangedFindings({ title, findings, graph, labels, evidence, onOpenSource }: {
    title: string;
    findings: readonly Finding[];
    graph: KnowledgeGraph;
    labels: KnowledgeGraphLabels;
    evidence?: ((f: Finding) => FindingEvidence[]) | undefined;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
}) {
    const index = useMemo(() => nodeIndex(graph), [graph]);
    if (findings.length === 0) return null;
    return (
        <section aria-label={title} style={{ display: 'grid', gap: 6 }}>
            <h4 style={{ ...heading, fontSize: 13 }}>{title} <span style={muted}>({findings.length})</span></h4>
            <ul style={list}>
                {findings.map((f) => (
                    <li key={f.id} data-finding={f.kind} style={{ ...card, display: 'grid', gap: 6 }}>
                        <strong style={{ fontSize: 13 }}>{findingTitle(f, labels)}</strong>
                        <p style={{ ...muted, margin: 0, overflowWrap: 'anywhere' }}>{findingItems(f, index)}</p>
                        {evidence && <EvidenceList items={evidence(f)} onOpenSource={onOpenSource} />}
                    </li>
                ))}
            </ul>
        </section>
    );
}
