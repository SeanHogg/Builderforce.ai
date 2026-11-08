/**
 * Counting proxies: the unit of WORK for the deterministic profiler. Wall-clock milliseconds vary run to run; the number of
 * times code reads a graph element's property or an array's index does not, so it can gate CI. A {@link WorkMeter} wraps the
 * graph's arrays (index reads counted) and their elements (string-key property reads counted); every read costs one, and
 * `length` / symbols / framework probes (`$$typeof`, `toJSON`, `then`, `constructor`) cost nothing, so the totals track real
 * work and not the test rig. The same proxy is handed back for the same target (WeakMap cache), so identity-keyed Maps and
 * `===` comparisons behave exactly as they do on the raw graph.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';

/** Keys that tooling probes on any object; counting them would measure the harness, not the code under test. */
const PROBES: ReadonlySet<string> = new Set(['$$typeof', 'toJSON', 'constructor', 'then', 'asymmetricMatch', 'nodeType', 'tagName', '@@__IMMUTABLE_ITERABLE__@@']);
const isIndex = (key: string): boolean => key.length > 0 && key.charCodeAt(0) >= 48 && key.charCodeAt(0) <= 57 && String(Number(key) >>> 0) === key;
const isPlainElement = (v: unknown): v is object => typeof v === 'object' && v !== null && !Array.isArray(v);

export class WorkMeter {
    private count = 0;
    private pauses = 0;
    private readonly arrays = new WeakMap<object, object>();
    private readonly elements = new WeakMap<object, object>();
    /** proxy → target, for arrays and elements alike. */
    private readonly targets = new WeakMap<object, object>();
    private readonly elementTargets = new WeakSet<object>();

    constructor(readonly name: string) {}

    /** Property reads on metered elements + index reads on metered arrays, while not paused. */
    get reads(): number { return this.count; }
    get paused(): boolean { return this.pauses > 0; }

    /** Runs `fn` with counting off (test bookkeeping, e.g. the loopback's own clone). Re-entrant. */
    without<T>(fn: () => T): T {
        this.pauses++;
        try { return fn(); } finally { this.pauses--; }
    }

    mark(): number { return this.count; }
    since(mark: number): number { return this.count - mark; }

    /**
     * A proxy over the array (counts numeric-index gets) whose elements are each a counting proxy (counts string-key property
     * gets). Arrays of primitives and tuples: index reads only, since a nested array element is left plain.
     */
    wrapArray<T>(list: readonly T[]): readonly T[] { return this.proxyArray(list, true); }

    /** A new graph with nodes, edges, findings, outline.files metered and outline.links index-metered; everything else shared. */
    wrapGraph(graph: KnowledgeGraph): KnowledgeGraph {
        const g = graph as unknown as Record<string, unknown>;
        const out: Record<string, unknown> = { ...g };
        for (const k of ['nodes', 'edges', 'findings']) if (Array.isArray(g[k])) out[k] = this.wrapArray(g[k] as unknown[]);
        const outline = g.outline as Record<string, unknown> | undefined;
        if (outline) {
            const o: Record<string, unknown> = { ...outline };
            if (Array.isArray(outline.files)) o.files = this.wrapArray(outline.files as unknown[]);
            if (Array.isArray(outline.links)) o.links = this.proxyArray(outline.links as unknown[], false);
            out.outline = o;
        }
        return out as unknown as KnowledgeGraph;
    }

    /** Proxy → its target; anything else unchanged. */
    unwrap<T>(value: T): T {
        if (typeof value !== 'object' || value === null) return value;
        return (this.targets.get(value) ?? value) as T;
    }

    /** True for a metered element (proxy) or the target behind one. */
    isElement(value: unknown): boolean {
        if (typeof value !== 'object' || value === null) return false;
        return this.elementTargets.has(this.targets.get(value) ?? value);
    }

    /**
     * The proxy's TARGET is a fresh mirror array that already holds the element proxies, never the source array: graphs are
     * frozen by contract (`freezeGraph`), and a Proxy `get` over a frozen (non-configurable, non-writable) index must return
     * the target's actual value. So `get` returns `Reflect.get(mirror, …)` untouched and only counts; freezing the proxy later
     * freezes the mirror, which is equally fine. `unwrap` maps the proxy back to the ORIGINAL source array.
     */
    private proxyArray<T>(list: readonly T[], proxyElements: boolean): readonly T[] {
        const known = this.arrays.get(list);
        if (known) return known as readonly T[];
        const mirror = list.map((value) => (proxyElements && isPlainElement(value) ? this.proxyElement(value) : value)) as T[];
        const proxy = new Proxy(mirror, {
            get: (target, key, receiver) => {
                const value = Reflect.get(target, key, receiver);
                if (typeof key === 'string' && isIndex(key) && !this.paused) this.count++;
                return value;
            },
        });
        this.arrays.set(list, proxy);
        this.targets.set(proxy, list);
        return proxy;
    }

    private proxyElement(target: object): object {
        const known = this.elements.get(target);
        if (known) return known;
        const proxy = new Proxy(target, {
            get: (t, key, receiver) => {
                if (typeof key === 'string' && !PROBES.has(key) && !this.paused) this.count++;
                return Reflect.get(t, key, receiver);
            },
        });
        this.elements.set(target, proxy);
        this.targets.set(proxy, target);
        this.elementTargets.add(target);
        return proxy;
    }
}

const MAX_DEPTH = 8;
const isPlain = (v: object): boolean => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };

/**
 * A structured-clone-safe copy SOURCE: metered arrays and elements are replaced by their targets, recursing into plain objects
 * and arrays (not into typed arrays; Map / Set values are unwrapped, their keys kept), depth-limited. Allocation is fine; the
 * walk never counts a read because every proxy is swapped for its target before it is touched, and it runs paused regardless.
 */
export function unwrapDeep<T>(value: T, meters: readonly WorkMeter[]): T {
    const raw = (v: unknown): unknown => { let out = v; for (const m of meters) out = m.unwrap(out); return out; };
    const walk = (v: unknown, depth: number): unknown => {
        const t = raw(v);
        if (typeof t !== 'object' || t === null || depth > MAX_DEPTH || ArrayBuffer.isView(t) || t instanceof ArrayBuffer) return t;
        if (Array.isArray(t)) return t.map((x) => walk(x, depth + 1));
        if (t instanceof Map) return new Map([...t].map(([k, x]) => [k, walk(x, depth + 1)] as const));
        if (t instanceof Set) return new Set([...t].map((x) => walk(x, depth + 1)));
        if (!isPlain(t)) return t;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(t)) out[k] = walk((t as Record<string, unknown>)[k], depth + 1);
        return out;
    };
    const paused = meters.reduce<() => T>((next, m) => () => m.without(next), () => walk(value, 0) as T);
    return paused();
}
