import { describe, expect, it, vi } from "vitest";
import {
  RUN_ID_REQUIRED,
  createRunStartStore,
  recordRunStarted,
  recoverInterruptedRuns,
  type RunStartRecord,
  type RunStartStore,
} from "./runStartRecord";

const NOW = "2026-10-18T12:00:00.000Z";

function storeWith(seed: RunStartRecord[]): RunStartStore & { records: Map<string, RunStartRecord> } {
  const store = createRunStartStore();
  for (const record of seed) store.put(record);
  return store;
}

describe("recordRunStarted", () => {
  it("writes { id, startedAt, status: 'running' }", async () => {
    const store = createRunStartStore();
    await recordRunStarted(store, { id: "run-1", startedAt: "2026-10-18T11:00:00.000Z" });
    expect(store.list()).toEqual([
      { id: "run-1", startedAt: "2026-10-18T11:00:00.000Z", status: "running" },
    ]);
  });

  it("throws run_id_required when id is empty and does not write", () => {
    const store = createRunStartStore();
    const put = vi.spyOn(store, "put");
    expect(() => recordRunStarted(store, { id: "", startedAt: NOW })).toThrow(RUN_ID_REQUIRED);
    expect(() => recordRunStarted(store, { id: "   ", startedAt: NOW })).toThrow(RUN_ID_REQUIRED);
    expect(() => recordRunStarted(store, { id: undefined as unknown as string, startedAt: NOW })).toThrow(
      RUN_ID_REQUIRED,
    );
    expect(put).not.toHaveBeenCalled();
    expect(store.list()).toEqual([]);
  });
});

describe("recoverInterruptedRuns", () => {
  it("returns every record still running and marks each interrupted with interruptedAt = now", async () => {
    const store = storeWith([
      { id: "live-a", startedAt: "t0", status: "running" },
      { id: "live-b", startedAt: "t1", status: "running" },
    ]);

    const recovered = await recoverInterruptedRuns(store, NOW);

    expect(recovered).toEqual([
      { id: "live-a", startedAt: "t0", status: "interrupted", interruptedAt: NOW },
      { id: "live-b", startedAt: "t1", status: "interrupted", interruptedAt: NOW },
    ]);
    expect(store.list()).toEqual(recovered);
  });

  it("returns an empty list when none are running", async () => {
    const store = createRunStartStore();
    const put = vi.spyOn(store, "put");
    await expect(recoverInterruptedRuns(store, NOW)).resolves.toEqual([]);
    expect(put).not.toHaveBeenCalled();
  });

  it("never returns or rewrites a run that is already completed", async () => {
    const completed: RunStartRecord = { id: "done", startedAt: "t0", status: "completed" };
    const store = storeWith([
      completed,
      { id: "live", startedAt: "t1", status: "running" },
    ]);
    const put = vi.spyOn(store, "put");

    const recovered = await recoverInterruptedRuns(store, NOW);

    expect(recovered.map((record) => record.id)).toEqual(["live"]);
    expect(recovered[0]).toEqual({ id: "live", startedAt: "t1", status: "interrupted", interruptedAt: NOW });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(recovered[0]);
    expect(store.records.get("done")).toBe(completed);
    expect(completed).toEqual({ id: "done", startedAt: "t0", status: "completed" });
    expect(completed).not.toHaveProperty("interruptedAt");
  });
});
