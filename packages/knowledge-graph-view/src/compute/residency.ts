/**
 * Which graphs the compute context holds, and how the main thread names parts of them.
 *
 * EDIT CONTRACT: GRAPHS ARE IMMUTABLE. The worker holds a copy of each resident graph, and everything here (ids, the
 * element → index caches, the located subsets) is keyed on the identity of the graph and of its arrays. So an edit never
 * changes a graph in place: it produces a NEW graph object with NEW `nodes`/`edges` arrays, which gets a new id and is
 * streamed to the worker afresh. In development the `nodes` and `edges` arrays are frozen when they become resident, so an
 * in-place `push`/`splice`/`sort` throws at the call that does it (see `immutable.ts`).
 *
 * A graph gets an id when it is first used (`graphId`, idempotent and free of worker traffic, so a render may call it); at
 * most {@link MAX_RESIDENT} are held, the least recently used goes. The eviction (and the `drop` it sends the worker) is
 * deferred to a microtask, never done inside the render that asked. A view that draws a SUBSET of a graph (the nodes and
 * edges it was handed) names them with `locate`: as indices into whichever held graph contains them. The subsets are almost
 * always runs of the graph's own arrays (`focusGraph` filters, `lensGraph` filters), so the indices come from one
 * merge-style scan; only a subset that is out of order falls back to an element → index map. A view mounted with arrays
 * that belong to no held graph (a test, a host that draws bare arrays) gets a stand-alone graph made of exactly those arrays.
 */

import type { Finding, KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { FIELDS, indexOfArray, type Field } from './fields';
import { freezeGraph } from './immutable';
import { MAX_RESIDENT } from './store';
import type { GraphId, Refs } from './protocol';

export interface GraphHandle { id: GraphId; graph: KnowledgeGraph; live: boolean }

export interface Parts { nodes?: readonly KNode[]; edges?: readonly KEdge[]; findings?: readonly Finding[] }

export class Residency {
    private readonly held: GraphHandle[] = []; // most recently used first
    private readonly byGraph = new WeakMap<object, GraphHandle>();
    private readonly located = new WeakMap<readonly object[], Map<GraphId, Uint32Array | null>>();
    private readonly tokens = new WeakMap<object, number>();
    private nextId = 1;
    private nextToken = 1;
    private trimming = false;

    constructor(private readonly onEvict: (id: GraphId) => void) {}

    /** The id of `graph`, holding it if it is new. Idempotent. */
    graphId(graph: KnowledgeGraph): GraphId {
        const known = this.byGraph.get(graph);
        if (known?.live) { this.touch(known); return known.id; }
        return this.hold(graph).id;
    }

    handleOf(id: GraphId): GraphHandle | undefined { return this.held.find((h) => h.id === id); }

    /** False once the graph was evicted: a reply that names it is stale. */
    isLive(id: GraphId): boolean { return this.held.some((h) => h.id === id); }

    /** `parts` as indices into one held graph (the most recently used that contains them all). */
    locate(parts: Parts): Refs {
        for (const h of this.held) {
            const refs = this.within(h, parts);
            if (refs) { this.touch(h); return refs; }
        }
        const alone = this.hold({
            scope: { rootId: '', packs: [], digest: '' },
            nodes: (parts.nodes ?? []) as KNode[], edges: (parts.edges ?? []) as KEdge[], findings: (parts.findings ?? []) as Finding[],
            stats: { sources: 0, nodes: parts.nodes?.length ?? 0, edges: parts.edges?.length ?? 0, stale: 0, truncated: false },
        });
        return this.within(alone, parts)!;
    }

    private hold(graph: KnowledgeGraph): GraphHandle {
        freezeGraph(graph);
        const handle: GraphHandle = { id: this.nextId++, graph, live: true };
        this.byGraph.set(graph, handle);
        this.held.unshift(handle);
        if (this.countable() > MAX_RESIDENT) this.scheduleTrim();
        return handle;
    }

    /** Evicts down to the limit in a microtask: the render that held the graph stays free of side effects. */
    private scheduleTrim(): void {
        if (this.trimming) return;
        this.trimming = true;
        queueMicrotask(() => {
            this.trimming = false;
            while (this.countable() > MAX_RESIDENT) {
                const at = this.held.findLastIndex(Residency.counts);
                const [old] = this.held.splice(at, 1);
                old!.live = false;
                this.onEvict(old!.id);
            }
        });
    }

    /** The empty graph holds nothing worth evicting for, so it does not count toward the limit. */
    private static counts(h: GraphHandle): boolean {
        const g = h.graph;
        return g.nodes.length + g.edges.length + g.findings.length > 0;
    }

    private countable(): number { return this.held.filter(Residency.counts).length; }

    private touch(h: GraphHandle): void {
        const at = this.held.indexOf(h);
        if (at > 0) { this.held.splice(at, 1); this.held.unshift(h); }
    }

    private tokenOf(array: object): number {
        let t = this.tokens.get(array);
        if (t === undefined) { t = this.nextToken++; this.tokens.set(array, t); }
        return t;
    }

    private within(h: GraphHandle, parts: Parts): Refs | null {
        const refs: Refs = { graph: h.id, key: '' };
        const key: number[] = [h.id];
        for (const field of FIELDS) {
            const sub = parts[field];
            if (!sub) { key.push(0); continue; }
            const indices = this.indices(h, field, sub);
            if (!indices) return null;
            refs[field] = indices;
            key.push(this.tokenOf(sub));
        }
        refs.key = key.join(':');
        return refs;
    }

    /** Where each element of `sub` sits in `h`'s array, or null when one is not in it. Cached per array and graph. */
    private indices(h: GraphHandle, field: Field, sub: readonly object[]): Uint32Array | null {
        let per = this.located.get(sub);
        if (!per) { per = new Map(); this.located.set(sub, per); }
        if (per.has(h.id)) return per.get(h.id)!;
        const parent = h.graph[field] as readonly object[];
        const out = new Uint32Array(sub.length);
        let ok = true;
        if (sub === parent) {
            for (let i = 0; i < out.length; i++) out[i] = i;
        } else {
            // A run of the parent's own elements, in order: one forward scan.
            let p = 0;
            for (let i = 0; i < sub.length && ok; i++) {
                while (p < parent.length && parent[p] !== sub[i]) p++;
                if (p >= parent.length) ok = false; else out[i] = p++;
            }
            if (!ok) {
                // Out of order: look each one up.
                const map = indexOfArray(parent);
                ok = true;
                for (let i = 0; i < sub.length && ok; i++) {
                    const at = map.get(sub[i]!);
                    if (at === undefined) ok = false; else out[i] = at;
                }
            }
        }
        const found = ok ? out : null;
        per.set(h.id, found);
        return found;
    }
}
