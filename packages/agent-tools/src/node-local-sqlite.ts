/**
 * node-local-sqlite.ts — the ONE loader and opener of `node:sqlite` for every Node host (VS Code extension host,
 * on-prem agent-runtime). G03 (PRD 41 B4, design `local-first-closure-g03-g21-g23-g27.md` C5).
 *
 * `node:sqlite` is loaded at RUNTIME, never imported: it exists from Node 22.13 (unflagged), and a host on an older
 * Node must still start. Such a host gets {@link LocalSqliteUnavailableError}, which a caller catches.
 *
 * {@link openLocalSqlite} always sets a busy timeout (a held writer is waited on, not stolen from). Two options are OPT-IN,
 * and only the knowledge store turns them on:
 *   - `check`: run `quick_check`; a file that is not a database, is malformed, or fails the check is refused with
 *     `local_record_store_corrupt`, never opened as an empty store. ONLY SQLITE_CORRUPT (11) and SQLITE_NOTADB (26) are
 *     corruption: a READONLY, IOERR, FULL, BUSY or EPERM failure is rethrown as it is (see {@link isCorruptError});
 *   - `wal`: ask for WAL; when the pragma does not answer `wal`, or the path is a network share (UNC, `\\wsl$`), use
 *     `journal_mode = DELETE`. The mode is reported.
 * A read-only open skips both.
 *
 * It also owns the process warning filter (one wrapper of `process.emitWarning`, rules added by whoever needs one): the
 * SQLite ExperimentalWarning rule is installed on load, and agent-runtime adds its own rules to the same filter.
 *
 * Node-only: this module is published behind its own export condition and the package root never imports it.
 */

import { createRequire } from 'node:module';

/** The slice of `node:sqlite`'s statement this package uses. */
export interface LocalSqliteStatement {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
}

/** The slice of `node:sqlite`'s `DatabaseSync` this package uses (kept structural: older `@types/node` have no `node:sqlite`). */
export interface LocalSqliteDb {
    exec(sql: string): void;
    prepare(sql: string): LocalSqliteStatement;
    close(): void;
}

export interface LocalSqliteConstructorOptions { readOnly?: boolean; allowExtension?: boolean }
export type LocalSqliteConstructor = new (path: string, options?: LocalSqliteConstructorOptions) => LocalSqliteDb;

/** This host's runtime has no `node:sqlite` (Node < 22.13, or a distribution built without it). */
export class LocalSqliteUnavailableError extends Error {
    readonly code = 'sqlite_unavailable';
    constructor(cause: unknown) {
        super('sqlite_unavailable: node:sqlite is not available in this Node runtime');
        this.cause = cause;
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The process warning filter: ONE wrapper of `process.emitWarning`, with rules added by each host.
// ---------------------------------------------------------------------------------------------------------------------

export type ProcessWarning = { code?: string; name?: string; message?: string };
type WarningRule = (warning: ProcessWarning) => boolean;
type WarningFilterState = { installed: boolean; rules: WarningRule[] };

const warningFilterKey = Symbol.for('builderforce.warning-filter');

/** `node:sqlite` prints an ExperimentalWarning on first load. */
export const isSqliteExperimentalWarning: WarningRule = (w) => w.name === 'ExperimentalWarning' && !!w.message?.includes('SQLite is an experimental feature');

function normalizeWarningArgs(args: unknown[]): ProcessWarning {
    const [first, second, third] = args;
    let name: string | undefined;
    let code: string | undefined;
    let message: string | undefined;
    if (first instanceof Error) {
        name = first.name;
        message = first.message;
        code = (first as Error & { code?: string }).code;
    } else if (typeof first === 'string') {
        message = first;
    }
    if (second && typeof second === 'object' && !Array.isArray(second)) {
        const options = second as { type?: unknown; code?: unknown };
        if (typeof options.type === 'string') name = options.type;
        if (typeof options.code === 'string') code = options.code;
    } else {
        if (typeof second === 'string') name = second;
        if (typeof third === 'string') code = third;
    }
    return { name, code, message };
}

/** Adds a rule (true = drop the warning) to the process's one warning filter, installing the filter the first time. */
export function addProcessWarningRule(rule: WarningRule): void {
    const g = globalThis as typeof globalThis & { [warningFilterKey]?: WarningFilterState };
    const state = (g[warningFilterKey] ??= { installed: false, rules: [] });
    if (!state.rules.includes(rule)) state.rules.push(rule);
    if (state.installed) return;
    state.installed = true;
    const original = process.emitWarning.bind(process);
    process.emitWarning = ((...args: unknown[]) => {
        const warning = normalizeWarningArgs(args);
        if (state.rules.some((r) => r(warning))) return;
        return Reflect.apply(original, process, args);
    }) as typeof process.emitWarning;
}

// ---------------------------------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------------------------------

/** A held lock (SQLITE_BUSY / SQLITE_LOCKED): not corruption, not fatal; the caller waits and retries. The ONE predicate. */
export function isSqliteBusy(err: unknown): boolean {
    const code = (err as { errcode?: unknown } | null)?.errcode;
    if (typeof code === 'number' && ((code & 0xff) === 5 || (code & 0xff) === 6)) return true;
    return /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(err instanceof Error ? err.message : String(err));
}

/**
 * True ONLY for SQLITE_CORRUPT (11) and SQLITE_NOTADB (26), including their extended codes. A READONLY, IOERR, FULL, PERM or
 * CANTOPEN failure is NOT corruption: moving a healthy file aside for one would lose a good index. An error without a code is
 * judged by SQLite's two messages.
 */
export function isCorruptError(err: unknown): boolean {
    const code = (err as { errcode?: unknown } | null)?.errcode;
    if (typeof code === 'number') return (code & 0xff) === 11 || (code & 0xff) === 26;
    return /file is not a database|database disk image is malformed/i.test(err instanceof Error ? err.message : String(err));
}

// ---------------------------------------------------------------------------------------------------------------------
// Loader and opener
// ---------------------------------------------------------------------------------------------------------------------

let loaded: { DatabaseSync: LocalSqliteConstructor } | undefined;

/** The `node:sqlite` module. THROWS {@link LocalSqliteUnavailableError} when the runtime has none. */
export function loadNodeSqlite(): { DatabaseSync: LocalSqliteConstructor } {
    if (loaded) return loaded;
    addProcessWarningRule(isSqliteExperimentalWarning);
    try {
        const mod = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync?: LocalSqliteConstructor };
        if (typeof mod.DatabaseSync !== 'function') throw new Error('node:sqlite has no DatabaseSync');
        loaded = { DatabaseSync: mod.DatabaseSync };
        return loaded;
    } catch (err) {
        throw new LocalSqliteUnavailableError(err);
    }
}

/** True when this runtime can open a local SQLite file. */
export function localSqliteAvailable(): boolean {
    try { loadNodeSqlite(); return true; } catch { return false; }
}

/** A UNC share or a WSL path: WAL needs shared memory that such a file system does not give. */
export function isNetworkPath(path: string): boolean {
    return /^[\\/]{2}/.test(path);
}

/** The journal mode to ask for: WAL, except on a network share (UNC, `\\wsl$`), where it is `DELETE` from the start. */
export const journalModeWanted = (path: string): 'wal' | 'delete' => (isNetworkPath(path) ? 'delete' : 'wal');

export interface OpenLocalSqliteOptions {
    readOnly?: boolean;
    allowExtension?: boolean;
    /** How long a statement waits on another connection's lock before failing busy. */
    busyTimeoutMs: number;
    /** Run `quick_check` and refuse a corrupt file. Opt-in (the knowledge store). Ignored when read-only. */
    check?: boolean;
    /** Ask for WAL (DELETE on a network share or when WAL is refused). Opt-in (the knowledge store). Ignored when read-only. */
    wal?: boolean;
}

export interface OpenedLocalSqlite<Db = LocalSqliteDb> {
    db: Db;
    /** The journal mode the file is in (`wal`, `delete`, ...); `readonly` for a read-only open. */
    journalMode: string;
}

const firstValue = (rows: unknown[]): unknown => Object.values((rows[0] ?? {}) as Record<string, unknown>)[0];

/** Opens (creating) a local SQLite file. `Db` lets a caller that holds `node:sqlite`'s own types use them. */
export function openLocalSqlite<Db = LocalSqliteDb>(path: string, opts: OpenLocalSqliteOptions): OpenedLocalSqlite<Db> {
    const { DatabaseSync } = loadNodeSqlite();
    const readOnly = !!opts.readOnly;
    const db = new DatabaseSync(path, { ...(readOnly ? { readOnly: true } : {}), ...(opts.allowExtension ? { allowExtension: true } : {}) });
    const fail = (err: unknown, asCorrupt: boolean): never => {
        try { db.close(); } catch { /* already unusable */ }
        if (asCorrupt) throw Object.assign(new Error('local_record_store_corrupt'), { cause: err, path });
        throw err;
    };
    try {
        db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(opts.busyTimeoutMs))}`);
        if (readOnly) return { db: db as unknown as Db, journalMode: 'readonly' };
        if (opts.check && firstValue(db.prepare('PRAGMA quick_check').all()) !== 'ok') return fail(new Error('quick_check failed'), true);
        let journalMode: string;
        if (opts.wal) {
            const wanted = journalModeWanted(path);
            journalMode = String(firstValue(db.prepare(`PRAGMA journal_mode = ${wanted}`).all()) ?? '').toLowerCase();
            if (wanted === 'wal' && journalMode !== 'wal') {
                journalMode = String(firstValue(db.prepare('PRAGMA journal_mode = DELETE').all()) ?? 'delete').toLowerCase();
            }
        } else {
            journalMode = 'unchanged'; // no statement beyond the busy timeout: the caller's own journal mode stands
        }
        return { db: db as unknown as Db, journalMode };
    } catch (err) {
        // Only SQLITE_CORRUPT / SQLITE_NOTADB (when the caller asked for the check) is corruption; everything else is rethrown as it is.
        return fail(err, !!opts.check && isCorruptError(err));
    }
}
