/**
 * The docked pane above the code band (PRD 43 Part C1): the outline of the level on show, built from the stations the
 * stage already holds (no records walk, no `symbolsOf`). One row per member: its shape glyph, its name, a "No test" mark
 * and an anti-pattern mark (`SymbolFacts`, computed once by the wiring), and at the end its actions: Go inside when it
 * has an inside, Restructure when it carries an anti-pattern and the host handles it. A click on the row picks the
 * member through the stage's own `onSelect` (the path the station card takes), so the picture moves to it.
 */

import type { CSSProperties } from 'react';
import { findingTitle } from '../../findingText';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { typeShape, type MarkType } from '../../shapes';
import { CONTROL, list } from '../../styles';
import { ShapeGlyph } from '../../surface/LegendGlyph';
import type { Station } from '../../surface/stations';
import type { SymbolFacts } from '../../surface/symbolFacts';
import { TYPE } from '../../surface/ui/type';
import { LINK_BUTTON, WarnGlyph } from '../drill/CodeLayer';
import { toggleButton } from './cardStyles';

const ICON_PX = 12;

const rowBox = (on: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 4, borderRadius: 6, background: on ? cssVar('accentSoft') : 'transparent',
});
const main: CSSProperties = {
    ...LINK_BUTTON, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', minWidth: 0, minHeight: CONTROL,
    padding: '0 8px', textAlign: 'left', ...TYPE.body,
};
const act: CSSProperties = { ...toggleButton, minHeight: CONTROL, minWidth: CONTROL, padding: 0 };

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
    return (
        <aside data-code-dock data-code-pane data-level-outline role="complementary" aria-label={t.dockAria} style={{ position: 'absolute', inset: 0, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, color: cssVar('text') }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <b style={TYPE.sectionHeading}>{t.outline}</b>
                {onHide && <button type="button" data-action="dock-hide" aria-label={t.dockHide} title={t.dockHide} onClick={onHide} style={{ ...toggleButton, minHeight: 24 }}><span aria-hidden="true">‹</span></button>}
            </div>
            {note && <p role="note" data-outline-note style={{ margin: 0, ...TYPE.meta }}>{note}</p>}
            {stations.length === 0 && <p role="note" data-outline-empty style={{ margin: 0, ...TYPE.meta }}>{t.levelEmpty}</p>}
            <ul aria-label={t.levelAria} style={{ ...list, gap: 0, flex: '1 1 0', minHeight: 0, overflow: 'auto' }}>
                {stations.map((s) => {
                    const key = keyOf(s), ref = s.refs[0] ?? s.id;
                    const anti = facts.antiPatternOf(ref), untested = facts.untested(ref);
                    const type = types.get(s.id);
                    return (
                        <li key={s.id} data-outline-member={ref} style={rowBox(key === selected)}>
                            <button type="button" aria-current={key === selected ? 'true' : undefined} title={s.path ?? s.name} onClick={() => onSelect(key)} style={main}>
                                {type && <ShapeGlyph shape={typeShape(type)} size={ICON_PX} />}
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{s.name}</span>
                                {untested && <span data-mark="no-test" style={{ ...TYPE.meta, whiteSpace: 'nowrap' }}>{t.rowNoTest}</span>}
                                {anti && <span data-mark="anti-pattern" style={{ display: 'inline-flex' }}><WarnGlyph size={ICON_PX} label={fillTemplate(t.rowAntiPattern, { name: findingTitle({ kind: anti.kind }, labels) })} /></span>}
                            </button>
                            {canEnter(s.id) && (
                                <button type="button" data-row-action="enter" aria-label={fillTemplate(t.rowGoInside, { name: s.name })} title={fillTemplate(t.rowGoInside, { name: s.name })} onClick={() => onEnter(s.id)} style={act}>
                                    <span aria-hidden="true">⤓</span>
                                </button>
                            )}
                            {anti && onRestructure && (
                                <button type="button" data-row-action="restructure" aria-label={fillTemplate(t.rowRestructure, { name: s.name })} title={fillTemplate(t.rowRestructure, { name: s.name })} onClick={() => onRestructure(ref)} style={act}>
                                    <span aria-hidden="true">⚒</span>
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </aside>
    );
}
