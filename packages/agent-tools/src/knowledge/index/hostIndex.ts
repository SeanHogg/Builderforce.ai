/**
 * One root's knowledge index on a host (docs/design/deterministic-knowledge-index.md,
 * "Where it runs", "Sequence") — the editor and on-prem both hold theirs through this,
 * with their own files, embedders and idle scheduler injected:
 *
 *   - LAZY: nothing is read until the first call; then the stored index is loaded bound to
 *     the warm embedder (or none), and the host's `seed` runs in the background;
 *   - UPSERT: `toCards(graph)` → `upsert` (unchanged hashes are skipped by the engine);
 *     the graph's edges are kept for one-hop recall expansion;
 *   - IDLE: a changed embedder fingerprint (a warm model appeared, or another one) ⇒
 *     rebind, and `compact()` re-embeds every card — the engine never mixes fingerprints;
 *     churn over 10% since the last compaction ⇒ `compact()`; then persist when the digest
 *     moved (atomic). Queries never wait for any of it.
 */

import {
    createKnowledgeIndex, loadKnowledgeIndex, pathOfRef, toCards,
    type EmbedderPort, type GraphNeighbours, type IndexDoc, type IndexHit, type IndexParams, type KnowledgeGraph, type SimilarPair,
} from '@seanhogg/builderforce-memory/knowledge';
import type { HitMeta, HostKnowledgeIndexCore, IdleScheduler, KnowledgeIndexFiles, Recall, RecalledHit } from './contract.js';
import { readStoredIndex, writeIndexAtomic, type LoadedIndex } from './persistence.js';

/** Churn share since the last compaction that triggers the next one. */
export const COMPACT_CHURN = 0.1;
/** The Duplication lens's default near-duplicate floor (design: "Consumers"). */
export const NEAR_DUPLICATE_MIN = 0.92;
/** Most pairs one similar-pairs pass returns. */
export const NEAR_DUPLICATE_MAX_PAIRS = 2_000;

export interface HostIndexOptions {
    rootId: string;
    /** The index file; absent (or no `files`) ⇒ in memory only. */
    path?: string;
    files?: KnowledgeIndexFiles;
    /** The warm embedder right now (`resolveWarmEmbedder`); undefined ⇒ exact + lexical only. */
    embedder?: () => Promise<EmbedderPort | undefined>;
    idle: IdleScheduler;
    /** Fills the root on first use (the workspace repository: the code pack). Runs in the background. */
    seed?: (index: HostKnowledgeIndexCore) => Promise<void>;
    params?: Partial<IndexParams>;
    onError?: (e: unknown) => void;
}

type Edge = { id: string; kind: string; weight: number };
const clamp01 = (n: number): number => (n > 1 ? 1 : n > 0 ? n : 0);
const prefixOf = (id: string): string => id.slice(0, id.indexOf(':') + 1);

class HostIndex implements HostKnowledgeIndexCore {
    private index: LoadedIndex | undefined;
    private bound: string | undefined;
    private loading: Promise<LoadedIndex> | undefined;
    private persisted: string | undefined;
    private churn = 0;
    private chain: Promise<unknown> = Promise.resolve();
    private readonly hashes = new Map<string, string>();
    private readonly meta = new Map<string, HitMeta>();
    private readonly adjacency = new Map<string, Edge[]>();
    private nearDup: { digest: string; pairs: SimilarPair[] } | undefined;

    constructor(private readonly o: HostIndexOptions) {}

    get rootId(): string {
        return this.o.rootId;
    }

    private ready(): Promise<LoadedIndex> {
        return (this.loading ??= this.load());
    }

    private async load(): Promise<LoadedIndex> {
        const embedder = await this.warmEmbedder();
        const stored = this.o.path && this.o.files ? await readStoredIndex(this.o.files, this.o.path, embedder) : undefined;
        const index = stored ?? createKnowledgeIndex({ ...(embedder ? { embedder } : {}), ...(this.o.params ? { params: this.o.params } : {}) });
        this.index = index;
        this.bound = embedder?.fingerprint;
        if (stored) this.persisted = index.digest();
        if (embedder && index.size() > 0 && !index.tiers().includes('dense')) this.scheduleIdle();
        if (this.o.seed) void this.o.seed(this).catch((e: unknown) => this.o.onError?.(e));
        return index;
    }

    private async warmEmbedder(): Promise<EmbedderPort | undefined> {
        return this.o.embedder ? this.o.embedder().catch(() => undefined) : undefined;
    }

    /** Mutations and the idle pass run one at a time (the idle pass may swap the index). */
    private exclusive<T>(work: () => Promise<T>): Promise<T> {
        const run = this.chain.then(work, work);
        this.chain = run.catch(() => undefined);
        return run;
    }

    private scheduleIdle(): void {
        this.o.idle(() => this.flush());
    }

    /** A query noticed the warm embedder differs from the bound one: re-embed on idle. */
    private async noticeEmbedder(): Promise<void> {
        if (!this.o.embedder) return;
        const now = await this.warmEmbedder();
        if (now?.fingerprint !== this.bound && (now || this.bound)) this.scheduleIdle();
    }

    async search(q: string, k = 10): Promise<IndexHit[]> {
        const index = await this.ready();
        void this.noticeEmbedder();
        return index.search(q, { k });
    }

    async recall(q: string, opts: { k?: number; hops?: 1 | 2 } = {}): Promise<Recall> {
        const k = opts.k ?? 8;
        const index = await this.ready();
        void this.noticeEmbedder();
        const hits = await index.search(q, { k });
        const own = new Set(hits.map((h) => h.id));
        const expanded = index.expand(hits, this.neighbours, { hops: opts.hops ?? 1 }).slice(0, k * 2);
        const out: RecalledHit[] = expanded.map((h) => {
            const path = pathOfRef(h.id);
            const meta = this.meta.get(h.id);
            return { ...h, ...(path ? { path } : {}), ...(meta ? { meta } : {}), ...(own.has(h.id) ? {} : { expanded: true }) };
        });
        return { hits: out, tiers: index.tiers(), digest: index.digest() };
    }

    private readonly neighbours: GraphNeighbours = {
        neighbours: (id, edgeKinds) => {
            const all = this.adjacency.get(id) ?? [];
            return edgeKinds ? all.filter((e) => edgeKinds.includes(e.kind)) : all;
        },
    };

    async similar(ids: string[]): Promise<SimilarPair[]> {
        const index = await this.ready();
        const wanted = new Set(ids);
        const out: SimilarPair[] = [];
        for (const idPrefix of [...new Set(ids.map(prefixOf))].sort()) {
            for (const p of index.similarPairs({ minSimilarity: NEAR_DUPLICATE_MIN, maxPairs: NEAR_DUPLICATE_MAX_PAIRS, ...(idPrefix ? { idPrefix } : {}) })) {
                if (wanted.has(p.a) && wanted.has(p.b)) out.push(p);
            }
        }
        return out.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
    }

    nearDuplicates(): SimilarPair[] {
        const index = this.index;
        if (!index) {
            void this.ready();
            return [];
        }
        const digest = index.digest();
        if (this.nearDup?.digest !== digest) {
            this.nearDup = { digest, pairs: index.similarPairs({ minSimilarity: NEAR_DUPLICATE_MIN, maxPairs: NEAR_DUPLICATE_MAX_PAIRS, idPrefix: 'src:' }) };
        }
        return this.nearDup.pairs;
    }

    upsertFromGraph(g: KnowledgeGraph): Promise<void> {
        return this.upsertGraph(g);
    }

    async upsertGraph(g: KnowledgeGraph, extraKeys?: ReadonlyMap<string, readonly string[]>): Promise<void> {
        await this.ready();
        await this.exclusive(async () => {
            const cards: IndexDoc[] = toCards(g).map((c) => {
                const extra = extraKeys?.get(c.id);
                return extra?.length ? { ...c, keys: [...new Set([...(c.keys ?? []), ...extra])] } : c;
            });
            let changed = 0;
            for (const c of cards) {
                if (this.hashes.get(c.id) !== c.hash) changed++;
                this.hashes.set(c.id, c.hash!);
            }
            await this.index!.upsert(cards);
            const textOf = new Map(cards.map((c) => [c.id, c.text] as const));
            for (const n of g.nodes) {
                this.meta.set(n.ref, {
                    kind: n.kind, label: n.label,
                    ...(n.partition ? { partition: n.partition } : {}),
                    ...(textOf.has(n.ref) ? { text: textOf.get(n.ref)! } : {}),
                });
                this.adjacency.delete(n.ref);
            }
            for (const e of g.edges) {
                const weight = clamp01(e.weight);
                if (weight === 0) continue;
                this.link(e.from, { id: e.to, kind: e.kind, weight });
                this.link(e.to, { id: e.from, kind: e.kind, weight });
            }
            this.churn += changed;
        });
        this.scheduleIdle();
    }

    private link(from: string, edge: Edge): void {
        const list = this.adjacency.get(from) ?? [];
        if (!list.some((e) => e.id === edge.id && e.kind === edge.kind)) list.push(edge);
        this.adjacency.set(from, list);
    }

    remove(ids: string[]): void {
        void this.ready().then(() => this.exclusive(async () => {
            this.index!.remove(ids);
            for (const id of ids) {
                this.hashes.delete(id);
                this.meta.delete(id);
                this.adjacency.delete(id);
            }
            this.churn += ids.length;
        })).then(() => this.scheduleIdle(), (e: unknown) => this.o.onError?.(e));
    }

    async digest(): Promise<string> {
        return (await this.ready()).digest();
    }

    async size(): Promise<number> {
        return (await this.ready()).size();
    }

    async flush(): Promise<void> {
        await this.ready();
        await this.exclusive(() => this.idlePass());
    }

    private async idlePass(): Promise<void> {
        const embedder = await this.warmEmbedder();
        let index = this.index!;
        if (embedder?.fingerprint !== this.bound) {
            // Rebind: the stored state under the embedder warm now. A different
            // fingerprint leaves the dense tier absent until the compaction below.
            index = this.index = loadKnowledgeIndex(index.serialize(), embedder);
            this.bound = embedder?.fingerprint;
        }
        const size = index.size();
        const mismatch = !!embedder && size > 0 && !index.tiers().includes('dense');
        if (embedder && size > 0 && (mismatch || this.churn > size * COMPACT_CHURN)) {
            await index.compact();
            this.churn = 0;
        }
        const digest = index.digest();
        if (digest === this.persisted || !this.o.path || !this.o.files) return;
        await writeIndexAtomic(this.o.files, this.o.path, index.serialize(), digest);
        this.persisted = digest;
    }
}

/** One root's index over the host's ports. The host keeps one per root id. */
export function createHostKnowledgeIndex(options: HostIndexOptions): HostKnowledgeIndexCore {
    return new HostIndex(options);
}
