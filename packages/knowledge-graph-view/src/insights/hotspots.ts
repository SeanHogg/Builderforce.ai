/**
 * Fan-in and fan-out hotspots from a graph's edges, in ONE pass over them: every ref becomes a small integer, a distinct
 * (from, to) pair is one number in a Set (two edge kinds between the same pair count once), and the degrees are typed
 * arrays. Only the few refs that make the top list get their neighbour lists, found by one more pass over the distinct pairs.
 */

import type { KEdge } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../order';

export interface Hotspot { id: string; value: number; refs: string[] }

/** The pair key's multiplier: refs are numbered from 0, far below this. */
const SPAN = 2 ** 26;

export interface Hotspots { fanIn: Hotspot[]; fanOut: Hotspot[] }

/** The `limit` refs with the most distinct neighbours each way, value descending then by ref; `kinds` are the edge kinds that count. */
export function hotspotsOf(edges: readonly KEdge[], kinds: ReadonlySet<string>, limit: number): Hotspots {
    const ids = new Map<string, number>();
    const names: string[] = [];
    const intern = (ref: string): number => {
        let at = ids.get(ref);
        if (at === undefined) { at = names.length; ids.set(ref, at); names.push(ref); }
        return at;
    };
    const pairs = new Set<number>();
    const from: number[] = [], to: number[] = [];
    for (const e of edges) {
        if (e.from === e.to || !kinds.has(e.kind)) continue;
        const a = intern(e.from), b = intern(e.to);
        const key = a * SPAN + b;
        if (pairs.has(key)) continue;
        pairs.add(key);
        from.push(a); to.push(b);
    }
    const inDegree = new Int32Array(names.length), outDegree = new Int32Array(names.length);
    for (let k = 0; k < from.length; k++) { outDegree[from[k]!]!++; inDegree[to[k]!]!++; }

    const top = (degree: Int32Array): number[] => {
        const present: number[] = [];
        for (let i = 0; i < degree.length; i++) if (degree[i]! > 0) present.push(i);
        return present.sort((a, b) => degree[b]! - degree[a]! || cmp(names[a]!, names[b]!)).slice(0, limit);
    };
    const named = (chosen: readonly number[], degree: Int32Array, key: number[], other: number[]): Hotspot[] => {
        const wanted = new Map(chosen.map((id) => [id, [] as string[]] as const));
        for (let k = 0; k < key.length; k++) wanted.get(key[k]!)?.push(names[other[k]!]!);
        return chosen.map((id) => ({ id: names[id]!, value: degree[id]!, refs: wanted.get(id)!.sort(cmp) }));
    };
    return {
        fanIn: named(top(inDegree), inDegree, to, from),
        fanOut: named(top(outDegree), outDegree, from, to),
    };
}
