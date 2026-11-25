import { describe, expect, it } from "vitest";
import { createChildLedger, MAX_SETTLED_CHILDREN, type PersistedChild } from "./childLedger";
import type { ChildReport } from "./childRuns";

const spawn = (key: number, rootChatId = 1) => ({
  key,
  ownerKey: rootChatId,
  rootChatId,
  handle: `c${key}`,
  label: `child ${key}`,
  owner: "owner",
  brief: `brief ${key}`,
  role: "coder",
});
const report = (key: number): ChildReport => ({ handle: `c${key}`, name: `c${key}`, label: `child ${key}`, state: "done", output: "ok" });

describe("createChildLedger", () => {
  it("regression: flush awaits a settle queued during close, so the journal never keeps the child `running` (chat #61651)", async () => {
    const written: PersistedChild[][] = [];
    let release!: () => void;
    const slow = new Promise<void>((r) => { release = r; });
    const ledger = createChildLedger({
      persist: async (_chat, children) => {
        await slow;
        written.push(children.map((c) => ({ ...c })));
      },
    });
    ledger.spawned(spawn(1));
    ledger.settled(1, report(1), "inbox");
    const flushed = ledger.flush();
    let done = false;
    void flushed.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await flushed;
    expect(written.at(-1)?.[0]?.state).toBe("done");
  });

  it("regression: a prune past the cap never shrinks the PERSISTED children list (a write replaces the run's list)", async () => {
    let persisted: PersistedChild[] = [];
    const ledger = createChildLedger({ persist: (_chat, children) => { persisted = children.map((c) => ({ ...c })); } });
    const total = MAX_SETTLED_CHILDREN + 5;
    ledger.spawned(spawn(0));
    for (let k = 1; k <= total; k += 1) {
      ledger.spawned(spawn(k));
      ledger.settled(k, report(k), "inbox");
    }
    // A later spawn in the same chat after the prune: its write must still carry every earlier child.
    ledger.spawned(spawn(total + 1));
    await ledger.flush();
    expect(persisted.map((c) => c.handle)).toEqual(Array.from({ length: total + 2 }, (_, k) => `c${k}`));
    expect(persisted.find((c) => c.handle === "c1")?.report?.output).toBe("ok");
    expect(persisted.find((c) => c.handle === "c0")?.state).toBe("running");
    expect(ledger.liveWork(1).map((w) => w.handle)).toEqual(["c0", `c${total + 1}`]);
  });

  it("archives per chat: another chat's prune does not leak into or erase this chat's list", () => {
    const ledger = createChildLedger();
    ledger.spawned(spawn(10_000, 2));
    ledger.settled(10_000, report(10_000), "wait");
    for (let k = 1; k <= MAX_SETTLED_CHILDREN + 2; k += 1) {
      ledger.spawned(spawn(k));
      ledger.settled(k, report(k), "wait");
    }
    expect(ledger.childrenOf(2).map((c) => c.handle)).toEqual(["c10000"]);
    expect(ledger.childrenOf(1)).toHaveLength(MAX_SETTLED_CHILDREN + 2);
  });
});
