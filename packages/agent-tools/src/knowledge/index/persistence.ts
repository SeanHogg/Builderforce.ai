/**
 * Where a root's knowledge index lives on the host, and how it is read and written
 * (docs/design/deterministic-knowledge-index.md, "Where it runs"):
 * `<workspace>/.builderforce/knowledge/<rootId>.idx` (the id made file-safe: {@link rootFileStem}),
 * the engine's own serialized bytes.
 *
 *   - read: a missing, unreadable or corrupt file is NO index (a fresh one is built) —
 *     the index is derived data, never the source of truth;
 *   - write: keyed by digest — an unchanged digest writes nothing — and atomic (a temp
 *     file, then a rename), so a crash mid-write leaves the previous index whole.
 */

import { loadKnowledgeIndex, sha256Hex, type EmbedderPort } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeIndexFiles } from './contract.js';

/** The directory under a workspace root that holds every root's index. */
export const KNOWLEDGE_INDEX_DIR = '.builderforce/knowledge';
export const KNOWLEDGE_INDEX_EXT = '.idx';

/**
 * A file-safe, collision-free stem for a root id: its readable part plus a short hash of
 * the whole id (two ids that sanitize alike never share a file). The same stem the
 * knowledge host names a root's snapshot and manifest with.
 */
export function rootFileStem(rootId: string): string {
    const readable = rootId.replace(/[^\w.-]+/g, '_').slice(0, 60);
    return `${readable}-${sha256Hex(rootId).slice(0, 10)}`;
}

/** The index file's name for a root id. */
export function indexFileName(rootId: string): string {
    return `${rootFileStem(rootId)}${KNOWLEDGE_INDEX_EXT}`;
}

const join = (dir: string, name: string): string => `${dir.replace(/[\\/]+$/, '')}/${name}`;

/** The absolute directory for `workspaceRoot`. */
export function knowledgeIndexDir(workspaceRoot: string): string {
    return join(workspaceRoot, KNOWLEDGE_INDEX_DIR);
}

/** The absolute index path for `rootId` under `workspaceRoot`. */
export function knowledgeIndexPath(workspaceRoot: string, rootId: string): string {
    return join(knowledgeIndexDir(workspaceRoot), indexFileName(rootId));
}

export type LoadedIndex = ReturnType<typeof loadKnowledgeIndex>;

/** The stored index, bound to `embedder`; undefined when there is none or it does not load. */
export async function readStoredIndex(files: KnowledgeIndexFiles, path: string, embedder: EmbedderPort | undefined): Promise<LoadedIndex | undefined> {
    const bytes = await files.read(path).catch(() => undefined);
    if (!bytes || bytes.byteLength === 0) return undefined;
    try {
        return loadKnowledgeIndex(bytes, embedder);
    } catch {
        return undefined;
    }
}

/** Write `bytes` to `path` atomically: a sibling temp file, then a rename over it. */
export async function writeIndexAtomic(files: KnowledgeIndexFiles, path: string, bytes: Uint8Array, digest: string): Promise<void> {
    const dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
    if (dir) await files.mkdir(dir);
    const temp = `${path}.${digest.slice(0, 12)}.tmp`;
    await files.write(temp, bytes);
    try {
        await files.rename(temp, path);
    } catch (e) {
        await files.remove?.(temp).catch(() => undefined);
        throw e;
    }
}
