/**
 * What a person can act on in the current lens — nested and lazy (PRD 38 §4.6). The
 * findings are grouped by their kind (`labels.groupFindingsBy`); each group is a collapsed
 * summary row until it is expanded, so a large graph's many findings cost nothing until they
 * are looked at.
 *
 * *Fix with agent* is the PRIMARY action and MULTISELECT: every row carries a checkbox, the
 * toolbar selects all / clears, and the primary button hands the host ONE batched request
 * (`findingBatchRequest`) for every selected finding. A row's own *Fix with agent* still
 * composes that one finding. *Show* focuses a finding's nodes. Never a model call.
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { Finding, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from './labels';
import { counted } from './surface/plural';
import { fillTemplate } from './template';
import { nodeIndex } from './graphModel';
import { findingBatchRequest, findingDetail, findingItems, findingRequest, findingTitle } from './findingText';
import { EvidenceList } from './EvidenceList';
import type { FindingEvidence, SourceLocation } from './types';
import { cssVar } from './scene/themeColors';
import { button, card, heading, list, muted, primaryButton, quietButton } from './styles';

export interface FindingsPanelProps {
    graph: KnowledgeGraph;
    findings: readonly Finding[];
    /** How many findings the rail holds in all. When the list is narrower and `lensName` is given, the heading says so ("· Structure lens (2 of 5)"). */
    total?: number | undefined;
    lensName?: string | undefined;
    labels: KnowledgeGraphLabels;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
    /** Where each finding was seen (the host's `evidence`, bound to this graph's side). */
    evidence?: ((f: Finding) => FindingEvidence[]) | undefined;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    /** Drawn beside a row's severity (the Act panel's provenance badge). */
    badge?: ((f: Finding) => ReactNode) | undefined;
    /** Opens the Resolve drawer on a finding. Absent ⇒ no Resolve button. */
    onResolve?: ((f: Finding) => void) | undefined;
    /** Names where the list is scoped to, for the empty line ("No open findings at {scope}"); absent ⇒ the whole graph. */
    scope?: string | undefined;
}

const SEVERITY_TONE = { error: 'violation', warn: 'cycle', info: 'muted' } as const;

const groupKey = (f: Finding, labels: KnowledgeGraphLabels): string => findingTitle(f, labels);

interface FindingRowProps {
    f: Finding;
    labels: KnowledgeGraphLabels;
    index: ReadonlyMap<string, KNode>;
    checked: boolean;
    onToggle(f: Finding): void;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
    evidence?: ((f: Finding) => FindingEvidence[]) | undefined;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    badge?: ((f: Finding) => ReactNode) | undefined;
    onResolve?: ((f: Finding) => void) | undefined;
}

function FindingRow({ f, labels, index, checked, onToggle, onShow, onCompose, evidence, onOpenSource, badge, onResolve }: FindingRowProps) {
    return (
        <li data-finding={f.kind} style={{ ...card, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <input
                    type="checkbox"
                    aria-label={`${labels.fixWithAgent}: ${findingTitle(f, labels)}`}
                    checked={checked}
                    onChange={() => onToggle(f)}
                    style={{ marginTop: 3, width: 16, height: 16, flex: 'none', cursor: 'pointer', accentColor: cssVar('accent') }}
                />
                <span style={{ fontSize: 11, fontWeight: 700, color: cssVar(SEVERITY_TONE[f.severity]) }}>
                    {labels.severity[f.severity]}
                </span>
                <strong style={{ fontSize: 13 }}>{findingTitle(f, labels)}</strong>
                {badge?.(f)}
            </div>
            <p style={{ ...muted, margin: 0, overflowWrap: 'anywhere' }}>{findingDetail(f, labels, index) ?? findingItems(f, index)}</p>
            {evidence && <EvidenceList items={evidence(f)} onOpenSource={onOpenSource} />}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" style={button} onClick={() => onShow([...f.nodes])}>{labels.showFinding}</button>
                {onResolve && <button type="button" style={button} aria-label={fillTemplate(labels.surface.resolveFindingAria, { title: findingTitle(f, labels) })} onClick={() => onResolve(f)}>{labels.surface.resolveFinding}</button>}
                {onCompose && (
                    <button type="button" style={primaryButton} onClick={() => onCompose(findingRequest(f, labels, index))}>
                        {labels.fixWithAgent}
                    </button>
                )}
            </div>
        </li>
    );
}

export function FindingsPanel({ graph, findings, total, lensName, labels, onShow, onCompose, evidence, onOpenSource, badge, onResolve, scope }: FindingsPanelProps) {
    const index = useMemo(() => nodeIndex(graph), [graph]);
    // The multiselect Fix-with-agent selection (by finding id; stable within a load).
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    // Which nested groups are expanded (lazy): a group renders its rows only once opened.
    const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

    const groups = useMemo(() => {
        const by = new Map<string, Finding[]>();
        for (const f of findings) {
            const key = groupKey(f, labels);
            const arr = by.get(key);
            if (arr) arr.push(f); else by.set(key, [f]);
        }
        // Stable order: most severe first, then the largest group, then the name.
        const rank = { error: 0, warn: 1, info: 2 } as const;
        return [...by.entries()].sort((a, b) =>
            Math.min(...a[1].map((f) => rank[f.severity])) - Math.min(...b[1].map((f) => rank[f.severity]))
            || b[1].length - a[1].length || a[0].localeCompare(b[0]));
    }, [findings, labels]);

    const toggle = (f: Finding) => setSelected((s) => {
        const next = new Set(s);
        if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
        return next;
    });
    const toggleGroup = (key: string) => setOpen((s) => {
        const next = new Set(s);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    const chosen = findings.filter((f) => selected.has(f.id));
    const fixSelected = () => { if (onCompose && chosen.length > 0) onCompose(findingBatchRequest(chosen, labels, index)); };

    return (
        <section aria-label={labels.findingsTitle} style={{ display: 'grid', gap: 8 }}>
            <h3 style={heading}>
                {total !== undefined && lensName && total > findings.length
                    ? fillTemplate(labels.findingsNarrowed, { lens: lensName, shown: findings.length, total })
                    : <>{labels.findingsTitle} <span style={muted}>({findings.length})</span></>}
            </h3>
            {findings.length === 0 ? (
                <p style={muted}>{fillTemplate(labels.findingsEmpty, { scope: scope ?? labels.surface.actScopeAll })}</p>
            ) : (
                <>
                    {onCompose && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button type="button" style={primaryButton} disabled={chosen.length === 0} onClick={fixSelected}>
                                {fillTemplate(labels.fixSelected, { count: chosen.length })}
                            </button>
                            <span style={muted}>{fillTemplate(labels.selectedCount, { count: chosen.length })}</span>
                            <button type="button" style={quietButton} onClick={() => setSelected(new Set(findings.map((f) => f.id)))}>
                                {labels.selectAll}
                            </button>
                            <button type="button" style={quietButton} onClick={() => setSelected(new Set())} disabled={chosen.length === 0}>
                                {labels.clearSelection}
                            </button>
                        </div>
                    )}
                    <ul style={list}>
                        {groups.map(([key, members]) => {
                            const expanded = open.has(key);
                            const worst = members.some((f) => f.severity === 'error') ? 'error' : members.some((f) => f.severity === 'warn') ? 'warn' : 'info';
                            return (
                                <li key={key} style={{ display: 'grid', gap: 6 }}>
                                    <button
                                        type="button"
                                        aria-expanded={expanded}
                                        onClick={() => toggleGroup(key)}
                                        style={{ ...quietButton, justifyContent: 'flex-start', display: 'flex', gap: 8, width: '100%', textAlign: 'start' }}
                                    >
                                        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: cssVar(SEVERITY_TONE[worst]) }}>
                                            {labels.severity[worst]}
                                        </span>
                                        <strong style={{ fontSize: 13 }}>{key}</strong>
                                        <span style={muted}>{counted(labels, 'findingCollapsed', members.length)}</span>
                                    </button>
                                    {expanded && (
                                        <ul style={{ ...list, paddingInlineStart: 20 }}>
                                            {members.map((f) => (
                                                <FindingRow
                                                    key={f.id} f={f} labels={labels} index={index}
                                                    checked={selected.has(f.id)} onToggle={toggle}
                                                    onShow={onShow} onCompose={onCompose} evidence={evidence} onOpenSource={onOpenSource} badge={badge} onResolve={onResolve}
                                                />
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </section>
    );
}
