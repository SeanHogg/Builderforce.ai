/**
 * The DOM caption layer (PRD 43 B3, Labels): the placement's UI-font captions — band titles, the wall label, the
 * describes label, terminus names, plane captions (at most {@link CAPTION_MAX}) — plus any mono name the SDF pass
 * handed back (a glyph outside its font). Real DOM text, so Inter renders exactly, every script gets the browser's glyph
 * fallback, and assistive tech can read it. Every word arrives localized in the placement; the layer adds none.
 *
 * Laid out once per placement at world (x, z); the stage's frame loop moves the whole layer with ONE CSS transform
 * (`transform.ts`) on pan, zoom and tilt — no React commit. Hidden while marks tween (it would sit where they were).
 */

import { forwardRef, memo, type CSSProperties } from 'react';
import { cssVar } from '../../scene/themeColors';
import { FONT_MONO, TYPE } from '../../surface/ui/type';
import { TONE_ORDER } from '../tones';
import type { Caption } from '../types';
import { INVERSE_VAR } from './transform';

export const CAPTION_MAX = 60;

export interface CaptionLayerProps {
    captions: readonly Caption[];
    /** Mono names the SDF pass could not draw (`LabelLayer.domCaptions`); not counted against the cap. */
    names?: readonly Caption[];
    hidden: boolean;
}

const LAYER: CSSProperties = { position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformOrigin: '0 0', pointerEvents: 'none' };
const SHIFT: Record<Caption['anchor'], string> = { start: '0', middle: '-50%', end: '-100%' };

function styleOf(c: Caption): CSSProperties {
    const role = c.font === 'mono' ? { fontFamily: FONT_MONO, fontSize: 11, fontWeight: 500 } : c.role === 'band' ? TYPE.bandLabel : TYPE.caption;
    return {
        ...role,
        position: 'absolute', left: c.position[0], top: c.position[2], whiteSpace: 'nowrap', lineHeight: 1,
        color: cssVar(TONE_ORDER[c.tone] ?? 'muted'),
        transformOrigin: '0 0',
        // Cancel the layer's scale / tilt, then shift by the caption's px offset, then anchor the text on its point.
        transform: `var(${INVERSE_VAR}, none)${c.offsetPx ? ` translate(${c.offsetPx[0]}px, ${c.offsetPx[1]}px)` : ''} translate(${SHIFT[c.anchor]}, -50%)`,
    };
}

export const CaptionLayer = memo(forwardRef<HTMLDivElement, CaptionLayerProps>(function CaptionLayer({ captions, names = [], hidden }, ref) {
    const shown = captions.slice(0, CAPTION_MAX);
    return (
        <div ref={ref} data-stage-captions style={{ ...LAYER, visibility: hidden ? 'hidden' : 'visible' }}>
            {shown.map((c, i) => <span key={`c${i}`} data-caption-role={c.role ?? 'plane'} style={styleOf(c)}>{c.text}</span>)}
            {names.map((c, i) => <span key={`n${i}`} data-caption-role="name" style={styleOf(c)}>{c.text}</span>)}
        </div>
    );
}));
