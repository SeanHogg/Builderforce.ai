import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import type { IncidentIndex } from '../../scene/edgeBudget';
import { mapBack } from './codec';

/**
 * ref → its links, read straight from the worker's flat index array (`edges`, cut by `offsets` per place in `refs`). A ref's
 * list is turned into the caller's own edge objects the first time it is asked for, so receiving a reply costs nothing
 * per ref (a selection reads one or two lists, never all of them).
 */
export class LazyIncident implements IncidentIndex {
    private readonly place = new Map<string, number>();
    private readonly built = new Map<string, KEdge[]>();

    constructor(
        private readonly refs: readonly string[],
        private readonly offsets: Uint32Array,
        private readonly flat: Uint32Array,
        private readonly source: readonly KEdge[],
    ) {
        for (let i = 0; i < refs.length; i++) this.place.set(refs[i]!, i);
    }

    get size(): number { return this.refs.length; }

    has(ref: string): boolean { return this.place.has(ref); }

    keys(): IterableIterator<string> { return this.place.keys(); }

    get(ref: string): KEdge[] | undefined {
        const kept = this.built.get(ref);
        if (kept) return kept;
        const at = this.place.get(ref);
        if (at === undefined) return undefined;
        const list = mapBack(this.flat.subarray(this.offsets[at]!, this.offsets[at + 1]!), this.source);
        this.built.set(ref, list);
        return list;
    }
}
