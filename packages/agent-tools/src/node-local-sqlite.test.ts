import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addProcessWarningRule, isCorruptError, isNetworkPath, isSqliteBusy, isSqliteExperimentalWarning, journalModeWanted, localSqliteAvailable, openLocalSqlite } from './node-local-sqlite.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function dbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'local-sqlite-'));
    dirs.push(dir);
    return join(dir, 'x.sqlite');
}

const sqliteError = (message: string, errcode: number) => Object.assign(new Error(message), { errcode });
const KNOWLEDGE = { busyTimeoutMs: 100, check: true, wal: true } as const;

describe('journal mode choice (pure)', () => {
    it('uses DELETE from the start on a UNC share or a WSL path, WAL otherwise', () => {
        for (const p of ['\\\\server\\share\\x.sqlite', '\\\\wsl$\\Ubuntu\\home\\x.sqlite', '//server/share/x.sqlite']) {
            expect(isNetworkPath(p)).toBe(true);
            expect(journalModeWanted(p)).toBe('delete');
        }
        for (const p of ['C:\\work\\x.sqlite', '/home/me/x.sqlite', 'relative/x.sqlite']) {
            expect(isNetworkPath(p)).toBe(false);
            expect(journalModeWanted(p)).toBe('wal');
        }
    });
});

describe('error classification (pure)', () => {
    it('only SQLITE_CORRUPT (11) and SQLITE_NOTADB (26), with their extended codes, are corruption', () => {
        expect(isCorruptError(sqliteError('database disk image is malformed', 11))).toBe(true);
        expect(isCorruptError(sqliteError('file is not a database', 26))).toBe(true);
        expect(isCorruptError(sqliteError('corrupt vtab', 11 | (1 << 8)))).toBe(true);
        expect(isCorruptError(new Error('file is not a database'))).toBe(true); // no code: SQLite's own message
        for (const [msg, code] of [['attempt to write a readonly database', 8], ['disk I/O error', 10], ['database or disk is full', 13], ['unable to open database file', 14], ['operation not permitted', 3], ['database is locked', 5]] as const) {
            expect(isCorruptError(sqliteError(msg, code))).toBe(false);
        }
        expect(isCorruptError(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }))).toBe(false);
    });

    it('ONE busy predicate: SQLITE_BUSY / SQLITE_LOCKED by code or message', () => {
        expect(isSqliteBusy(sqliteError('database is locked', 5))).toBe(true);
        expect(isSqliteBusy(sqliteError('database table is locked', 6))).toBe(true);
        expect(isSqliteBusy(new Error('SQLITE_BUSY: database is locked'))).toBe(true);
        expect(isSqliteBusy(sqliteError('disk I/O error', 10))).toBe(false);
        expect(isSqliteBusy(undefined)).toBe(false);
    });
});

describe('the one process warning filter', () => {
    it('drops the SQLite ExperimentalWarning and any rule a host adds, and keeps every other warning', async () => {
        expect(isSqliteExperimentalWarning({ name: 'ExperimentalWarning', message: 'SQLite is an experimental feature and might change at any time' })).toBe(true);
        expect(isSqliteExperimentalWarning({ name: 'Warning', message: 'SQLite is an experimental feature' })).toBe(false);
        const base = process.emitWarning;
        const seen: string[] = [];
        const onWarning = (w: Error & { code?: string }) => { seen.push(w.code ?? w.name); };
        process.on('warning', onWarning);
        try {
            addProcessWarningRule((w) => w.code === 'BF_TEST_DROP');
            const emit = (...a: unknown[]) => (process.emitWarning as unknown as (...x: unknown[]) => void)(...a);
            emit('dropped', { type: 'Warning', code: 'BF_TEST_DROP' });
            emit('kept', { type: 'Warning', code: 'BF_TEST_KEEP' });
            await new Promise((r) => setImmediate(r));
            expect(seen).toContain('BF_TEST_KEEP');
            expect(seen).not.toContain('BF_TEST_DROP');
        } finally {
            process.off('warning', onWarning);
            process.emitWarning = base;
            delete (globalThis as Record<symbol, unknown>)[Symbol.for('builderforce.warning-filter')];
        }
    });
});

// node:sqlite ships unflagged from Node 22.13; an older Node cannot open the store at all.
describe.skipIf(!localSqliteAvailable())('openLocalSqlite', () => {
    it('with `wal` opens a writable file in WAL and reports the mode', () => {
        const { db, journalMode } = openLocalSqlite(dbPath(), KNOWLEDGE);
        try {
            expect(journalMode).toBe('wal');
            db.exec('CREATE TABLE t(a)');
            db.prepare('INSERT INTO t VALUES (?)').run(1);
            expect(db.prepare('SELECT a FROM t').all()).toEqual([{ a: 1 }]);
        } finally { db.close(); }
    });

    it('with `check` refuses a corrupt file with local_record_store_corrupt and leaves its bytes alone', () => {
        const path = dbPath();
        writeFileSync(path, 'this is not a sqlite database, it is a torn write'.repeat(20));
        expect(() => openLocalSqlite(path, KNOWLEDGE)).toThrow(/local_record_store_corrupt/);
        expect(readFileSync(path, 'utf8')).toMatch(/^this is not a sqlite database/);
    });

    it('without `check` or `wal` it runs neither quick_check nor a journal-mode request (the memory index keeps its old behaviour)', () => {
        const path = dbPath();
        writeFileSync(path, 'this is not a sqlite database'.repeat(20));
        const { db, journalMode } = openLocalSqlite(path, { busyTimeoutMs: 0 });
        try {
            expect(journalMode).toBe('unchanged');
            expect(() => db.prepare('SELECT 1 FROM sqlite_master').all()).toThrow(); // the caller's read fails, not the open
        } finally { db.close(); }
        const fresh = openLocalSqlite(dbPath(), { busyTimeoutMs: 0 });
        try { expect(fresh.db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' }); } finally { fresh.db.close(); }
    });

    it('falls back to DELETE (never throws) when the file system will not give WAL, and reports the mode it got', () => {
        // An in-memory database answers `memory` to a WAL request.
        const { db, journalMode } = openLocalSqlite(':memory:', KNOWLEDGE);
        try { expect(journalMode).not.toBe('wal'); } finally { db.close(); }
    });

    it('a read-only open skips WAL and the check, and cannot write', () => {
        const path = dbPath();
        const writer = openLocalSqlite(path, KNOWLEDGE);
        writer.db.exec('CREATE TABLE t(a)');
        writer.db.close();
        const { db, journalMode } = openLocalSqlite(path, { readOnly: true, busyTimeoutMs: 1, check: true, wal: true });
        try {
            expect(journalMode).toBe('readonly');
            expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 });
            expect(() => db.exec('INSERT INTO t VALUES (1)')).toThrow();
        } finally { db.close(); }
    });

    it('a read-only open of a corrupt file runs no quick_check: the failure is the SQLite read error, not local_record_store_corrupt', () => {
        const path = dbPath();
        writeFileSync(path, 'not sqlite'.repeat(50));
        const attempt = () => {
            const { db } = openLocalSqlite(path, { readOnly: true, busyTimeoutMs: 1, check: true });
            try { db.prepare('SELECT 1 FROM sqlite_master').all(); } finally { db.close(); }
        };
        expect(attempt).toThrow();
        expect(attempt).not.toThrow(/local_record_store_corrupt/);
    });

    it('opens with extension loading allowed', () => {
        const { db } = openLocalSqlite(dbPath(), { allowExtension: true, ...KNOWLEDGE });
        db.close();
    });

    it('lets two connections to one file commit in turn, with a busy timeout set', () => {
        const path = dbPath();
        const first = openLocalSqlite(path, { ...KNOWLEDGE, busyTimeoutMs: 1000 });
        const second = openLocalSqlite(path, { ...KNOWLEDGE, busyTimeoutMs: 1000 });
        try {
            first.db.exec('CREATE TABLE t(a)');
            first.db.prepare('INSERT INTO t VALUES (?)').run(1);
            second.db.prepare('INSERT INTO t VALUES (?)').run(2);
            expect(first.db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 2 });
        } finally { first.db.close(); second.db.close(); }
    });
});
