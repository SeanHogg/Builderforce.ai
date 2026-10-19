import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  l10n: { t: (message: string) => message },
}));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({
  createLocalBrainPersistence: () => ({}),
}));

import {
  LOCAL_FIRST_SNAPSHOT_CORRUPT,
  LocalFirstSnapshotCorruptError,
  corruptSnapshotRecoveryPath,
  loadExistingSnapshot,
  planSnapshotLoad,
} from "./localFirstStore";

const SNAPSHOT = "/globalStorage/local-first-v1.json";
const TIMESTAMP = 1_710_000_000_000;

const valid = {
  records: [{ id: "kept" }],
  events: [{ id: "e1" }],
  mappings: [{ id: "m1" }],
  receipts: [{ id: "r1" }],
  conflicts: [{ id: "c1" }],
  cursors: { dest: "cursor-9" },
  nextSequence: 4,
};

describe("corrupt snapshot recovery", () => {
  it("names the recovery copy local-first-v1.json.corrupt-<timestamp>", () => {
    expect(corruptSnapshotRecoveryPath(SNAPSHOT, TIMESTAMP)).toBe(
      `${SNAPSHOT}.corrupt-${TIMESTAMP}`,
    );
  });

  it("plans a preserve, not an empty snapshot, when JSON does not parse", () => {
    const plan = planSnapshotLoad("{not json", SNAPSHOT, TIMESTAMP);
    expect(plan.action).toBe("preserve");
    if (plan.action !== "preserve") return;
    expect(plan.recoveryPath).toBe(`${SNAPSHOT}.corrupt-${TIMESTAMP}`);
    expect(plan.error).toBeInstanceOf(LocalFirstSnapshotCorruptError);
    expect(plan.error.name).toBe(LOCAL_FIRST_SNAPSHOT_CORRUPT);
    expect(plan.error.name).toBe("local_first_snapshot_corrupt");
    expect(plan.error.recoveryPath).toBe(plan.recoveryPath);
    expect(plan.error.message).toContain("local_first_snapshot_corrupt");
    expect(plan.error.message).toContain(plan.recoveryPath);
    expect(plan).not.toHaveProperty("snapshot");
  });

  it("plans a preserve when the file parses but validSnapshot rejects it", () => {
    const plan = planSnapshotLoad(JSON.stringify({ records: [] }), SNAPSHOT, TIMESTAMP);
    expect(plan.action).toBe("preserve");
    if (plan.action !== "preserve") return;
    expect(plan.error.name).toBe("local_first_snapshot_corrupt");
    expect(plan.recoveryPath.endsWith(`.corrupt-${TIMESTAMP}`)).toBe(true);
  });

  it("copies the bad file and then throws, without returning empty data", async () => {
    const order: string[] = [];
    const copy = vi.fn(async (from: string, to: string) => {
      order.push(`copy:${from}->${to}`);
    });
    const recoveryPath = `${SNAPSHOT}.corrupt-${TIMESTAMP}`;
    await expect(loadExistingSnapshot("{", SNAPSHOT, TIMESTAMP, copy)).rejects.toMatchObject({
      name: "local_first_snapshot_corrupt",
      recoveryPath,
    });
    order.push("throw");
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(SNAPSHOT, recoveryPath);
    expect(order).toEqual([`copy:${SNAPSHOT}->${recoveryPath}`, "throw"]);
  });

  it("throws after copying a file validSnapshot rejects, without an empty snapshot", async () => {
    const copy = vi.fn(async () => undefined);
    const recoveryPath = `${SNAPSHOT}.corrupt-${TIMESTAMP}`;
    await expect(
      loadExistingSnapshot(JSON.stringify({ records: [] }), SNAPSHOT, TIMESTAMP, copy),
    ).rejects.toMatchObject({
      name: "local_first_snapshot_corrupt",
      recoveryPath,
    });
    expect(copy).toHaveBeenCalledWith(SNAPSHOT, recoveryPath);
  });

  it("does not copy or empty a valid snapshot", async () => {
    const copy = vi.fn(async () => undefined);
    const loaded = await loadExistingSnapshot(JSON.stringify(valid), SNAPSHOT, TIMESTAMP, copy);
    expect(copy).not.toHaveBeenCalled();
    expect(loaded.records).toEqual(valid.records);
    expect(loaded.events).toEqual(valid.events);
    expect(loaded.nextSequence).toBe(4);
    expect(loaded.cursors).toEqual({ dest: "cursor-9" });
  });

  it("keeps a legitimate empty snapshot instead of treating it as corrupt", async () => {
    const empty = {
      records: [],
      events: [],
      mappings: [],
      receipts: [],
      conflicts: [],
      cursors: {},
      nextSequence: 1,
    };
    const copy = vi.fn(async () => undefined);
    await expect(loadExistingSnapshot(JSON.stringify(empty), SNAPSHOT, TIMESTAMP, copy)).resolves.toEqual(empty);
    expect(copy).not.toHaveBeenCalled();
  });
});
