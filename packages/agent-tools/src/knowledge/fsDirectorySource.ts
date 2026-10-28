/**
 * knowledge/fsDirectorySource.ts — ONE `DirectorySource` over a filesystem port, for every
 * host that reviews a folder on a real disk (VS Code's `vscode.workspace.fs`, the on-prem
 * container fs) — PRD 38 §4.7.
 *
 *   list   — a walk of the folder, every file with the SHA-256 of its bytes (the content
 *            hash the extracted cache and the platform share), cached by mtime + size so a
 *            re-review hashes only what changed;
 *   read   — the file as text (memory's binary check and size cap decide what is used);
 *   watch  — the port's watcher, reporting root-relative paths of listed files only.
 *
 * Install and build trees and VCS stores ({@link KNOWLEDGE_SKIP_DIRS}, the ONE list every
 * host walks by — the browser's sources test paths with {@link isSkippedPath}) are never walked. Inside
 * `.builderforce/` only the review's own inputs are listed (the ignore file, the layer
 * override) — snapshots and indexes are never sources. `.gitignore` /
 * `.builderforce/ignore` rules are applied by `planReview`. Pure: no `fs`, no `crypto`.
 */

import { mediaTypeOfPath, sha256Hex, type DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import type { SourceDocument } from '@seanhogg/builderforce-memory/ingest';
import { WORKSPACE_SKIP_DIRS } from '../skipDirs.js';

/** Never walked, whatever the host skips. */
const VCS_DIRS: ReadonlySet<string> = new Set(['.git', '.hg', '.svn']);

/** Directory names no review walks, on any host (the definition index's list). */
export const KNOWLEDGE_SKIP_DIRS: ReadonlySet<string> = WORKSPACE_SKIP_DIRS;

/** Root-relative, forward slashes, no leading `./` or `/`, no trailing slash. */
export function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
}

/** Whether a root-relative path sits under a skipped directory (a trailing `/` names a directory). */
export function isSkippedPath(path: string, skipDirs: ReadonlySet<string> = KNOWLEDGE_SKIP_DIRS): boolean {
    const dirs = path.replace(/\\/g, '/').split('/').slice(0, -1);
    return dirs.some((name) => skipDirs.has(name) || VCS_DIRS.has(name));
}

/** The document memory reads for one text file of a root. */
export function textDocument(rootId: string, path: string, text: string): SourceDocument {
    return { id: path, tenantId: rootId, title: path, content: { kind: 'text', text, mediaType: mediaTypeOfPath(path) } };
}

/** What the source needs of a filesystem. Paths are absolute, `/`-separated. */
export interface KnowledgeFs {
    readDirectory(path: string): Promise<Array<[name: string, kind: 'file' | 'dir']>>;
    stat(path: string): Promise<{ mtime: number; size: number }>;
    readFile(path: string): Promise<Uint8Array>;
    /** Changed absolute paths under `base`; returns the unsubscribe. */
    watch?(base: string, cb: (paths: string[]) => void): () => void;
}

/** A file's hash, remembered by (mtime, size) — shared across sources so a re-review re-hashes nothing unchanged. */
export type HashCache = Map<string, { mtime: number; size: number; hash: string }>;

/** The review's own inputs inside `.builderforce/` — everything else there is the host's state. */
const BUILDERFORCE_INPUTS: ReadonlySet<string> = new Set(['.builderforce/ignore', '.builderforce/partitions.json']);
/** A walk that has listed this many files stops. */
export const MAX_LISTED_FILES = 20_000;

export interface FsDirectorySourceOptions {
    fs: KnowledgeFs;
    /** Absolute path of the folder reviewed. */
    rootPath: string;
    rootId: string;
    title: string;
    /** Directory NAMES never walked; default {@link KNOWLEDGE_SKIP_DIRS}. */
    skipDirs?: ReadonlySet<string>;
    hashCache?: HashCache;
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');
const join = (a: string, b: string): string => (a ? `${a}/${b}` : b);

/** Whether a root-relative file is listed (`.builderforce/` holds only two review inputs). */
export function listsFile(rel: string): boolean {
    return !rel.startsWith('.builderforce/') || BUILDERFORCE_INPUTS.has(rel);
}

export function createFsDirectorySource(opts: FsDirectorySourceOptions): DirectorySource {
    const { fs, rootId, title, skipDirs = KNOWLEDGE_SKIP_DIRS } = opts;
    const root = norm(opts.rootPath);
    const cache: HashCache = opts.hashCache ?? new Map();
    const walks = (rel: string): boolean => {
        const name = rel.slice(rel.lastIndexOf('/') + 1);
        return !skipDirs.has(name) && !VCS_DIRS.has(name);
    };
    const underWalked = (rel: string): boolean => !isSkippedPath(rel, skipDirs);

    const hashOf = async (abs: string): Promise<{ hash: string; size: number }> => {
        const st = await fs.stat(abs);
        const hit = cache.get(abs);
        if (hit && hit.mtime === st.mtime && hit.size === st.size) return { hash: hit.hash, size: st.size };
        const hash = sha256Hex(await fs.readFile(abs));
        cache.set(abs, { mtime: st.mtime, size: st.size, hash });
        return { hash, size: st.size };
    };

    async function* list(): AsyncIterable<{ path: string; hash: string; size: number }> {
        const queue: string[] = [''];
        let listed = 0;
        while (queue.length > 0) {
            const dir = queue.shift()!;
            let entries: Array<[string, 'file' | 'dir']>;
            try {
                entries = await fs.readDirectory(dir ? `${root}/${dir}` : root);
            } catch {
                continue; // An unreadable folder is skipped, never a failed review.
            }
            for (const [name, kind] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
                const rel = join(dir, name);
                if (kind === 'dir') {
                    if (walks(rel)) queue.push(rel);
                    continue;
                }
                if (!listsFile(rel)) continue;
                try {
                    const { hash, size } = await hashOf(`${root}/${rel}`);
                    yield { path: rel, hash, size };
                } catch {
                    continue; // Deleted mid-walk.
                }
                if (++listed >= MAX_LISTED_FILES) return;
            }
        }
    }

    const read = async (path: string): Promise<SourceDocument> => {
        const rel = normalizePath(path);
        return textDocument(rootId, rel, new TextDecoder('utf-8').decode(await fs.readFile(`${root}/${rel}`)));
    };

    const watch = fs.watch
        ? (cb: (paths: string[]) => void) => fs.watch!(root, (paths) => {
            const rel = paths
                .map(norm)
                .filter((p) => p.startsWith(`${root}/`))
                .map((p) => p.slice(root.length + 1))
                .filter((p) => listsFile(p) && underWalked(p));
            if (rel.length > 0) cb(rel);
        })
        : undefined;

    return { rootId, title, list, read, ...(watch ? { watch } : {}) };
}
