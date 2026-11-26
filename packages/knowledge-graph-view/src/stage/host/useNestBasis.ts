/**
 * What a rebuilt world re-derives the zoom's nesting from (`useNestEntries`): the placements of the drill's ANCESTOR levels
 * (the world map, then each drilled level above the one on show) at the generation of the MarkSet on show, paired with that
 * MarkSet. Computed only while the zoom has nesting to keep; the worker caches them with the placements the stage already
 * asked for, so they are not new layouts in the steady state. `basis` is null until every level has landed at the MarkSet's
 * generation, so no nest entry is ever derived from mismatched generations.
 */

import { useMemo } from 'react';
import { drillKeyOf } from '../../compute/tasks/placement/request';
import type { KindInput } from '../../compute/kinds';
import { useComputed } from '../../compute/useComputed';
import type { DrillFrame } from '../../surface/transit/drillView';
import type { NestBasis } from '../drill/nest';
import type { MarkSet } from '../types';

/** A drilled stack is at most package, class, function: the deepest ancestor of the level on show is the class level. */
export function useNestBasis(
    marks: MarkSet | null,
    stack: readonly DrillFrame[],
    enabled: boolean,
    place: (drill: string | null) => KindInput<'placement'>,
    deps: readonly unknown[],
): { basis: NestBasis | null; pending: boolean } {
    const n = stack.length, on = enabled && !!marks;
    const key1 = drillKeyOf(stack[0]), key2 = drillKeyOf(stack[1]);
    const world = useComputed('placement', place(null), deps, null, { enabled: on && n >= 1 });
    const one = useComputed('placement', place(key1), [...deps, key1], null, { enabled: on && n >= 2 });
    const two = useComputed('placement', place(key2), [...deps, key2], null, { enabled: on && n >= 3 });
    const basis = useMemo((): NestBasis | null => {
        const levels = [world.value, one.value, two.value].slice(0, n);
        if (!marks || n === 0 || !levels.every((l) => !!l && l.generation === marks.generation)) return null;
        return { marks, levels: levels as NestBasis['levels'] };
    }, [marks, n, world.value, one.value, two.value]);
    return { basis, pending: world.pending || one.pending || two.pending };
}

/**
 * Whether the stage holds its frame for the nest basis: only while something is still coming (the placements are computing, or
 * they landed and the zoom has not taken them yet) AND the level on show still awaits it. A basis that never lands (the
 * placements failed: nothing pending, nothing landed) or a chain that cannot be derived (the basis matches the generation, so
 * nothing more awaits it) releases the frame: the level is drawn un-nested rather than held for ever.
 */
export const holdsForNestBasis = (pending: boolean, basis: NestBasis | null, awaits: boolean): boolean => (pending || !!basis) && awaits;
