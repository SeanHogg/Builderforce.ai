import { describe, expect, it } from 'vitest';
import type { Placement } from '../types';
import { deriveNestEntries, nestEntryOf, nestPlacement, slotInPlacement, type NestBasis, type NestEntry } from './nest';

/** A placement with only what nesting reads: slots at (x, 0, z) with a scale, in a 10 x 10 box. */
function placementOf(generation: number, drill: string, slots: ReadonlyArray<readonly [number, number, number]>, append?: Placement['append']): Placement {
    const n = slots.length;
    const position = new Float32Array(n * 3), scale = new Float32Array(n);
    slots.forEach(([x, z, s], i) => { position[i * 3] = x; position[i * 3 + 2] = z; scale[i] = s; });
    return {
        generation, cacheKey: `k|map|${drill}`, position, scale, extrude: new Float32Array(n), links: [], planes: [], captions: [], labels: [],
        bounds: { min: [0, 0, 0], max: [10, 0, 10] }, rig: {}, a11y: [], ...(append ? { append } : {}),
    } as unknown as Placement;
}

const marks = (generation: number, keys: string[]) => ({ generation, keys });
const stale = (drill: string): NestEntry => ({ drill, centre: [0, 0, 0], diameter: 1, outer: placementOf(1, '', [[0, 0, 1]]) });

describe('slotInPlacement', () => {
    it('finds a MarkSet slot, then a slot the placement appended, else -1', () => {
        const p = placementOf(2, 'class:f', [[0, 0, 1]], { base: 3, keys: ['node:f#a', 'node:f#b'] } as Placement['append']);
        expect(slotInPlacement(marks(2, ['st:p', 'node:f', 'x']), p, 'node:f')).toBe(1);
        expect(slotInPlacement(marks(2, ['st:p', 'node:f', 'x']), p, 'node:f#b')).toBe(4);
        expect(slotInPlacement(marks(2, ['st:p']), p, 'node:nope')).toBe(-1);
    });
});

describe('deriveNestEntries', () => {
    it('re-derives the entry of a package frame from the new generation\'s world placement (the slot of the NEW marks)', () => {
        const world = placementOf(2, '', [[1, 1, 1], [4, 6, 2]]);
        const basis: NestBasis = { marks: marks(2, ['st:other', 'st:p1']), levels: [world] };
        const out = deriveNestEntries([{ level: 'package', ref: 'p1' }], new Map([['package:p1', stale('package:p1')]]), basis);
        const e = out.get('package:p1')!;
        expect(e.centre).toEqual([4, 0, 6]);
        expect(e.diameter).toBe(4);
        expect(e.outer).toBe(world);
    });

    it('derives the whole chain: a class frame is looked up in the package level nested into its own entry', () => {
        const world = placementOf(2, '', [[4, 6, 2]]);
        // Slot 0 is the package's own mark (hidden inside its level), slot 1 the file the class frame is entered from.
        const level = placementOf(2, 'package:p1', [[0, 0, 0], [5, 5, 1]]);
        const basis: NestBasis = { marks: marks(2, ['st:p1', 'node:f']), levels: [world, level] };
        const stack = [{ level: 'package', ref: 'p1' }, { level: 'class', ref: 'f' }] as const;
        const out = deriveNestEntries(stack, new Map([['package:p1', stale('package:p1')], ['class:f', stale('class:f')]]), basis);
        const top = nestEntryOf(world, 0, 'package:p1')!;
        const nested = nestPlacement(level, top);
        const inner = out.get('class:f')!;
        expect(inner.outer.generation).toBe(2);
        expect(inner.centre).toEqual([nested.position[3], nested.position[4], nested.position[5]]);
        expect(inner.diameter).toBe(2 * nested.scale[1]!);
    });

    it('derives nothing from a basis whose MarkSet and placements are of different generations', () => {
        const basis: NestBasis = { marks: marks(3, ['st:p1']), levels: [placementOf(2, '', [[4, 6, 2]])] };
        expect(deriveNestEntries([{ level: 'package', ref: 'p1' }], new Map([['package:p1', stale('package:p1')]]), basis).size).toBe(0);
    });

    it('derives only frames the zoom entered, and stops where the chain cannot go on', () => {
        const world = placementOf(2, '', [[4, 6, 2]]);
        const basis: NestBasis = { marks: marks(2, ['st:p1']), levels: [world] };
        expect(deriveNestEntries([{ level: 'package', ref: 'p1' }], new Map(), basis).size).toBe(0);
        // The mark is not on the map (or not drawn): nothing to nest into.
        const missing: NestBasis = { marks: marks(2, ['st:other']), levels: [world] };
        expect(deriveNestEntries([{ level: 'package', ref: 'p1' }], new Map([['package:p1', stale('package:p1')]]), missing).size).toBe(0);
    });
});
