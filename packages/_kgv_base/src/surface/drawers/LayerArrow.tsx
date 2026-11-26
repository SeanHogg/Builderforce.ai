/**
 * The two pictures an anti-pattern card draws, in tokens only (both themes): `LayerArrow`, two layer
 * boxes with the link between them (red, dashed when it skips a layer), and `FileArrow`, two real
 * files one above the other with the link pointing up (before, red) or down (after, green).
 */

import { cssVar } from '../../scene/themeColors';
import { FONT_MONO, FONT_UI } from '../ui/type';
import { layerRank } from '../layers';

const MAX_CHARS = 26;

/** The end of a path that fits a box: `…ain/user.ts`. */
export const shortPath = (path: string): string => (path.length > MAX_CHARS ? `…${path.slice(path.length - MAX_CHARS + 1)}` : path);

/** The last segment of a path: `user.ts`. */
export const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

interface LayerArrowProps {
    /** The layer that reaches, the one it reaches into: their display names and raw partitions. */
    fromName: string;
    toName: string;
    from?: string | undefined;
    to?: string | undefined;
    skips: boolean;
    caption: string;
    aria: string;
}

export function LayerArrow({ fromName, toName, from, to, skips, caption, aria }: LayerArrowProps) {
    const fr = layerRank(from), tr = layerRank(to);
    // The upper layer sits on the left; a link from the lower layer to the upper one points left (it climbs).
    const fromLeft = fr !== undefined && tr !== undefined && fr < tr;
    const [left, right] = fromLeft ? [fromName, toName] : [toName, fromName];
    const red = cssVar('violation');
    const box = (x: number, name: string) => (
        <>
            <rect x={x} y={4} width={120} height={30} rx={6} fill={cssVar('panel2')} stroke={cssVar('border')} />
            <text x={x + 60} y={24} textAnchor="middle" fill={cssVar('text')} fontSize={12} fontFamily={FONT_UI}>{name}</text>
        </>
    );
    return (
        <svg role="img" aria-label={aria} viewBox="0 0 420 44" width="100%" style={{ maxWidth: 420, height: 'auto', display: 'block' }} data-diagram="layerArrow">
            {box(0, left)}
            {box(300, right)}
            {fromLeft
                ? <><path d="M122 19 H294" stroke={red} strokeWidth={2.5} {...(skips ? { strokeDasharray: '6 4' } : {})} /><path d="M298 19 l-8 -5 v10 z" fill={red} /></>
                : <><path d="M298 19 H126" stroke={red} strokeWidth={2.5} {...(skips ? { strokeDasharray: '6 4' } : {})} /><path d="M122 19 l8 -5 v10 z" fill={red} /></>}
            <text x={212} y={13} textAnchor="middle" fill={red} fontSize={11} fontFamily={FONT_UI}>{caption}</text>
        </svg>
    );
}

interface FileArrowProps {
    top: string;
    bottom: string;
    /** Before: the lower file reaches up (red). After: the upper file reaches down (green). */
    state: 'before' | 'after';
    aria: string;
}

export function FileArrow({ top, bottom, state, aria }: FileArrowProps) {
    const before = state === 'before';
    const tone = cssVar(before ? 'violation' : 'agrees');
    const text = (y: number, s: string, fill: string) => (
        <text x={110} y={y} textAnchor="middle" fill={fill} fontSize={11} fontFamily={FONT_MONO}>{s}</text>
    );
    return (
        <svg role="img" aria-label={aria} viewBox="0 0 220 96" width="100%" style={{ maxWidth: 220, height: 'auto', display: 'block' }} data-diagram="fileArrow" data-state={state}>
            <rect x={20} y={4} width={180} height={28} rx={6} fill={cssVar('panel2')} stroke={cssVar('border')} />
            {text(22, shortPath(top), cssVar('text'))}
            <rect x={20} y={64} width={180} height={28} rx={6} fill={cssVar('panel2')} stroke={tone} />
            {text(82, shortPath(bottom), tone)}
            {before
                ? <><path d="M110 62 V38" stroke={tone} strokeWidth={2.5} /><path d="M110 34 l-5 8 h10 z" fill={tone} /></>
                : <><path d="M110 36 V58" stroke={tone} strokeWidth={2.5} /><path d="M110 62 l-5 -8 h10 z" fill={tone} /></>}
        </svg>
    );
}
