/**
 * knowledge/factStoreNode.ts — the Node adapter binding the builderforce-memory `FactStorePort`
 * (PRD 41 §B4) to `<workspace>/.builderforce/cache/knowledge/<rootId>/index.sqlite`, the existing
 * G03 SQLite store that `folderKnowledge.ts` opens per workspace folder.
 *
 * The port is content-addressed: each `FileFacts` is written under its sha256 `factsHash`, the
 * manifest maps path → `{ factsHash, contentHash, kind hashes }`, and derived rule results are
 * keyed by `derivedRowKey(rule, focus)` and carry their input-hash trace. This adapter keeps
 * them in ONE transactional SQLite file so a crash leaves the previous manifest valid (it
 * references only objects that already existed) and at worst unreferenced objects, which
 * `sweepObjects` removes.
 *
 * Determinism (§B8): the canonical dump sorts by key; wall-clock time and mtime never enter an
 * object, a manifest entry, a derived row or a dump. The clock is injected.
 *
 * SQLite is opened through the same `node:sqlite` the G03 store uses, with a busy timeout and a
 * refusal to open a corrupt file (the `localRecordTransaction.ts` pattern: a corrupt database is
 * reported and left for the host to recover, never silently repaired here).
 */

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// node:sqlite is builtin from Node 22.5 / VS Code 1.101. The `localRecordTransaction.ts` pattern
// tolerates a host without it: a structural `DatabaseSyncLike` (the methods this adapter uses),
// loaded through `require` in a try/catch, so a host without `node:sqlite` still compiles and the
// adapter reports unavailable at open time instead of failing to build.
interface DatabaseSyncLike {
  prepare(sql: string): { run(...args: unknown[]): { changes: number }; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown };
  exec(sql: string): unknown;
  close(): void;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync: NodeDatabaseSync } = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("node:sqlite");
  } catch {
    return { DatabaseSync: undefined };
  }
})();

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** The one error the port contracts surface; `code` is stable and machine-readable. */
export class FactStoreError extends Error {
  constructor(readonly code: string, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "FactStoreError";
  }
}

export interface FactStoreNodeOptions {
  /** Millisecond clock (PRD 41 §B8: no bare Date.now in computed output). Default Date.now. */
  now?: () => number;
  /** A log sink for the corrupt-recovery notice; default silent. */
  log?: (line: string) => void;
}

interface StatRow {
  size: number;
  mtimeNs: string;
  fileId: string | null;
}

interface ManifestEntryRow {
  path: string;
  factsHash: string;
  contentHash: string;
  kinds: string;
  stat: string | null;
}

interface DerivedRowRecord {
  key: string;
  rule: string;
  focus: string;
  row: string;
}

/**
 * Opens (creating if absent) the per-root SQLite fact store and returns the adapter. Throws
 * `FactStoreError('sqlite-unavailable')` when `node:sqlite` is absent, and
 * `FactStoreError('sqlite-corrupt')` when the file exists but is not a valid database (the
 * host recovers; this adapter never repairs a corrupt file in place).
 */
export function openFactStoreNode(
  cacheDir: string,
  rootId: string,
  opts: FactStoreNodeOptions = {},
): {
  store: {
    getObjects(hashes: readonly string[]): Map<string, string>;
    putObjects(objects: ReadonlyMap<string, string>): void;
    readVersion(): { epoch: string; generation: number };
    readManifest(): { epoch: string; generation: number; files: Map<string, { factsHash: string; contentHash: string; kinds: Record<string, string> }> };
    writeManifest(
      manifest: { epoch: string; generation: number; puts: ReadonlyMap<string, { factsHash: string; contentHash: string; kinds: Record<string, string> }>; deletes: readonly string[] },
      derivedPuts: readonly { rule: string; focus: string; row: unknown }[],
      derivedDeletes: readonly string[],
    ): void;
    derivedRows(): Map<string, { rule: string; focus: string; row: unknown }>;
    sweepObjects(expected: { epoch: string; generation: number }): number;
    reset(): void;
    close(): void;
  };
} {
  if (!NodeDatabaseSync) throw new FactStoreError("sqlite-unavailable");
  const dir = join(cacheDir, "knowledge", rootId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "index.sqlite");
  let db: DatabaseSyncLike;
  try {
    db = new NodeDatabaseSync(file) as unknown as DatabaseSyncLike;
  } catch (error) {
    throw new FactStoreError("sqlite-corrupt", String(error));
  }
  try {
    // One writer per store per process (folderKnowledge shares the connection); the busy timeout replaces the old lock-steal.
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        epoch TEXT NOT NULL,
        generation INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS objects (
        hash TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS manifest (
        path TEXT PRIMARY KEY,
        factsHash TEXT NOT NULL,
        contentHash TEXT NOT NULL,
        kinds TEXT NOT NULL,
        stat TEXT
      );
      CREATE TABLE IF NOT EXISTS derived (
        key TEXT PRIMARY KEY,
        rule TEXT NOT NULL,
        focus TEXT NOT NULL,
        row TEXT NOT NULL
      );
    `);
  } catch (error) {
    db.close();
    throw new FactStoreError("sqlite-corrupt", String(error));
  }
  // A fresh store starts at generation 0 with a new epoch; the epoch is minted once and survives sweeps.
  const row = db.prepare("SELECT epoch, generation FROM version WHERE id = 1").get() as { epoch: string; generation: number } | undefined;
  if (!row) {
    const epoch = sha256Hex(new TextEncoder().encode(`${rootId}:${opts.now?.() ?? Date.now()}:${Math.random()}`));
    db.prepare("INSERT INTO version (id, epoch, generation) VALUES (1, ?, ?)").run(epoch, 0);
  }

  const readVersion = (): { epoch: string; generation: number } => {
    const r = db.prepare("SELECT epoch, generation FROM version WHERE id = 1").get() as { epoch: string; generation: number };
    return { epoch: r.epoch, generation: r.generation };
  };

  return {
    store: {
      getObjects(hashes) {
        const out = new Map<string, string>();
        for (const hash of hashes) {
          const r = db.prepare("SELECT json FROM objects WHERE hash = ?").get(hash) as { json: string } | undefined;
          if (r) out.set(hash, r.json);
        }
        return out;
      },
      putObjects(objects) {
        const insert = db.prepare("INSERT OR IGNORE INTO objects (hash, json) VALUES (?, ?)");
        for (const [hash, json] of objects) insert.run(hash, json);
      },
      readVersion,
      readManifest() {
        const { epoch, generation } = readVersion();
        const files = new Map<string, { factsHash: string; contentHash: string; kinds: Record<string, string> }>();
        for (const r of db.prepare("SELECT path, factsHash, contentHash, kinds FROM manifest").all() as ManifestEntryRow[]) {
          files.set(r.path, { factsHash: r.factsHash, contentHash: r.contentHash, kinds: JSON.parse(r.kinds) as Record<string, string> });
        }
        return { epoch, generation, files };
      },
      writeManifest(manifest, derivedPuts, derivedDeletes) {
        const current = readVersion();
        if (current.epoch !== manifest.epoch || current.generation + 1 !== manifest.generation) {
          throw new FactStoreError("fact_store_generation_conflict", `expected ${current.epoch}@${current.generation}, got ${manifest.epoch}@${manifest.generation}`);
        }
        // The ONE transaction: objects were put first by the caller; apply the manifest delta + derived puts/deletes atomically.
        db.exec("BEGIN IMMEDIATE");
        try {
          const upsert = db.prepare(
            "INSERT INTO manifest (path, factsHash, contentHash, kinds, stat) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET factsHash=excluded.factsHash, contentHash=excluded.contentHash, kinds=excluded.kinds, stat=excluded.stat",
          );
          for (const [path, e] of manifest.puts) upsert.run(path, e.factsHash, e.contentHash, JSON.stringify(e.kinds), null);
          const del = db.prepare("DELETE FROM manifest WHERE path = ?");
          for (const path of manifest.deletes) del.run(path);
          const put = db.prepare("INSERT INTO derived (key, rule, focus, row) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET row=excluded.row");
          for (const d of derivedPuts) put.run(`${d.rule}:${d.focus}`, d.rule, d.focus, JSON.stringify(d.row));
          const delD = db.prepare("DELETE FROM derived WHERE key = ?");
          for (const key of derivedDeletes) delD.run(key);
          db.prepare("UPDATE version SET generation = ? WHERE id = 1").run(manifest.generation);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      derivedRows() {
        const out = new Map<string, { rule: string; focus: string; row: unknown }>();
        for (const r of db.prepare("SELECT key, rule, focus, row FROM derived").all() as DerivedRowRecord[]) {
          out.set(r.key, { rule: r.rule, focus: r.focus, row: JSON.parse(r.row) as unknown });
        }
        return out;
      },
      sweepObjects(expected) {
        const current = readVersion();
        if (current.epoch !== expected.epoch || current.generation !== expected.generation) {
          throw new FactStoreError("fact_store_generation_conflict", `sweep expected ${expected.epoch}@${expected.generation}`);
        }
        db.exec("BEGIN IMMEDIATE");
        try {
          const deleted = db.prepare(
            "DELETE FROM objects WHERE hash NOT IN (SELECT DISTINCT factsHash FROM manifest)",
          ).run().changes;
          if (deleted > 0) db.prepare("UPDATE version SET generation = generation + 1 WHERE id = 1").run();
          db.exec("COMMIT");
          return deleted;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      reset() {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare("DELETE FROM objects").run();
          db.prepare("DELETE FROM manifest").run();
          db.prepare("DELETE FROM derived").run();
          const epoch = sha256Hex(new TextEncoder().encode(`${rootId}:${opts.now?.() ?? Date.now()}:${Math.random()}`));
          db.prepare("UPDATE version SET epoch = ?, generation = 0 WHERE id = 1").run(epoch);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      close() {
        db.close();
      },
    },
  };
}
