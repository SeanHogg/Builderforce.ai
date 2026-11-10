/**
 * node-knowledge/statRows.ts — the plan's stat manifest (PRD 41 B2) in the folder's knowledge SQLite file: the `stat` table,
 * one row per (root id, root-relative path), and per root the meta keys `stat_written:<rootId>` (the racy rule's reference
 * time, ns: the START of the walk that last moved it) and `stat_rule:<rootId>` (the hash rule the rows were made under). The
 * pure prefilter and the port live in `knowledge/statManifest.ts`, one walk's bookkeeping in `knowledge/statWalk.ts`.
 *
 * `mtime_ns` and `file_id` are decimal TEXT, not INTEGER: ns mtimes (~1.7e18) and Windows file ids exceed 2^53, node:sqlite
 * reads an INTEGER back as a JS number unless every statement opts into BigInts, and a 64-bit file id may not fit a signed
 * INTEGER at all. TEXT round-trips every value exactly through `BigInt(text)`.
 *
 * A load reads the rows and both meta keys in ONE read transaction. A save is a DELTA (changed rows, vanished paths, the meta
 * keys) in ONE write transaction on the store's gate, so a one-file edit writes one row. A file of a newer format is read,
 * never written: the save is a no-op there (the walk still works; it just re-hashes next time). A removed root's rows and
 * keys go with its scope (`SqliteKnowledgeDb.writeChange` calls {@link deleteStatOf}).
 */

import type { LocalSqliteDb } from '../node-local-sqlite.js';
import { EMPTY_STAT_SET, StatSetMemo, type HashCache, type StatDelta, type StatRow, type StatSet } from '../knowledge/statManifest.js';
import type { SqliteKnowledgeDb } from './sqliteRows.js';

const writtenKey = (rootId: string): string => `stat_written:${rootId}`;
const ruleKey = (rootId: string): string => `stat_rule:${rootId}`;

interface Row { path: string; size: number; mtime_ns: string; file_id: string | null; hash: string; git_blob: string | null }

const toStat = (r: Row): StatRow => ({
    path: r.path,
    size: Number(r.size),
    mtimeNs: BigInt(r.mtime_ns),
    ...(r.file_id !== null ? { fileId: BigInt(r.file_id) } : {}),
    hash: r.hash,
    ...(r.git_blob !== null ? { gitBlob: r.git_blob } : {}),
});

const metaOf = (db: LocalSqliteDb, k: string): string | undefined => (db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v;

/**
 * The root's rows made under `rule`, read in one transaction. Rows made under another rule (or none) come back as an empty,
 * `stale` set; a file whose `stat` table is missing (another format) as an empty one.
 */
export async function readStatSet(persistence: SqliteKnowledgeDb, rootId: string, rule: string): Promise<StatSet> {
    return persistence.readOwn((db) => {
        let rows: Row[];
        try {
            rows = db.prepare('SELECT path, size, mtime_ns, file_id, hash, git_blob FROM stat WHERE root_id = ?').all(rootId) as unknown as Row[];
        } catch (err) {
            if (/no such table: stat/i.test(err instanceof Error ? err.message : String(err))) return EMPTY_STAT_SET;
            throw err;
        }
        if (metaOf(db, ruleKey(rootId)) !== rule) return rows.length > 0 ? { rows: new Map(), stale: true as const } : EMPTY_STAT_SET;
        const written = metaOf(db, writtenKey(rootId));
        return { rows: new Map(rows.map((r) => [r.path, toStat(r)])), ...(written ? { writtenAtNs: BigInt(written) } : {}) };
    });
}

/** Applies one walk's delta, in one transaction. Refused (rejects) on a file of a newer format. */
export function writeStatDelta(persistence: SqliteKnowledgeDb, rootId: string, delta: StatDelta): Promise<void> {
    return persistence.writeOwn((db) => {
        if (delta.replace) db.prepare('DELETE FROM stat WHERE root_id = ?').run(rootId);
        const upsert = db.prepare(`INSERT INTO stat(root_id, path, size, mtime_ns, file_id, hash, git_blob) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(root_id, path) DO UPDATE SET size = excluded.size, mtime_ns = excluded.mtime_ns, file_id = excluded.file_id, hash = excluded.hash, git_blob = excluded.git_blob`);
        for (const r of delta.upserts) upsert.run(rootId, r.path, r.size, r.mtimeNs.toString(), r.fileId?.toString() ?? null, r.hash, r.gitBlob ?? null);
        const del = db.prepare('DELETE FROM stat WHERE root_id = ? AND path = ?');
        for (const path of delta.deletes) del.run(rootId, path);
        persistence.setMeta(ruleKey(rootId), delta.rule);
        if (delta.writtenAtNs !== undefined) persistence.setMeta(writtenKey(rootId), delta.writtenAtNs.toString());
    });
}

/** Deletes a root's rows and meta keys, inside the caller's transaction (the root's scope is being removed). */
export function deleteStatOf(db: LocalSqliteDb, rootId: string): void {
    try {
        db.prepare('DELETE FROM stat WHERE root_id = ?').run(rootId);
    } catch (err) {
        if (!/no such table: stat/i.test(err instanceof Error ? err.message : String(err))) throw err;
    }
    const del = db.prepare('DELETE FROM meta WHERE k = ?');
    del.run(writtenKey(rootId));
    del.run(ruleKey(rootId));
}

/** The store's {@link HashCache}: rows in the SQLite file, the last set per root kept in memory for `sizeOf`. */
export function sqliteHashCache(persistence: SqliteKnowledgeDb): HashCache {
    const memo = new StatSetMemo();
    return {
        load: async (rootId, rule) => memo.set(rootId, await readStatSet(persistence, rootId, rule)),
        async save(rootId, delta) {
            // A read-only (newer-format) file is never written; the next walk simply re-hashes what it could not remember.
            if (persistence.formatNewer) return;
            await writeStatDelta(persistence, rootId, delta);
            memo.apply(rootId, delta);
        },
        async drop(rootId) {
            memo.drop(rootId);
            if (!persistence.formatNewer) await persistence.writeOwn((db) => deleteStatOf(db, rootId));
        },
        sizeOf: (rootId, path) => memo.sizeOf(rootId, path),
    };
}
