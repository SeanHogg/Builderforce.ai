/**
 * G03 local system of record for the writes that must survive offline.
 *
 * Chat, project, ticket, audit, and run commit in one SQLite transaction.
 * A restart opens the same database file and reads them back. This module
 * does not call the API, and it does not persist those entities as a JSON
 * snapshot.
 *
 * Activation wiring belongs to `extension.ts`, which this slice does not edit.
 *
 * `node:sqlite` is loaded at RUNTIME, not imported. It exists from Node 22.13 on
 * (unflagged), and the extension's `engines.vscode` floor still admits hosts on
 * Node 20, where a static import would fail extension activation. On such a host
 * `openLocalRecordTransaction` throws `LocalSqliteUnavailableError`, which a caller
 * catches to keep the journaled store; `localSqliteAvailable()` answers up front.
 * Per the offline-first review (step 2) the store waits on a held writer
 * (`busy_timeout`) instead of stealing a lock, and a corrupt file is refused
 * with `local_record_store_corrupt`, never silently opened as an empty store.
 */
import { createRequire } from "node:module";

export const SURVIVING_OFFLINE_KINDS = ["chat", "project", "ticket", "audit", "run"] as const;

export type SurvivingOfflineKind = (typeof SURVIVING_OFFLINE_KINDS)[number];

export interface SurvivingOfflineRecord {
  kind: SurvivingOfflineKind;
  id: string;
  payload: unknown;
}

export interface LocalRecordTransaction {
  /** Commit the offline set in one transaction. A throw writes none of it. */
  commitOfflineSet(records: readonly SurvivingOfflineRecord[]): void;
  /** Read the committed set. No network. */
  read(): SurvivingOfflineRecord[];
  close(): void;
}

const KIND_SET = new Set<string>(SURVIVING_OFFLINE_KINDS);

/** How long a write waits on another connection's lock before failing busy. */
export const LOCAL_RECORD_BUSY_TIMEOUT_MS = 5_000;

/** The slice of `node:sqlite`'s `DatabaseSync` this store uses. */
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
type SqliteDatabaseConstructor = new (path: string) => SqliteDatabase;

/** This host's runtime has no `node:sqlite` (Node < 22.13). */
export class LocalSqliteUnavailableError extends Error {
  readonly code = "sqlite_unavailable";
  constructor(cause: unknown) {
    super("sqlite_unavailable: node:sqlite is not available in this extension host");
    this.cause = cause;
  }
}

let databaseConstructor: SqliteDatabaseConstructor | null | undefined;

function loadDatabaseConstructor(): SqliteDatabaseConstructor {
  if (databaseConstructor === undefined) {
    try {
      const sqlite = createRequire(__filename)("node:sqlite") as { DatabaseSync?: SqliteDatabaseConstructor };
      databaseConstructor = typeof sqlite.DatabaseSync === "function" ? sqlite.DatabaseSync : null;
    } catch (error) {
      databaseConstructor = null;
      throw new LocalSqliteUnavailableError(error);
    }
  }
  if (databaseConstructor === null) throw new LocalSqliteUnavailableError(undefined);
  return databaseConstructor;
}

/** True when this host can open the SQLite store. */
export function localSqliteAvailable(): boolean {
  try {
    loadDatabaseConstructor();
    return true;
  } catch {
    return false;
  }
}

function openDatabase(dbPath: string): SqliteDatabase {
  const Database = loadDatabaseConstructor();
  let db: SqliteDatabase;
  try {
    db = new Database(dbPath);
    db.exec(`PRAGMA busy_timeout = ${LOCAL_RECORD_BUSY_TIMEOUT_MS}`);
    const check = db.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
    if (Object.values(check[0] ?? {})[0] !== "ok") throw new Error("quick_check failed");
    db.exec("PRAGMA journal_mode = WAL");
  } catch (error) {
    throw Object.assign(new Error("local_record_store_corrupt"), { cause: error, path: dbPath });
  }
  return db;
}

function assertOfflineSet(records: readonly SurvivingOfflineRecord[]): void {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("offline_set_required");
  }
  const seen = new Set<string>();
  const present = new Set<string>();
  for (const record of records) {
    if (!record || !KIND_SET.has(record.kind)) {
      throw new Error("offline_set_kind_refused");
    }
    if (typeof record.id !== "string" || record.id.trim() === "") {
      throw new Error("offline_set_id_required");
    }
    const key = `${record.kind}\0${record.id}`;
    if (seen.has(key)) throw new Error("offline_set_duplicate");
    seen.add(key);
    present.add(record.kind);
  }
  for (const kind of SURVIVING_OFFLINE_KINDS) {
    if (!present.has(kind)) throw new Error(`offline_set_missing_${kind}`);
  }
}

function compareRecords(left: SurvivingOfflineRecord, right: SurvivingOfflineRecord): number {
  const byKind = SURVIVING_OFFLINE_KINDS.indexOf(left.kind) - SURVIVING_OFFLINE_KINDS.indexOf(right.kind);
  if (byKind !== 0) return byKind;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

export function openLocalRecordTransaction(dbPath: string): LocalRecordTransaction {
  if (typeof dbPath !== "string" || dbPath.trim() === "") {
    throw new Error("offline_set_path_required");
  }
  const db = openDatabase(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_record (
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (kind, id)
    )
  `);
  const upsert = db.prepare(
    `INSERT INTO local_record (kind, id, payload) VALUES (?, ?, ?)
     ON CONFLICT (kind, id) DO UPDATE SET payload = excluded.payload`,
  );
  const selectAll = db.prepare(`SELECT kind, id, payload FROM local_record ORDER BY kind, id`);

  return {
    commitOfflineSet(records) {
      assertOfflineSet(records);
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const record of records) {
          const payload = JSON.stringify(record.payload);
          if (typeof payload !== "string") throw new Error("offline_set_payload_not_json");
          upsert.run(record.kind, record.id, payload);
        }
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // The statement already aborted the transaction.
        }
        throw error;
      }
    },
    read() {
      const rows = selectAll.all() as Array<{ kind: SurvivingOfflineKind; id: string; payload: string }>;
      return rows
        .map((row) => ({
          kind: row.kind,
          id: row.id,
          payload: JSON.parse(row.payload) as unknown,
        }))
        .sort(compareRecords);
    },
    close() {
      db.close();
    },
  };
}
