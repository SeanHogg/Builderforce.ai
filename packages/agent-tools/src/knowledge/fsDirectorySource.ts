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
 * Install and build trees, VCS stores, `.worktrees/`, `*.local/`, vendored `_*_src/` and nested git
 * checkouts ({@link KNOWLEDGE_SKIP_DIRS}, the ONE list every
 * host walks by — the browser's sources test paths with {@link isSkippedPath}) are never walked. Inside
 * `.builderforce/` only the review's own inputs are listed (the ignore file, the layer
 * override) — snapshots and indexes are never sources. `.gitignore` /
 * `.builderforce/ignore` rules are applied by `planReview`. Pure: no `fs`, no `crypto`.
 */

import { mediaTypeOfPath, sha256Hex, type DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import type { SourceDocument } from '@seanhogg/builderforce-memory/ingest';
import { isSkippedDirName, isVcsMetadataName, skippedDirReason, WORKSPACE_SKIP_DIRS, type SkippedFolder } from '../skipDirs.js';
import { slashPath } from './rootRelative.js';
import { withDocumentText } from './documents/withDocumentText.js';

/** Directory names no review walks, on any host (the definition index's list). */
export const KNOWLEDGE_SKIP_DIRS: ReadonlySet<string> = WORKSPACE_SKIP_DIRS;

/** Root-relative, forward slashes, no leading `./` or `/`, no trailing slash. */
export function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
}

/** Whether a root-relative path sits under a skipped directory (a trailing `/` names a directory). */
export function isSkippedPath(
    path: string,
    skipDirs: ReadonlySet<string> = KNOWLEDGE_SKIP_DIRS,
    /** Nested checkouts a walk found (see `skippedFolders()`): everything under one is skipped too. */
    nestedCheckouts?: ReadonlySet<string>,
): boolean {
    const dirs = path.replace(/\\/g, '/').split('/').slice(0, -1);
    if (dirs.some((name) => isSkippedDirName(name, skipDirs) || isVcsMetadataName(name))) return true;
    return !!nestedCheckouts && dirs.some((_, i) => nestedCheckouts.has(dirs.slice(0, i + 1).join('/')));
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
/** Files of one folder stat'ed and hashed at once. */
const HASH_CONCURRENCY = 16;

export interface FsDirectorySourceOptions {
    fs: KnowledgeFs;
    /** Absolute path of the folder reviewed. */
    rootPath: string;
    rootId: string;
    title: string;
    /** Directory NAMES never walked; default {@link KNOWLEDGE_SKIP_DIRS}. */
    skipDirs?: ReadonlySet<string>;
    hashCache?: HashCache;
    /** The content hash of a file's bytes; default memory's {@link sha256Hex}. A host may pass a native one that yields the SAME lowercase hex digest. */
    hash?: (bytes: Uint8Array) => string;
    /**
     * Files larger than this many bytes are listed with their size and a placeholder hash, never read: for a host whose
     * plan skips them as too large (the plan classifies those by size alone). Default: every file is hashed.
     */
    skipHashAbove?: number;
    /** A walk that has listed this many files stops; default {@link MAX_LISTED_FILES}. */
    maxListed?: number;
}

const join = (a: string, b: string): string => (a ? `${a}/${b}` : b);

/**
 * Whether a root-relative path sits in the host's own `.builderforce/` state (at any depth)
 * rather than being one of the review's two inputs — analysis output, snapshots, indexes.
 */
export function isBuilderforceState(rel: string): boolean {
    const path = rel.replace(/\\/g, '/');
    return path.split('/').includes('.builderforce') && !BUILDERFORCE_INPUTS.has(path);
}

/** Whether a root-relative file is listed (`.builderforce/` holds only two review inputs). */
export function listsFile(rel: string): boolean {
    return !isBuilderforceState(rel);
}

/** A directory source that remembers the folders its last walk left out. */
export type FsDirectorySource = DirectorySource & {
    /** Folders the latest `list()` skipped by rule (nested checkouts, `.worktrees/`, `*.local/`, `_*_src/`), with the reason. */
    skippedFolders(): SkippedFolder[];
    /** Folders (root-relative, "" = the root) the latest `list()` saw hold a `.git` entry, directory or file: the systems of the root (PRD 41 A9). */
    gitRoots?(): string[];
    /** Whether a folder (root-relative, "" = the root) holds a `.git` entry right now, without a walk: a confirmed plan carries no walk of its own. */
    hasGit?(folder: string): Promise<boolean>;
};

export function createFsDirectorySource(opts: FsDirectorySourceOptions): FsDirectorySource {
    const { fs, rootId, title, skipDirs = KNOWLEDGE_SKIP_DIRS } = opts;
    const root = slashPath(opts.rootPath);
    const cache: HashCache = opts.hashCache ?? new Map();
    const walks = (rel: string): boolean => {
        const name = rel.slice(rel.lastIndexOf('/') + 1);
        return !isSkippedDirName(name, skipDirs) && !isVcsMetadataName(name);
    };
    let skipped: SkippedFolder[] = [];
    const gitRoots = new Set<string>();
    const nested = new Set<string>();
    const underWalked = (rel: string): boolean => !isSkippedPath(rel, skipDirs, nested);

    const digest = opts.hash ?? sha256Hex;
    const maxListed = opts.maxListed ?? MAX_LISTED_FILES;
    const hashOf = async (abs: string): Promise<{ hash: string; size: number }> => {
        const st = await fs.stat(abs);
        // A file the plan skips by size needs its size only: never read, and a hash no other file can equal.
        if (opts.skipHashAbove !== undefined && st.size > opts.skipHashAbove) return { hash: `unhashed:${st.size}:${abs}`, size: st.size };
        const hit = cache.get(abs);
        if (hit && hit.mtime === st.mtime && hit.size === st.size) return { hash: hit.hash, size: st.size };
        const hash = digest(await fs.readFile(abs));
        cache.set(abs, { mtime: st.mtime, size: st.size, hash });
        return { hash, size: st.size };
    };

    async function* list(): AsyncIterable<{ path: string; hash: string; size: number }> {
        const queue: string[] = [''];
        let listed = 0;
        skipped = [];
        nested.clear();
        gitRoots.clear();
        let rootIsRepo = false;
        while (queue.length > 0) {
            const dir = queue.shift()!;
            let entries: Array<[string, 'file' | 'dir']>;
            try {
                entries = await fs.readDirectory(dir ? `${root}/${dir}` : root);
            } catch {
                continue; // An unreadable folder is skipped, never a failed review.
            }
            // A root that is itself a git work tree skips a child folder with its own `.git` DIRECTORY (a vendored clone). A `.git` FILE
            // is a submodule / worktree link inside this repository: its files are this repository's. A root that is no work tree (a
            // folder of several repositories) keeps every child.
            if (entries.some(([name]) => name === '.git')) gitRoots.add(dir);
            if (!dir) rootIsRepo = entries.some(([name]) => name === '.git');
            else if (rootIsRepo && entries.some(([name, kind]) => name === '.git' && kind === 'dir')) {
                nested.add(dir);
                skipped.push({ path: dir, reason: 'nested-checkout' });
                continue;
            }
            const fileRels: string[] = [];
            for (const [name, kind] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
                const rel = join(dir, name);
                if (kind === 'dir') {
                    if (walks(rel)) queue.push(rel);
                    else {
                        const reason = skippedDirReason(name);
                        if (reason) skipped.push({ path: rel, reason });
                    }
                    continue;
                }
                if (isVcsMetadataName(name) || !listsFile(rel)) continue; // a `.git` FILE is a link to a repository store, not a source
                fileRels.push(rel);
            }
            // A folder's files are stat'ed and hashed a few at a time (a cold walk of ~16k files one await at a time
            // spent minutes in round trips); the listing order is unchanged.
            // Never starts hashing past the cap: a batch is at most what the cap still allows.
            for (let i = 0; i < fileRels.length;) {
                const batch = fileRels.slice(i, i + Math.min(HASH_CONCURRENCY, maxListed - listed));
                i += batch.length;
                const hashed = await Promise.all(batch.map(async (rel) => {
                    try {
                        return { path: rel, ...(await hashOf(`${root}/${rel}`)) };
                    } catch {
                        return undefined; // Deleted mid-walk.
                    }
                }));
                for (const file of hashed) {
                    if (!file) continue;
                    yield file;
                    if (++listed >= maxListed) return;
                }
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
                .map(slashPath)
                .filter((p) => p.startsWith(`${root}/`))
                .map((p) => p.slice(root.length + 1))
                .filter((p) => listsFile(p) && underWalked(p));
            if (rel.length > 0) cb(rel);
        })
        : undefined;

    const hasGit = async (folder: string): Promise<boolean> => {
        try { return (await fs.readDirectory(folder ? `${root}/${folder}` : root)).some(([name]) => name === '.git'); } catch { return false; }
    };

    const source: FsDirectorySource = { rootId, title, list, read, skippedFolders: () => [...skipped], gitRoots: () => [...gitRoots].sort(), hasGit, ...(watch ? { watch } : {}) };
    // pdf/office files are read as bytes and handed to the review as their extracted text (the listing hash stays over the bytes).
    return withDocumentText(source, (path) => fs.readFile(`${root}/${normalizePath(path)}`));
}
