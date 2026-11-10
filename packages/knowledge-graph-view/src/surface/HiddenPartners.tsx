/**
 * The selected file's hidden coupling (PRD 38 P4): the files that usually change with it but share no reference, each with
 * its co-change rate through THE ONE rate formatter (shrunk rate, interval, n). Renders nothing when the file has none
 * (or no co-change history). Clicking a partner selects it.
 */

import { useMemo } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { nodeIndex, pathOf } from '../graphModel';
import { list, muted, quietButton } from '../styles';
import { hiddenPartners } from './coupling';
import { rateFormat } from './rateFormat';

export interface HiddenPartnersProps {
    graph: KnowledgeGraph;
    nodeRef: string;
    labels: KnowledgeGraphLabels;
    onSelect(ref: string): void;
}

export function HiddenPartners({ graph, nodeRef, labels, onSelect }: HiddenPartnersProps) {
    const partners = useMemo(() => hiddenPartners(graph, nodeRef), [graph, nodeRef]);
    if (partners.length === 0) return null;
    const t = labels.surface.coupling;
    const index = nodeIndex(graph);
    return (
        <section data-testid="kg-hidden-partners" style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>{t.title}</h3>
            <p style={{ ...muted, margin: 0 }}>{t.hint}</p>
            <ul style={list}>
                {partners.map((p) => (
                    <li key={p.ref}>
                        <button
                            type="button" data-partner={p.ref} onClick={() => onSelect(p.ref)}
                            style={{ ...quietButton, width: '100%', textAlign: 'start', whiteSpace: 'normal', overflowWrap: 'anywhere', borderRadius: 8 }}
                        >
                            {fillTemplate(t.partner, {
                                name: index.get(p.ref)?.label ?? pathOf(p.ref),
                                rate: rateFormat(labels, { k: p.together, n: p.ofSelf, low: p.low, high: p.high }),
                            })}
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
