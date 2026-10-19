/**
 * G03 local system of record for the writes that must survive offline.
 *
 * Chat, project, ticket, audit, and run commit in one SQLite transaction.
 * A restart opens the same database file and reads them back. This module
 * does not call the API, and it does not persist those entities as a JSON
 * snapshot.
 *
 * Activation wiring belongs to `extension.ts`, which this slice does not edit.
 */
import { DatabaseSync } from "node:sqlite";

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
  const db = new DatabaseSync(dbPath);
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
