/**
 * node-knowledge/openKnowledgeDb.ts — where a workspace folder keeps its knowledge SQLite file, and the workspace hygiene
 * of the first open (G03, PRD 41 B4): `<folder>/.builderforce/cache/knowledge/index.sqlite`, with
 * `<folder>/.builderforce/cache/.gitignore` holding `*` so the cache is never committed (the repo's own .gitignore is never
 * edited).
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openLocalSqlite, type OpenedLocalSqlite } from '../node-local-sqlite.js';
import { ManifestBuffer } from './manifestBuffer.js';
import { FORMAT_VERSION, SqliteKnowledgeDb, readFormat } from './sqliteRows.js';

/** How long a statement waits on another window's write lock. */
export const KNOWLEDGE_BUSY_TIMEOUT_MS = 5_000;

export const knowledgeCacheDir = (folderDir: string): string => join(folderDir, '.builderforce', 'cache');
export const knowledgeDbPath = (folderDir: string): string => join(knowledgeCacheDir(folderDir), 'knowledge', 'index.sqlite');

export interface OpenKnowledgeDb {
    persistence: SqliteKnowledgeDb;
    buffer: ManifestBuffer;
    /** `wal`, or `delete` on a network share. */
    journalMode: string;
    /** Set when the file was corrupt: where its bytes were moved, and the store started empty. */
    recoveredFrom?: string;
}

/** What the knowledge store asks of the opener: the corruption check and WAL are on here (and only here). */
const knowledgeOpen = (busyTimeoutMs: number, wal = true) => ({ busyTimeoutMs, check: true, wal });

/**
 * The `format` a file already on disk was written with, read through a READ-ONLY connection (0 when there is no file, no `meta`
 * table, or anything else is wrong: the real open then classifies the file). It lets the open skip `PRAGMA journal_mode = WAL`
 * on a file of a newer format, since that pragma writes the file header and a newer file must not be touched.
 */
function peekFormat(path: string, busyTimeoutMs: number): number {
    if (!existsSync(path)) return 0;
    try {
        const { db } = openLocalSqlite(path, { readOnly: true, busyTimeoutMs });
        try {
            return readFormat(db);
        } finally {
            db.close();
        }
    } catch {
        return 0;
    }
}

/**
 * Moves a corrupt file (and its -wal / -shm) aside as `<path>.corrupt-<timestamp>`; the bytes are kept for recovery. ALL OR
 * NOTHING: the sidecars go first and the main file last, and any failure (a file another window still holds) puts every file back.
 * Only a SQLITE_CORRUPT / SQLITE_NOTADB open reaches this (see `isCorruptError`); no other open error moves a file.
 */
export function moveAside(path: string): string {
    const aside = `${path}.corrupt-${Date.now()}`;
    const moved: string[] = [];
    try {
        for (const suffix of ['-wal', '-shm', '']) {
            if (!existsSync(`${path}${suffix}`)) continue;
            renameSync(`${path}${suffix}`, `${aside}${suffix}`);
            moved.push(suffix);
        }
    } catch (err) {
        for (const suffix of moved.reverse()) {
            try { renameSync(`${aside}${suffix}`, `${path}${suffix}`); } catch { /* best effort: the bytes are still under the aside name */ }
        }
        throw err;
    }
    return aside;
}

/** Opens the folder's knowledge file (creating it, its folder and the cache's `.gitignore`). THROWS `LocalSqliteUnavailableError` / `local_record_store_corrupt`. */
export function openKnowledgeDb(folderDir: string, busyTimeoutMs = KNOWLEDGE_BUSY_TIMEOUT_MS): OpenKnowledgeDb {
    const path = knowledgeDbPath(folderDir);
    mkdirSync(join(knowledgeCacheDir(folderDir), 'knowledge'), { recursive: true });
    try {
        // `wx`: written once; a person's own edit of this file is left alone.
        writeFileSync(join(knowledgeCacheDir(folderDir), '.gitignore'), '*\n', { flag: 'wx' });
    } catch { /* already there (or a read-only folder: the cache still works) */ }
    let recoveredFrom: string | undefined;
    let opened: OpenedLocalSqlite;
    try {
        opened = openLocalSqlite(path, knowledgeOpen(busyTimeoutMs, !(peekFormat(path, busyTimeoutMs) > Number(FORMAT_VERSION))));
    } catch (err) {
        // A corrupt file must not block the root forever: keep its bytes aside, start empty, and the next review re-indexes. The
        // opener says `local_record_store_corrupt` only for SQLITE_CORRUPT / NOTADB / a failed quick_check; READONLY, IOERR, FULL,
        // EPERM and the rest are rethrown as they are, and a healthy file is never moved.
        if (!(err instanceof Error) || err.message !== 'local_record_store_corrupt') throw err;
        try {
            recoveredFrom = moveAside(path);
        } catch {
            throw err; // could not move it safely (another window holds it): report the corruption, change nothing
        }
        opened = openLocalSqlite(path, knowledgeOpen(busyTimeoutMs));
    }
    const buffer = new ManifestBuffer();
    let persistence: SqliteKnowledgeDb;
    try {
        persistence = new SqliteKnowledgeDb(opened.db, buffer); // can throw (e.g. SQLITE_BUSY reading the format): never leak the handle
    } catch (err) {
        try { opened.db.close(); } catch { /* already unusable */ }
        throw err;
    }
    return { persistence, buffer, journalMode: opened.journalMode, ...(recoveredFrom ? { recoveredFrom } : {}) };
}
