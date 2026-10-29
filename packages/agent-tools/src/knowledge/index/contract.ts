/**
 * The HOST knowledge index's contract (docs/design/deterministic-knowledge-index.md,
 * "Where it runs") — what the editor and the on-prem runtime hold per reviewed root over
 * memory's deterministic engine (`@seanhogg/builderforce-memory/knowledge`):
 *
 *   - {@link HostKnowledgeIndex}: the PINNED surface the knowledge host (review runner,
 *     graph panel, stores) imports — search, near-duplicates, upsert from a graph;
 *   - {@link HostKnowledgeIndexCore}: that plus what this package's own consumers read
 *     (recall with one-hop expansion for `knowledge.ask` and the context pack);
 *   - the host's ports: its files ({@link KnowledgeIndexFiles}), its warm embedders
 *     ({@link WarmEmbedderSource}) and its idle scheduler.
 *
 * Pure: no fs, no model. Each host injects its own.
 */

import type { EmbedderPort, IndexHit, IndexTier, KnowledgeGraph, SimilarPair } from '@seanhogg/builderforce-memory/knowledge';

/** The pinned surface (clients/vscode/src/knowledge/index/hostKnowledgeIndex.ts re-exports it). */
export interface HostKnowledgeIndex {
    search(q: string, k?: number): Promise<IndexHit[]>;
    /**
     * Near-duplicate pairs touching `ids` (claims/entities): with what the index holds and
     * among themselves, deterministic. `texts` gives the text of ids not indexed yet (a
     * review's new claims), so they need not be indexed first.
     */
    similar(ids: string[], texts?: ReadonlyMap<string, string>): Promise<SimilarPair[]>;
    /** `src:` pairs, for `buildGraph`'s `input.nearDuplicates`. */
    nearDuplicates(): SimilarPair[];
    /** `toCards(g)` → upsert → compact when churn > 10% (on idle). */
    upsertFromGraph(g: KnowledgeGraph): Promise<void>;
}

/** What a hit is, for rendering: from the graph node it was carded from. */
export interface HitMeta {
    kind?: string;
    partition?: string;
    label?: string;
    /** The card text, for a short excerpt. */
    text?: string;
}

/** A hit with what the renderer shows; `path` is root-relative when the ref is a `src:` one. */
export interface RecalledHit extends IndexHit {
    path?: string;
    meta?: HitMeta;
    /** True when the hit came from one-hop graph expansion, not the search itself. */
    expanded?: boolean;
}

export interface Recall {
    /** The search's own hits, then their one-hop neighbours, in total order. */
    hits: RecalledHit[];
    /** The tiers that could run (dense only with a warm embedder of the stored fingerprint). */
    tiers: IndexTier[];
    digest: string;
}

export interface HostKnowledgeIndexCore extends HostKnowledgeIndex {
    readonly rootId: string;
    /** `search` plus one hop of graph neighbours (the knowledge graph's edges). */
    recall(q: string, opts?: { k?: number; hops?: 1 | 2 }): Promise<Recall>;
    /** Upsert a graph's cards with extra exact keys per card (the code pack's exported symbols). */
    upsertGraph(g: KnowledgeGraph, extraKeys?: ReadonlyMap<string, readonly string[]>): Promise<void>;
    /** Forget cards (a deleted file). */
    remove(ids: string[]): void;
    digest(): Promise<string>;
    size(): Promise<number>;
    /** Run the idle pass now (re-embed on a fingerprint change, compact on churn, persist). Tests and shutdown. */
    flush(): Promise<void>;
}

/** The host's files: the workspace fs on the editor, the disk on-prem. Paths are absolute. */
export interface KnowledgeIndexFiles {
    /** The file's bytes, or undefined when it does not exist. */
    read(path: string): Promise<Uint8Array | undefined>;
    write(path: string, bytes: Uint8Array): Promise<void>;
    /** Replaces `to` atomically. */
    rename(from: string, to: string): Promise<void>;
    mkdir(dir: string): Promise<void>;
    remove?(path: string): Promise<void>;
}

/**
 * One embedder the host ALREADY runs. `warm()` is judged as the prefetch logprob port
 * judges it: a model is resident now — nothing is loaded on a request's path (a model the
 * host has on disk is loaded on idle first, `idleLoadedEmbedder`).
 */
export interface WarmEmbedderSource {
    id: 'synapse' | 'evermind' | 'ollama';
    warm(): boolean;
    /** The port over the resident model; undefined when it went cold since `warm()`. */
    port(): EmbedderPort | undefined | Promise<EmbedderPort | undefined>;
}

/** Runs `task` once the host is idle; repeated calls before it runs coalesce. */
export type IdleScheduler = (task: () => Promise<void>) => void;
