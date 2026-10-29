/**
 * The graph as a list — for no WebGL, reduced motion, and as the FIRST paint while the
 * lazy 3D chunk loads (PRD 38 §4.6, §5.6). The same data: nodes grouped by partition
 * (most important first, toned by the active lens), and every finding of every lens.
 */

import type { Finding, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from './labels';
import type { LensDef } from './lenses';
import { byPartition } from './graphModel';
import { kindLabel } from './names';
import { FindingsPanel } from './FindingsPanel';
import type { FindingEvidence, SourceLocation } from './types';
import { cssVar } from './scene/themeColors';
import { list, muted, swatch } from './styles';

export interface ListFallbackProps {
    graph: KnowledgeGraph;
    nodes: readonly KNode[];
    lens: LensDef;
    labels: KnowledgeGraphLabels;
    selected: string | null;
    onSelect(ref: string): void;
    onShow(refs: string[]): void;
    onCompose?: ((text: string) => void) | undefined;
    note?: string | undefined;
    evidence?: ((f: Finding) => FindingEvidence[]) | undefined;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
}

export function ListFallback({ graph, nodes, lens, labels, selected, onSelect, onShow, onCompose, note, evidence, onOpenSource }: ListFallbackProps) {
    const groups = byPartition(nodes);
    return (
        <div data-testid="kg-list" style={{ display: 'grid', gap: 16, padding: 12, overflow: 'auto', alignContent: 'start' }}>
            {note && <p style={{ ...muted, margin: 0 }}>{note}</p>}
            {groups.map(({ partition, nodes: members }) => (
                <section key={partition ?? ''} aria-label={partition ?? labels.partitionNone} style={{ display: 'grid', gap: 6 }}>
                    <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: cssVar('muted'), textTransform: 'uppercase', letterSpacing: '.04em' }}>
                        {partition ?? labels.partitionNone} <span>({members.length})</span>
                    </h3>
                    <ul style={{ ...list, gap: 4 }}>
                        {members.map((n) => {
                            const style = lens.nodeStyle(n);
                            const active = n.ref === selected;
                            return (
                                <li key={n.ref}>
                                    <button
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => onSelect(n.ref)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 40, padding: '0 10px',
                                            border: `1px solid ${active ? cssVar('accent') : 'transparent'}`, borderRadius: 8,
                                            background: active ? cssVar('accentSoft') : 'transparent', color: cssVar('text'),
                                            opacity: style.emphasis === 'dim' ? 0.55 : 1, font: 'inherit', fontSize: 13, textAlign: 'start', cursor: 'pointer',
                                        }}
                                    >
                                        <span style={swatch(cssVar(style.tone))} aria-hidden="true" />
                                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: style.emphasis === 'strong' ? 700 : 400 }}>
                                            {n.label}
                                        </span>
                                        <span style={muted}>{kindLabel(labels, n.kind)}</span>
                                        {n.stale && <span style={{ fontSize: 11, color: cssVar('stale') }}>{labels.legend.stale}</span>}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
            <FindingsPanel graph={graph} findings={graph.findings} labels={labels} onShow={onShow} onCompose={onCompose} evidence={evidence} onOpenSource={onOpenSource} />
        </div>
    );
}
