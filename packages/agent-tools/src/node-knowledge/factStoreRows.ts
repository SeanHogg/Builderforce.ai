/**
 * node-knowledge/factStoreRows.ts — memory's `FactStorePort` (PRD 41 §B4) on the folder's G03 knowledge SQLite file
 * (`index.sqlite`, the SAME file and connection gate as the knowledge rows): no second SQLite path.
 *
 * EXPAND-ONLY tables (`CREATE TABLE IF NOT EXISTS`, created on the first write; reads tolerate a file without them), keyed
 * by the root id because one folder file holds every root reviewed in it — the same no-format-bump reasoning as `stat` and
 * `preimage`: an older build ignores them, so `FORMAT_VERSION` stays 1:
 *   - `fact_version(root_id, epoch, generation)`: the store version of the root (absent ⇒ epoch '' at generation 0);
 *   - `fact_object(root_id, hash, json)`: each FileFacts' canonical JSON under its `factsHash`, write-once;
 *   - `fact_manifest(root_id, path, json)`: path → manifest entry;
 *   - `fact_derived(root_id, key, json)`: each derived rule row with its input-hash trace.
 *
 * Every write is ONE `BEGIN IMMEDIATE` transaction on the store's gate (`writeOwn`): the write lock is taken BEFORE the
 * version is compared, so two processes never both pass the check (memory's adapter rule). Writes never move the knowledge
 * rows' generation. Reads are one transaction each (`readOwn`).
 */

import type { DerivedRow, FactManifestEntry, FactStoreManifest, FactStorePort, FactStoreVersion } from '@seanhogg/builderforce-memory/knowledge';
import type { LocalSqliteDb } from '../node-local-sqlite.js';
import type { SqliteKnowledgeDb } from './sqliteRows.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fact_version(root_id TEXT PRIMARY KEY, epoch TEXT NOT NULL, generation INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fact_object(root_id TEXT NOT NULL, hash TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(root_id, hash)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS fact_manifest(root_id TEXT NOT NULL, path TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(root_id, path)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS fact_derived(root_id TEXT NOT NULL, "key" TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(root_id, "key")) WITHOUT ROWID;
`;

const ensure = (db: LocalSqliteDb): void => db.exec(SCHEMA);
const missingTable = (err: unknown): boolean => /no such table: fact_/i.test(err instanceof Error ? err.message : String(err));
const conflict = (why: string) => new Error(`fact_store_generation_conflict:${why}`);
const derivedKey = (row: DerivedRow) => `${row.rule}\u0000${row.focus}`;

function newEpoch(): string {
    const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
    return uuid ?? `epoch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** A read of tables that may not exist yet: the empty answer when they do not. */
function tolerant<T>(read: () => T, empty: T): T {
    try { return read(); } catch (err) { if (missingTable(err)) return empty; throw err; }
}

function versionOf(db: LocalSqliteDb, rootId: string): FactStoreVersion {
    const row = tolerant(() => db.prepare('SELECT epoch, generation FROM fact_version WHERE root_id = ?').get(rootId) as { epoch: string; generation: number | bigint } | undefined, undefined);
    return row ? { epoch: row.epoch, generation: Number(row.generation) } : { epoch: '', generation: 0 };
}

const setVersion = (db: LocalSqliteDb, rootId: string, v: FactStoreVersion): void => {
    db.prepare('INSERT INTO fact_version(root_id, epoch, generation) VALUES (?, ?, ?) ON CONFLICT(root_id) DO UPDATE SET epoch = excluded.epoch, generation = excluded.generation')
        .run(rootId, v.epoch, v.generation);
};

/** The fact store of one root in the folder's knowledge file. */
export function sqliteFactStore(persistence: SqliteKnowledgeDb, rootId: string): FactStorePort {
    return {
        getObjects: (hashes) => persistence.readOwn((db) => {
            const out = new Map<string, string>();
            tolerant(() => {
                const get = db.prepare('SELECT json FROM fact_object WHERE root_id = ? AND hash = ?');
                for (const hash of new Set(hashes)) {
                    const row = get.get(rootId, hash) as { json: string } | undefined;
                    if (row) out.set(hash, row.json);
                }
            }, undefined);
            return out;
        }),
        putObjects: (objects) => (objects.size === 0 ? undefined : persistence.writeOwn((db) => {
            ensure(db);
            const put = db.prepare('INSERT OR IGNORE INTO fact_object(root_id, hash, json) VALUES (?, ?, ?)');
            for (const [hash, json] of objects) put.run(rootId, hash, json);
        })),
        readVersion: () => persistence.readOwn((db) => versionOf(db, rootId)),
        readManifest: () => persistence.readOwn((db): FactStoreManifest => {
            const v = versionOf(db, rootId);
            const rows = tolerant(() => db.prepare('SELECT path, json FROM fact_manifest WHERE root_id = ?').all(rootId) as Array<{ path: string; json: string }>, []);
            return { ...v, files: new Map(rows.map((r) => [r.path, JSON.parse(r.json) as FactManifestEntry] as const)) };
        }),
        writeManifest: (delta, derivedPuts, derivedDeletes) => persistence.writeOwn((db) => {
            ensure(db);
            const stored = versionOf(db, rootId);
            if (delta.epoch !== stored.epoch || delta.generation !== stored.generation + 1) {
                throw conflict(`${stored.epoch}@${stored.generation}->${delta.epoch}@${delta.generation}`);
            }
            const has = db.prepare('SELECT 1 AS ok FROM fact_object WHERE root_id = ? AND hash = ?');
            for (const e of delta.puts.values()) if (!has.get(rootId, e.factsHash)) throw new Error(`fact_store_object_missing:${e.factsHash}`);
            const putEntry = db.prepare('INSERT INTO fact_manifest(root_id, path, json) VALUES (?, ?, ?) ON CONFLICT(root_id, path) DO UPDATE SET json = excluded.json');
            const delEntry = db.prepare('DELETE FROM fact_manifest WHERE root_id = ? AND path = ?');
            const putRow = db.prepare('INSERT INTO fact_derived(root_id, "key", json) VALUES (?, ?, ?) ON CONFLICT(root_id, "key") DO UPDATE SET json = excluded.json');
            const delRow = db.prepare('DELETE FROM fact_derived WHERE root_id = ? AND "key" = ?');
            for (const [path, e] of delta.puts) putEntry.run(rootId, path, JSON.stringify(e));
            for (const path of delta.deletes) delEntry.run(rootId, path);
            for (const row of derivedPuts) putRow.run(rootId, derivedKey(row), JSON.stringify(row));
            for (const key of derivedDeletes) delRow.run(rootId, key);
            setVersion(db, rootId, { epoch: delta.epoch, generation: delta.generation });
        }),
        derivedRows: () => persistence.readOwn((db) => {
            const rows = tolerant(() => db.prepare('SELECT "key" AS k, json FROM fact_derived WHERE root_id = ?').all(rootId) as Array<{ k: string; json: string }>, []);
            return new Map(rows.map((r) => [r.k, JSON.parse(r.json) as DerivedRow] as const));
        }),
        sweepObjects: async (expected) => {
            let removed = 0;
            await persistence.writeOwn((db) => {
                ensure(db);
                const stored = versionOf(db, rootId);
                if (expected.epoch !== stored.epoch || expected.generation !== stored.generation) {
                    throw conflict(`${stored.epoch}@${stored.generation}->${expected.epoch}@${expected.generation}`);
                }
                const live = new Set((db.prepare('SELECT json FROM fact_manifest WHERE root_id = ?').all(rootId) as Array<{ json: string }>)
                    .map((r) => (JSON.parse(r.json) as FactManifestEntry).factsHash));
                const del = db.prepare('DELETE FROM fact_object WHERE root_id = ? AND hash = ?');
                for (const { hash } of db.prepare('SELECT hash FROM fact_object WHERE root_id = ?').all(rootId) as Array<{ hash: string }>) {
                    if (!live.has(hash)) { del.run(rootId, hash); removed++; }
                }
                if (removed > 0) setVersion(db, rootId, { epoch: stored.epoch, generation: stored.generation + 1 });
            });
            return removed;
        },
        reset: () => persistence.writeOwn((db) => {
            ensure(db);
            for (const table of ['fact_object', 'fact_manifest', 'fact_derived']) db.prepare(`DELETE FROM ${table} WHERE root_id = ?`).run(rootId);
            setVersion(db, rootId, { epoch: newEpoch(), generation: 0 });
        }),
    };
}
