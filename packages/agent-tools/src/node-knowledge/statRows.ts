/**
 * node-knowledge/statRows.ts — the plan's stat manifest (PRD 41 B2) in the folder's knowledge SQLite file: the `stat` table,
 * one row per (root id, root-relative path), and the meta key `stat_written:<rootId>` (when the root's rows were last written,
 * in ns: the racy rule's reference). The pure prefilter and the port live in `knowledge/statManifest.ts`.
 *
 * `mtime_ns` and `file_id` are decimal TEXT, not INTEGER: ns mtimes (~1.7e18) and Windows file ids exceed 2^53, node:sqlite
 * reads an INTEGER back as a JS number unless every statement opts into BigInts, and a 64-bit file id may not fit a signed
 * INTEGER at all. TEXT round-trips every value exactly through `BigInt(text)`.
 *
 * A save replaces the root's rows in ONE transaction on the store's gate. A file of a newer format is read, never written:
 * the save is a no-op there (the walk still works; it just re-hashes next time).
 */

import { EMPTY_STAT_SET, StatSetMemo, type HashCache, type StatRow, type StatSet } from '../knowledge/statManifest.js';
import type { SqliteKnowledgeDb } from './sqliteRows.js';

const writtenKey = (rootId: string): string => `stat_written:${rootId}`;

interface Row { path: string; size: number; mtime_ns: string; file_id: string | null; hash: string; git_blob: string | null }

const toStat = (r: Row): StatRow => ({
    path: r.path,
    size: Number(r.size),
    mtimeNs: BigInt(r.mtime_ns),
    ...(r.file_id !== null ? { fileId: BigInt(r.file_id) } : {}),
    hash: r.hash,
    ...(r.git_blob !== null ? { gitBlob: r.git_blob } : {}),
});

/** The root's rows as stored (empty when there are none, or the table is missing in a file of another format). */
export function readStatSet(persistence: SqliteKnowledgeDb, rootId: string): StatSet {
    let rows: Row[];
    try {
        rows = persistence.db.prepare('SELECT path, size, mtime_ns, file_id, hash, git_blob FROM stat WHERE root_id = ?').all(rootId) as unknown as Row[];
    } catch (err) {
        if (/no such table: stat/i.test(err instanceof Error ? err.message : String(err))) return EMPTY_STAT_SET;
        throw err;
    }
    const written = persistence.getMeta(writtenKey(rootId));
    return { rows: new Map(rows.map((r) => [r.path, toStat(r)])), ...(written ? { writtenAtNs: BigInt(written) } : {}) };
}

/** Replaces the root's rows, in one transaction. Refused (rejects) on a file of a newer format. */
export function writeStatSet(persistence: SqliteKnowledgeDb, rootId: string, rows: readonly StatRow[], writtenAtNs: bigint): Promise<void> {
    return persistence.writeOwn((db) => {
        db.prepare('DELETE FROM stat WHERE root_id = ?').run(rootId);
        const insert = db.prepare('INSERT INTO stat(root_id, path, size, mtime_ns, file_id, hash, git_blob) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const r of rows) insert.run(rootId, r.path, r.size, r.mtimeNs.toString(), r.fileId?.toString() ?? null, r.hash, r.gitBlob ?? null);
        persistence.setMeta(writtenKey(rootId), writtenAtNs.toString());
    });
}

/** The store's {@link HashCache}: rows in the SQLite file, the last set per root kept in memory for `sizeOf`. */
export function sqliteHashCache(persistence: SqliteKnowledgeDb): HashCache {
    const memo = new StatSetMemo();
    return {
        load: async (rootId) => memo.set(rootId, readStatSet(persistence, rootId)),
        async save(rootId, rows, writtenAtNs) {
            // A read-only (newer-format) file is never written; the next walk simply re-hashes what it could not remember.
            if (persistence.formatNewer) return;
            await writeStatSet(persistence, rootId, rows, writtenAtNs);
            memo.setRows(rootId, rows, writtenAtNs);
        },
        sizeOf: (rootId, path) => memo.sizeOf(rootId, path),
    };
}
