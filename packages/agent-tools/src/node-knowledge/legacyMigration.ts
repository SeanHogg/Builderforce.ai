/**
 * node-knowledge/legacyMigration.ts — imports a root's LEGACY knowledge files into the SQLite store (G03, C4).
 *
 * Legacy: `.builderforce/knowledge/<stem>.json` (the snapshot), `<stem>.manifest.json` and `<stem>.extracted.jsonl`.
 * Run it per root id, with the root's files wrapped by `migratingRootFiles` so a root reviewed under an older id imports
 * under its new one. The snapshot and the log are read by memory's own parsers (a read-only `localSnapshotStore` over the
 * text), never by a copy of them.
 *
 * One transaction holds every row and `meta.format` plus the root's marker; the rows are built first (yielding to the
 * event loop with `setImmediate` while they are built, before the transaction opens) and then written in chunks of at most
 * {@link CHUNK_ROWS} rows WITHOUT yielding, so the write lock is held only for the writes. After the commit the three files are renamed to
 * `*.migrated`; a later open that finds the marker and the files still there (a crash between commit and rename) renames
 * them again without importing. A snapshot that does not parse is kept as `.corrupt`, and the store starts empty for that
 * root. A window that meets SQLITE_BUSY waits and retries; once the marker is set it only renames.
 *
 * replica.json, dirty.json, analysis-pending.json and runs/ belong to the replica stack and are never touched.
 */

import { localSnapshotStore, type ScopeRecord } from '@seanhogg/builderforce-memory/knowledge';
import type { RowChange } from '@seanhogg/builderforce-memory/knowledge';
import type { ChunkFingerprint } from '@seanhogg/builderforce-memory/ingest';
import { extractedLogFileName, manifestFileName, snapshotFileName, type KnowledgeFiles } from '../knowledge/fileManifest.js';
import { isSqliteBusy } from '../node-local-sqlite.js';
import { FORMAT_VERSION, type SqliteKnowledgeDb } from './sqliteRows.js';

/** At most this many rows per statement batch. */
export const CHUNK_ROWS = 2_000;
const BUSY_WAIT_MS = 100;
/** A window that cannot get the write lock gives up after this long (another window's import is normally over in well under a second). */
export const BUSY_LIMIT_MS = 30_000;

export interface MigrationOptions {
    /** The root's pre-rename id: its own legacy files are renamed too (the read already copied them under the new id). */
    legacyRootId?: string;
    /** Receives the one-line outcome (rows and duration). */
    log?: (line: string) => void;
    /** How long to wait for another window's write lock before failing (default {@link BUSY_LIMIT_MS}). */
    busyLimitMs?: number;
}

export interface MigrationResult { imported: boolean; rows: number; corrupt: boolean }

const markerOf = (rootId: string): string => `migrated:${rootId}`;
const namesOf = (rootId: string): string[] => [snapshotFileName(rootId), manifestFileName(rootId), extractedLogFileName(rootId)];
const yieldTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const emptyChange = (): RowChange => ({
    upserts: { scopes: [], facts: [], relations: [], extracted: [], recheck: [] },
    deletes: { scopes: [], facts: [], relations: [], extracted: [], recheck: [] },
});

const changeRows = (c: RowChange): number => Object.values(c.upserts).reduce((n, rows) => n + rows.length, 0) + Object.values(c.deletes).reduce((n, rows) => n + rows.length, 0);

/** The rows of a legacy snapshot and log, read through memory's own store over the text. */
async function readLegacy(snapshotText: string | undefined, logText: string | undefined): Promise<{ change: RowChange[]; rows: number; corrupt: boolean }> {
    let corrupt = false;
    const legacy = localSnapshotStore(
        { read: async () => snapshotText, write: async () => undefined, keepAside: async () => { corrupt = true; } },
        { extractedLog: { read: async () => logText, append: async () => undefined } },
    );
    const chunks: RowChange[] = [emptyChange()];
    let inChunk = 0;
    const room = (): RowChange => {
        if (inChunk >= CHUNK_ROWS) { chunks.push(emptyChange()); inChunk = 0; }
        inChunk += 1;
        return chunks[chunks.length - 1]!;
    };
    let rows = 0;
    const scopes: ScopeRecord[] = await legacy.scopes();
    for (const s of scopes) {
        room().upserts.scopes.push(s);
        for (const f of await legacy.facts({ rootId: s.rootId })) room().upserts.facts.push([s.rootId, f]);
        for (const r of await legacy.relations({ rootId: s.rootId })) room().upserts.relations.push([s.rootId, r]);
        await yieldTurn(); // rows are built BEFORE the transaction opens, so the host breathes here and never while the write lock is held
    }
    for (const h of await legacy.recheckHashes()) room().upserts.recheck.push(h);
    for (const [h, e] of Object.entries(await legacy.extractedEntries())) room().upserts.extracted.push([h, e]);
    for (const c of chunks) rows += changeRows(c);
    return { change: chunks, rows, corrupt };
}

/** The legacy manifest's records. A manifest that does not parse is no manifest: every file plans as changed (slower, never wrong). */
function readManifestRecord(text: string | undefined): Record<string, ChunkFingerprint[]> {
    try {
        const parsed = JSON.parse(text ?? '{}') as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, ChunkFingerprint[]> : {};
    } catch { return {}; }
}

async function renameAside(files: KnowledgeFiles, rootIds: string[]): Promise<void> {
    if (!files.rename) return;
    for (const name of rootIds.flatMap(namesOf)) {
        try { await files.rename(name, `${name}.migrated`); } catch { /* not there (or still locked): the next open tries again */ }
    }
}

/** Keeps a snapshot that did not parse as `.corrupt` beside where it was. */
async function keepCorrupt(files: KnowledgeFiles, name: string, text: string): Promise<void> {
    if (files.rename) { try { await files.rename(name, `${name}.corrupt`); return; } catch { /* fall through to a copy */ } }
    await files.write(`${name}.corrupt`, text);
}

/**
 * Imports one root's legacy files. `target` is what `nodeKnowledgeStore` returned: the migration is tracked on its file, so the
 * store's first read waits for it. Call it BEFORE the root is read.
 */
export function migrateLegacyKnowledge(files: KnowledgeFiles, target: { persistence: SqliteKnowledgeDb }, rootId: string, opts: MigrationOptions = {}): Promise<MigrationResult> {
    return target.persistence.track(migrate(files, target.persistence, rootId, opts));
}

async function migrate(files: KnowledgeFiles, db: SqliteKnowledgeDb, rootId: string, opts: MigrationOptions): Promise<MigrationResult> {
    const ids = opts.legacyRootId && opts.legacyRootId !== rootId ? [rootId, opts.legacyRootId] : [rootId];
    const marker = markerOf(rootId);
    if (db.getMeta(marker)) {
        await renameAside(files, ids);
        return { imported: false, rows: 0, corrupt: false };
    }
    const started = Date.now();
    const [snapshotText, manifestText, logText] = await Promise.all(namesOf(rootId).map((n) => files.read(n)));
    const { change, rows, corrupt } = await readLegacy(snapshotText, logText);
    // A manifest that outlived its facts would skip files whose knowledge is gone: with no facts, nothing is skipped.
    const manifest = corrupt ? {} : readManifestRecord(manifestText);
    const manifestIds = Object.keys(manifest);

    const deadline = Date.now() + (opts.busyLimitMs ?? BUSY_LIMIT_MS);
    let imported = false;
    for (;;) {
        try {
            // The transaction is pure writes of pre-built rows: no yield while it holds the write lock.
            imported = await db.transaction((w) => {
                if (w.getMeta(marker)) return false; // another window finished first
                // A root a review has already written (an earlier import failed and the session went on) is NEVER imported over:
                // the legacy rows are older than what is there. Mark it migrated and only rename the files.
                if (w.hasRows(rootId)) { w.setMeta(marker, '1'); return false; }
                // An empty chunk writes no row, so it must not count as a write (the generation moves only for real rows).
                for (const c of change) if (changeRows(c) > 0) w.upsert(c);
                for (let i = 0; i < manifestIds.length; i += CHUNK_ROWS) {
                    w.upsertManifest(Object.fromEntries(manifestIds.slice(i, i + CHUNK_ROWS).map((id) => [id, manifest[id]!])));
                }
                w.setMeta('format', FORMAT_VERSION);
                w.setMeta(marker, '1');
                return true;
            });
            break;
        } catch (err) {
            if (!isSqliteBusy(err)) throw err;
            if (Date.now() >= deadline) throw new Error(`knowledge_migration_busy: another window held the knowledge index write lock for more than ${(opts.busyLimitMs ?? BUSY_LIMIT_MS) / 1000} s; the legacy files of ${rootId} are kept and imported on the next open`, { cause: err });
            await sleep(BUSY_WAIT_MS);
            if (db.getMeta(marker)) break; // the other window set `format`: only the rename is left
        }
    }
    if (corrupt && snapshotText !== undefined) await keepCorrupt(files, snapshotFileName(rootId), snapshotText);
    await renameAside(files, ids);
    opts.log?.(`knowledge: migrated legacy files of ${rootId} (${rows} rows, ${manifestIds.length} manifest entries${corrupt ? ', snapshot corrupt' : ''}) in ${Date.now() - started} ms`);
    return { imported, rows, corrupt };
}
