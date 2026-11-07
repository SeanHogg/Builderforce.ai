/**
 * One hop of a line: a background casing stroke, the coloured stroke (5 to 12px from the width
 * channel), a dashed violation stroke where no test reaches, a dashed stroke and a mark where
 * the hop is a cycle, a flowing dash on the selected line, and .22 opacity when the question
 * dims it. Never colour alone: untested and cycle are dashes.
 */

import { cssVar } from '../../scene/themeColors';
import { FONT_UI, TYPE } from '../ui/type';
import type { HopRoute } from './corridors';

export interface HopPathProps {
    route: HopRoute;
    color: string;
    width: number;
    untested: boolean;
    cycle: boolean;
    dim: boolean;
    flowing: boolean;
    cycleLabel: string;
    /** The Tower camera's pipe: a wider raised underlay instead of the background casing, and a highlight along the top. */
    pipe?: boolean;
    onSelect(): void;
}

const halo = { paintOrder: 'stroke', stroke: cssVar('bg'), strokeWidth: 3 } as const;

export function HopPath({ route: r, color, width, untested, cycle, dim, flowing, cycleLabel, pipe = false, onSelect }: HopPathProps) {
    return (
        <g opacity={dim ? 0.22 : 1} data-line={r.lineId} data-untested={untested || undefined} data-cycle={cycle || undefined} data-pipe={pipe || undefined}>
            <path d={r.d} fill="none" stroke={pipe ? cssVar('raise') : cssVar('bg')} strokeWidth={width + (pipe ? 6 : 4)} strokeLinecap="round" strokeLinejoin="round" data-casing />
            <path
                d={r.d} fill="none" stroke={untested ? cssVar('violation') : color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray={untested ? '9 7' : cycle ? '3 5' : undefined} style={{ cursor: 'pointer' }} onClick={onSelect}
            />
            {pipe && !dim && (
                <path
                    d={r.d} fill="none" stroke="white" strokeWidth={Math.max(1.5, width * 0.3)} strokeLinecap="round" opacity={0.22}
                    pointerEvents="none" transform="translate(-1 -1.5)" data-pipe-highlight
                />
            )}
            {cycle && (
                <g role="img" aria-label={cycleLabel} data-cycle-mark>
                    <title>{cycleLabel}</title>
                    <text x={r.mid.x} y={r.mid.y + 4} textAnchor="middle" fontFamily={FONT_UI} fontSize={TYPE.title.fontSize} fontWeight={TYPE.title.fontWeight} fill={cssVar('text')} {...halo}>⟲</text>
                </g>
            )}
            {flowing && (
                <path d={r.d} fill="none" stroke={cssVar('bg')} strokeWidth={2} strokeLinecap="round" strokeDasharray="2 14" opacity={0.75} pointerEvents="none">
                    <animate attributeName="stroke-dashoffset" from="16" to="0" dur="1.2s" repeatCount="indefinite" />
                </path>
            )}
        </g>
    );
}
