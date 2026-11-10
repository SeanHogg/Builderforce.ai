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

  it("regression: settled children are pruned past the cap; running children are never dropped", () => {
    const ledger = createChildLedger();
    ledger.spawned(spawn(0));
    for (let k = 1; k <= MAX_SETTLED_CHILDREN + 5; k += 1) {
      ledger.spawned(spawn(k));
      ledger.settled(k, report(k), "wait");
    }
    const kids = ledger.childrenOf(1);
    expect(kids.filter((c) => c.state !== "running")).toHaveLength(MAX_SETTLED_CHILDREN);
    expect(kids.find((c) => c.handle === "c0")?.state).toBe("running");
    // The oldest settled went first.
    expect(kids.some((c) => c.handle === "c1")).toBe(false);
    expect(kids.some((c) => c.handle === `c${MAX_SETTLED_CHILDREN + 5}`)).toBe(true);
    expect(ledger.liveWork(1).map((w) => w.handle)).toEqual(["c0"]);
  });
});
