import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localSqliteAvailable, openLocalSqlite } from "@builderforce/agent-tools/node-local-sqlite.js";

const here = (file: string): string => readFileSync(new URL(file, import.meta.url), "utf8");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the memory index opens through the ONE local SQLite opener", () => {
  it("qmd-manager opens read-only with a 1 ms busy timeout; manager-sync-ops opens with the extension flag; nobody loads node:sqlite itself", () => {
    const qmd = here("./qmd-manager.ts");
    expect(qmd).toMatch(/openLocalSqlite<SqliteDatabase>\(this\.indexPath, \{ readOnly: true, busyTimeoutMs: 1 \}\)/);
    const sync = here("./manager-sync-ops.ts");
    expect(sync).toMatch(/openLocalSqlite<DatabaseSync>\(dbPath, \{\s*allowExtension: this\.settings\.store\.vector\.enabled,\s*busyTimeoutMs: 0,/);
    for (const text of [qmd, sync]) {
      expect(text).not.toMatch(/requireNodeSqlite/);
      expect(text).not.toMatch(/new DatabaseSync\(/);
    }
  });
});

describe.skipIf(!localSqliteAvailable())("the options those callers pass", () => {
  it("read-only with busy_timeout 1 reads a file another connection wrote and cannot write", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qmd-open-"));
    dirs.push(dir);
    const file = path.join(dir, "index.sqlite");
    const writer = openLocalSqlite(file, { busyTimeoutMs: 100 });
    writer.db.exec("CREATE TABLE documents(id INTEGER)");
    writer.db.close();
    const { db } = openLocalSqlite(file, { readOnly: true, busyTimeoutMs: 1 });
    try {
      expect(db.prepare("SELECT count(*) AS n FROM documents").get()).toEqual({ n: 0 });
      expect(() => db.exec("INSERT INTO documents VALUES (1)")).toThrow();
    } finally {
      db.close();
    }
  });

  it("the memory index open (allowExtension, busy timeout 0) writes and forces neither quick_check nor WAL", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mem-open-"));
    dirs.push(dir);
    const { db, journalMode } = openLocalSqlite(path.join(dir, "memory.sqlite"), { allowExtension: true, busyTimeoutMs: 0 });
    try {
      expect(journalMode).toBe("unchanged");
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
      db.exec("CREATE TABLE t(a)");
    } finally {
      db.close();
    }
  });

  it("a garbage file opens here as before (no check): the caller's own reads fail, not the open", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mem-garbage-"));
    dirs.push(dir);
    const file = path.join(dir, "memory.sqlite");
    writeFileSync(file, "not sqlite".repeat(50));
    const { db } = openLocalSqlite(file, { busyTimeoutMs: 0 });
    try {
      expect(() => db.prepare("SELECT 1 FROM sqlite_master").all()).toThrow();
    } finally {
      db.close();
    }
  });
});
