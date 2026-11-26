/**
 * The side of an open comparison, applied to the placement the stage is about to draw (PRD 43 C5): the union MarkSet's
 * placement with the slots the side lacks shrunk to scale 0 at their anchor (`applySideMask`). A post-step over the
 * placement output, memoized on it; a placement of another MarkSet generation is left alone. Flipping the side changes
 * only the output's positions and scales, which the stage's placement tween animates.
 */

import { useMemo } from 'react';
import { applySideMask } from '../../compute/compare';
import type { CompareView } from '../../surface/compareModel';
import type { MarkSet, Placement } from '../types';

export function useSideMask(placement: Placement | null, marks: MarkSet | null, view: CompareView | null | undefined): Placement | null {
    return useMemo(
        () => (placement && marks && view?.graph && placement.generation === marks.generation ? applySideMask(placement, marks, view.absent, view.anchors) : placement),
        [placement, marks, view],
    );
}
