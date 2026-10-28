/**
 * One node, read: what it is, where it came from, whether it went stale, and what is
 * remembered about it (its facts and claims). *Add fact* writes a `human` fact anchored
 * to it that every host and agent sees. A fact node offers *Delete fact* only when the
 * SOURCE says this viewer may (its author or a project admin, PRD 38 §8.3); the delete
 * is confirmed through the host's destructive confirmation, or an inline two-step.
 */

import { useEffect, useMemo, useState } from 'react';
import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from './labels';
import { knowledgeAbout, nodeIndex } from './graphModel';
import { cssVar } from './scene/themeColors';
import { button, input, list, muted, primaryButton, quietButton } from './styles';
import type { FactActions, KnowledgeConfirm, KnowledgeGraphSource } from './types';

export interface NodePanelProps {
    graph: KnowledgeGraph;
    nodeRef: string;
    labels: KnowledgeGraphLabels;
    source: KnowledgeGraphSource;
    confirm?: KnowledgeConfirm | undefined;
    onTrace(): void;
    onSelect(ref: string): void;
    onChanged(): void;
}

function Row({ name, value }: { name: string; value: string }) {
    return (
        <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
            <dt style={{ ...muted, minWidth: 88 }}>{name}</dt>
            <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value}</dd>
        </div>
    );
}

function KnowledgeList({ title, nodes, labels, onSelect }: { title: string; nodes: KNode[]; labels: KnowledgeGraphLabels; onSelect(ref: string): void }) {
    if (nodes.length === 0) return null;
    return (
        <section style={{ display: 'grid', gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>{title}</h3>
            <ul style={list}>
                {nodes.map((n) => (
                    <li key={n.ref}>
                        <button type="button" onClick={() => onSelect(n.ref)} style={{ ...quietButton, width: '100%', textAlign: 'start', whiteSpace: 'normal', borderRadius: 8 }}>
                            {n.label}
                            {n.stale && <span style={{ ...muted, display: 'block' }}>{labels.staleMark}</span>}
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export function NodePanel({ graph, nodeRef, labels, source, confirm, onTrace, onSelect, onChanged }: NodePanelProps) {
    const node = useMemo(() => nodeIndex(graph).get(nodeRef), [graph, nodeRef]);
    const about = useMemo(() => knowledgeAbout(graph, nodeRef), [graph, nodeRef]);
    const [draft, setDraft] = useState('');
    const [saved, setSaved] = useState(false);
    const [actions, setActions] = useState<FactActions | undefined>(undefined);
    const [arming, setArming] = useState(false);
    const isFact = node !== undefined && node.origin !== 'extracted' && node.ref.startsWith('fact:');

    useEffect(() => {
        let live = true;
        setActions(undefined);
        setArming(false);
        if (isFact && source.factActions) {
            source.factActions(nodeRef).then((a) => { if (live) setActions(a); }).catch(() => undefined);
        }
        return () => { live = false; };
    }, [isFact, nodeRef, source]);

    if (!node) return null;

    const save = async () => {
        if (!source.rememberFact || !draft.trim()) return;
        await source.rememberFact({ content: draft.trim(), ref: nodeRef, rootId: graph.scope.rootId });
        setDraft('');
        setSaved(true);
        onChanged();
    };

    const remove = async () => {
        if (!actions?.delete) return;
        if (confirm) {
            if (!(await confirm(labels.deleteFactConfirm))) return;
        } else if (!arming) {
            setArming(true);
            return;
        }
        await actions.delete();
        onChanged();
    };

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <strong style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{node.label}</strong>
            {node.stale && <p role="status" style={{ margin: 0, fontSize: 12, color: cssVar('violation') }}>{labels.staleMark}</p>}
            <dl style={{ margin: 0, display: 'grid', gap: 4 }}>
                <Row name={labels.nodeKind} value={labels.legend[node.kind] ?? node.kind} />
                <Row name={labels.nodePack} value={node.pack} />
                <Row name={labels.nodePartition} value={node.partition ?? labels.partitionNone} />
                <Row name={labels.nodeOrigin} value={labels.origins[node.origin]} />
            </dl>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" style={button} onClick={onTrace}>{labels.trace}</button>
                {actions?.delete && (
                    <button type="button" style={{ ...button, color: cssVar('violation') }} onClick={() => void remove()}>
                        {arming ? labels.confirmDelete : labels.deleteFact}
                    </button>
                )}
                {arming && <button type="button" style={quietButton} onClick={() => setArming(false)}>{labels.cancel}</button>}
            </div>
            <KnowledgeList title={labels.factsTitle} nodes={about.facts} labels={labels} onSelect={onSelect} />
            <KnowledgeList title={labels.claimsTitle} nodes={about.claims} labels={labels} onSelect={onSelect} />
            {about.facts.length === 0 && about.claims.length === 0 && <p style={{ ...muted, margin: 0 }}>{labels.noFacts}</p>}
            {source.rememberFact && !isFact && (
                <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 700 }} htmlFor={`kg-fact-${nodeRef}`}>{labels.addFact}</label>
                    <textarea
                        id={`kg-fact-${nodeRef}`}
                        value={draft}
                        placeholder={labels.addFactPlaceholder}
                        onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
                        rows={3}
                        style={{ ...input, padding: 10, resize: 'vertical' }}
                    />
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button type="submit" style={primaryButton} disabled={!draft.trim()}>{labels.saveFact}</button>
                        {saved && <span role="status" style={muted}>{labels.factSaved}</span>}
                    </div>
                </form>
            )}
        </div>
    );
}
