/** The L3 gate's inputs (PRD 41 §12.3): a requested pass waits for an active agent run, and the persisted sha and the crash guard decide whether it has work. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanDetail } from "@seanhogg/builderforce-memory/knowledge";
import { L3_IDLE_MAINS_MS, realClock, type Clock } from "./indexBudget";
import type { IndexPlan } from "./indexReconcile";
import { PRIORITY } from "./indexScheduler";
import type { L3StatePort } from "./l3Persist";
import { RootIndexer, type IndexRootPorts } from "./rootIndexer";

const plan = (): IndexPlan => ({ files: 1, changed: [], removed: [], reviewed: true, ms: 1, detail: { prior: new Map() } as unknown as PlanDetail });

function harness(extra: Partial<IndexRootPorts> = {}, clock: Clock = realClock) {
  const ports = {
    rootId: "r",
    plan: vi.fn(async () => plan()),
    extractEdited: vi.fn(async () => ({ changed: [] as string[], unreviewed: [] as string[] })),
    mapPass: vi.fn(async (_p: IndexPlan, _o: { analyzers: boolean; signal: AbortSignal }) => ({ changed: [] as string[] })),
    onFactsChanged: vi.fn(async () => undefined),
  } satisfies IndexRootPorts;
  Object.assign(ports, extra);
  const errors: string[] = [];
  const indexer = new RootIndexer({
    ports, clock, gate: { pausedBy: () => undefined, idleForMs: () => L3_IDLE_MAINS_MS }, power: { current: async () => "mains" },
    priorityOf: () => PRIORITY.rest, publish: () => undefined, telemetry: () => undefined, log: (what, error) => { errors.push(`${what}: ${String(error)}`); }, quietPollMs: 10,
  });
  return { ports, indexer, errors, analyzerPasses: () => ports.mapPass.mock.calls.filter(([, o]) => o.analyzers).length };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("L3 gate — an active agent run", () => {
  // regression: the person is idle while an agent works, so L3 started mid-run and held the extension host.
  it("regression: L3 waits ('busy') while a run is active, and runs once it has ended", async () => {
    let active = true;
    const h = harness({ agentBusy: () => active });
    await h.indexer.reconcile();
    expect(await h.indexer.requestL3()).toBe(false);
    expect(h.analyzerPasses()).toBe(0);
    expect(h.indexer.status()).toMatchObject({ l3Waiting: "busy" });
    active = false;
    expect(await h.indexer.requestL3()).toBe(true);
    expect(h.analyzerPasses()).toBe(1);
  });

  it("regression: a run does NOT hold the map/facts passes (only L3 reads the agent-busy port)", async () => {
    const h = harness({ agentBusy: () => true });
    h.ports.plan.mockResolvedValue({ ...plan(), changed: ["a.ts"], reviewed: false });
    const done = h.indexer.reconcile();
    await vi.advanceTimersByTimeAsync(3_000);
    await done;
    expect(h.ports.mapPass).toHaveBeenCalledTimes(1);
  });

  it("regression: pauseL3 stops an L3 pass but leaves a map pass running", async () => {
    const h = harness();
    h.ports.plan.mockResolvedValue({ ...plan(), changed: ["a.ts"], reviewed: false });
    let mapSignal!: AbortSignal;
    h.ports.mapPass.mockImplementationOnce((_p, o) => new Promise((resolve) => { mapSignal = o.signal; o.signal.addEventListener("abort", () => resolve({ changed: [] })); }));
    const reconciling = h.indexer.reconcile();
    await vi.advanceTimersByTimeAsync(3_000);
    h.indexer.pauseL3();
    expect(mapSignal.aborted).toBe(false);
    h.indexer.pauseLongPass();
    await vi.advanceTimersByTimeAsync(1_000);
    await reconciling;
  });

  // regression: a run that started during the gate's own reads or the hand-over still let L3 start.
  it("regression: an agent run that starts during the sha read or the hand-over stops the start", async () => {
    const h = harness();
    await h.indexer.reconcile();
    // flips true on the gate's re-check after its own reads (the sha read, when the root has one)
    let reads = 0;
    Object.assign(h.ports, { agentBusy: () => { reads += 1; return reads >= 2; } });
    expect(await h.indexer.requestL3()).toBe(false);
    expect(h.analyzerPasses()).toBe(0);
    reads = 0;
    Object.assign(h.ports, { agentBusy: () => { reads += 1; return reads >= 3; } }); // busy only at the check inside the pass
    expect(await h.indexer.requestL3()).toBe(false);
    expect(h.analyzerPasses()).toBe(0);
    Object.assign(h.ports, { agentBusy: () => false });
    expect(await h.indexer.requestL3()).toBe(true);
  });

  it("a run that starts mid-pass stops the pass (pauseL3); L3 stays requested and reruns when the run is over", async () => {
    const h = harness();
    await h.indexer.reconcile();
    let signal!: AbortSignal;
    h.ports.mapPass.mockImplementationOnce((_p, o) => new Promise((resolve) => { signal = o.signal; o.signal.addEventListener("abort", () => resolve({ changed: [] })); }));
    const l3 = h.indexer.requestL3();
    await vi.advanceTimersByTimeAsync(10);
    h.indexer.pauseLongPass(); // what `BackgroundIndexer` does when `runStarted` fires
    expect(await l3).toBe(false);
    expect(signal.aborted).toBe(true);
    await h.indexer.tick("/ws"); // still requested: the tick runs it
    expect(h.analyzerPasses()).toBe(2);
  });
});

describe("L3 gate — the persisted sha", () => {
  const state = (initial: { done?: string; head?: string; blocked?: string }): L3StatePort & { set(head: string): void; marked: string[] } => {
    let head = initial.head;
    let done = initial.done;
    const marked: string[] = [];
    return {
      head: async () => head, done: () => done, markDone: (sha) => { done = sha; marked.push(sha); }, set: (sha) => { head = sha; }, marked,
      blocked: async () => initial.blocked,
    };
  };

  it("regression: a request after a restart on the sha the last completed pass saw has nothing to run", async () => {
    const h = harness({ l3State: state({ done: "aaa", head: "aaa" }) });
    await h.indexer.reconcile();
    expect(await h.indexer.requestL3()).toBe(true); // current
    expect(h.analyzerPasses()).toBe(0);
  });

  it("with no sha persisted a request runs at once, and completing it persists the sha", async () => {
    const s = state({ head: "aaa" });
    const h = harness({ l3State: s });
    await h.indexer.reconcile();
    expect(await h.indexer.requestL3()).toBe(true);
    expect(s.marked).toEqual(["aaa"]);
    expect(await h.indexer.requestL3()).toBe(true);
    expect(h.analyzerPasses()).toBe(1);
  });

  it("a new sha owes a requested pass at once (no settling window for a person's ask); an aborted pass persists nothing", async () => {
    const s = state({ done: "aaa", head: "aaa" });
    const h = harness({ l3State: s });
    await h.indexer.reconcile();
    expect(await h.indexer.requestL3()).toBe(true);
    expect(h.analyzerPasses()).toBe(0);
    s.set("bbb");
    let signal!: AbortSignal;
    h.ports.mapPass.mockImplementationOnce((_p, o) => new Promise((resolve) => { signal = o.signal; o.signal.addEventListener("abort", () => resolve({ changed: [] })); }));
    const l3 = h.indexer.requestL3();
    await vi.advanceTimersByTimeAsync(10);
    h.indexer.pauseLongPass();
    expect(await l3).toBe(false);
    expect(signal.aborted).toBe(true);
    expect(s.marked).toEqual([]);
    expect(await h.indexer.requestL3()).toBe(true);
    expect(s.marked).toEqual(["bbb"]);
  });

  // regression: the host died mid-pass on a 20k-file folder; every restart (and every view open) ran the same pass again.
  it("regression: a root its crash guard quarantines is refused before anything starts, and the request ends", async () => {
    const h = harness({ l3State: state({ head: "aaa", blocked: "the extension host stopped during the last L3 pass" }) });
    await h.indexer.reconcile();
    expect(await h.indexer.requestL3()).toBe(false);
    await h.indexer.tick("/ws");
    expect(h.analyzerPasses()).toBe(0);
    expect(h.indexer.status()).not.toHaveProperty("l3Waiting");
  });
});

describe("L3 gate — what the sha does NOT veto", () => {
  const same = (): L3StatePort & { marked: string[] } => {
    const marked: string[] = [];
    return { head: async () => "aaa", done: () => "aaa", markDone: (s) => { marked.push(s); }, marked };
  };

  // regression: the sha verdict vetoed ALL owed L3, so uncommitted edits never refreshed the analysis again.
  it("regression: a request after a file EDIT runs even though the sha is the persisted one", async () => {
    const h = harness({ l3State: same(), extractEdited: vi.fn(async () => ({ changed: ["a.ts"], unreviewed: [] as string[] })) });
    await h.indexer.reconcile();
    expect(await h.indexer.requestL3()).toBe(true); // the restart case: current, nothing ran
    expect(h.analyzerPasses()).toBe(0);
    const edited = h.indexer.edited(["a.ts"]);
    await vi.advanceTimersByTimeAsync(50);
    await edited;
    expect(h.analyzerPasses()).toBe(0); // an edit starts nothing
    expect(await h.indexer.requestL3()).toBe(true);
    expect(h.analyzerPasses()).toBe(1);
  });

  // regression: memory's review records a failed analyzer in `analyzerStatus` and resolves; L3 marked that pass done (sha
  // persisted, level 3 ready), so a failed analysis looked complete until the next commit.
  it("regression: a pass whose analyzer failed is a FAILED pass — logged, not marked done, not L3-ready; the next request runs it again", async () => {
    const marked: string[] = [];
    const s = { head: async () => "aaa", done: () => undefined as string | undefined, markDone: (sha: string) => { marked.push(sha); } };
    const h = harness({ l3State: s });
    // what production returns: the review resolves, its analyzer failure reported (never a throw)
    h.ports.mapPass.mockImplementationOnce(async () => ({ changed: [] as string[], analyzerFailures: ["code: spawn failed"] }));
    await h.indexer.reconcile();
    expect(await h.indexer.requestL3()).toBe(false);
    expect(h.errors).toEqual(["L3 analyzers: Error: code: spawn failed"]);
    expect(marked).toEqual([]);
    expect(h.indexer.status().ready).toBe(2);
    await h.indexer.tick("/ws");
    expect(h.analyzerPasses()).toBe(1); // the tick does not retry it
    expect(await h.indexer.requestL3()).toBe(true);
    expect(h.analyzerPasses()).toBe(2);
    expect(marked).toEqual(["aaa"]);
  });
});

describe("L3 gate — single flight, withdrawal, the tick's idle wait, sub-folder scopes", () => {
  it("overlapping requests, ticks and a reconcile's end never start two passes", async () => {
    const h = harness();
    await h.indexer.reconcile();
    let release!: () => void;
    h.ports.mapPass.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ changed: [] }); }));
    const first = h.indexer.requestL3();
    const second = h.indexer.requestL3();
    const tick = h.indexer.tick("/ws");
    await vi.advanceTimersByTimeAsync(10);
    expect(h.analyzerPasses()).toBe(1);
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true); // current by then: nothing more ran
    await tick;
    expect(h.analyzerPasses()).toBe(1);
  });

  it("a request withdrawn before it started (the view closed) is dropped: the tick does not run it", async () => {
    let busy = true;
    const h = harness({ busy: () => busy });
    await h.indexer.reconcile();
    expect(await h.indexer.requestL3()).toBe(false);
    expect(h.indexer.status()).toMatchObject({ l3Waiting: "busy" });
    h.indexer.withdrawL3();
    expect(h.indexer.status()).not.toHaveProperty("l3Waiting");
    busy = false;
    await h.indexer.tick("/ws");
    expect(h.analyzerPasses()).toBe(0);
  });

  it("the tick retries a pending request only after the person has been idle long enough", async () => {
    let typing: "typing" | undefined = "typing";
    let idle = 0;
    const ports = {
      rootId: "r", plan: vi.fn(async () => plan()), extractEdited: vi.fn(async () => ({ changed: [] as string[], unreviewed: [] as string[] })),
      mapPass: vi.fn(async (_p: IndexPlan, _o: { analyzers: boolean; signal: AbortSignal }) => ({ changed: [] as string[] })), onFactsChanged: vi.fn(async () => undefined),
    } satisfies IndexRootPorts;
    const indexer = new RootIndexer({
      ports, clock: realClock, gate: { pausedBy: () => typing, idleForMs: () => idle }, power: { current: async () => "mains" },
      priorityOf: () => PRIORITY.rest, publish: () => undefined, telemetry: () => undefined, log: () => undefined, quietPollMs: 10,
    });
    typing = undefined;
    idle = 10_000;
    const reconciled = indexer.reconcile();
    await vi.advanceTimersByTimeAsync(10);
    await reconciled;
    typing = "typing";
    expect(await indexer.requestL3()).toBe(false); // typing: it stays requested
    typing = undefined; // a pause between bursts of typing
    idle = 1_000;
    await indexer.tick("/ws");
    expect(ports.mapPass).not.toHaveBeenCalled();
    idle = L3_IDLE_MAINS_MS;
    await indexer.tick("/ws");
    expect(ports.mapPass).toHaveBeenCalledTimes(1);
  });

  it("a sub-folder root's request runs ITS pass (scoped), never the whole folder's, and is held off by either quarantine", async () => {
    const blockedFor: Array<string | undefined> = [];
    let blocked: string | undefined;
    const subRootPass = vi.fn(async (_rel: string, _signal: AbortSignal) => ({}));
    const h = harness({
      subRootPass,
      l3State: { head: async () => "aaa", done: () => "aaa", markDone: () => undefined, blocked: async (_head, rel) => { blockedFor.push(rel); return blocked; } },
    });
    await h.indexer.reconcile();
    expect(await h.indexer.requestL3("packages/x")).toBe(true);
    expect(subRootPass).toHaveBeenCalledTimes(1);
    expect(subRootPass.mock.calls[0]![0]).toBe("packages/x");
    expect(h.analyzerPasses()).toBe(0); // the folder's own pass did not run
    expect(blockedFor).toEqual(["packages/x"]);
    expect(await h.indexer.requestL3("packages/x")).toBe(true); // current
    expect(subRootPass).toHaveBeenCalledTimes(1);
    blocked = "quarantined";
    const edited = h.indexer.edited(["a.ts"]);
    await vi.advanceTimersByTimeAsync(50);
    await edited;
    expect(await h.indexer.requestL3("packages/x")).toBe(false);
    expect(subRootPass).toHaveBeenCalledTimes(1);
  });
});
