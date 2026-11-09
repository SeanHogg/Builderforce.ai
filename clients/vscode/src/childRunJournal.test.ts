import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import { createChildLedger, type PersistedChild } from "./childLedger";
import { INTERRUPTED_CHILD_NOTE, childrenOfRecord, describeInterruptedChildren, persistChildrenTo } from "./childRunJournal";
import { recordRunCheckpoint, recordRunStarted, recoverInterruptedRuns } from "./runRecovery";

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
    const writes: Promise<void>[] = [];
    const persist = persistChildrenTo(store, deps.now);
    const ledger = createChildLedger({ persist: (chat, children) => { const w = persist(chat, children); writes.push(w); return w; } });

    ledger.spawned(spawn(-1, "a1", "Port the drawer to SlideOutPanel."));
    ledger.spawned(spawn(-2, "a2", "Add the i18n keys for the drawer."));
    ledger.spawned(spawn(-3, "a3", "Map every caller of openModal."));
    ledger.settled(-1, { handle: "a1", name: "Dev", label: "slice a1", state: "done", output: "Drawer ported." }, "inbox");
    ledger.settled(-3, { handle: "a3", name: "Dev", label: "slice a3", state: "done", output: "4 callers." }, "wait");
    for (const w of writes) await w;
    // A later checkpoint rewrites the record — the children ride along.
    await recordRunCheckpoint(store, deps, { runId: "run-1", step: 4, safeToResume: false });

    const [recovered] = await recoverInterruptedRuns(store, deps);
    expect(recovered!.record.payload.status).toBe("interrupted");
    expect(childrenOfRecord(recovered!.record).map((c: PersistedChild) => [c.handle, c.state])).toEqual([["a1", "done"], ["a2", "running"], ["a3", "done"]]);

    const told = describeInterruptedChildren(recovered!.record);
    expect(told).toContain("started 3 sub-agents; 1 died with the editor");
    expect(told).toContain("Drawer ported.");
    expect(told).toContain(`a2 (slice a2; started by Ada): ${INTERRUPTED_CHILD_NOTE}`);
    expect(told).toContain("Add the i18n keys for the drawer.");
    expect(told).toContain("a3 (slice a3; started by Ada): done — its report was already returned to you by wait_agents.");
  });

  it("says nothing for a run that started no children", () => {
    expect(describeInterruptedChildren({ payload: { status: "interrupted" } })).toBe("");
  });

  it("writes nothing for a chat with no journaled run", async () => {
    const store = createMemoryLocalFirstStore();
    await persistChildrenTo(store)(42, []);
    const runs = await recoverInterruptedRuns(store, deps);
    expect(runs).toEqual([]);
  });
});
