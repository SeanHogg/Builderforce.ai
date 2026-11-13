/** The L3 gate's two new inputs (PRD 41 §12.3): an active agent run makes the root busy, and the persisted sha decides what is owed. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanDetail } from "@seanhogg/builderforce-memory/knowledge";
import { L3_HEAD_STABLE_MS, L3_IDLE_MAINS_MS, L3_RETRY_BACKOFF_MS, realClock, type Clock } from "./indexBudget";
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
  const indexer = new RootIndexer({
    ports, clock, gate: { pausedBy: () => undefined, idleForMs: () => L3_IDLE_MAINS_MS }, power: { current: async () => "mains" },
    priorityOf: () => PRIORITY.rest, publish: () => undefined, telemetry: () => undefined, log: () => undefined, quietPollMs: 10,
  });
  return { ports, indexer, analyzerPasses: () => ports.mapPass.mock.calls.filter(([, o]) => o.analyzers).length };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("L3 gate — an active agent run", () => {
  // regression: the person is idle while an agent works, so L3 started mid-run and held the extension host.
  it("regression: L3 waits ('busy') while a run is active, and runs once it has ended", async () => {
    let active = true;
    const h = harness({ agentBusy: () => active });
    await h.indexer.reconcile();
    expect(await h.indexer.maybeRunL3()).toBe(false);
    expect(h.analyzerPasses()).toBe(0);
    expect(h.indexer.status()).toMatchObject({ l3Waiting: "busy" });
    active = false;
    expect(await h.indexer.maybeRunL3()).toBe(true);
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

  // regression: a run that started during the power query or the hand-over still let L3 start.
  it("regression: an agent run that starts during the power query or the hand-over stops the start", async () => {
    const h = harness();
    await h.indexer.reconcile();
    // flips true on the first read after the gate looked: the power query is the first await after it
    let reads = 0;
    Object.assign(h.ports, { agentBusy: () => { reads += 1; return reads >= 3; } });
    expect(await h.indexer.maybeRunL3()).toBe(false);
    expect(h.analyzerPasses()).toBe(0);
    reads = 0;
    Object.assign(h.ports, { agentBusy: () => { reads += 1; return reads >= 4; } }); // busy only at the check inside the pass
    expect(await h.indexer.maybeRunL3()).toBe(false);
    expect(h.analyzerPasses()).toBe(0);
    Object.assign(h.ports, { agentBusy: () => false });
    expect(await h.indexer.maybeRunL3()).toBe(true);
  });

  it("a run that starts mid-pass stops the pass (pauseL3); L3 stays owed and reruns when the run is over", async () => {
    const h = harness();
    await h.indexer.reconcile();
    let signal!: AbortSignal;
    h.ports.mapPass.mockImplementationOnce((_p, o) => new Promise((resolve) => { signal = o.signal; o.signal.addEventListener("abort", () => resolve({ changed: [] })); }));
    const l3 = h.indexer.maybeRunL3();
    await vi.advanceTimersByTimeAsync(10);
    h.indexer.pauseLongPass(); // what `BackgroundIndexer` does when `runStarted` fires
    expect(await l3).toBe(false);
    expect(signal.aborted).toBe(true);
    expect(await h.indexer.maybeRunL3()).toBe(true);
  });
});

describe("L3 gate — the persisted sha", () => {
  const state = (initial: { done?: string; head?: string }): L3StatePort & { set(head: string): void; marked: string[] } => {
    let head = initial.head;
    let done = initial.done;
    const marked: string[] = [];
    return { head: async () => head, done: () => done, markDone: (sha) => { done = sha; marked.push(sha); }, set: (sha) => { head = sha; }, marked };
  };

  it("regression: a restart on the sha the last completed pass saw does not run L3 again", async () => {
    const h = harness({ l3State: state({ done: "aaa", head: "aaa" }) });
    await h.indexer.reconcile();
    expect(await h.indexer.maybeRunL3()).toBe(false);
    expect(h.analyzerPasses()).toBe(0);
  });

  it("with no sha persisted L3 is owed at once, and completing it persists the sha", async () => {
    const s = state({ head: "aaa" });
    const h = harness({ l3State: s });
    await h.indexer.reconcile();
    expect(await h.indexer.maybeRunL3()).toBe(true);
    expect(s.marked).toEqual(["aaa"]);
    expect(await h.indexer.maybeRunL3()).toBe(false);
  });

  it("a new sha re-owes L3 only after the debounce window (fake clock); an aborted pass persists nothing", async () => {
    const s = state({ done: "aaa", head: "aaa" });
    const h = harness({ l3State: s });
    await h.indexer.reconcile();
    expect(await h.indexer.maybeRunL3()).toBe(false);
    s.set("bbb");
    expect(await h.indexer.maybeRunL3()).toBe(false); // seen just now
    await vi.advanceTimersByTimeAsync(L3_HEAD_STABLE_MS);
    let signal!: AbortSignal;
    h.ports.mapPass.mockImplementationOnce((_p, o) => new Promise((resolve) => { signal = o.signal; o.signal.addEventListener("abort", () => resolve({ changed: [] })); }));
    const l3 = h.indexer.maybeRunL3();
    await vi.advanceTimersByTimeAsync(10);
    h.indexer.pauseLongPass();
    expect(await l3).toBe(false);
    expect(signal.aborted).toBe(true);
    expect(s.marked).toEqual([]);
    expect(await h.indexer.maybeRunL3()).toBe(true);
    expect(s.marked).toEqual(["bbb"]);
  });
});

describe("L3 gate — what the sha does NOT veto", () => {
  const same = (): L3StatePort & { marked: string[] } => {
    const marked: string[] = [];
    return { head: async () => "aaa", done: () => "aaa", markDone: (s) => { marked.push(s); }, marked };
  };

  // regression: the sha verdict vetoed ALL owed L3, so uncommitted edits never refreshed the analysis again.
  it("regression: an owed set by a file EDIT runs even though the sha is the persisted one", async () => {
    const h = harness({ l3State: same(), extractEdited: vi.fn(async () => ({ changed: ["a.ts"], unreviewed: [] as string[] })) });
    await h.indexer.reconcile();
    expect(await h.indexer.maybeRunL3()).toBe(false); // the restart case: vetoed
    const edited = h.indexer.edited(["a.ts"]);
    await vi.advanceTimersByTimeAsync(50);
    await edited;
    expect(await h.indexer.maybeRunL3()).toBe(true);
    expect(h.analyzerPasses()).toBe(1);
  });

  // regression: one transient failure disabled L3 until the next commit.
  it("regression: a failed pass (not an out-of-memory) retries after the backoff; an out-of-memory is not retried for that sha", async () => {
    const mk = (error: Error) => {
      const s = { head: async () => "aaa", done: () => undefined as string | undefined, markDone: () => undefined };
      const h = harness({ l3State: s });
      h.ports.mapPass.mockImplementationOnce(async () => { throw error; });
      return h;
    };
    const transient = mk(new Error("spawn failed"));
    await transient.indexer.reconcile();
    expect(await transient.indexer.maybeRunL3()).toBe(false);
    expect(await transient.indexer.maybeRunL3()).toBe(false); // backing off
    await vi.advanceTimersByTimeAsync(L3_RETRY_BACKOFF_MS);
    expect(await transient.indexer.maybeRunL3()).toBe(true);

    const oom = mk(Object.assign(new Error("Worker terminated due to reaching memory limit"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
    await oom.indexer.reconcile();
    expect(await oom.indexer.maybeRunL3()).toBe(false);
    await vi.advanceTimersByTimeAsync(L3_RETRY_BACKOFF_MS * 3);
    expect(await oom.indexer.maybeRunL3()).toBe(false);
    expect(oom.analyzerPasses()).toBe(1);
  });
});
