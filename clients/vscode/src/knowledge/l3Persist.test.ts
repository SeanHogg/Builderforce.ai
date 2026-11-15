import { describe, expect, it, vi } from "vitest";

vi.mock("@builderforce/agent-tools/node-git-history", () => ({ recentCommits: vi.fn(async () => []) }));
vi.mock("./knowledgeSyncStatus", () => ({ hostMemento: () => undefined }));

import { isPermanentL3Failure, l3QuarantineKey } from "./l3CrashGuard";
import { l3DoneKey, l3StateOf, L3Tracker, type L3StatePort } from "./l3Persist";
import { L3_RESULT_OVER_BUDGET } from "./l3WorkerJob";

vi.mock("./l3WorkerJob", () => ({ L3_RESULT_OVER_BUDGET: "l3_result_over_budget" }));

/** A root's persisted state over a fake memento that outlives "the host". */
function root(memento: Map<string, unknown>, head: { sha: string | undefined }): L3StatePort {
  return l3StateOf({ rootId: "r", rootPath: "/ws" }, {
    head: async () => head.sha,
    memento: () => ({ get: <T>(k: string) => memento.get(k) as T | undefined, update: async (k, v) => { if (v === undefined) memento.delete(k); else memento.set(k, v); } }),
  });
}

describe("L3Tracker — whether a request has work, across host restarts", () => {
  it("regression: the same sha after a restart is current (the crash loop re-ran it 30 s after every restart)", async () => {
    const memento = new Map<string, unknown>();
    const head = { sha: "aaa" };
    const first = new L3Tracker(root(memento, head));
    expect(await first.verdict()).toBe("owed"); // none persisted: owed at once
    first.completed();
    expect(memento.get(l3DoneKey("r"))).toBe("aaa");
    // the extension host restarts: a new tracker, the same persisted state
    const second = new L3Tracker(root(memento, head));
    expect(await second.verdict()).toBe("current");
  });

  it("a changed sha owes a pass at once; completing it makes it current; git unreadable leaves the decision to the gate", async () => {
    const memento = new Map<string, unknown>([[l3DoneKey("r"), "aaa"]]);
    const head = { sha: "aaa" as string | undefined };
    const tracker = new L3Tracker(root(memento, head));
    expect(await tracker.verdict()).toBe("current");
    head.sha = "bbb";
    expect(await tracker.verdict()).toBe("owed");
    tracker.completed();
    expect(await tracker.verdict()).toBe("current");
    expect(memento.get(l3DoneKey("r"))).toBe("bbb");
    head.sha = undefined;
    expect(await tracker.verdict()).toBe("unknown");
  });

  it("the root's crash quarantine reaches the gate through the state port, for the sha of the last look", async () => {
    const memento = new Map<string, unknown>([[l3QuarantineKey("r"), { sha: "aaa", at: 1, reason: "host-died" }]]);
    const head = { sha: "aaa" as string | undefined };
    const tracker = new L3Tracker(root(memento, head));
    await tracker.verdict();
    expect(await tracker.blocked()).toMatch(/extension host stopped/);
    head.sha = "bbb"; // the commit moved: lifted
    await tracker.verdict();
    expect(await tracker.blocked()).toBeUndefined();
  });

  it("only a worker out-of-memory or a result over the transfer budget is a permanent failure", () => {
    expect(isPermanentL3Failure(Object.assign(new Error("x"), { code: "ERR_WORKER_OUT_OF_MEMORY" }))).toBe(true);
    expect(isPermanentL3Failure(Object.assign(new Error(`${L3_RESULT_OVER_BUDGET}: too big`), { code: L3_RESULT_OVER_BUDGET }))).toBe(true);
    expect(isPermanentL3Failure(new Error(`${L3_RESULT_OVER_BUDGET}: the analysis result passed 1 bytes`))).toBe(true); // the code lost across a boundary
    expect(isPermanentL3Failure(new Error("spawn failed"))).toBe(false);
  });
});
