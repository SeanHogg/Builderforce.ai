/**
 * Positions on the wire, in ONE place for both directions: the worker packs a layout it computed, the main thread packs a
 * layout it already holds to ask for edges drawn against it. A position is addressed by its node's place in the subset the
 * request names, so no ref string crosses and the doubles survive exactly.
 */

import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import type { PlacedWire } from './protocol';

const placeOf = new WeakMap<readonly KNode[], Map<string, number>>();

/** ref → place in `nodes`, built once per array. */
function placesIn(nodes: readonly KNode[]): Map<string, number> {
    let held = placeOf.get(nodes);
    if (!held) { held = new Map(nodes.map((n, i) => [n.ref as string, i] as const)); placeOf.set(nodes, held); }
    return held;
}

/** The positions of `nodes` as a wire block (a position for a ref that is not in `nodes` is left out). */
export function packPlaced(nodes: readonly KNode[], positions: ReadonlyMap<string, readonly number[]>, dims: 2 | 3): PlacedWire {
    const places = placesIn(nodes);
    const order: number[] = [];
    const coords: number[] = [];
    for (const [ref, at] of positions) {
        const place = places.get(ref);
        if (place === undefined) continue;
        order.push(place);
        for (let d = 0; d < dims; d++) coords.push(at[d]!);
    }
    return { dims, order: Uint32Array.from(order), coords: Float64Array.from(coords) };
}

/** The wire block as a ref → position map, in the order it was packed. */
export function unpackPlaced(nodes: readonly KNode[], wire: PlacedWire): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (let i = 0; i < wire.order.length; i++) {
        const node = nodes[wire.order[i]!];
        if (!node) continue;
        out.set(node.ref, Array.from(wire.coords.subarray(i * wire.dims, (i + 1) * wire.dims)));
    }
    return out;
}
