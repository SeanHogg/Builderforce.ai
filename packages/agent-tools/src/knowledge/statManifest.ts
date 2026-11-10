/**
 * knowledge/statManifest.ts — the plan's stat manifest (PRD 41 B2 steps 1–3): what a walk remembers of every file it hashed,
 * so the next walk re-hashes only what changed. Pure: no `fs`, no clock of its own (the caller passes `now`).
 *
 *   - {@link HashCache}: the port a directory source loads once per walk and saves once per walk, as a DELTA (one small
 *     transaction on a store that has one). {@link memoryHashCache} is the default for a host with no store (tests, web): it
 *     lives as long as the process. The Node knowledge store's port keeps the rows in the folder's SQLite file
 *     (`node-knowledge/statRows.ts`).
 *   - Rows are recorded under a HASH RULE (which digest made them). A load under another rule, or with none recorded, starts
 *     empty, and the next save replaces the root's rows: a host that changes its digest never reuses a hash of the old one.
 *   - {@link reusedHash}: the prefilter. A file whose `(size, mtimeNs, fileId)` equals its row reuses the row's hash without
 *     being read, EXCEPT when its mtime lies within {@link RACY_WINDOW_NS} of the reference time (the START of the walk that
 *     wrote the rows; git's racy-file rule: a change in the same timestamp tick as the stat is invisible to it). A git blob
 *     id is a lookup HINT: a file git reports clean at the blob its row was verified against reuses the row even when its
 *     stat moved (a checkout).
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
    /**
     * The git blob id of the bytes that were hashed, kept ONLY when it equals the index blob git reported clean: a lookup hint,
     * never an identity.
     */
    gitBlob?: string;
}

/** A root's rows and their reference time (ns since the epoch; absent ⇒ never written, nothing is racy against it). */
export interface StatSet {
    rows: ReadonlyMap<string, StatRow>;
    writtenAtNs?: bigint;
    /** Rows exist under another hash rule (or none): they are not used, and the next save replaces them. */
    stale?: true;
}

/** One walk's save. */
export interface StatDelta {
    /** The hash rule the rows were made under (recorded for the root). */
    rule: string;
    upserts: readonly StatRow[];
    /** Root-relative paths whose rows go (a complete walk did not find them). */
    deletes: readonly string[];
    /** The new reference time; absent ⇒ the stored one stays (a capped or stopped walk never refreshes rows it did not visit). */
    writtenAtNs?: bigint;
    /** Drop every row of the root first (the stored rows were made under another rule). */
    replace?: true;
}

/** The stat manifest of a store, per root. */
export interface HashCache {
    /** The root's rows made under `rule`; empty (and `stale`) when they were made under another one or none is recorded. */
    load(rootId: string, rule: string): Promise<StatSet>;
    /** Applies one walk's delta (one transaction). A store that may not be written (a newer format) writes nothing. */
    save(rootId: string, delta: StatDelta): Promise<void>;
    /** Forgets the root's rows (the root was removed). */
    drop?(rootId: string): Promise<void>;
    /** A file's size from the rows last loaded or saved in this process, without a read (the replica pump's chunk budget). */
    sizeOf?(rootId: string, path: string): number | undefined;
}

/** git's racy window: a file modified within 2 s of the reference time is re-hashed whatever its stat says. */
const RACY_WINDOW_NS = 2_000_000_000n;

export const EMPTY_STAT_SET: StatSet = { rows: new Map() };

/** ms (a float from `mtimeMs`, or an integer from `vscode.workspace.fs`) → ns, for a host whose stat has no `mtimeNs`. */
export const msToNs = (ms: number): bigint => BigInt(Math.round(ms * 1_000_000));

/** Whether a file of this mtime is racy against a reference time (future mtimes are racy too). */
export const isRacy = (mtimeNs: bigint, refNs: bigint | undefined): boolean => refNs !== undefined && mtimeNs >= refNs - RACY_WINDOW_NS;

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
 *   1. the stat tuple equals the row's and the file is not racy against the reference time;
 *   2. otherwise git reports it clean at the blob its row's bytes were verified as, with the same size, and it was not
 *      modified after git looked.
 */
export function reusedHash(st: FileStat, row: StatRow | undefined, set: StatSet, hint: string | undefined, hintsTakenAtNs?: bigint): string | undefined {
    if (!row) return undefined;
    if (!isRacy(st.mtimeNs, set.writtenAtNs) && row.size === st.size && row.mtimeNs === st.mtimeNs && row.fileId === st.fileId) return row.hash;
    if (hint !== undefined && row.gitBlob === hint && row.size === st.size && hintsTakenAtNs !== undefined && st.mtimeNs < hintsTakenAtNs) return row.hash;
    return undefined;
}

/** Whether two rows say the same thing (an unchanged file writes nothing). */
export const sameRow = (a: StatRow | undefined, b: StatRow): boolean =>
    !!a && a.size === b.size && a.mtimeNs === b.mtimeNs && a.fileId === b.fileId && a.hash === b.hash && a.gitBlob === b.gitBlob;

/** Keeps each root's last rows in memory: what a port remembers for {@link HashCache.sizeOf}. */
export class StatSetMemo {
    private readonly sets = new Map<string, StatSet>();
    get(rootId: string): StatSet | undefined { return this.sets.get(rootId); }
    set(rootId: string, set: StatSet): StatSet { this.sets.set(rootId, set); return set; }
    drop(rootId: string): void { this.sets.delete(rootId); }
    apply(rootId: string, delta: StatDelta): void {
        const before = this.sets.get(rootId);
        const rows = new Map(delta.replace || !before ? [] : before.rows);
        for (const path of delta.deletes) rows.delete(path);
        for (const r of delta.upserts) rows.set(r.path, r);
        const writtenAtNs = delta.writtenAtNs ?? before?.writtenAtNs;
        this.sets.set(rootId, { rows, ...(writtenAtNs !== undefined ? { writtenAtNs } : {}) });
    }
    sizeOf(rootId: string, path: string): number | undefined { return this.sets.get(rootId)?.rows.get(path)?.size; }
}

/** The in-memory stat manifest: the default for a host with no store (it lasts as long as the process). */
export function memoryHashCache(): HashCache {
    const memo = new StatSetMemo();
    const rules = new Map<string, string>();
    return {
        load: async (rootId, rule) => {
            const set = memo.get(rootId);
            if (!set) return EMPTY_STAT_SET;
            return rules.get(rootId) === rule ? set : { rows: new Map(), stale: true };
        },
        save: async (rootId, delta) => { memo.apply(rootId, delta); rules.set(rootId, delta.rule); },
        drop: async (rootId) => { memo.drop(rootId); rules.delete(rootId); },
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
        load: async (rootId, rule) => port().load(rootId, rule),
        save: async (rootId, delta) => port().save(rootId, delta),
        drop: async (rootId) => port().drop?.(rootId),
        sizeOf: (rootId, path) => { try { return port().sizeOf?.(rootId, path); } catch { return undefined; } },
    };
}
