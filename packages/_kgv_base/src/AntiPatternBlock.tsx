/**
 * The anti-pattern block at the top of a file's card (the mockup's C3): the tag, where it comes
 * from, why it is bad in one sentence, the measures against their limits (a god module) or, per
 * layer pair, the links that climb a layer and the files on the other end (a layer violation), and
 * *Fix* beside *Show in Tower*. Self-contained: it finds its own findings for the ref and draws
 * nothing when the file has none. A god module read from its badges (an older graph, no finding yet)
 * shows the measures it has and asks for a re-review; Show in Tower still lights the file, from the
 * ref. No finding is made up here.
 */

import { useMemo } from 'react';
import type { Finding, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { AntiPatternActions } from './AntiPatternActions';
import { AntiPatternLayerSection, type LayerSectionModel } from './AntiPatternLayerSection';
import { findingTitle } from './findingText';
import { fillTemplate, type KnowledgeGraphLabels } from './labels';
import { nodeIndex } from './graphModel';
import { MeasureBars } from './MeasureBars';
import { measuresOf } from './measures';
import { cssVar } from './scene/themeColors';
import { card } from './styles';
import { findingProvenance } from './surface/scope';
import { ProvenanceBadge } from './surface/ui';
import { TYPE } from './surface/ui/type';
import { ruleText } from './surface/drawers/antiPatternRules';
import { highlightFor, highlightForRef, type TowerHighlight } from './surface/towerHighlight';

const GOD_MODULE = 'god-module';
const PARTITION_VIOLATION = 'partition-violation';

export interface AntiPatternBlockProps {
    graph: Pick<KnowledgeGraph, 'findings' | 'nodes'>;
    nodeRef: string;
    labels: KnowledgeGraphLabels;
    /** Opens the Resolve flow on a finding. Absent ⇒ Fix is disabled. */
    onResolve?: ((finding: Finding) => void) | undefined;
    /** Lights a highlight in the Tower. Absent ⇒ Show in Tower is disabled. */
    onShowInTower?: ((highlight: TowerHighlight, refs: string[]) => void) | undefined;
}

const tagStyle = { ...TYPE.status, padding: '2px 10px', borderRadius: 999, background: `color-mix(in srgb, ${cssVar('violation')} 18%, transparent)`, color: cssVar('violation') } as const;

/** The file's layer violations as sections: one per role (offender / partner) and layer pair, the most links first. */
function layerSections(layer: readonly Finding[], nodeRef: string): LayerSectionModel[] {
    const by = new Map<string, LayerSectionModel & { tally: Map<string, number> }>();
    for (const f of layer) {
        const role = f.nodes[0] === nodeRef ? 'offender' as const : 'partner' as const;
        const key = `${role}:${String(f.params.verdict ?? '')}:${String(f.params.from ?? '')}>${String(f.params.to ?? '')}`;
        let s = by.get(key);
        if (!s) by.set(key, s = { key, role, findings: [], others: [], tally: new Map() });
        s.findings.push(f);
        // The other end: what an offender reaches into, or who reaches into a partner.
        for (const r of role === 'offender' ? f.nodes.slice(1) : f.nodes.slice(0, 1)) if (r !== nodeRef) s.tally.set(r, (s.tally.get(r) ?? 0) + 1);
    }
    return [...by.values()]
        .map(({ tally, ...s }) => ({ ...s, others: [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([r]) => r) }))
        .sort((a, b) => b.findings.length - a.findings.length || (a.key < b.key ? -1 : 1));
}

export function AntiPatternBlock({ graph, nodeRef, labels, onResolve, onShowInTower }: AntiPatternBlockProps) {
    const t = labels.surface.patterns;
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const node: KNode | undefined = index.get(nodeRef);
    const mine = useMemo(() => graph.findings.filter((f) => f.nodes.includes(nodeRef as Finding['nodes'][number])), [graph.findings, nodeRef]);
    const god = mine.find((f) => f.kind === GOD_MODULE);
    const sections = useMemo(() => layerSections(mine.filter((f) => f.kind === PARTITION_VIOLATION), nodeRef), [mine, nodeRef]);
    const godBadge = String(node?.badges?.patterns ?? '').split(',').some((p) => p.trim() === GOD_MODULE);
    if (!god && !godBadge && sections.length === 0) return null;

    const godTitle = findingTitle({ kind: GOD_MODULE }, labels);
    const godText = ruleText(GOD_MODULE, labels);
    // A god module with a finding lights that; one read from its badge alone lights the file itself.
    const godTower = onShowInTower ? () => onShowInTower(god ? highlightFor([god]) : highlightForRef(nodeRef, GOD_MODULE), [nodeRef]) : undefined;

    return (
        <div data-testid="kg-anti-block" style={{ display: 'grid', gap: 10 }}>
            {(god || godBadge) && (
                <section data-block="god-module" style={{ ...card, display: 'grid', gap: 10, border: `1px solid color-mix(in srgb, ${cssVar('violation')} 40%, ${cssVar('border')})` }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={tagStyle}>{fillTemplate(t.block.tag, { title: godTitle })}</span>
                        <ProvenanceBadge provenance={findingProvenance({ kind: GOD_MODULE })} labels={labels} />
                    </div>
                    <span style={{ ...TYPE.bodyLarge, lineHeight: 1.5 }}>{godText.reason}</span>
                    <MeasureBars measures={measuresOf(node, god)} labels={labels} />
                    <span style={{ ...TYPE.body, color: cssVar('muted') }}>{t.goodLooksLike}: {godText.good}</span>
                    <AntiPatternActions labels={labels} title={godTitle} fix={god} onResolve={onResolve} tower={godTower} hint />
                </section>
            )}
            {sections.map((s) => (
                <AntiPatternLayerSection key={s.key} section={s} nodeRef={nodeRef} labels={labels} index={index} tagStyle={tagStyle} onResolve={onResolve} onShowInTower={onShowInTower} />
            ))}
        </div>
    );
}
