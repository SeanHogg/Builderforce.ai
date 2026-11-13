import { describe, expect, it, vi } from "vitest";

vi.mock("@builderforce/agent-tools/node-git-history", () => ({ recentCommits: vi.fn(async () => []) }));
vi.mock("./knowledgeSyncStatus", () => ({ hostMemento: () => undefined }));

import { L3_HEAD_STABLE_MS } from "./indexBudget";
import { isWorkerOom, l3DoneKey, l3StateOf, L3Tracker, type L3StatePort } from "./l3Persist";

/** A root's persisted state over a fake memento that outlives "the host". */
function root(memento: Map<string, unknown>, head: { sha: string | undefined }): L3StatePort {
  return l3StateOf({ rootId: "r", rootPath: "/ws" }, {
    head: async () => head.sha,
    memento: () => ({ get: <T>(k: string) => memento.get(k) as T | undefined, update: async (k, v) => { memento.set(k, v); } }),
  });
}

describe("L3Tracker — L3 is owed by the sha, across host restarts", () => {
  it("regression: the same sha after a restart does NOT owe L3 again (the crash loop re-ran it 30 s after every restart)", async () => {
    const memento = new Map<string, unknown>();
    const head = { sha: "aaa" };
    const first = new L3Tracker(root(memento, head), { now: () => 0 });
    expect(await first.verdict()).toBe("owed"); // none persisted: owed at once
    first.completed();
    expect(memento.get(l3DoneKey("r"))).toBe("aaa");
    // the extension host restarts: a new tracker, the same persisted state
    const second = new L3Tracker(root(memento, head), { now: () => 1 });
    expect(await second.verdict()).toBe("current");
  });

  it("a changed sha owes L3 only after it has stood still for the debounce window; a burst makes ONE pass", async () => {
    const memento = new Map<string, unknown>([[l3DoneKey("r"), "aaa"]]);
    const head = { sha: "aaa" };
    let now = 0;
    const tracker = new L3Tracker(root(memento, head), { now: () => now });
    expect(await tracker.verdict()).toBe("current");
    head.sha = "bbb"; now = 1_000;
    expect(await tracker.verdict()).toBe("settling");
    head.sha = "ccc"; now = L3_HEAD_STABLE_MS; // another commit: the window restarts
    expect(await tracker.verdict()).toBe("settling");
    now = L3_HEAD_STABLE_MS + L3_HEAD_STABLE_MS - 1;
    expect(await tracker.verdict()).toBe("settling");
    now = L3_HEAD_STABLE_MS * 2;
    expect(await tracker.verdict()).toBe("owed");
    tracker.completed();
    expect(await tracker.verdict()).toBe("current");
    expect(memento.get(l3DoneKey("r"))).toBe("ccc");
  });

  it("regression: only an out-of-memory is held for the same sha; any other failure backs off and retries; git unreadable leaves the decision to the gate", async () => {
    const head = { sha: "aaa" as string | undefined };
    let now = 0;
    const tracker = new L3Tracker(root(new Map(), head), { now: () => now }, L3_HEAD_STABLE_MS, 1_000);
    expect(await tracker.verdict()).toBe("owed");
    tracker.failedPass(false);
    expect(await tracker.verdict()).toBe("settling");
    now = 1_000;
    expect(await tracker.verdict()).toBe("owed");
    tracker.failedPass(true);
    now = 10 * L3_HEAD_STABLE_MS;
    expect(await tracker.verdict()).toBe("current");
    expect(isWorkerOom(Object.assign(new Error("x"), { code: "ERR_WORKER_OUT_OF_MEMORY" }))).toBe(true);
    expect(isWorkerOom(new Error("spawn failed"))).toBe(false);
    head.sha = undefined;
    expect(await tracker.verdict()).toBe("unknown");
  });
});
