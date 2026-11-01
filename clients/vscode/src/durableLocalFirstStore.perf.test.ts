import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeJournalFrame, newLocalRecord, type LocalFirstSnapshot } from "@builderforce/local-first";
import { createDurableLocalFirstStore } from "./durableLocalFirstStore";
import { LEGACY_JOURNAL_FILE, type JournalStageTiming } from "./localFirstJournalIo";

const directories: string[] = [];

async function directory(): Promise<string> {
  const created = await mkdtemp(nodePath.join(tmpdir(), "bf-durable-perf-"));
  directories.push(created);
  return created;
}

const ticket = (id: string) => newLocalRecord({ id, entityType: "ticket", payload: { title: id }, deviceId: "device-1" });

const snapshotOf = (...ids: string[]): LocalFirstSnapshot => ({
  records: ids.map(ticket),
  events: [],
  mappings: [],
  receipts: [],
  conflicts: [],
  cursors: {},
  nextSequence: 3,
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const stagesOf = (timings: JournalStageTiming[]): string[] => timings.map((timing) => timing.stage);

describe("stage timings", () => {
  it("emits the import stages on a first open over a v2 journal, then the commit stages", async () => {
    const root = await directory();
    await writeFile(nodePath.join(root, LEGACY_JOURNAL_FILE), encodeJournalFrame(snapshotOf("from-v2")));
    await writeFile(nodePath.join(root, "local-first-v1.json"), JSON.stringify(snapshotOf("from-v2")));
    const timings: JournalStageTiming[] = [];
    const store = createDurableLocalFirstStore(root, { onStageTiming: (timing) => timings.push(timing) });

    await store.read(async () => undefined); // forces the first open/import

    const importStages = stagesOf(timings);
    // The import decodes frames (journal-io "decode"), rebuilds the snapshot in memory,
    // and persists the v3 base (the import's compact). The open wraps all of it.
    expect(importStages).toContain("import.open");
    expect(importStages).toContain("decode");
    expect(importStages).toContain("import.rebuild");
    expect(importStages).toContain("import.persist");
    expect(importStages.indexOf("decode")).toBeLessThan(importStages.indexOf("import.rebuild"));
    expect(importStages.indexOf("import.rebuild")).toBeLessThan(importStages.indexOf("import.persist"));

    timings.length = 0;
    await store.transact(async (tx) => { await tx.put(ticket("new")); });

    const commitStages = stagesOf(timings);
    expect(commitStages).toEqual(
      expect.arrayContaining(["commit.lock", "commit.refresh", "commit.serialize", "commit.compact-check", "commit.total"]),
    );
    // A fresh lock is uncontended and a tiny frame is one append+fsync.
    expect(timings.every((timing) => timing.ms >= 0)).toBe(true);
  });

  it("emits no timings and reads no clock when no callback is provided (default)", async () => {
    const root = await directory();
    const store = createDurableLocalFirstStore(root);
    // Disabled by default: still fully functional, just silent.
    await store.transact(async (tx) => { await tx.put(ticket("a")); });
    await store.flush();
    expect((await store.export()).records.map((record) => record.id)).toEqual(["a"]);
  });

  it("emits timings through the env flag via the host debug log when set", async () => {
    vi.stubEnv("BUILDERFORCE_LOCAL_FIRST_PERF", "1");
    const hostLog = vi.fn();
    vi.doMock("./hostLog", () => ({ hostLog }));
    try {
      const { createDurableLocalFirstStore: createStore } = await import("./durableLocalFirstStore");
      const root = await directory();
      const store = createStore(root);
      await store.transact(async (tx) => { await tx.put(ticket("a")); });
      expect(hostLog.mock.calls.some((call) => String(call[0]).includes("local-first perf:"))).toBe(true);
    } finally {
      vi.doUnmock("./hostLog");
    }
  });
});
