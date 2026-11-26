/**
 * The tone table the stage paints with: a tone is an INDEX into {@link TONE_ORDER} (the theme's token order), so paint
 * crosses the worker boundary as a `Uint8Array` and a theme flip rewrites one palette uniform, never an attribute.
 * Worker-safe: no DOM, no three.
 */

import { KG_TOKENS, type ThemeTone } from '../scene/themeTokens';

export const TONE_ORDER: readonly ThemeTone[] = Object.keys(KG_TOKENS) as ThemeTone[];

const INDEX = new Map<ThemeTone, number>(TONE_ORDER.map((t, i) => [t, i]));

/** The palette uniform's length: every tone, with room to grow (the shader declares the same size). */
export const PALETTE_SIZE = 96;

if (TONE_ORDER.length > PALETTE_SIZE) throw new Error(`stage: ${TONE_ORDER.length} tones exceed the palette (${PALETTE_SIZE})`);

export function toneIndex(tone: ThemeTone): number {
    return INDEX.get(tone) ?? INDEX.get('edge')!;
}

export const BG_TONE = toneIndex('bg');
