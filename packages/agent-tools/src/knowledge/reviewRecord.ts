/**
 * knowledge/reviewRecord.ts - what a root's LAST review left behind, kept for the Sync panel
 * (PRD 38, Option B+ Contract 4/5): the plan's counts and everything that was skipped, so
 * "nothing is dropped without a trace" holds after the review ended, and after a reload.
 * Shared by every host; each supplies only where the record is persisted.
 *
 *   counts   the plan's files and docs (the docs pack's files are the docs; skipped files
 *            are not counted);
 *   skipped  the plan's skips, skipped folders and coverage files;
 *   absent   no record = "unknown", never "none".
 *
 * Pure and Worker-safe.
 */

import type { KnowledgeGraph, ReviewPlan } from '@seanhogg/builderforce-memory/knowledge';

export interface SkippedEntry {
    path: string;
    /** Encoded size; absent where the skip does not know it (the plan carries none). */
    bytes?: number;
    reason: string;
}

export interface ReviewRecord {
    /** `edges` = the repo map's import edges when a review of this root measured them; absent = not measured. */
    counts: { files: number; docs: number; edges?: number };
    skipped: SkippedEntry[];
    at: string;
}

export interface ReviewRecordStore {
    get(rootId: string): ReviewRecord | undefined;
    set(rootId: string, record: ReviewRecord): void;
}

/** Where a host keeps records between processes (workspaceState, sessionStorage); every call may throw or be absent. */
export interface RecordPersistence {
    read(key: string): unknown;
    write(key: string, value: ReviewRecord): void;
}

const KEY = 'builderforce.knowledge.review.';

const isRecord = (value: unknown): value is ReviewRecord => {
    const v = value as Partial<ReviewRecord> | null | undefined;
    return !!v && Array.isArray(v.skipped) && !!v.counts && typeof v.counts.files === 'number' && typeof v.counts.docs === 'number';
};

/** A record store: this process's map, backed by the host's persistence when it has one. */
export function reviewRecordStore(persistence?: RecordPersistence): ReviewRecordStore {
    const held = new Map<string, ReviewRecord>();
    return {
        get(rootId) {
            const mine = held.get(rootId);
            if (mine) return mine;
            try {
                const stored = persistence?.read(KEY + rootId);
                return isRecord(stored) ? stored : undefined;
            } catch { return undefined; }
        },
        set(rootId, record) {
            held.set(rootId, record);
            try { persistence?.write(KEY + rootId, record); } catch { /* A host that cannot persist still answers from memory. */ }
        },
    };
}

/**
 * Retired: the knowledge client no longer lists skipped uploads (every host uploads through the ONE pack, whose refusals
 * are typed errors, never silent skips). Kept only so hosts still passing `client` compile; it is ignored.
 */
export type SkippedUploads = unknown;

export interface ReviewRecorder {
    /** The plan: its skipped files and the per-pack counts. */
    planned(plan: Pick<ReviewPlan, 'skipped' | 'byPack'>): void;
    /** Coverage files the signals read skipped (too large, stale). */
    signals(skipped: readonly { path: string; reason: string }[]): void;
    /** The repo map's edge count, when this review built the map (a cached analysis builds none). */
    edges(count: number): void;
    /** A review starts: uploads skipped from here on belong to it. */
    begin(): void;
    /** A review ended: record counts and skips. */
    finish(): void;
}

export function createReviewRecorder(args: {
    rootId: string;
    store: ReviewRecordStore;
    /** Ignored (see {@link SkippedUploads}). */
    client?: SkippedUploads;
    folders?(): readonly { path: string; reason: string }[];
    now?(): string;
}): ReviewRecorder {
    let counts = { files: 0, docs: 0 };
    let edges: number | undefined;
    let planSkips: SkippedEntry[] = [];
    let signalSkips: SkippedEntry[] = [];
    return {
        planned(plan) {
            counts = { files: plan.byPack.code ?? 0, docs: plan.byPack.docs ?? 0 };
            planSkips = plan.skipped.filter((s) => s.reason !== 'ignored').map((s) => ({ path: s.path, reason: s.reason }));
        },
        signals(skipped) {
            signalSkips = skipped.map((s) => ({ path: s.path, reason: `coverage-${s.reason}` }));
        },
        edges(count) {
            edges = count;
        },
        begin() {
            signalSkips = [];
            edges = undefined;
        },
        finish() {
            const folders = (args.folders?.() ?? []).map((f) => ({ path: f.path, reason: f.reason }));
            // A review that reused a cached analysis builds no map: keep the edge count the last one measured.
            const measured = edges ?? args.store.get(args.rootId)?.counts.edges;
            args.store.set(args.rootId, {
                counts: { ...counts, ...(measured !== undefined ? { edges: measured } : {}) },
                skipped: [...planSkips, ...folders, ...signalSkips],
                at: (args.now ?? (() => new Date().toISOString()))(),
            });
        },
    };
}

/** The number of import edges in a repo map's built graph (`out[i]` = file i's outgoing `[to, weight]`). */
export function repoGraphEdgeCount(shape: { graph: { out: ReadonlyArray<ReadonlyArray<unknown>> } }): number {
    return shape.graph.out.reduce((sum, out) => sum + out.length, 0);
}

/** Counts of a root. `edges` is absent when a host did not measure it; `truncated` when a cap cut the file/doc split short. */
export interface GraphCounts { files: number; edges?: number; docs: number; truncated?: boolean }

/**
 * Files, docs and edges of a graph. `edges` and the total come from `graph.stats` (the
 * platform's own numbers, not the returned nodes, which a cap may have cut); the docs are
 * counted off the nodes returned, and `truncated` says the split is a lower bound.
 */
export function graphCounts(graph: KnowledgeGraph): GraphCounts {
    let docs = 0;
    let code = 0;
    for (const node of graph.nodes) {
        if (node.kind !== 'file') continue;
        if (node.pack === 'code') code += 1; else docs += 1;
    }
    const truncated = graph.stats.truncated;
    return {
        files: truncated ? Math.max(code, graph.stats.sources - docs) : code,
        docs,
        edges: graph.stats.edges,
        ...(truncated ? { truncated: true } : {}),
    };
}
