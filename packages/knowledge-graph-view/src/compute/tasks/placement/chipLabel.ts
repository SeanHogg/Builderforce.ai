/** The perspective Map's name for a shape: a mono DOM chip projected above it (the ONE label run `map.ts` and `level.ts` both emit). Pure. */

import { BG_TONE, toneIndex } from '../../../stage/tones';
import type { LabelRun } from '../../../stage/types';

const TEXT = toneIndex('text');

/** `size`: how far above the shape's footprint the chip stands (world units, as the label's px offset reads it). */
export function chipLabel(slot: number, text: string, size: number, priority: number, risky: boolean, title: string | undefined): LabelRun {
    return {
        slot, text, offsetPx: [0, size + 12], font: 'mono', size: 11, weight: 500, anchor: 'middle',
        tone: TEXT, halo: { tone: BG_TONE, px: 3 }, priority, scale: 'world', chip: { risky, title },
    };
}
