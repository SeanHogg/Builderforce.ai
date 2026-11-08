/** A kind's translation between the components' objects and the wire: `encode` names the graph and builds the request, `decode` maps the reply back onto the caller's own objects. */

import type { KindInput, KindResult } from '../kinds';
import type { GraphId, TaskKind, TaskTable } from '../protocol';
import type { Residency } from '../residency';

export interface Codec<K extends TaskKind> {
    encode(input: KindInput<K>, residency: Residency): { graph: GraphId; req: TaskTable[K]['req'] };
    decode(raw: TaskTable[K]['raw'], input: KindInput<K>): KindResult<K>;
}

/** The elements at `indices` of the caller's array: its own objects, so identity survives the trip. */
export function mapBack<T>(indices: Uint32Array, source: readonly T[]): T[] {
    // A plain loop: `Array.from(typed, fn)` goes through the iterator protocol, ~10x slower at 100k+ elements.
    const out = new Array<T>(indices.length);
    for (let i = 0; i < indices.length; i++) out[i] = source[indices[i]!]!;
    return out;
}
