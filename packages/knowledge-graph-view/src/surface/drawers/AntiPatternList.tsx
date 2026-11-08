/**
 * The Patterns drawer's anti-pattern list (the mockup's C1): the total and one chip per kind, a
 * select-all row, one card per group (capped, with Show more) and the note that explains the fold.
 */

import { useMemo, useState } from 'react';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { findingTitle } from '../../findingText';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { button, chip, muted } from '../../styles';
import type { Selection } from '../../useSelection';
import { counted } from '../plural';
import { TYPE } from '../ui/type';
import { kindTotals, type AntiPatternGroup } from './antiPatternGroups';
import { AntiPatternCard } from './AntiPatternCard';

/** Cards drawn at once; groups are few, but a graph with many kinds must not draw them all. */
export const CARD_CAP = 30;

export interface AntiPatternListProps {
    groups: readonly AntiPatternGroup[];
    labels: KnowledgeGraphLabels;
    index: ReadonlyMap<string, KNode>;
    selection: Selection;
    canShow: boolean;
    onShow(group: AntiPatternGroup): void;
    /** The layer the list is narrowed to (a matrix cell), by display name; null = every layer. */
    layerName: string | null;
    onClearLayer(): void;
}

export function AntiPatternList({ groups, labels, index, selection, canShow, onShow, layerName, onClearLayer }: AntiPatternListProps) {
    const t = labels.surface.patterns;
    const [kind, setKind] = useState<string | null>(null);
    const [limit, setLimit] = useState(CARD_CAP);
    const kinds = useMemo(() => kindTotals(groups), [groups]);
    const total = useMemo(() => groups.reduce((n, g) => n + g.count, 0), [groups]);
    const shown = useMemo(() => (kind ? groups.filter((g) => g.kind === kind) : groups), [groups, kind]);
    const allChosen = shown.length > 0 && shown.every((g) => selection.selected.has(g.id));
    const chosen = groups.filter((g) => selection.selected.has(g.id)).length;
    // A different kind is a different list: the selection never reaches a group that is not shown.
    const pick = (next: string | null) => { setKind(next); setLimit(CARD_CAP); selection.clear(); };
    return (
        <div data-testid="kg-anti-list" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            <strong data-testid="kg-anti-total" style={{ ...TYPE.title, color: cssVar('violation') }}>
                {fillTemplate(t.summary, { anti: counted(labels, 'antiPattern', total, { count: total.toLocaleString() }), kinds: counted(labels, 'kind', kinds.length) })}
            </strong>
            {layerName && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={muted}>{fillTemplate(t.filteredTo, { layer: layerName })}</span>
                    <button type="button" style={button} onClick={onClearLayer}>{t.clearFilter}</button>
                </div>
            )}
            {kinds.length > 1 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" aria-pressed={kind === null} style={chip(kind === null)} onClick={() => pick(null)}>{t.filterAll}</button>
                    {kinds.map((k) => (
                        <button key={k.kind} type="button" aria-pressed={kind === k.kind} style={chip(kind === k.kind)} onClick={() => pick(k.kind)}>
                            {findingTitle({ kind: k.kind }, labels)} · {k.count.toLocaleString()}
                        </button>
                    ))}
                </div>
            )}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', ...muted }}>
                <input
                    type="checkbox" aria-label={t.selectAllShown} checked={allChosen} style={{ width: 16, height: 16, accentColor: cssVar('accent') }}
                    onChange={() => (allChosen ? shown.forEach((g) => selection.toggle(g.id)) : selection.setAll([...selection.selected, ...shown.map((g) => g.id)]))}
                />
                <span data-testid="kg-anti-selected">{counted(labels, 'groupSelected', chosen)}</span>
            </label>
            <div style={{ display: 'grid', gap: 8 }}>
                {shown.slice(0, limit).map((g) => (
                    <AntiPatternCard key={g.id} group={g} labels={labels} index={index} checked={selection.selected.has(g.id)} onToggle={selection.toggle} onShow={onShow} canShow={canShow} />
                ))}
            </div>
            {shown.length > limit && <button type="button" style={button} onClick={() => setLimit((n) => n + CARD_CAP)}>{t.showMore}</button>}
            <span style={{ ...TYPE.body, color: cssVar('muted') }}>
                {fillTemplate(t.foldHint, { findings: counted(labels, 'finding', total, { count: total.toLocaleString() }), groups: counted(labels, 'group', groups.length) })}
            </span>
        </div>
    );
}
