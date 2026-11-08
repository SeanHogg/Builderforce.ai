/**
 * One layer pair of a file's layer violations (the file card's block): the links, the arrow, why it
 * is bad and the files on the other end. The file is the OFFENDER when it reaches up ("Reaches
 * into …") and a PARTNER when something reaches into it ("Reached by …"); the two never share a card.
 */

import type { CSSProperties } from 'react';
import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { AntiPatternActions } from './AntiPatternActions';
import { findingTitle } from './findingText';
import { fillTemplate, type KnowledgeGraphLabels } from './labels';
import { labelFor } from './graphModel';
import { cssVar } from './scene/themeColors';
import { card, muted } from './styles';
import { counted } from './surface/plural';
import { findingProvenance } from './surface/scope';
import { ProvenanceBadge } from './surface/ui';
import { TYPE } from './surface/ui/type';
import { ruleText } from './surface/drawers/antiPatternRules';
import { layerNames } from './surface/drawers/AntiPatternCard';
import { LayerArrow } from './surface/drawers/LayerArrow';
import { highlightFor, type TowerHighlight } from './surface/towerHighlight';

const TOP_OTHERS = 5;

export interface LayerSectionModel {
    key: string;
    role: 'offender' | 'partner';
    findings: Finding[];
    /** The files on the other end, the most-linked first. */
    others: string[];
}

export interface LayerSectionProps {
    section: LayerSectionModel;
    nodeRef: string;
    labels: KnowledgeGraphLabels;
    index: ReadonlyMap<string, KNode>;
    tagStyle: CSSProperties;
    onResolve: ((finding: Finding) => void) | undefined;
    onShowInTower: ((highlight: TowerHighlight, refs: string[]) => void) | undefined;
}

export function AntiPatternLayerSection({ section, nodeRef, labels, index, tagStyle, onResolve, onShowInTower }: LayerSectionProps) {
    const t = labels.surface.patterns;
    const first = section.findings[0]!;
    const from = String(first.params.from ?? ''), to = String(first.params.to ?? '');
    const names = layerNames({ from, to }, labels);
    const title = findingTitle(first, labels);
    return (
        <section data-block="layer-violation" data-role={section.role} style={{ ...card, display: 'grid', gap: 10, border: `1px solid color-mix(in srgb, ${cssVar('violation')} 40%, ${cssVar('border')})` }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={tagStyle}>{fillTemplate(t.block.tag, { title })}</span>
                <ProvenanceBadge provenance={findingProvenance(first)} labels={labels} />
                <span style={muted}>{counted(labels, 'link', section.findings.length)}</span>
            </div>
            <LayerArrow
                fromName={names.from} toName={names.to} from={from} to={to}
                skips={first.params.verdict === 'skips'} caption={t.arrowCaption} aria={fillTemplate(t.arrowAria, names)}
            />
            <span style={{ ...TYPE.bodyLarge, lineHeight: 1.5 }}>{ruleText(first.kind, labels, names).reason}</span>
            <div style={{ display: 'grid', gap: 2 }}>
                <span style={muted}>{section.role === 'offender' ? t.block.reachesInto : t.block.reachedBy}</span>
                <ul style={{ margin: 0, paddingInlineStart: 18, ...TYPE.mono }}>
                    {section.others.slice(0, TOP_OTHERS).map((r) => <li key={r} style={{ overflowWrap: 'anywhere' }}>{labelFor(index, r)}</li>)}
                </ul>
                {section.others.length > TOP_OTHERS && <span style={muted}>{fillTemplate(t.moreFiles, { count: section.others.length - TOP_OTHERS })}</span>}
            </div>
            <AntiPatternActions
                labels={labels} title={title} fix={first} onResolve={onResolve}
                tower={onShowInTower ? () => onShowInTower(highlightFor(section.findings), [nodeRef, ...section.others.slice(0, TOP_OTHERS)]) : undefined}
            />
        </section>
    );
}
