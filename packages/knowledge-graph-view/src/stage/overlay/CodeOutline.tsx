/**
 * The docked pane above the code band (PRD 43 Part C1): the outline of the level on show, built from the stations the
 * stage already holds (no records walk, no `symbolsOf`), windowed so only the rows on show are in the DOM
 * (`useVirtualRows`). One row per member: its shape glyph, its name, a "No test" mark
 * and an anti-pattern mark (`SymbolFacts`, computed once by the wiring), and at the end its actions: Go inside when it
 * has an inside, Restructure when it carries a restructurable anti-pattern and the host handles it. The marks come
 * from `selectionFacts` over ALL the station's files (the same function the cards use). A click on the row picks the
 * member through the stage's own `onSelect` (the path the station card takes), so the picture moves to it.
 */

import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { typeShape, type MarkType } from '../../shapes';
import { CONTROL, list } from '../../styles';
import { ShapeGlyph } from '../../surface/LegendGlyph';
import type { Station } from '../../surface/stations';
import type { SymbolFacts } from '../../surface/symbolFacts';
import { selectionFacts } from '../../surface/transit/cardModel';
import { actionGlyph } from '../../surface/ui/glyphs';
import { TYPE } from '../../surface/ui/type';
import { LINK_BUTTON } from '../drill/linkButton';
import { useVirtualRows } from '../drill/useVirtualRows';
import { toggleButton } from './cardStyles';
import { restructureTargetOf } from './restructureTarget';

const ICON_PX = 12;

/** A row's height before one is measured (CONTROL's coarse-pointer default). */
const FALLBACK_ROW_PX = 40;

// Exactly CONTROL tall (a single ellipsised line): the window's offset maths needs every row one height.
const rowBox = (on: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 4, borderRadius: 6, background: on ? cssVar('accentSoft') : 'transparent',
    height: CONTROL, boxSizing: 'border-box',
});
const main: CSSProperties = {
    ...LINK_BUTTON, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', minWidth: 0, height: CONTROL, outlineOffset: -2,
    padding: '0 8px', textAlign: 'left', ...TYPE.body,
};
const act: CSSProperties = { ...toggleButton, height: CONTROL, minWidth: CONTROL, padding: 0, outlineOffset: -2 };

export interface CodeOutlineProps {
    /** The stations of the level on show (`StageMap.stations`). */
    stations: readonly Station[];
    /** A station's slot key: what a click selects (`StageMap.keyOfStation`). */
    keyOf(s: Station): string;
    /** Each station's mark type (`stationTypes`): its glyph. */
    types: ReadonlyMap<string, MarkType>;
    facts: SymbolFacts;
    /** The selected slot key. */
    selected: string | null;
    canEnter(id: string): boolean;
    onSelect(key: string): void;
    onEnter(id: string): void;
    /** Restructure a member (by ref); the action is hidden when absent. */
    onRestructure?: ((ref: string) => void) | undefined;
    /** Hide the pane. */
    onHide?: (() => void) | undefined;
    /** A line under the heading (the host cannot read source: this is all there is). */
    note?: string | undefined;
    labels: KnowledgeGraphLabels;
}

export function CodeOutline({ stations, keyOf, types, facts, selected, canEnter, onSelect, onEnter, onRestructure, onHide, note, labels }: CodeOutlineProps) {
    const t = labels.surface.code;
    // Rows are exactly CONTROL tall (30 or 40px by pointer): the first drawn row says which, so offsets stay exact.
    const [rowPx, setRowPx] = useState(FALLBACK_ROW_PX);
    const v = useVirtualRows<HTMLUListElement>(stations.length, rowPx, { after: 0 });
    useLayoutEffect(() => {
        const h = v.ref.current?.querySelector('li')?.getBoundingClientRect().height ?? 0;
        if (h > 0 && h !== rowPx) setRowPx(h);
    });
    const selectedIndex = selected === null ? -1 : stations.findIndex((s) => keyOf(s) === selected);
    const { reveal } = v;
    useEffect(() => { if (selectedIndex >= 0) reveal(selectedIndex); }, [selected, selectedIndex, reveal, rowPx]);
    return (
        <aside data-code-dock data-code-pane data-level-outline role="complementary" aria-label={t.dockAria} style={{ position: 'absolute', inset: 0, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, color: cssVar('text') }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <b style={TYPE.sectionHeading}>{t.outline}</b>
                {onHide && <button type="button" data-action="dock-hide" aria-label={t.dockHide} title={t.dockHide} onClick={onHide} style={{ ...toggleButton, minHeight: 24 }}><span aria-hidden="true" style={{ display: 'inline-flex' }}>{actionGlyph('close')}</span></button>}
            </div>
            {note && <p role="note" data-outline-note style={{ margin: 0, ...TYPE.meta }}>{note}</p>}
            {stations.length === 0 && <p role="note" data-outline-empty style={{ margin: 0, ...TYPE.meta }}>{t.levelEmpty}</p>}
            <ul ref={v.ref} onScroll={v.onScroll} aria-label={t.levelAria} style={{ ...list, gap: 0, flex: '1 1 0', minHeight: 0, overflow: 'auto', alignContent: 'start', paddingTop: v.padTop, paddingBottom: v.padBottom }}>
                {stations.slice(v.from, v.to).map((s, i) => {
                    const key = keyOf(s), ref = s.refs[0] ?? s.id;
                    // The ONE selection-facts function the cards use, over EVERY file of the station (the offender may be refs[1]).
                    const sel = selectionFacts(facts, s.refs.length > 0 ? s.refs : [ref], labels);
                    const anti = sel?.antiPattern ?? null, untested = sel?.tests === 'none';
                    const restructurable = anti?.restructurable === true;
                    const type = types.get(s.id);
                    return (
                        <li key={s.id} data-outline-member={ref} aria-setsize={stations.length} aria-posinset={v.from + i + 1} style={rowBox(key === selected)}>
                            <button type="button" aria-current={key === selected ? 'true' : undefined} title={s.path ?? s.name} onClick={() => onSelect(key)} style={main}>
                                {type && <ShapeGlyph shape={typeShape(type)} size={ICON_PX} />}
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{s.name}</span>
                                {untested && <span data-mark="no-test" style={{ ...TYPE.meta, whiteSpace: 'nowrap' }}>{t.rowNoTest}</span>}
                                {anti && <span data-mark="anti-pattern" role="img" aria-label={fillTemplate(t.rowAntiPattern, { name: anti.name })} title={fillTemplate(t.rowAntiPattern, { name: anti.name })} style={{ display: 'inline-flex', color: cssVar('violation') }}>{actionGlyph('warning')}</span>}
                            </button>
                            {canEnter(s.id) && (
                                <button type="button" data-row-action="enter" aria-label={fillTemplate(t.rowGoInside, { name: s.name })} title={fillTemplate(t.rowGoInside, { name: s.name })} onClick={() => onEnter(s.id)} style={act}>
                                    {actionGlyph('inside')}
                                </button>
                            )}
                            {restructurable && onRestructure && (
                                <button type="button" data-row-action="restructure" aria-label={fillTemplate(t.rowRestructure, { name: s.name })} title={fillTemplate(t.rowRestructure, { name: s.name })} onClick={() => onRestructure(restructureTargetOf(facts, s.refs) ?? ref)} style={act}>
                                    {actionGlyph('restructure')}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </aside>
    );
}
