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
import { isCodePath, loadCodePartitions } from '../codePack.js';
import { createHostKnowledgeIndex } from './hostIndex.js';
import { knowledgeIndexPath } from './persistence.js';
import { rootRelOf } from '../rootId.js';
import { seedCodeCards } from './seedCode.js';
/** Quiet period after a file change before the workspace root is re-seeded. */
export const RESEED_DEBOUNCE_MS = 3_000;
/** The workspace's layer override (the code pack's `CODE_PARTITIONS_FILE`). */
const PARTITIONS_FILE = '.builderforce/partitions.json';
const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const sameRoot = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
/** The workspace's layers: a valid override, else the code pack's default. */
export async function readSeedPartitions(files, workspaceRoot) {
    const bytes = await files?.read(`${norm(workspaceRoot)}/${PARTITIONS_FILE}`).catch(() => undefined);
    if (!bytes)
        return undefined;
    try {
        return loadCodePartitions(new TextDecoder().decode(bytes));
    }
    catch {
        return undefined;
    }
}
export function createKnowledgeIndexRegistry(o) {
    const indexes = new Map();
    const seeded = new Map();
    const timers = new Map();
    const seeding = new Map();
    const workspaceOf = (rootId) => {
        // A workspace folder's id, or `<folder id>:<rel>` for a folder reviewed inside it (`rootIdFor`).
        const roots = o.workspaceRoots();
        return roots.find((r) => o.rootIdOf(r) === rootId) ?? roots.find((r) => rootRelOf(o.rootIdOf(r), rootId) !== undefined) ?? roots[0];
    };
    const isCodeRoot = (rootId, workspace) => !!workspace && !!o.symbolFiles && o.rootIdOf(workspace) === rootId;
    const seed = (rootId, workspace) => async (index) => {
        const prior = seeding.get(rootId);
        if (prior)
            await prior.catch(() => undefined);
        const work = (async () => {
            const [files, partitions] = await Promise.all([o.symbolFiles(workspace), readSeedPartitions(o.files, workspace)]);
            const previous = seeded.get(rootId);
            seeded.set(rootId, await seedCodeCards(index, files, { ...(partitions ? { partitions } : {}), ...(previous ? { previous } : {}) }));
        })();
        seeding.set(rootId, work);
        try {
            await work;
        }
        finally {
            if (seeding.get(rootId) === work)
                seeding.delete(rootId);
        }
    };
    const get = (rootId) => {
        let index = indexes.get(rootId);
        if (index)
            return index;
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
            if (!workspace)
                return;
            const rel = file.slice(norm(workspace).length + 1);
            if (rel.split('/').some((seg) => seg.startsWith('.')) || !isCodePath(rel))
                return;
            refresh(workspace);
        },
        refresh,
    };
    function refresh(workspace) {
        const rootId = o.rootIdOf(workspace);
        const index = indexes.get(rootId);
        if (!index || !isCodeRoot(rootId, workspace) || !seeded.has(rootId))
            return;
        const prev = timers.get(rootId);
        if (prev)
            clearTimeout(prev);
        const timer = setTimeout(() => {
            timers.delete(rootId);
            if (!o.workspaceRoots().some((r) => sameRoot(r, workspace)))
                return;
            void seed(rootId, workspace)(index).catch((e) => o.onError?.(e));
        }, RESEED_DEBOUNCE_MS);
        timer.unref?.();
        timers.set(rootId, timer);
    }
}
//# sourceMappingURL=registry.js.map