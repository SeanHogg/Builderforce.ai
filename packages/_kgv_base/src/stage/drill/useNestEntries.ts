/**
 * The zoom's nest entries (`nest.ts`): one per level the ZOOM entered, keyed `<level>:<ref>`, holding the mark the level
 * was nested into and the placement it was nested against. Three things keep them true as the map changes under the person:
 *
 *   - a package frame the drill moved onto a rebuilt map's station (`drill.reanchored`) carries its entry to the new key
 *     (before paint: no frame draws the level un-nested);
 *   - a rebuilt world (a new generation) stales every entry's geometry, so the entries are DERIVED again from the new
 *     generation's placements (`setBasis`: one MarkSet and the ancestor levels' placements of that same generation), the
 *     whole chain, so the level stays nested in its mark instead of snapping out;
 *   - a level the zoom did not enter is never nested.
 *
 * `nest` is the placement the stage draws: a placement is only ever nested by an entry of its OWN generation.
 */

import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { drillKeyOf } from '../../compute/tasks/placement/request';
import type { DrillModel } from '../../surface/transit/useDrill';
import type { Placement } from '../types';
import { deriveNestEntries, drillOfPlacement, nestPlacement, type NestBasis, type NestEntry } from './nest';

export interface NestEntries {
    /** The entries as the zoom reads them: recorded ones, re-derived where a rebuilt world staled them. */
    entries: ReadonlyMap<string, NestEntry>;
    /** Records the entry of a level the zoom just entered. */
    add(e: NestEntry): void;
    /** The placement nested into its mark (the same placement when the zoom did not enter it, or its entry is not of this generation). */
    nest(p: Placement): Placement;
    /** The generation-matched placements a rebuilt world re-derives the entries from; null clears them. */
    setBasis(b: NestBasis | null): void;
    /** An entry of the drill stack is stale for `p`'s generation and its basis has not landed: nesting now would draw the level un-nested. */
    awaitsBasis(p: Placement): boolean;
    /** The zoom entered a level of the current drill stack (so a rebuilt world has nesting to keep). */
    nests: boolean;
}

export function useNestEntries(drill: DrillModel): NestEntries {
    const [recorded, setRecorded] = useState<ReadonlyMap<string, NestEntry>>(() => new Map());
    const [basis, setBasis] = useState<NestBasis | null>(null);
    const add = useCallback((e: NestEntry) => setRecorded((m) => new Map(m).set(e.drill, e)), []);

    // A package frame the drill moved onto a rebuilt map's station: its entry follows the new key. Only the moved frames
    // are re-keyed; the new key's entry is always overwritten.
    useLayoutEffect(() => {
        const { moves } = drill.reanchored;
        if (moves.size === 0) return;
        setRecorded((m) => {
            const next = new Map(m);
            for (const [from, to] of moves) {
                const old = next.get(`package:${from}`);
                if (!old) continue;
                next.delete(`package:${from}`);
                next.set(`package:${to}`, { ...old, drill: `package:${to}` });
            }
            return next;
        });
    }, [drill.reanchored]);

    const stack = drill.stack;
    const derived = useMemo(() => (basis ? deriveNestEntries(stack, recorded, basis) : null), [stack, recorded, basis]);
    const entries = useMemo(() => {
        if (!derived || derived.size === 0) return recorded;
        // A derived entry replaces the recorded one only where that one is of another generation.
        const merged = new Map(recorded);
        for (const [k, e] of derived) if (merged.get(k)?.outer.generation !== e.outer.generation) merged.set(k, e);
        return merged;
    }, [recorded, derived]);

    const nested = useMemo(() => new WeakMap<Placement, Placement>(), [entries]);
    const nest = useCallback((p: Placement): Placement => {
        const e = entries.get(drillOfPlacement(p));
        if (!e || e.outer.generation !== p.generation) return p;
        let out = nested.get(p);
        if (!out) { out = nestPlacement(p, e); nested.set(p, out); }
        return out;
    }, [entries, nested]);

    const awaitsBasis = useCallback((p: Placement): boolean => {
        const stale = stack.some((f) => { const e = recorded.get(drillKeyOf(f) ?? ''); return !!e && e.outer.generation !== p.generation; });
        return stale && !(basis && basis.marks.generation === p.generation);
    }, [stack, recorded, basis]);

    const nests = useMemo(() => stack.some((f) => recorded.has(drillKeyOf(f) ?? '')), [stack, recorded]);
    return { entries, add, nest, setBasis, awaitsBasis, nests };
}
