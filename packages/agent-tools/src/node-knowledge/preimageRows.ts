/**
 * node-knowledge/preimageRows.ts — a run's baseline pre-images (PRD 41 §C1.3) in the folder's knowledge SQLite file: the BYTES
 * of every file dirty when an agent run started, so the run delta can read that file's before side after the run wrote it.
 *
 * Per the PRD §B4 deviation of 2026-11-08, bodies live in tables of `index.sqlite`, not in object files:
 *   - `preimage(hash, bytes, size, stored_at)`: content-addressed by memory's EOL-normalized `contentHash` of the bytes. Two
 *     files of one normalized content share a row (the delta normalizes EOLs before it compares, so either copy reads the same).
 *     `stored_at` (ms since the epoch) is what the retention sweep measures; it is refreshed when a run unpins the row.
 *   - `preimage_pin(run_id, hash, pinned_at)`: a run's hold on its rows. A pinned row is not swept; a pin older than the
 *     retention is itself swept (a run whose finalization never came — a crash, a closed editor — cannot hold rows forever).
 *
 * Additive (`CREATE TABLE IF NOT EXISTS`, created on the first write), the same no-format-bump reasoning as the `stat` table:
 * an older build ignores the tables, so `FORMAT_VERSION` stays 1. Writes go through {@link SqliteKnowledgeDb.writeOwn}: ONE
 * transaction on the store's gate that never moves the fact generation, refused on a file of a newer format. Reads tolerate a
 * file that has no table yet (nothing was ever captured there).
 */

import type { LocalSqliteDb } from '../node-local-sqlite.js';
import type { SqliteKnowledgeDb } from './sqliteRows.js';

/** An unpinned pre-image is kept this long after it was stored or last unpinned, then swept. */
export const PREIMAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS preimage(hash TEXT PRIMARY KEY, bytes BLOB NOT NULL, size INTEGER NOT NULL, stored_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS preimage_pin(run_id TEXT NOT NULL, hash TEXT NOT NULL, pinned_at INTEGER NOT NULL, PRIMARY KEY(run_id, hash)) WITHOUT ROWID;
`;

/** One captured file: its content hash (the key) and its bytes as read. */
export interface PreimageWrite {
    hash: string;
    bytes: Uint8Array;
}

const ensure = (db: LocalSqliteDb): void => db.exec(SCHEMA);

const missingTable = (err: unknown): boolean => /no such table: preimage/i.test(err instanceof Error ? err.message : String(err));

/** At most this many bytes per write transaction: the host thread is never held by one 50 MB insert. */
export const PREIMAGE_WRITE_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Stores the run's pre-images and pins them to the run, in transactions of at most {@link PREIMAGE_WRITE_CHUNK_BYTES}. A row
 * already held keeps its bytes.
 */
export async function putPreimages(persistence: SqliteKnowledgeDb, runId: string, items: readonly PreimageWrite[], nowMs: number): Promise<void> {
    let start = 0;
    while (start < items.length) {
        let end = start, bytes = 0;
        while (end < items.length && (end === start || bytes + items[end]!.bytes.byteLength <= PREIMAGE_WRITE_CHUNK_BYTES)) bytes += items[end++]!.bytes.byteLength;
        const chunk = items.slice(start, end);
        await persistence.writeOwn((db) => {
            ensure(db);
            const put = db.prepare('INSERT INTO preimage(hash, bytes, size, stored_at) VALUES (?, ?, ?, ?) ON CONFLICT(hash) DO UPDATE SET stored_at = excluded.stored_at');
            const pin = db.prepare('INSERT OR IGNORE INTO preimage_pin(run_id, hash, pinned_at) VALUES (?, ?, ?)');
            for (const item of chunk) {
                put.run(item.hash, item.bytes, item.bytes.byteLength, nowMs);
                pin.run(runId, item.hash, nowMs);
            }
        });
        start = end;
    }
}

/** The bytes held for each hash asked (absent hashes are absent from the map), in one read transaction. */
export function readPreimages(persistence: SqliteKnowledgeDb, hashes: readonly string[]): Promise<Map<string, Uint8Array>> {
    const wanted = [...new Set(hashes)];
    if (wanted.length === 0) return Promise.resolve(new Map());
    return persistence.readOwn((db) => {
        const out = new Map<string, Uint8Array>();
        try {
            const get = db.prepare('SELECT bytes FROM preimage WHERE hash = ?');
            for (const hash of wanted) {
                const row = get.get(hash) as { bytes: Uint8Array } | undefined;
                if (row) out.set(hash, new Uint8Array(row.bytes));
            }
        } catch (err) {
            if (!missingTable(err)) throw err;
        }
        return out;
    });
}

/**
 * Releases a run's hold (its delta is recorded, or will never be). The released rows' retention starts now, so a later
 * re-computation of the same delta still finds them for {@link PREIMAGE_RETENTION_MS}.
 */
export function unpinPreimages(persistence: SqliteKnowledgeDb, runId: string, nowMs: number): Promise<void> {
    return persistence.writeOwn((db) => {
        ensure(db);
        db.prepare('UPDATE preimage SET stored_at = ? WHERE hash IN (SELECT hash FROM preimage_pin WHERE run_id = ?)').run(nowMs, runId);
        db.prepare('DELETE FROM preimage_pin WHERE run_id = ?').run(runId);
    });
}

/**
 * Drops pins older than `retentionMs` (their run never released them), then deletes every unpinned pre-image stored (or last
 * unpinned) more than `retentionMs` ago. Returns how many pre-images went.
 */
export async function sweepPreimages(persistence: SqliteKnowledgeDb, nowMs: number, retentionMs: number = PREIMAGE_RETENTION_MS): Promise<number> {
    let swept = 0;
    await persistence.writeOwn((db) => {
        ensure(db);
        db.prepare('DELETE FROM preimage_pin WHERE pinned_at < ?').run(nowMs - retentionMs);
        const result = db.prepare('DELETE FROM preimage WHERE stored_at < ? AND hash NOT IN (SELECT hash FROM preimage_pin)').run(nowMs - retentionMs) as { changes?: number | bigint };
        swept = Number(result.changes ?? 0);
    });
    return swept;
}
