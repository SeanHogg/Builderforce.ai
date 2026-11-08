/**
 * The ONE memo for pure readings of a graph: computed once per anchor object (an edges array, a graph) and handed back
 * to every consumer, so the Insights panel and the partition matrix, or the three edge consumers, never repeat the same
 * pass. The anchor is held weakly: the memo dies with the graph it was computed from. `tag` is whatever else the result
 * depends on besides the anchor's identity (e.g. the nodes array next to an edges array); a different tag recomputes.
 * Results are shared, so they must be treated as read-only.
 *
 * CONTRACT: graphs are IMMUTABLE. The memo keys on object identity, so an edit must produce NEW nodes / edges arrays and
 * never mutate one in place (an in-place change would keep serving the stale result). In development the shared results are
 * frozen (`devFreeze`) so a consumer that mutates one throws instead of silently corrupting every other reader.
 */

import { isDevBuild } from './devBuild';

export function weakMemo<A, V>(compute: (input: A) => V, anchor: (input: A) => object, tag: (input: A) => unknown = () => undefined): (input: A) => V {
    const held = new WeakMap<object, { tag: unknown; value: V }>();
    return (input) => {
        const key = anchor(input), t = tag(input);
        const hit = held.get(key);
        if (hit && hit.tag === t) return hit.value;
        const value = compute(input);
        held.set(key, { tag: t, value });
        return value;
    };
}


/** In development only, freezes a shared result (shallowly) so a consumer that mutates it throws; returns it unchanged in production. */
export function devFreeze<T extends object>(value: T): T {
    return isDevBuild() ? Object.freeze(value) : value;
}
