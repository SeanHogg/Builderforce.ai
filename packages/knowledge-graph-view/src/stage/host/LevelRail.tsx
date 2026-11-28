/**
 * The level rail (the design's `#zoom`), top-right of the stage in every camera: a vertical rail of the five levels
 * (System, Component, Class, Method, Line) with an accent thumb on the current one — past levels normal, the current bold,
 * deeper ones faint — and under it a small hint chip about what the zoom does next. A click goes to that level. The chip
 * hides in a narrow stage (≤ 900px), the rail stays.
 *
 * The levels are where you are, the Map's bands are what it shows there: band i (0 system … 3 code) is drill depth i, so
 * System = the world, Component = inside a component (its classes), Class = inside a class (its methods), Method = inside
 * a method (its code), and Line = a line or call picked in that code. The Sequence has three bands: System, Class, Method.
 */

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { fillTemplate } from '../../labels';
import type { SceneLabels } from '../../labels/surface.scene';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';

export type RailLevel = 'system' | 'component' | 'class' | 'method' | 'line';
const MAP_LEVELS: readonly RailLevel[] = ['system', 'component', 'class', 'method', 'line'];
const SEQUENCE_LEVELS: readonly RailLevel[] = ['system', 'class', 'method'];
/** The Map's code band (drill depth 3). */
const CODE_BAND = 3;
const NAME: Record<RailLevel, keyof SceneLabels['zoom']> = {
    system: 'levelSystem', component: 'levelComponent', class: 'levelClass', method: 'levelMethod', line: 'levelLine',
};

const ROW_PX = 24;
const chip: CSSProperties = { maxWidth: 210, padding: '2px 8px', border: `1px solid ${cssVar('border')}`, borderRadius: 4, background: cssVar('panel'), ...TYPE.meta, textAlign: 'right' };

export interface LevelRailInput {
    zoom: SceneLabels['zoom'];
    /** The Sequence camera: its own three bands. */
    sequence: boolean;
    /** The band on show: the Sequence's (0..2) or the Map's (0 system … 3 code). */
    band: number;
    /** At the code band, a line or call is picked: the Line level. */
    linePicked: boolean;
    /** The Map's rung (0 System … 4 Line) from the drill; when given, `toBand` receives a rung and `band` / `linePicked` are not read. */
    rung?: number | undefined;
    /** Go to band `i` (the Map's ladder, or the Sequence's band control). */
    toBand(i: number): void;
    /** The station the zoom would go inside next (the pick), else null. */
    into: string | null;
    /** The level a further zoom-out goes back to, else null (the world has none). */
    backTo: string | null;
    /** The stage's pick: a new one ends the "keep zooming out" state. */
    selected: string | null;
}

export interface LevelRailModel {
    levels: readonly RailLevel[];
    current: number;
    go(i: number): void;
    hint: string;
    /** A wheel step (the Map's stepped zoom): an outward one shows "Keep zooming out · back to …". */
    noteStep(dir: 1 | -1): void;
}

/** The rail's levels, the current one, where a click goes and the hint (going inside, back out, deepest, or how to zoom). */
export function useLevelRail({ zoom, sequence, band, linePicked, rung, toBand, into, backTo, selected }: LevelRailInput): LevelRailModel {
    const levels = sequence ? SEQUENCE_LEVELS : MAP_LEVELS;
    // The Map reads the drill's own rung (`levelRung.ts`: world/system → System, app/package → Component, class, function → Method, code → Line).
    const current = Math.max(0, Math.min(levels.length - 1, !sequence && rung !== undefined ? rung : !sequence && band >= CODE_BAND && linePicked ? CODE_BAND + 1 : band));
    // The last zoom went out: the hint says where the next one goes back to, until the person zooms in or picks again.
    const [out, setOut] = useState(false);
    useEffect(() => { setOut(false); }, [selected]);
    const noteStep = useCallback((dir: 1 | -1) => setOut(dir < 0), []);
    const go = useCallback((i: number) => {
        setOut(i < current);
        toBand(Math.min(i, sequence || rung !== undefined ? levels.length - 1 : CODE_BAND));
    }, [current, toBand, sequence, levels.length, rung]);
    const deepest = sequence || rung !== undefined ? current >= levels.length - 1 : band >= CODE_BAND;
    const hint = out && backTo ? fillTemplate(zoom.hintBack, { name: backTo })
        : deepest ? zoom.hintDeepest : into ? fillTemplate(zoom.hintInto, { name: into }) : zoom.hintIn;
    return { levels, current, go, hint, noteStep };
}

export interface LevelRailProps {
    zoom: SceneLabels['zoom'];
    rail: LevelRailModel;
    narrow: boolean;
    filters?: ReactNode;
}

export function LevelRail({ zoom, rail, narrow, filters }: LevelRailProps) {
    const { levels, current, go, hint } = rail;
    return (
        <div data-level-rail style={{ position: 'absolute', zIndex: 2, insetInlineEnd: 10, insetBlockStart: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, pointerEvents: 'none' }}>
            <div role="group" aria-label={zoom.group} style={{ position: 'relative', display: 'flex', flexDirection: 'column', paddingInlineStart: 12, border: `1px solid ${cssVar('border')}`, borderRadius: 4, background: cssVar('panel'), pointerEvents: 'auto' }}>
                <span aria-hidden="true" style={{ position: 'absolute', insetInlineStart: 7, top: 12, bottom: 12, width: 1, background: cssVar('border') }} />
                {levels.map((level, i) => (
                    <button
                        key={level} type="button" data-level={level} aria-pressed={i === current} onClick={() => go(i)}
                        style={{ height: ROW_PX, border: 0, background: 'none', padding: '0 8px 0 6px', cursor: 'pointer', textAlign: 'left', font: 'inherit', fontSize: 11.5, color: cssVar(i > current ? 'muted' : 'text'), opacity: i > current ? 0.6 : 1, fontWeight: i === current ? 600 : 400 }}
                    >
                        {zoom[NAME[level]]}
                    </button>
                ))}
                <i aria-hidden="true" data-level-thumb style={{ position: 'absolute', insetInlineStart: 4, top: current * ROW_PX + (ROW_PX - 7) / 2, width: 7, height: 7, borderRadius: '50%', background: cssVar('accent') }} />
            </div>
            {filters}
            {!narrow && <div role="status" aria-live="polite" data-level-hint style={chip}>{hint}</div>}
        </div>
    );
}
