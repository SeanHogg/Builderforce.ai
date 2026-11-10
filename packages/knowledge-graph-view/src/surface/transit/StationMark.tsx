/**
 * One station: a real button (a 40px target) holding the mark and its label. The mark is a
 * size-scaled silhouette of the station's mark type (`shapes.ts`; a plain disc when no type is
 * known: the map reads a type for every station of a graph) on a back-disc in the background colour, with an
 * interchange backing, the coverage arc, a pulse ring, a dashed violation outline and the
 * selection ring; the label sits on the side the placer chose, with the 10px note under it.
 */

import { cssVar, type ThemeTone } from '../../scene/themeColors';
import type { NodeShape } from '../../shapes';
import { ShapePath } from '../LegendGlyph';
import { FONT_MONO, TYPE } from '../ui/type';
import type { StationStyle } from '../overlays';
import type { PlacedLabel } from './labelPlacement';
import type { Point } from './geometry';

export interface StationMarkProps {
    id: string;
    at: Point;
    style: StationStyle;
    selected: boolean;
    dim: boolean;
    doc: boolean;
    /** Lines stopping here (only when more than one); the backing says "interchange". */
    interchange: string | null;
    aria: string;
    label: PlacedLabel;
    /** The note is the question's answer, not a plain fact: it reads in the accent colour. */
    accentNote: boolean;
    reducedMotion: boolean;
    /** The station's complexity level (1-5); the tower reads it for its height while the size channel has no reading. */
    complexity?: number | undefined;
    /** The station's mark type silhouette (`stationTypes` → `typeShape`; a document station's is the doc type's); absent ⇒ the plain disc. */
    shape?: NodeShape | undefined;
    onActivate(): void;
}

const halo = { paintOrder: 'stroke', stroke: cssVar('bg'), strokeWidth: 3 } as const;
const tone = (t: ThemeTone) => cssVar(t);

export function StationMark(p: StationMarkProps) {
    const { at, style: st, label } = p;
    const r = st.size, ring = r + 4;
    const circ = 2 * Math.PI * ring;
    const mark = p.shape
        ? <ShapePath shape={p.shape} x={at.x} y={at.y} r={r} fill={tone(st.tone)} strokeWidth={2} />
        : <circle cx={at.x} cy={at.y} r={r} fill={tone(st.tone)} stroke={cssVar('bg')} strokeWidth={2} />;
    return (
        <g
            role="button" tabIndex={0} data-station={p.id} data-doc={p.doc || undefined} aria-pressed={p.selected} aria-label={p.aria}
            style={{ cursor: 'pointer' }} opacity={p.dim ? 0.4 : 1}
            onClick={p.onActivate} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onActivate(); } }}
        >
            {p.interchange && <title>{p.interchange}</title>}
            <circle cx={at.x} cy={at.y} r={Math.max(20, ring + 6)} fill="transparent" />
            {p.interchange && <circle cx={at.x} cy={at.y} r={ring + 3} fill={tone('text')} />}
            <circle cx={at.x} cy={at.y} r={ring} fill={cssVar('bg')} />
            {mark}
            {st.ring && (
                <circle
                    cx={at.x} cy={at.y} r={ring} fill="none" stroke={tone(st.ring.tone)} strokeWidth={3}
                    strokeDasharray={st.ring.frac > 0 ? `${st.ring.frac * circ} ${circ}` : '3 3'} transform={`rotate(-90 ${at.x} ${at.y})`}
                />
            )}
            {st.pulse && (
                <circle cx={at.x} cy={at.y} r={ring} fill="none" stroke={tone('changed')} strokeWidth={2.5} pointerEvents="none">
                    {!p.reducedMotion && <animate attributeName="r" values={`${ring};${ring + 9};${ring}`} dur="2s" repeatCount="indefinite" />}
                    {!p.reducedMotion && <animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite" />}
                </circle>
            )}
            {st.outline && <circle cx={at.x} cy={at.y} r={ring + 5} fill="none" stroke={tone('violation')} strokeWidth={1.5} strokeDasharray="2 3" />}
            {p.selected && <circle cx={at.x} cy={at.y} r={ring + 8} fill="none" stroke={tone('accent')} strokeWidth={2.5} />}
            <text x={label.x} y={label.y} textAnchor={label.anchor} fontFamily={FONT_MONO} fontSize={TYPE.monoName.fontSize} fontWeight={p.dim ? 500 : TYPE.monoName.fontWeight} fill={p.dim ? cssVar('muted') : cssVar('text')} {...halo}>{label.text}</text>
            {label.note && label.noteY !== null && !p.dim && (
                <text x={label.x} y={label.noteY} textAnchor={label.anchor} fontFamily={FONT_MONO} fontSize={TYPE.monoMeta.fontSize} fill={p.accentNote ? cssVar('accent') : cssVar('muted')} {...halo}>{label.note}</text>
            )}
        </g>
    );
}
