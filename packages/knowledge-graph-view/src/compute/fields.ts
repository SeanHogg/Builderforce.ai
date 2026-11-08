/**
 * The three arrays of a graph the compute context names by index, and the ONE helper that maps elements to their place in
 * one (the residency, the worker store, the edge ranking and the layout packing all need it).
 */

import type { Finding, KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';

export type Field = 'nodes' | 'edges' | 'findings';
export const FIELDS: readonly Field[] = ['nodes', 'edges', 'findings'];
export type Element = KNode | KEdge | Finding;

/** Each item's key → its place in `items` (the last wins on a repeated key). `keyOf` defaults to the item itself. */
export function buildIndex<T, K = T>(items: readonly T[], keyOf?: (item: T) => K): Map<K, number> {
    const out = new Map<K, number>();
    for (let i = 0; i < items.length; i++) out.set(keyOf ? keyOf(items[i]!) : (items[i] as unknown as K), i);
    return out;
}

const held = new WeakMap<readonly object[], Map<object, number>>();

/**
 * element → its place in `items`, built once per array. Safe to cache because graphs are immutable (an edit makes a new
 * array; see `residency.ts`), so an array never changes under its map.
 */
export function indexOfArray<T extends object>(items: readonly T[]): Map<T, number> {
    let map = held.get(items);
    if (!map) { map = buildIndex<object>(items); held.set(items, map); }
    return map as Map<T, number>;
}
