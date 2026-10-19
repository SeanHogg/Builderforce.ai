import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openLocalRecordTransaction,
  SURVIVING_OFFLINE_KINDS,
  type SurvivingOfflineRecord,
} from "./localRecordTransaction";

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function databasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "local-record-tx-"));
  dirs.push(dir);
  return join(dir, "records.sqlite");
}

function offlineSet(mark = "kept"): SurvivingOfflineRecord[] {
  return [
    { kind: "chat", id: "chat-1", payload: { title: `chat ${mark}` } },
    { kind: "project", id: "project-1", payload: { name: `project ${mark}` } },
    { kind: "ticket", id: "ticket-1", payload: { title: `ticket ${mark}` } },
    { kind: "audit", id: "audit-1", payload: { name: `audit ${mark}` } },
    { kind: "run", id: "run-1", payload: { status: mark } },
  ];
}

describe("localRecordTransaction", () => {
  it("does not import the API, vscode, or a JSON snapshot store", () => {
    const source = readFileSync(new URL("./localRecordTransaction.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/@builderforce\/local-first/);
    expect(source).not.toMatch(/from\s+["']\.\/bfApi["']/);
    expect(source).not.toMatch(/from\s+["']vscode["']/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/local-first-v1\.json/);
    expect(source).not.toMatch(/writeFile/);
    expect(source).toMatch(/BEGIN IMMEDIATE/);
    expect(source).toMatch(/COMMIT/);
    expect(source).toMatch(/ROLLBACK/);
  });

  it("commits chat, project, ticket, audit, and run in one transaction and a restart reads them back without the API", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network must not be used"));
    const path = databasePath();
    const committed = offlineSet("kept");
    const first = openLocalRecordTransaction(path);
    first.commitOfflineSet(committed);
    first.close();

    const restarted = openLocalRecordTransaction(path);
    try {
      expect(restarted.read()).toEqual(committed);
      expect(restarted.read().map((record) => record.kind)).toEqual([...SURVIVING_OFFLINE_KINDS]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      restarted.close();
    }

    const header = readFileSync(path).subarray(0, 16).toString("utf8");
    expect(header).toBe("SQLite format 3\u0000");
    expect(() => JSON.parse(readFileSync(path, "utf8"))).toThrow();
  });

  it("rolls the whole set back when a later write in the same transaction fails", () => {
    const path = databasePath();
    const store = openLocalRecordTransaction(path);
    store.commitOfflineSet(offlineSet("kept"));

    const circular: Record<string, unknown> = { title: "replacement" };
    circular.self = circular;
    const replacement = offlineSet("replacement");
    replacement[replacement.length - 1] = { kind: "run", id: "run-1", payload: circular };

    expect(() => store.commitOfflineSet(replacement)).toThrow(TypeError);
    store.close();

    const restarted = openLocalRecordTransaction(path);
    try {
      expect(restarted.read()).toEqual(offlineSet("kept"));
    } finally {
      restarted.close();
    }
  });

  it("refuses a set that omits one surviving kind and writes nothing", () => {
    const path = databasePath();
    const store = openLocalRecordTransaction(path);
    try {
      expect(() => store.commitOfflineSet(offlineSet().filter((record) => record.kind !== "audit"))).toThrow(
        /offline_set_missing_audit/,
      );
      expect(store.read()).toEqual([]);
    } finally {
      store.close();
    }
  });
});
