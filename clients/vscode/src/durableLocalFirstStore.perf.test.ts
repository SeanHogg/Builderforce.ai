import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeJournalFrame, newLocalRecord, type LocalFirstSnapshot } from "@builderforce/local-first";
import { createDurableLocalFirstStore } from "./durableLocalFirstStore";
import { hostLog } from "./hostLog";
import { LEGACY_JOURNAL_FILE, type JournalStageTiming } from "./localFirstJournalIo";

vi.mock("./hostLog", () => ({ hostLog: vi.fn() }));

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
    // load (read the file) -> decode (fold frames) -> rebuild (adopt into memory)
    // -> persist (write the v3 base) -> open (all of it, emitted last).
    for (const stage of ["import.load", "import.decode", "import.rebuild", "import.persist", "import.open"]) {
      expect(importStages).toContain(stage);
    }
    expect(importStages.indexOf("import.load")).toBeLessThan(importStages.indexOf("import.decode"));
    expect(importStages.indexOf("import.decode")).toBeLessThan(importStages.indexOf("import.rebuild"));
    expect(importStages.indexOf("import.rebuild")).toBeLessThan(importStages.indexOf("import.persist"));

    timings.length = 0;
    await store.transact(async (tx) => { await tx.put(ticket("new")); });

    const commitStages = stagesOf(timings);
    expect(commitStages).toEqual(
      expect.arrayContaining(["commit.lock", "commit.refresh", "commit.serialize", "commit.compact-check", "commit.total"]),
    );
    expect(timings.every((timing) => timing.ms >= 0)).toBe(true);
  });

  it("emits no timings and calls no logger when disabled (no callback, no env flag)", async () => {
    const root = await directory();
    const store = createDurableLocalFirstStore(root);
    await store.transact(async (tx) => { await tx.put(ticket("a")); });
    await store.flush();
    expect((await store.export()).records.map((record) => record.id)).toEqual(["a"]);
    expect(vi.mocked(hostLog)).not.toHaveBeenCalled();
  });

  it("emits timings through the env flag via the host debug log when set", async () => {
    vi.stubEnv("BUILDERFORCE_LOCAL_FIRST_PERF", "1");
    const root = await directory();
    const store = createDurableLocalFirstStore(root);
    await store.transact(async (tx) => { await tx.put(ticket("a")); });
    expect(vi.mocked(hostLog).mock.calls.some((call) => String(call[0]).includes("local-first perf:"))).toBe(true);
  });
});
