/**
 * node-knowledge/sqliteRows.ts — memory's `RowPersistence` over one SQLite file (G03, PRD 41 B4; design C0-C3).
 *
 * Tables: `meta(k, v)` (format, generation, per-root migration markers), `scope`, `fact`, `relation`, `recheck(hash)`
 * (one global set), `extracted(hash, json)` (bodies, loaded lazily per hash), `manifest(source_id, json)`, and `stat` (the plan's
 * stat manifest, read and written by `statRows.ts` only). `stat` is ADDITIVE: a reader of the same format that predates it
 * never looks at it, so it does not move {@link FORMAT_VERSION}.
 *
 * `apply` runs in ONE `BEGIN IMMEDIATE`, synchronously (node:sqlite is synchronous), so a body read can never see half of it:
 *   - it compares `meta.generation` with the generation this store last saw; on a mismatch another window wrote, and the
 *     full rows are read INSIDE the transaction, after the change, and returned as `reloaded` (bodies are not included);
 *   - every upsert is `ON CONFLICT DO UPDATE` and every delete is by key, so a retry with a SUPERSET of a committed change
 *     is idempotent;
 *   - the manifest buffer is drained in the same transaction (a manifest never runs ahead of its facts), and put back if
 *     the transaction fails.
 * A migration's import ({@link SqliteKnowledgeDb.transaction}) is ONE transaction of pre-built rows, written without yielding
 * to the event loop, so the write lock is held only for the writes themselves. Every apply and load runs on one gate, behind
 * whatever transaction is running. A file of a NEWER format is read, never written: every write path throws.
 */

import { filesManifestKey, type Extracted, type ScopeRecord, type StoredFact, type StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeSnapshot, RowChange, RowPersistence } from '@seanhogg/builderforce-memory/knowledge';
import type { ChunkFingerprint } from '@seanhogg/builderforce-memory/ingest';
import type { LocalSqliteDb } from '../node-local-sqlite.js';
import { writeManifestEntries, type ManifestBuffer, type ManifestSink, type PendingManifest } from './manifestBuffer.js';
import { deleteStatOf } from './statRows.js';

export const FORMAT_VERSION = '1';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scope(root_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fact(root_id TEXT NOT NULL, "key" TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(root_id, "key")) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS relation(root_id TEXT NOT NULL, from_ref TEXT NOT NULL, to_ref TEXT NOT NULL, kind TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(root_id, from_ref, to_ref, kind)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS recheck(hash TEXT PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS extracted(hash TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS manifest(source_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stat(root_id TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL, mtime_ns TEXT NOT NULL, file_id TEXT, hash TEXT NOT NULL, git_blob TEXT, PRIMARY KEY(root_id, path)) WITHOUT ROWID;
`;

/** The format a file was written with (0 for a new file with no `meta` table yet; any other failure, e.g. SQLITE_BUSY, is rethrown). The ONE reader. */
export function readFormat(db: LocalSqliteDb): number {
    try {
        const row = db.prepare("SELECT v FROM meta WHERE k = 'format'").get() as { v: string } | undefined;
        return Number(row?.v ?? 0);
    } catch (err) {
        // Only "no meta table yet" means a new file; a busy or failing file is not a new file.
        if (/no such table: meta/i.test(err instanceof Error ? err.message : String(err))) return 0;
        throw err;
    }
}

/** Creates the tables (idempotent). */
export function ensureSchema(db: LocalSqliteDb): void { db.exec(SCHEMA); }

const rows = <T>(db: LocalSqliteDb, sql: string, ...params: unknown[]): T[] => db.prepare(sql).all(...params) as T[];

/** What a migration may do inside its one transaction. */
export interface RowWriter {
    upsert(change: RowChange): void;
    upsertManifest(entries: Record<string, ChunkFingerprint[]>): void;
    setMeta(k: string, v: string): void;
    getMeta(k: string): string | undefined;
    /** The root already has a scope row or a files-manifest entry (a review has written it since the file was created). */
    hasRows(rootId: string): boolean;
}

export class SqliteKnowledgeDb implements RowPersistence, ManifestSink {
    /** The generation this store last saw. */
    private seen: number;
    private dataVersion: number;
    /** The `manifest_seq` this store last saw: a manifest-only commit elsewhere moves it (and not the generation). */
    private manifestSeen: string | undefined;
    /** One gate for every step that talks to the file about the whole store (apply, load, a migration's transaction). */
    private tail: Promise<unknown> = Promise.resolve();

    /** The file was written by a NEWER format: it is read, never written (every write throws). */
    readonly formatNewer: boolean;

    constructor(readonly db: LocalSqliteDb, private readonly buffer: ManifestBuffer) {
        // A newer file is checked BEFORE the schema statements: opening it must not write to it at all.
        this.formatNewer = readFormat(db) > Number(FORMAT_VERSION);
        if (!this.formatNewer) ensureSchema(db);
        this.seen = this.generation();
        this.dataVersion = this.readDataVersion();
        this.manifestSeen = this.manifestSeq();
    }

    assertWritable(): void {
        if (this.formatNewer) throw new Error(`knowledge_index_format_newer: this file was written by a newer BuilderForce (format ${this.getMeta('format')}); it is read-only here`);
    }

    /** Migrations in flight: a load, an apply and a changed-elsewhere check wait for them, so a read never races an import. */
    private readonly migrating = new Set<Promise<unknown>>();

    track<T>(run: Promise<T>): Promise<T> {
        this.migrating.add(run);
        const done = (): void => { this.migrating.delete(run); };
        run.then(done, done);
        return run;
    }

    private async settled(): Promise<void> { await Promise.allSettled([...this.migrating]); }

    private serial<T>(step: () => Promise<T> | T): Promise<T> {
        const run = this.tail.then(step);
        this.tail = run.catch(() => undefined);
        return run;
    }

    getMeta(k: string): string | undefined {
        return (this.db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v;
    }

    setMeta(k: string, v: string): void {
        this.assertWritable(); // every write path, public or not, refuses on a file of a newer format
        this.db.prepare('INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
    }

    private generation(): number { return Number(this.getMeta('generation') ?? 0); }

    private manifestSeq(): string | undefined { return this.getMeta('manifest_seq'); }

    private readDataVersion(): number {
        const row = this.db.prepare('PRAGMA data_version').get() as Record<string, unknown> | undefined;
        return Number(Object.values(row ?? {})[0] ?? 0);
    }

    /** Every row except the extract bodies (those load lazily per hash). */
    private readAll(): KnowledgeSnapshot {
        const facts: Record<string, StoredFact[]> = {};
        for (const r of rows<{ root_id: string; json: string }>(this.db, 'SELECT root_id, json FROM fact')) (facts[r.root_id] ??= []).push(JSON.parse(r.json) as StoredFact);
        const relations: Record<string, StoredRelation[]> = {};
        for (const r of rows<{ root_id: string; json: string }>(this.db, 'SELECT root_id, json FROM relation')) (relations[r.root_id] ??= []).push(JSON.parse(r.json) as StoredRelation);
        const recheck = rows<{ hash: string }>(this.db, 'SELECT hash FROM recheck').map((r) => r.hash);
        return {
            version: 1,
            scopes: rows<{ json: string }>(this.db, 'SELECT json FROM scope').map((r) => JSON.parse(r.json) as ScopeRecord),
            facts, relations,
            ...(recheck.length > 0 ? { recheck } : {}),
        };
    }

    async load(): Promise<KnowledgeSnapshot | undefined> {
        await this.settled();
        return this.serial(() => {
            this.db.exec('BEGIN');
            try {
                this.dataVersion = this.readDataVersion();
                this.seen = this.generation();
                this.manifestSeen = this.manifestSeq();
                const snap = this.readAll();
                return snap.scopes.length === 0 && Object.keys(snap.facts).length === 0 && !snap.recheck ? undefined : snap;
            } finally {
                this.db.exec('COMMIT');
            }
        });
    }

    /** Writes the rows of one change. The caller owns the transaction. */
    private writeChange(c: RowChange, mode: 'update' | 'keep' = 'update'): void {
        const { db } = this;
        // `keep` (a legacy import) never overwrites a row a newer review already wrote.
        const onConflict = (key: string): string => (mode === 'keep' ? `ON CONFLICT(${key}) DO NOTHING` : `ON CONFLICT(${key}) DO UPDATE SET json = excluded.json`);
        const upScope = db.prepare(`INSERT INTO scope(root_id, json) VALUES (?, ?) ${onConflict('root_id')}`);
        const upFact = db.prepare(`INSERT INTO fact(root_id, "key", json) VALUES (?, ?, ?) ${onConflict('root_id, "key"')}`);
        const upRel = db.prepare(`INSERT INTO relation(root_id, from_ref, to_ref, kind, json) VALUES (?, ?, ?, ?, ?) ${onConflict('root_id, from_ref, to_ref, kind')}`);
        const upExt = db.prepare(`INSERT INTO extracted(hash, json) VALUES (?, ?) ${onConflict('hash')}`);
        const upRecheck = db.prepare('INSERT INTO recheck(hash) VALUES (?) ON CONFLICT(hash) DO NOTHING');
        for (const s of c.upserts.scopes) upScope.run(s.rootId, JSON.stringify(s));
        for (const [root, f] of c.upserts.facts) upFact.run(root, f.key, JSON.stringify(f));
        for (const [root, r] of c.upserts.relations) upRel.run(root, r.from, r.to, r.kind, JSON.stringify(r));
        for (const [h, e] of c.upserts.extracted) upExt.run(h, JSON.stringify(e));
        for (const h of c.upserts.recheck) upRecheck.run(h);
        const delScope = db.prepare('DELETE FROM scope WHERE root_id = ?');
        const delFact = db.prepare('DELETE FROM fact WHERE root_id = ? AND "key" = ?');
        const delRel = db.prepare('DELETE FROM relation WHERE root_id = ? AND from_ref = ? AND to_ref = ? AND kind = ?');
        const delExt = db.prepare('DELETE FROM extracted WHERE hash = ?');
        const delRecheck = db.prepare('DELETE FROM recheck WHERE hash = ?');
        // A removed root takes its stat manifest with it.
        for (const id of c.deletes.scopes) { delScope.run(id); deleteStatOf(db, id); }
        for (const [root, key] of c.deletes.facts) delFact.run(root, key);
        for (const [root, from, to, kind] of c.deletes.relations) delRel.run(root, from, to, kind);
        for (const h of c.deletes.extracted) delExt.run(h);
        for (const h of c.deletes.recheck) delRecheck.run(h);
    }

    private rollback(): void {
        try { this.db.exec('ROLLBACK'); } catch { /* the statement already aborted the transaction */ }
    }

    /**
     * The manifest buffer is taken SYNCHRONOUSLY here, before any await: the store builds its delta and calls this in one tick, so
     * the entries taken are exactly those set before that delta was built. A `set` made later describes facts newer than this
     * delta and waits for the next one. A failure at any step puts the entries back.
     */
    apply(change: RowChange): Promise<{ generation: number; reloaded?: KnowledgeSnapshot }> {
        // Refuse BEFORE taking: a refused apply must not cycle the buffer's entries through take and restore.
        try { this.assertWritable(); } catch (err) { return Promise.reject(err); }
        const taken = this.buffer.take();
        return this.settled()
            .then(() => this.serial(() => this.applyTaken(change, taken)))
            .catch((err: unknown) => { this.buffer.restore(taken); throw err; });
    }

    private applyTaken(change: RowChange, taken: PendingManifest): { generation: number; reloaded?: KnowledgeSnapshot } {
        this.assertWritable();
        try {
            this.db.exec('BEGIN IMMEDIATE'); // inside the try: a BUSY here rolls back (a no-op) and restores the entries
            const current = this.generation();
            const mismatch = current !== this.seen;
            this.writeChange(change);
            writeManifestEntries(this.db, taken);
            const next = current + 1;
            this.setMeta('generation', String(next));
            this.setMeta('format', FORMAT_VERSION);
            const reloaded = mismatch ? this.readAll() : undefined;
            const version = this.readDataVersion(); // read inside the transaction every time, so the no-mismatch path refreshes it too
            const manifestSeq = this.manifestSeq();
            this.db.exec('COMMIT');
            // Only after the commit: a retry of a committed change then sees a mismatch and just reloads.
            this.seen = next;
            this.dataVersion = version;
            this.manifestSeen = manifestSeq;
            return { generation: next, ...(reloaded ? { reloaded } : {}) };
        } catch (err) {
            this.rollback();
            throw err;
        }
    }

    async loadExtracted(hash: string): Promise<Extracted[] | undefined> {
        const row = this.db.prepare('SELECT json FROM extracted WHERE hash = ?').get(hash) as { json: string } | undefined;
        return row ? JSON.parse(row.json) as Extracted[] : undefined;
    }

    async loadAllExtracted(): Promise<Record<string, Extracted[]>> {
        const out: Record<string, Extracted[]> = {};
        for (const r of rows<{ hash: string; json: string }>(this.db, 'SELECT hash, json FROM extracted')) out[r.hash] = JSON.parse(r.json) as Extracted[];
        return out;
    }

    /**
     * True when facts or the manifest changed since this connection last loaded or reloaded: the generation moved (this
     * connection's own migration included, which `data_version` never reports), or another connection committed
     * (`PRAGMA data_version`) a manifest-only change (`manifest_seq`). A commit that touched neither (another window's stat
     * manifest save) is taken as seen and reports false: it must not force a full fact reload.
     */
    async changedElsewhere(): Promise<boolean> {
        await this.settled();
        return this.serial(() => {
            if (this.generation() !== this.seen) return true;
            const version = this.readDataVersion();
            if (version === this.dataVersion) return false;
            if (this.manifestSeq() !== this.manifestSeen) return true;
            this.dataVersion = version;
            return false;
        });
    }

    async readCommitted(sourceId: string): Promise<ChunkFingerprint[] | undefined> {
        await this.settled(); // a legacy import in flight lands first
        const row = this.db.prepare('SELECT json FROM manifest WHERE source_id = ?').get(sourceId) as { json: string } | undefined;
        return row ? JSON.parse(row.json) as ChunkFingerprint[] : undefined;
    }

    /**
     * A manifest-only apply: the buffered entries (all, or only `only`) in their own transaction; no fact changed, so the
     * generation stays. The entries are taken when this is CALLED, so an entry set later waits for its own facts.
     */
    commitBuffered(only?: readonly string[]): Promise<void> {
        try { this.assertWritable(); } catch (err) { return Promise.reject(err); } // before taking, as in apply
        const taken = this.buffer.take(only);
        if (taken.size === 0) return Promise.resolve();
        return this.serial(() => {
            this.assertWritable();
            try {
                this.db.exec('BEGIN IMMEDIATE');
                writeManifestEntries(this.db, taken);
                // Other windows tell this manifest-only commit from a stat save by the sequence (see `changedElsewhere`).
                const seq = String(Number(this.manifestSeq() ?? 0) + 1);
                this.setMeta('manifest_seq', seq);
                this.setMeta('format', FORMAT_VERSION);
                this.db.exec('COMMIT');
                this.manifestSeen = seq;
            } catch (err) {
                this.rollback();
                throw err;
            }
        }).catch((err: unknown) => { this.buffer.restore(taken); throw err; });
    }

    /** ONE read transaction (a consistent view of several statements), on the gate. */
    readOwn<T>(work: (db: LocalSqliteDb) => T): Promise<T> {
        return this.serial(() => {
            this.db.exec('BEGIN');
            try {
                return work(this.db);
            } finally {
                this.db.exec('COMMIT');
            }
        });
    }

    /**
     * ONE write transaction of rows outside the fact graph (the plan's stat manifest, `statRows.ts`): on the gate, refused on a
     * file of a newer format. Neither the generation nor `manifest_seq` moves, so another window's `changedElsewhere` takes it
     * as seen and does not reload its facts for it.
     */
    writeOwn(work: (db: LocalSqliteDb) => void): Promise<void> {
        try { this.assertWritable(); } catch (err) { return Promise.reject(err); }
        return this.serial(() => {
            this.assertWritable();
            try {
                this.db.exec('BEGIN IMMEDIATE');
                work(this.db);
                this.setMeta('format', FORMAT_VERSION);
                this.db.exec('COMMIT');
            } catch (err) {
                this.rollback();
                throw err;
            }
        });
    }

    /** ONE transaction (a migration's). Every apply and load waits behind it. It commits when `work` resolves and rolls back when it throws. The generation moves only when rows were written. */
    transaction<T>(work: (w: RowWriter) => Promise<T> | T): Promise<T> {
        return this.serial(async () => {
            this.assertWritable();
            let wrote = false;
            try {
                this.db.exec('BEGIN IMMEDIATE');
                const out = await work({
                    // A legacy import keeps what a newer review already wrote.
                    upsert: (c) => { wrote = true; this.writeChange(c, 'keep'); },
                    upsertManifest: (e) => { wrote = true; writeManifestEntries(this.db, new Map(Object.entries(e)), 'keep'); },
                    setMeta: (k, v) => this.setMeta(k, v),
                    getMeta: (k) => this.getMeta(k),
                    hasRows: (rootId) => this.db.prepare('SELECT 1 AS x FROM scope WHERE root_id = ? UNION ALL SELECT 1 FROM manifest WHERE source_id = ? LIMIT 1').get(rootId, filesManifestKey(rootId)) !== undefined,
                });
                if (wrote) this.setMeta('generation', String(this.generation() + 1));
                this.db.exec('COMMIT');
                return out;
            } catch (err) {
                this.rollback();
                throw err;
            }
        });
    }

    close(): void { this.db.close(); }
}
