import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore, type ExecutionValue } from "@builderforce/local-first";
import { createChildLedger, type PersistedChild } from "./childLedger";
import { INTERRUPTED_CHILD_NOTE, childrenOfRecord, describeInterruptedChildren, persistChildrenTo, recordRunChildren } from "./childRunJournal";
import { recordRunCheckpoint, recordRunFinished, recordRunStarted, recoverInterruptedRuns } from "./runRecovery";

/**
 * Chat #61651: the owner fanned out six children, the editor closed, and on resume the
 * owner had no idea they had existed. Children are journaled WITH their parent run, so the
 * interrupted record carries every one, and the resumed owner is told what became of each.
 */

const deps = { deviceId: "device-1", now: () => new Date("2026-11-08T10:00:00Z") };
const spawn = (key: number, handle: string, brief: string) => ({
  key, ownerKey: 61651, rootChatId: 61651, handle, label: `slice ${handle}`, owner: "Ada", brief, role: "code",
});

describe("sub-agents journaled with their parent run", () => {
  it("survive into the interrupted record and are each accounted for on resume", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "run-1", chatId: "61651" });
    const ledger = createChildLedger({ persist: persistChildrenTo(store, deps.now) });

    ledger.spawned(spawn(-1, "a1", "Port the drawer to SlideOutPanel."));
    ledger.spawned(spawn(-2, "a2", "Add the i18n keys for the drawer."));
    ledger.spawned(spawn(-3, "a3", "Map every caller of openModal."));
    ledger.settled(-1, { handle: "a1", name: "Dev", label: "slice a1", state: "done", output: "Drawer ported." }, "inbox");
    ledger.settled(-3, { handle: "a3", name: "Dev", label: "slice a3", state: "done", output: "4 callers." }, "wait");
    await ledger.flush();
    // A later checkpoint rewrites the record — the children ride along.
    await recordRunCheckpoint(store, deps, { runId: "run-1", step: 4, safeToResume: false });

    const [recovered] = await recoverInterruptedRuns(store, deps);
    expect(recovered!.record.payload.status).toBe("interrupted");
    expect(childrenOfRecord(recovered!.record).map((c: PersistedChild) => [c.handle, c.state])).toEqual([["a1", "done"], ["a2", "running"], ["a3", "done"]]);

    const told = describeInterruptedChildren(recovered!.record);
    expect(told).toContain("Sub-agents your interrupted run had started: 3. 1 of them died with the editor");
    expect(told).toContain("Drawer ported.");
    expect(told).toContain(`a2 (slice a2; started by Ada): ${INTERRUPTED_CHILD_NOTE}`);
    expect(told).toContain("Add the i18n keys for the drawer.");
    expect(told).toContain("a3 (slice a3; started by Ada): done — its report was already returned to you by wait_agents.");
  });

  it("says nothing for a run that started no children", () => {
    expect(describeInterruptedChildren({ payload: { status: "interrupted" } })).toBe("");
  });

  it("regression: a child that settles after a new person message is written to the run that STARTED it, not the newer run", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "run-1", chatId: "61651" });
    const ledger = createChildLedger({ persist: persistChildrenTo(store, deps.now) });
    ledger.spawned(spawn(-1, "a1", "Audit the drawer."));
    await ledger.flush();
    await recordRunFinished(store, deps, { runId: "run-1", status: "completed" });
    await recordRunStarted(store, deps, { runId: "run-2", chatId: "61651" });
    ledger.spawned(spawn(-2, "a2", "Second ask's child."));
    ledger.settled(-1, { handle: "a1", name: "Dev", label: "slice a1", state: "done", output: "Clean." }, "inbox");
    await ledger.flush();
    const [one, two] = await store.read(async (tx) => [await tx.get<ExecutionValue>("execution", "run-1"), await tx.get<ExecutionValue>("execution", "run-2")]);
    expect(childrenOfRecord(one!).map((c) => [c.handle, c.state])).toEqual([["a1", "done"]]);
    expect(childrenOfRecord(two!).map((c) => c.handle)).toEqual(["a2"]);
    // run-1 finished with its child settled: no false resume offer.
    const recovered = await recoverInterruptedRuns(store, deps);
    expect(recovered.map((r) => r.runId)).toEqual(["run-2"]);
  });

  it("retries a children write that lost a version race, and the ledger retries a failed persist", async () => {
    const store = createMemoryLocalFirstStore();
    await recordRunStarted(store, deps, { runId: "run-1", chatId: "9" });
    let conflicts = 1;
    const racy = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop !== "transact") return Reflect.get(target, prop, receiver);
        return (fn: Parameters<typeof store.transact>[0]) => {
          if (conflicts-- > 0) return Promise.reject(Object.assign(new Error("entity_version_conflict"), { code: "ENTITY_VERSION_CONFLICT" }));
          return target.transact(fn);
        };
      },
    });
    expect(await recordRunChildren(racy, { chatId: "9", runId: "run-1", children: [] , now: deps.now })).toBe("run-1");
    let failures = 1;
    const logs: string[] = [];
    const ledger = createChildLedger({ persist: async () => { if (failures-- > 0) throw new Error("disk busy"); }, log: (l) => void logs.push(l) });
    ledger.spawned(spawn(-1, "a1", "x"));
    await ledger.flush();
    expect(logs).toEqual([]);
  });

  it("writes nothing for a chat with no journaled run", async () => {
    const store = createMemoryLocalFirstStore();
    await persistChildrenTo(store)(42, []);
    const runs = await recoverInterruptedRuns(store, deps);
    expect(runs).toEqual([]);
  });
});
