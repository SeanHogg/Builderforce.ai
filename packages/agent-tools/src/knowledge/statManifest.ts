/**
 * knowledge/statManifest.ts — the plan's stat manifest (PRD 41 B2 steps 1–3): what a walk remembers of every file it hashed,
 * so the next walk re-hashes only what changed. Pure: no `fs`, no clock of its own (the caller passes `now`).
 *
 *   - {@link HashCache}: the port a directory source loads once per walk and saves once per walk (one transaction on a store
 *     that has one). {@link memoryHashCache} is the default for a host with no store (tests, web): it lives as long as the
 *     process. The Node knowledge store's port keeps the rows in the folder's SQLite file (`node-knowledge/statRows.ts`).
 *   - {@link reusedHash}: the prefilter. A file whose `(size, mtimeNs, fileId)` equals its row reuses the row's hash without
 *     being read, EXCEPT when its mtime lies within {@link RACY_WINDOW_NS} of the time the row set was written (git's racy-file
 *     rule: a change made in the same timestamp tick as the save is invisible to the stat). A git blob id is a lookup HINT: a
 *     file git reports clean at the blob its row was hashed at reuses the row even when its stat moved (a checkout).
 *
 * mtime and the file id never enter an output: they only decide whether a file is read (B8.3).
 */

/** What a walk remembers of one file (root-relative `path`). Stats are BigInts: ns mtimes and Windows file ids exceed 2^53. */
export interface StatRow {
    path: string;
    size: number;
    mtimeNs: bigint;
    /** The inode / Windows file id; absent on a host whose stat has none. */
    fileId?: bigint;
    /** The content hash the review keys facts by. */
    hash: string;
    /** The git blob id of the index entry the file was clean against when hashed: a lookup hint, never an identity. */
    gitBlob?: string;
}

/** A root's rows and when they were written (ns since the epoch; absent ⇒ never written, nothing is racy against it). */
export interface StatSet {
    rows: ReadonlyMap<string, StatRow>;
    writtenAtNs?: bigint;
}

/** The stat manifest of a store, per root. */
export interface HashCache {
    load(rootId: string): Promise<StatSet>;
    /** Replaces the root's rows (one transaction). A store that may not be written (a newer format) writes nothing. */
    save(rootId: string, rows: readonly StatRow[], writtenAtNs: bigint): Promise<void>;
    /** A file's size from the rows last loaded or saved in this process, without a read (the replica pump's chunk budget). */
    sizeOf?(rootId: string, path: string): number | undefined;
}

/** git's racy window: a file modified within 2 s of the row set's write is re-hashed whatever its stat says. */
const RACY_WINDOW_NS = 2_000_000_000n;

export const EMPTY_STAT_SET: StatSet = { rows: new Map() };

/** ms (a float from `mtimeMs`, or an integer from `vscode.workspace.fs`) → ns, for a host whose stat has no `mtimeNs`. */
export const msToNs = (ms: number): bigint => BigInt(Math.round(ms * 1_000_000));

/** What git said of the root's tracked files: the blob id of each one clean against the index, and when it asked. */
export interface GitHints {
    /** Root-relative path → blob id (`git ls-files -s`), only for files whose work tree matches the index. */
    blobs: ReadonlyMap<string, string>;
    /** When the status ran (ns): a file modified after it may no longer be what git saw, so its hint is not used. */
    takenAtNs: bigint;
}

/** One file's stat as the prefilter compares it. */
export interface FileStat { size: number; mtimeNs: bigint; fileId?: bigint }

/**
 * The stored hash this file may reuse without being read, or undefined when it must be read.
 *   1. the stat tuple equals the row's and the file is not racy against the row set's write time;
 *   2. otherwise git reports it clean at the blob its row was hashed at, with the same size, and it was not modified after
 *      git looked.
 */
export function reusedHash(st: FileStat, row: StatRow | undefined, set: StatSet, hint: string | undefined, hintsTakenAtNs?: bigint): string | undefined {
    if (!row) return undefined;
    const racy = set.writtenAtNs !== undefined && st.mtimeNs >= set.writtenAtNs - RACY_WINDOW_NS;
    if (!racy && row.size === st.size && row.mtimeNs === st.mtimeNs && row.fileId === st.fileId) return row.hash;
    if (hint !== undefined && row.gitBlob === hint && row.size === st.size && hintsTakenAtNs !== undefined && st.mtimeNs < hintsTakenAtNs) return row.hash;
    return undefined;
}

/** Whether two rows say the same thing (an unchanged walk writes nothing). */
export const sameRow = (a: StatRow | undefined, b: StatRow): boolean =>
    !!a && a.size === b.size && a.mtimeNs === b.mtimeNs && a.fileId === b.fileId && a.hash === b.hash && a.gitBlob === b.gitBlob;

/** Keeps each root's last rows in memory: what a port remembers for {@link HashCache.sizeOf}. */
export class StatSetMemo {
    private readonly sets = new Map<string, StatSet>();
    get(rootId: string): StatSet | undefined { return this.sets.get(rootId); }
    set(rootId: string, set: StatSet): StatSet { this.sets.set(rootId, set); return set; }
    setRows(rootId: string, rows: readonly StatRow[], writtenAtNs: bigint): StatSet {
        return this.set(rootId, { rows: new Map(rows.map((r) => [r.path, r])), writtenAtNs });
    }
    sizeOf(rootId: string, path: string): number | undefined { return this.sets.get(rootId)?.rows.get(path)?.size; }
}

/** The in-memory stat manifest: the default for a host with no store (it lasts as long as the process). */
export function memoryHashCache(): HashCache {
    const memo = new StatSetMemo();
    return {
        load: async (rootId) => memo.get(rootId) ?? EMPTY_STAT_SET,
        save: async (rootId, rows, writtenAtNs) => { memo.setRows(rootId, rows, writtenAtNs); },
        sizeOf: (rootId, path) => memo.sizeOf(rootId, path),
    };
}

/**
 * A port resolved on first use: a host whose store opens lazily (a SQLite file opened by the first review) hands the source
 * this, so building a source never opens the file. A store that cannot be opened fails the load, and the walk hashes every file.
 */
export function deferredHashCache(resolve: () => HashCache): HashCache {
    let held: HashCache | undefined;
    const port = (): HashCache => (held ??= resolve());
    return {
        // `async`: a store that throws while opening rejects the load, never throws into the walk.
        load: async (rootId) => port().load(rootId),
        save: async (rootId, rows, writtenAtNs) => port().save(rootId, rows, writtenAtNs),
        sizeOf: (rootId, path) => { try { return port().sizeOf?.(rootId, path); } catch { return undefined; } },
    };
}
