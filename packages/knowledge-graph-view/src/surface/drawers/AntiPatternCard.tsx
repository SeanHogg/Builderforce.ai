/**
 * One anti-pattern group, after the mockup's C1: a checkbox, the kind and where it comes from, the
 * direction (layer pair) with the link count, the arrow drawn, a one-line reason, the top files and
 * *Why* (what good looks like) beside *Show in Tower*. One card stands for every finding of the group.
 */

import { useState } from 'react';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { findingTitle } from '../../findingText';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { labelFor } from '../../graphModel';
import { cssVar } from '../../scene/themeColors';
import { button, card } from '../../styles';
import { counted } from '../plural';
import { findingProvenance } from '../scope';
import { ProvenanceBadge } from '../ui';
import { TYPE } from '../ui/type';
import type { AntiPatternGroup } from './antiPatternGroups';
import { ruleOf, ruleText } from './antiPatternRules';
import { LayerArrow } from './LayerArrow';

const TOP_FILES = 5;

export interface AntiPatternCardProps {
    group: AntiPatternGroup;
    labels: KnowledgeGraphLabels;
    index: ReadonlyMap<string, KNode>;
    checked: boolean;
    onToggle(id: string): void;
    onShow(group: AntiPatternGroup): void;
    /** False where there is no Tower to show it in. */
    canShow: boolean;
}

/** The layer pair's display names (a partition outside the five shows raw). */
export function layerNames(group: Pick<AntiPatternGroup, 'from' | 'to'>, labels: KnowledgeGraphLabels): { from: string; to: string } {
    const layers = labels.surface.layers as Record<string, string>;
    return { from: layers[group.from ?? ''] ?? group.from ?? '', to: layers[group.to ?? ''] ?? group.to ?? '' };
}

export function AntiPatternCard({ group, labels, index, checked, onToggle, onShow, canShow }: AntiPatternCardProps) {
    const t = labels.surface.patterns;
    const [why, setWhy] = useState(false);
    const first = group.findings[0]!;
    const title = findingTitle(first, labels);
    const rule = ruleOf(group.kind);
    const layer = rule.diagram === 'layerArrow' && group.from !== undefined && group.to !== undefined;
    const names = layerNames(group, labels);
    const route = fillTemplate(t.route, { from: names.from, to: names.to });
    const text = ruleText(group.kind, labels, { from: names.from, to: names.to });
    const counts = {
        links: counted(labels, 'link', group.count), findings: counted(labels, 'finding', group.count), files: counted(labels, 'file', group.files.length),
    };
    const meta = layer
        ? fillTemplate(t.layerMeta, { route, verdict: group.verdict === 'upward' ? t.climbs : t.skips, links: fillTemplate(t.linksIn, counts) })
        : fillTemplate(t.findingsIn, counts);
    // Only the files drawn are named; the rest are a count.
    const fileNames = group.files.slice(0, TOP_FILES).map((r) => labelFor(index, r));
    const more = group.files.length > 2 ? fillTemplate(t.moreFiles, { count: group.files.length - 2 }) : undefined;
    const sync = layer ? `1px solid color-mix(in srgb, ${cssVar('violation')} 40%, ${cssVar('border')})` : `1px solid ${cssVar('border')}`;
    return (
        <section data-anti={group.id} style={{ ...card, border: sync, display: 'grid', gap: 8, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
                <input
                    type="checkbox" checked={checked} onChange={() => onToggle(group.id)} aria-label={fillTemplate(t.selectGroupAria, { title, route: layer ? route : meta })}
                    style={{ marginTop: 3, width: 16, height: 16, flex: 'none', cursor: 'pointer', accentColor: cssVar('accent') }}
                />
                <div style={{ flex: 1, display: 'grid', gap: 6, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong style={TYPE.title}>{title}</strong>
                        <ProvenanceBadge provenance={findingProvenance(first)} labels={labels} />
                    </div>
                    <span style={{ ...TYPE.body, color: cssVar('muted') }}>{meta}</span>
                    {layer && <LayerArrow fromName={names.from} toName={names.to} from={group.from} to={group.to} skips={group.verdict === 'skips'} caption={t.arrowCaption} aria={fillTemplate(t.arrowAria, { from: names.from, to: names.to })} />}
                    <span style={{ ...TYPE.bodyLarge, color: cssVar('text') }}>{text.reason}</span>
                    {fileNames.length > 0 && (
                        <details style={{ ...TYPE.body, color: cssVar('muted') }}>
                            <summary style={{ cursor: 'pointer', overflowWrap: 'anywhere', fontFamily: TYPE.mono.fontFamily }}>
                                {fillTemplate(t.topFilesSummary, { names: fileNames.slice(0, 2).join(' → '), more })}
                            </summary>
                            <ul style={{ margin: '4px 0 0', paddingInlineStart: 18, display: 'grid', gap: 2, ...TYPE.mono }}>
                                {fileNames.map((n, i) => <li key={group.files[i]} style={{ overflowWrap: 'anywhere' }}>{n}</li>)}
                                {group.files.length > TOP_FILES && <li style={{ listStyle: 'none', fontFamily: TYPE.body.fontFamily }}>{fillTemplate(t.moreFiles, { count: group.files.length - TOP_FILES })}</li>}
                            </ul>
                        </details>
                    )}
                    {why && (
                        <div data-testid="kg-anti-why" style={{ display: 'grid', gap: 4, ...TYPE.body }}>
                            <span><strong>{t.goodLooksLike}</strong>{': '}{text.good}</span>
                            <span><strong>{t.afterLooksLike}</strong>{': '}{text.after}</span>
                        </div>
                    )}
                </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingInlineStart: 26 }}>
                <button type="button" style={{ ...button, borderRadius: 8 }} aria-expanded={why} onClick={() => setWhy((v) => !v)}>{t.why}</button>
                <button type="button" style={{ ...button, borderRadius: 8 }} disabled={!canShow} onClick={() => onShow(group)}>{t.showInTower}</button>
            </div>
        </section>
    );
}
