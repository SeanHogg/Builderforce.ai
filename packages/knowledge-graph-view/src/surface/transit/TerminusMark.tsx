/**
 * A line's end: a tank (data store), a globe (outside service), a cross (dead end) or a ticked
 * box (a dead end somebody reported), a stub from the last station for EACH line that ends here
 * in that line's colour, and the name beneath. The glyph says the kind by SHAPE; with several
 * lines it is drawn in the text colour, so no one line owns it.
 */

import { cssVar } from '../../scene/themeColors';
import type { Point } from './geometry';
import type { TerminusGlyph } from './termini';

export interface TerminusLine { color: string; width: number }

function Glyph({ glyph, at, color }: { glyph: TerminusGlyph; at: Point; color: string }) {
    const { x, y } = at;
    if (glyph === 'tank') {
        return <path data-shape="tank" d={`M ${x - 11} ${y - 8} a 11 4 0 0 0 22 0 v 16 a 11 4 0 0 1 -22 0 z M ${x - 11} ${y - 8} a 11 4 0 0 1 22 0 a 11 4 0 0 1 -22 0`} fill={color} stroke={cssVar('bg')} strokeWidth={1.5} />;
    }
    if (glyph === 'globe') {
        return <path data-shape="globe" d={`M ${x - 10} ${y} a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0 M ${x - 10} ${y} h 20 M ${x} ${y - 10} c 5 5 5 15 0 20 c -5 -5 -5 -15 0 -20`} fill="none" stroke={color} strokeWidth={1.8} />;
    }
    if (glyph === 'box') {
        return (
            <g data-shape="box">
                <rect x={x - 9} y={y - 9} width={18} height={18} rx={3} fill="none" stroke={cssVar('agrees')} strokeWidth={1.8} />
                <path d={`M ${x - 4} ${y} l 3 3.5 l 6 -7`} fill="none" stroke={cssVar('agrees')} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </g>
        );
    }
    return <path data-shape="cross" d={`M ${x - 8} ${y - 8} L ${x + 8} ${y + 8} M ${x + 8} ${y - 8} L ${x - 8} ${y + 8}`} stroke={cssVar('violation')} strokeWidth={3.5} strokeLinecap="round" fill="none" />;
}

export interface TerminusMarkProps {
    glyph: TerminusGlyph;
    kind: string;
    from: Point;
    at: Point;
    /** One per line that ends here. */
    lines: readonly TerminusLine[];
    text: string;
    dim: boolean;
}

export function TerminusMark({ glyph, kind, from, at, lines, text, dim }: TerminusMarkProps) {
    const many = lines.length > 1;
    return (
        <g data-terminus={kind} data-glyph={glyph} opacity={dim ? 0.4 : 1}>
            <title>{text}</title>
            {lines.map((line, i) => {
                // Each line's stub runs beside the others, one stroke apart, so every colour shows.
                const shift = (i - (lines.length - 1) / 2) * (line.width + 2);
                const d = `M ${from.x} ${from.y + shift} L ${at.x - 12} ${at.y + shift}`;
                return (
                    <g key={i} data-stub>
                        <path d={d} stroke={cssVar('bg')} strokeWidth={line.width + 4} strokeLinecap="round" fill="none" />
                        <path d={d} stroke={line.color} strokeWidth={line.width} strokeLinecap="round" fill="none" data-stub-colour={line.color} />
                    </g>
                );
            })}
            <Glyph glyph={glyph} at={at} color={many ? cssVar('text') : lines[0]?.color ?? cssVar('text')} />
            <text x={at.x} y={at.y + 25} textAnchor="middle" fontSize={10} fill={glyph === 'cross' ? cssVar('violation') : cssVar('muted')} paintOrder="stroke" stroke={cssVar('bg')} strokeWidth={3}>{text}</text>
        </g>
    );
}
