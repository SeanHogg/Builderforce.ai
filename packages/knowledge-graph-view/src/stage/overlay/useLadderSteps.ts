/**
 * The Map's wheel and ladder (`useStageWiring.tsx`): the wheel goes one band at a time, the ladder and the level rail walk to a
 * band or a rung from the picked mark; a step with nothing to enter says so (the toast) instead of doing nothing.
 */

import { useCallback } from 'react';
import { ZOOM_BANDS } from '../labels/lod';
import type { SemanticZoom } from '../drill/useSemanticZoom';

const BAND_ORDER = ZOOM_BANDS.map((b) => b.band);

export function useLadderSteps(zoom: SemanticZoom, selected: string | null, say: (text: string) => void, noMethod: string) {
    const { stepIn, outOne, closeCode, toBand: goToBand, toRung: goToRung } = zoom;
    const atCodeLevel = !!zoom.code;
    const bandIndex = BAND_ORDER.indexOf(zoom.band);
    const wheelStep = useCallback((dir: 1 | -1) => {
        if (dir > 0) { if (!stepIn(selected) && bandIndex === BAND_ORDER.length - 2) say(noMethod); return; }
        if (atCodeLevel) closeCode(); else outOne();
    }, [stepIn, outOne, closeCode, atCodeLevel, bandIndex, selected, say, noMethod]);
    const toRung = useCallback((target: number) => goToRung(target, selected, () => say(noMethod)), [goToRung, selected, say, noMethod]);
    const toBand = useCallback((target: number) => goToBand(target, selected, () => say(noMethod)), [goToBand, selected, say, noMethod]);
    return { wheelStep, toBand, toRung };
}
