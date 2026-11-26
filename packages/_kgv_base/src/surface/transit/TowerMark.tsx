/**
 * One station as a 2.5D tower, the Tower camera's mark (the transit map's circle, standing up):
 * a shadow ellipse, a 18px body whose height is the size channel and whose fill is the colour
 * channel, a coverage tint with a 2px fill line at the ring channel's fraction, a darker side
 * face and a lit top ellipse. Three coverage states, told apart by the station's data and never by a colour:
 * no data draws a plain body with no fill (the legend explains the empty channel), a MEASURED 0% draws a
 * dashed outline (a "shell") rather than a body, and anything above 0 fills. A selected tower's top takes
 * the accent stroke. A station off the answer drops to .3.
 * The label sits centred under the base. Pulse and outline have no tower form (as in the design).
 */

import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { ShapePath } from '../LegendGlyph';
import { FONT_MONO, TYPE } from '../ui/type';
import type { StationStyle } from '../overlays';
import type { Point } from './geometry';
import type { Box } from './labelPlacement';
import type { StationMarkProps } from './StationMark';
import { towerHeight } from './towerHeight';

export const TOWER_WIDTH = 18;
const BASE_DROP = 6;
/** The radii of the shadow and of the lit top ellipse (the tower's widest and highest extent). */
const SHADOW_RX = 12;
const SHADOW_RY = 5;
const TOP_RY = 4;

export { towerHeight };

export interface TowerGeometry {
    /** The foot of the tower (its shadow's centre). */
    base: Point;
    height: number;
    /** The top-left of the body and of the side face. */
    left: number;
    side: number;
    top: number;
    /** The coverage fill: its top edge and its height; 0 when the ring channel has no reading. */
    fillTop: number;
    fillHeight: number;
    /** MEASURED zero coverage (`style.ring.zeroCoverage`): an outline, not a body. No coverage data at all is neither a shell nor a fill. */
    shell: boolean;
}

export function towerGeometry(at: Point, style: StationStyle, cx?: number): TowerGeometry {
    const height = towerHeight(style.size, cx);
    const baseY = at.y + BASE_DROP;
    const fillHeight = style.ring ? Math.round(height * style.ring.frac) : 0;
    return {
        base: { x: at.x, y: baseY }, height, left: at.x - TOWER_WIDTH / 2, side: at.x + 3, top: baseY - height,
        fillTop: baseY - fillHeight, fillHeight, shell: style.ring?.zeroCoverage === true,
    };
}

/** Nearer towers (lower on the page) paint over farther ones: the drawn stations, ordered by y (stable). */
export function byDepth<T extends { id: string }>(items: readonly T[], positions: ReadonlyMap<string, Point>): T[] {
    return [...items].sort((a, b) => (positions.get(a.id)?.y ?? 0) - (positions.get(b.id)?.y ?? 0));
}

/** Where a pin goes: 12px above the tower's top, so it never sits on the body. */
export const towerPinY = (at: Point, style: StationStyle, cx?: number): number => at.y + BASE_DROP - towerHeight(style.size, cx) - 12;

/** The space a tower takes (its shadow's width, from the top ellipse to the shadow's foot): what the label placer keeps other labels off. */
export function towerBox(at: Point, style: StationStyle, cx?: number): Box {
    const g = towerGeometry(at, style, cx);
    const top = g.top - TOP_RY, foot = g.base.y + SHADOW_RY;
    return { x: at.x - SHADOW_RX, y: top, w: SHADOW_RX * 2, h: foot - top };
}

const halo = { paintOrder: 'stroke', stroke: cssVar('bg'), strokeWidth: 3 } as const;
const tone = (t: ThemeTone) => cssVar(t);

export function TowerMark(p: StationMarkProps) {
    const { at, style: st, label } = p;
    const g = towerGeometry(at, st, p.complexity);
    const colour = tone(st.tone);
    const o = p.dim ? 0.3 : 1;
    const ringColour = st.ring ? tone(st.ring.tone) : 'none';
    const labelY = at.y + 22;
    return (
        <g
            role="button" tabIndex={0} data-station={p.id} data-tower data-doc={p.doc || undefined} aria-pressed={p.selected} aria-label={p.aria}
            style={{ cursor: 'pointer' }} onClick={p.onActivate} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onActivate(); } }}
        >
            {p.interchange && <title>{p.interchange}</title>}
            <rect x={at.x - 20} y={g.top - 6} width={40} height={g.height + 24} fill="transparent" />
            <ellipse data-tower-part="shadow" cx={at.x} cy={g.base.y} rx={SHADOW_RX} ry={SHADOW_RY} fill={tone('scrim')} />
            {g.shell
                ? <rect data-tower-part="shell" x={g.left} y={g.top} width={TOWER_WIDTH} height={g.height} fill="none" stroke={colour} strokeWidth={1.5} strokeDasharray="3 3" opacity={o} />
                : <rect data-tower-part="body" x={g.left} y={g.top} width={TOWER_WIDTH} height={g.height} fill={colour} opacity={o} />}
            {st.ring && g.fillHeight > 0 && (
                <>
                    <rect data-tower-part="tint" x={g.left} y={g.fillTop} width={TOWER_WIDTH} height={g.fillHeight} fill={ringColour} opacity={p.dim ? 0.12 : 0.3} />
                    <rect data-tower-part="fill-line" x={g.left} y={g.fillTop} width={TOWER_WIDTH} height={2} fill={ringColour} opacity={p.dim ? 0.35 : 1} />
                </>
            )}
            <rect data-tower-part="side" x={g.side} y={g.top} width={6} height={g.height} fill={tone('towerSide')} />
            <ellipse
                data-tower-part="top" cx={at.x} cy={g.top} rx={TOWER_WIDTH / 2} ry={TOP_RY} fill={g.shell ? 'none' : colour} opacity={o} style={{ filter: 'brightness(1.3)' }}
                {...(p.selected
                    ? { stroke: tone('accent'), strokeWidth: 2 }
                    : g.shell ? { stroke: colour, strokeDasharray: '3 3' } : {})}
            />
            {p.shape && (
                // The station's mark type (`shapes.ts`), cut into the body's face so a tower reads its type like a station does.
                <g data-tower-part="type">
                    <ShapePath shape={p.shape} x={at.x - 3} y={g.top + Math.min(g.height / 2, 14)} r={5.5} fill={g.shell ? colour : cssVar('bg')} strokeWidth={0.5} opacity={o} />
                </g>
            )}
            <text x={at.x} y={labelY} textAnchor="middle" fontFamily={FONT_MONO} fontSize={TYPE.monoName.fontSize} fontWeight={p.dim ? 500 : TYPE.monoName.fontWeight} fill={p.dim ? cssVar('muted') : cssVar('text')} {...halo}>{label.text}</text>
            {label.note && !p.dim && (
                <text x={at.x} y={labelY + 13} textAnchor="middle" fontFamily={FONT_MONO} fontSize={TYPE.monoMeta.fontSize} fill={p.accentNote ? cssVar('accent') : cssVar('muted')} {...halo}>{label.note}</text>
            )}
        </g>
    );
}
