/**
 * Every root's knowledge index on one host, by root id — what the editor's and on-prem's
 * `getHostKnowledgeIndex(rootId)` both are, so neither copies the rules:
 *
 *   - one index per root id, created lazily, stored under the workspace that owns the root
 *     (`<workspace>/.builderforce/knowledge/<rootId>.idx`);
 *   - the WORKSPACE repository's own root is seeded from the code pack on first use
 *     (`seedCodeCards` over the host's definition index) and re-seeded, debounced, when a
 *     code file changes — unchanged cards cost nothing, deleted files are removed;
 *   - any other root (a reviewed directory) is filled by its review (`upsertFromGraph`).
 */

import type { EmbedderPort, PartitionRegistry } from '@seanhogg/builderforce-memory/knowledge';
import { isCodePath, loadCodePartitions } from '../codePack.js';
import type { HostKnowledgeIndexCore, IdleScheduler, KnowledgeIndexFiles } from './contract.js';
import { createHostKnowledgeIndex } from './hostIndex.js';
import { knowledgeIndexPath } from './persistence.js';
import { rootRelOf } from '../rootId.js';
import { seedCodeCards, type SymbolFile } from './seedCode.js';

/** Quiet period after a file change before the workspace root is re-seeded. */
export const RESEED_DEBOUNCE_MS = 3_000;
/** The workspace's layer override (the code pack's `CODE_PARTITIONS_FILE`). */
const PARTITIONS_FILE = '.builderforce/partitions.json';

export interface KnowledgeIndexRegistryOptions {
    /** Absolute workspace roots, read per call (folders can change). */
    workspaceRoots(): readonly string[];
    /** The knowledge-graph root id of a workspace root (what the graph's `src:` refs name). */
    rootIdOf(workspaceRoot: string): string;
    /** The host's definition index for a workspace root: every file with its symbols. */
    symbolFiles?(workspaceRoot: string): Promise<SymbolFile[]>;
    /** The host's files; absent ⇒ indexes live in memory only. */
    files?: KnowledgeIndexFiles;
    embedder?(): Promise<EmbedderPort | undefined>;
    idle: IdleScheduler;
    onError?(e: unknown): void;
}

export interface KnowledgeIndexRegistry {
    get(rootId: string): HostKnowledgeIndexCore;
    /** The index of the workspace root `workspaceRoot` (seeded from the code pack). */
    forWorkspace(workspaceRoot: string): HostKnowledgeIndexCore;
    /** A file was saved, created or deleted (absolute path): re-seed its workspace root, debounced. */
    fileChanged(absPath: string): void;
    /** Re-seed a workspace root that was seeded before, debounced (a host with no file events: each run). */
    refresh(workspaceRoot: string): void;
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');
const sameRoot = (a: string, b: string): boolean => norm(a).toLowerCase() === norm(b).toLowerCase();

/** The workspace's layers: a valid override, else the code pack's default. */
export async function readSeedPartitions(files: KnowledgeIndexFiles | undefined, workspaceRoot: string): Promise<PartitionRegistry | undefined> {
    const bytes = await files?.read(`${norm(workspaceRoot)}/${PARTITIONS_FILE}`).catch(() => undefined);
    if (!bytes) return undefined;
    try {
        return loadCodePartitions(new TextDecoder().decode(bytes));
    } catch {
        return undefined;
    }
}

export function createKnowledgeIndexRegistry(o: KnowledgeIndexRegistryOptions): KnowledgeIndexRegistry {
    const indexes = new Map<string, HostKnowledgeIndexCore>();
    const seeded = new Map<string, Set<string>>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const seeding = new Map<string, Promise<void>>();

    const workspaceOf = (rootId: string): string | undefined => {
        // A workspace folder's id, or `<folder id>:<rel>` for a folder reviewed inside it (`rootIdFor`).
        const roots = o.workspaceRoots();
        return roots.find((r) => o.rootIdOf(r) === rootId) ?? roots.find((r) => rootRelOf(o.rootIdOf(r), rootId) !== undefined) ?? roots[0];
    };
    const isCodeRoot = (rootId: string, workspace: string | undefined): workspace is string =>
        !!workspace && !!o.symbolFiles && o.rootIdOf(workspace) === rootId;

    const seed = (rootId: string, workspace: string) => async (index: HostKnowledgeIndexCore): Promise<void> => {
        const prior = seeding.get(rootId);
        if (prior) await prior.catch(() => undefined);
        const work = (async () => {
            const [files, partitions] = await Promise.all([o.symbolFiles!(workspace), readSeedPartitions(o.files, workspace)]);
            const previous = seeded.get(rootId);
            seeded.set(rootId, await seedCodeCards(index, files, { ...(partitions ? { partitions } : {}), ...(previous ? { previous } : {}) }));
        })();
        seeding.set(rootId, work);
        try { await work; } finally { if (seeding.get(rootId) === work) seeding.delete(rootId); }
    };

    const get = (rootId: string): HostKnowledgeIndexCore => {
        let index = indexes.get(rootId);
        if (index) return index;
        const workspace = workspaceOf(rootId);
        index = createHostKnowledgeIndex({
            rootId,
            ...(workspace && o.files ? { path: knowledgeIndexPath(workspace, rootId), files: o.files } : {}),
            ...(o.embedder ? { embedder: o.embedder } : {}),
            idle: o.idle,
            ...(isCodeRoot(rootId, workspace) ? { seed: seed(rootId, workspace) } : {}),
            ...(o.onError ? { onError: o.onError } : {}),
        });
        indexes.set(rootId, index);
        return index;
    };

    return {
        get,
        forWorkspace: (workspaceRoot) => get(o.rootIdOf(workspaceRoot)),
        fileChanged(absPath) {
            const file = norm(absPath);
            const workspace = o.workspaceRoots().find((r) => file.toLowerCase().startsWith(`${norm(r).toLowerCase()}/`));
            if (!workspace) return;
            const rel = file.slice(norm(workspace).length + 1);
            if (rel.split('/').some((seg) => seg.startsWith('.')) || !isCodePath(rel)) return;
            refresh(workspace);
        },
        refresh,
    };

    function refresh(workspace: string): void {
        const rootId = o.rootIdOf(workspace);
        const index = indexes.get(rootId);
        if (!index || !isCodeRoot(rootId, workspace) || !seeded.has(rootId)) return;
        const prev = timers.get(rootId);
        if (prev) clearTimeout(prev);
        const timer = setTimeout(() => {
            timers.delete(rootId);
            if (!o.workspaceRoots().some((r) => sameRoot(r, workspace))) return;
            void seed(rootId, workspace)(index).catch((e: unknown) => o.onError?.(e));
        }, RESEED_DEBOUNCE_MS);
        (timer as { unref?: () => void }).unref?.();
        timers.set(rootId, timer);
    }
}
