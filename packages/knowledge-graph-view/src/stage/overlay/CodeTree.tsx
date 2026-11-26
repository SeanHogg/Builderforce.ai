/**
 * The code pane's level tree (the design's `#tree`): the levels above the one on show (muted) and, indented under them,
 * the level's members. One row per entry, 24px tall, 14px of indent per depth: its shape glyph, its mono name, a warning
 * mark when it carries an anti-pattern, and a tag at the right ("No test" in the warning tone, else its kind). The
 * selected row is the accent wash with a 2px accent bar; hovering a row lights its shape on the stage (`onHover`). The
 * marks come from `selectionFacts` over ALL the station's files (the one function the cards use). A click picks the
 * member through the stage's own `onSelect`, so the picture moves to it; a click on the one already picked goes inside.
 */

import { useEffect, type CSSProperties } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { kindLabel } from '../../names';
import { cssVar } from '../../scene/themeColors';
import { typeLegendKey, typeShape, type MarkType } from '../../shapes';
import { ShapeGlyph } from '../../surface/LegendGlyph';
import type { Station } from '../../surface/stations';
import type { SymbolFacts } from '../../surface/symbolFacts';
import { selectionFacts } from '../../surface/transit/cardModel';
import { actionGlyph } from '../../surface/ui/glyphs';
import { FONT_MONO, TYPE } from '../../surface/ui/type';
import { useVirtualRows } from '../drill/useVirtualRows';

const ROW_PX = 24;
const INDENT_PX = 14;
const ICON_PX = 12;

/** A level above the one on show (`depthCrumbs`): its depth is what `DrillModel.climb` takes. */
export interface TreeAncestor { depth: number; name: string }

type Row =
    | { kind: 'ancestor'; id: string; depth: number; name: string; up: number }
    | { kind: 'member'; id: string; depth: number; station: Station; key: string };

const button = (on: boolean, muted: boolean, depth: number): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: ROW_PX, boxSizing: 'border-box', border: 0, borderRadius: 4, cursor: 'pointer', textAlign: 'left',
    paddingInlineStart: 6 + depth * INDENT_PX, paddingInlineEnd: 0, font: 'inherit', fontFamily: FONT_MONO, fontSize: 12,
    color: cssVar(muted ? 'muted' : 'text'), background: on ? cssVar('accentSoft') : 'transparent', boxShadow: on ? `inset 2px 0 0 ${cssVar('accent')}` : 'none',
});

export interface CodeTreeProps {
    ancestors: readonly TreeAncestor[];
    /** Climb the drill back to a depth (0 is the system). */
    onClimb(depth: number): void;
    /** The stations of the level on show (`StageMap.stations`). */
    stations: readonly Station[];
    /** A station's slot key: what a click selects (`StageMap.keyOfStation`). */
    keyOf(s: Station): string;
    /** Each station's mark type (`stationTypes`): its glyph and its short tag. */
    types: ReadonlyMap<string, MarkType>;
    facts: SymbolFacts;
    /** The selected slot key. */
    selected: string | null;
    canEnter(id: string): boolean;
    onSelect(key: string): void;
    onEnter(id: string): void;
    /** A row is hovered (its slot key) or left (null): the stage lights its shape. */
    onHover(key: string | null): void;
    labels: KnowledgeGraphLabels;
}

export function CodeTree({ ancestors, onClimb, stations, keyOf, types, facts, selected, canEnter, onSelect, onEnter, onHover, labels }: CodeTreeProps) {
    const t = labels.surface.code;
    const rows: Row[] = [
        ...ancestors.map((a, i): Row => ({ kind: 'ancestor', id: `up:${a.depth}`, depth: i, name: a.name, up: a.depth })),
        ...stations.map((s): Row => ({ kind: 'member', id: s.id, depth: ancestors.length, station: s, key: keyOf(s) })),
    ];
    const v = useVirtualRows<HTMLUListElement>(rows.length, ROW_PX);
    const selectedIndex = selected === null ? -1 : rows.findIndex((r) => r.kind === 'member' && r.key === selected);
    const { reveal } = v;
    useEffect(() => { if (selectedIndex >= 0) reveal(selectedIndex); }, [selected, selectedIndex, reveal]);
    return (
        <div data-code-tree style={{ padding: '0 6px 8px', borderBottom: `1px solid ${cssVar('border')}`, minHeight: 0, flex: '0 1 auto', display: 'flex', flexDirection: 'column' }}>
            {stations.length === 0 && <p role="note" data-outline-empty style={{ margin: 0, ...TYPE.meta }}>{t.levelEmpty}</p>}
            <ul
                ref={v.ref} onScroll={v.onScroll} role="tree" aria-label={t.levelAria}
                style={{ listStyle: 'none', margin: 0, padding: 0, paddingTop: v.padTop, paddingBottom: v.padBottom, maxHeight: 'min(40vh, 260px)', overflow: 'auto', minHeight: 0 }}
            >
                {rows.slice(v.from, v.to).map((row, i) => {
                    if (row.kind === 'ancestor') {
                        return (
                            <li key={row.id} role="none" aria-setsize={rows.length} aria-posinset={v.from + i + 1}>
                                <button type="button" role="treeitem" aria-selected={false} data-tree-ancestor={row.up} onClick={() => onClimb(row.up)} style={button(false, true, row.depth)}>
                                    <ShapeGlyph shape={typeShape('system')} size={ICON_PX} />
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{row.name}</span>
                                </button>
                            </li>
                        );
                    }
                    const s = row.station, ref = s.refs[0] ?? s.id, on = row.key === selected;
                    // The ONE selection-facts function the cards use, over EVERY file of the station (the offender may be refs[1]).
                    const sel = selectionFacts(facts, s.refs.length > 0 ? s.refs : [ref], labels);
                    const anti = sel?.antiPattern ?? null, untested = sel?.tests === 'none';
                    const type = types.get(s.id);
                    return (
                        <li key={row.id} role="none" data-outline-member={ref} aria-setsize={rows.length} aria-posinset={v.from + i + 1}>
                            <button
                                type="button" role="treeitem" aria-selected={on} aria-current={on ? 'true' : undefined} title={s.path ?? s.name}
                                onClick={() => { if (on && canEnter(s.id)) onEnter(s.id); else onSelect(row.key); }}
                                onMouseEnter={() => onHover(row.key)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(row.key)} onBlur={() => onHover(null)}
                                style={button(on, false, row.depth)}
                            >
                                {type && <ShapeGlyph shape={typeShape(type)} size={ICON_PX} />}
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{s.name}</span>
                                {anti && (
                                    <span data-mark="anti-pattern" role="img" aria-label={fillTemplate(t.rowAntiPattern, { name: anti.name })} title={fillTemplate(t.rowAntiPattern, { name: anti.name })} style={{ display: 'inline-flex', color: cssVar('violation') }}>
                                        {actionGlyph('warning')}
                                    </span>
                                )}
                                {untested
                                    ? <span data-mark="no-test" style={{ ...TYPE.meta, marginInlineStart: 'auto', paddingInlineEnd: 6, whiteSpace: 'nowrap', color: cssVar('violation') }}>{t.rowNoTest}</span>
                                    : type && <span data-mark="kind" style={{ ...TYPE.meta, marginInlineStart: 'auto', paddingInlineEnd: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{kindLabel(labels, typeLegendKey(type))}</span>}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
