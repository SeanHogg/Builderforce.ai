/**
 * The graphs a compute context holds RESIDENT, and what it remembers about them. The worker owns one; the in-process
 * fallback (and the small synchronous reads) own another: the handlers in `tasks/` take a store and cannot tell which.
 *
 * A graph arrives in slices (`begin`, `chunk`*, `end`) and is reassembled here; the in-process store simply adopts the
 * main thread's own graph. Everything derived (index maps, a ranking, a subset's arrays) is memoised under a key that starts
 * with the graph's id, so dropping a graph forgets all of it.
 */

import type { Finding, KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { GraphId, LoadField, Refs } from './protocol';

/** Graphs held at once: the one on screen, its Before/After twin and a stand-alone array set (a view mounted without a graph). */
export const MAX_RESIDENT = 3;
/** Derived values kept at once, oldest out. */
const MAX_MEMO = 12;

type Field = 'nodes' | 'edges' | 'findings';
type Element = KNode | KEdge | Finding;

interface Building {
    shell: object;
    outline: Record<string, unknown> | null;
    nodes: KNode[];
    edges: KEdge[];
    findings: Finding[];
    files: unknown[];
    links: Array<[number, number, number, number]>;
}

export interface Subset { nodes: KNode[]; edges: KEdge[]; findings: Finding[] }

export class ComputeStore {
    private readonly resident = new Map<GraphId, KnowledgeGraph>();
    private readonly building = new Map<GraphId, Building>();
    private readonly memo = new Map<string, unknown>();

    /** The in-process store holds the main thread's own graph: nothing is copied. */
    adopt(id: GraphId, graph: KnowledgeGraph): void {
        this.resident.delete(id);
        this.resident.set(id, graph);
        this.evict();
    }

    begin(id: GraphId, shell: object, outline: object | null): void {
        this.building.set(id, { shell, outline: outline as Record<string, unknown> | null, nodes: [], edges: [], findings: [], files: [], links: [] });
    }

    chunk(id: GraphId, field: LoadField, items: readonly unknown[] | Uint32Array): void {
        const b = this.building.get(id);
        if (!b) return;
        if (field === 'outlineLinks') {
            const flat = items as Uint32Array;
            for (let i = 0; i + 3 < flat.length; i += 4) b.links.push([flat[i]!, flat[i + 1]!, flat[i + 2]!, flat[i + 3]!]);
            return;
        }
        const list = items as readonly unknown[];
        const into = field === 'outlineFiles' ? b.files : b[field] as unknown[];
        for (const item of list) into.push(item);
    }

    end(id: GraphId): void {
        const b = this.building.get(id);
        if (!b) return;
        this.building.delete(id);
        const graph = {
            ...b.shell, nodes: b.nodes, edges: b.edges, findings: b.findings,
            ...(b.outline ? { outline: { ...b.outline, files: b.files, links: b.links } } : {}),
        } as unknown as KnowledgeGraph;
        this.adopt(id, graph);
    }

    drop(id: GraphId): void {
        this.resident.delete(id);
        this.building.delete(id);
        const prefix = `${id}:`;
        for (const key of [...this.memo.keys()]) if (key.startsWith(prefix)) this.memo.delete(key);
    }

    has(id: GraphId): boolean { return this.resident.has(id); }

    graph(id: GraphId): KnowledgeGraph {
        const g = this.resident.get(id);
        if (!g) throw new Error(`compute: graph ${id} is not resident`);
        return g;
    }

    /** The elements at `indices` of one of a resident graph's arrays, in that order. */
    pick<T extends Element>(id: GraphId, field: Field, indices: Uint32Array | undefined): T[] {
        if (!indices) return [];
        const source = this.graph(id)[field] as unknown as T[];
        return Array.from(indices, (i) => source[i]!);
    }

    /** The arrays a request names, built once per key. */
    subset(refs: Refs): Subset {
        return this.remember(`${refs.key}|subset`, () => ({
            nodes: this.pick<KNode>(refs.graph, 'nodes', refs.nodes),
            edges: this.pick<KEdge>(refs.graph, 'edges', refs.edges),
            findings: this.pick<Finding>(refs.graph, 'findings', refs.findings),
        }));
    }

    /** element → its place in the graph's array, built once per graph and field (to name elements a pure function handed back). */
    indexOf(id: GraphId, field: Field): Map<Element, number> {
        return this.remember(`${id}:index:${field}`, () => new Map((this.graph(id)[field] as Element[]).map((e, i) => [e, i] as const)));
    }

    /** What was kept under `key`, if anything. */
    recall<T>(key: string): T | undefined {
        if (!this.memo.has(key)) return undefined;
        const hit = this.memo.get(key) as T;
        this.memo.delete(key); // most recently used goes last
        this.memo.set(key, hit);
        return hit;
    }

    /** Keeps `value` under `key` (which must start with the graph's id, `${id}:…`) and returns it. */
    keep<T>(key: string, value: T): T {
        this.memo.delete(key);
        this.memo.set(key, value);
        while (this.memo.size > MAX_MEMO) this.memo.delete(this.memo.keys().next().value as string);
        return value;
    }

    /** `make()` once per key. */
    remember<T>(key: string, make: () => T): T {
        return this.recall<T>(key) ?? this.keep(key, make());
    }

    private evict(): void {
        while (this.resident.size > MAX_RESIDENT + 1) this.drop(this.resident.keys().next().value as GraphId);
    }
}
