import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanDetail } from "@seanhogg/builderforce-memory/knowledge";
import type { PowerState } from "../power/powerSource";
import {
  ActivityGate, BULK_EDIT_FILES, COALESCE_MS, L3_IDLE_MAINS_MS, L3_IDLE_UNKNOWN_MS, LIVE_IDLE_WAIT_MS, LONG_PASS_IDLE_MS, PREEMPT_HOLD_MAX_MS, realClock, TYPING_QUIET_MS,
  UNKNOWN_RECONCILE_MS,
} from "./indexBudget";
import { ALL_FACT_KINDS, liveWatcherIdle, trackLiveBatch, type IndexLevelStatus } from "./indexLevels";
import type { IndexPlan } from "./indexReconcile";
import { PRIORITY } from "./indexScheduler";
import { PathCoalescer } from "./indexWatcher";
import { RootIndexer, type IndexRootPorts } from "./rootIndexer";

const TREE = 16_000;
const paths = Array.from({ length: TREE }, (_, i) => `src/d${i % 100}/f${i}.ts`);

function planOf(changed: string[], reviewed = true): IndexPlan {
  const prior = new Map(reviewed ? paths.map((p) => [p, `h:${p}`] as const) : []);
  return { files: TREE, changed, removed: [], reviewed, ms: 7, detail: { prior } as unknown as PlanDetail };
}

function harness(opts: { changed?: string[]; reviewed?: boolean; power?: PowerState; idle?: number; open?: string[]; gate?: "real" } = {}) {
  const status: IndexLevelStatus[] = [];
  const errors: string[] = [];
  const telemetry = vi.fn();
  const ports = {
    rootId: "r",
    plan: vi.fn(async () => planOf(opts.changed ?? [], opts.reviewed ?? true)),
    extractEdited: vi.fn(async (batch: readonly string[]) => ({ changed: [...batch], unreviewed: [] as string[] })),
    mapPass: vi.fn(async (plan: IndexPlan, _o: { analyzers: boolean; signal: AbortSignal }) => ({ changed: [...plan.changed] })),
    onFactsChanged: vi.fn(async (_p: readonly string[], _k: readonly string[]) => undefined),
  } satisfies IndexRootPorts;
  let idle = opts.idle ?? 10 * 60_000;
  let paused: "typing" | undefined;
  let indexer: RootIndexer | undefined;
  const real = opts.gate === "real" ? new ActivityGate(realClock, () => { void indexer?.resume(); }) : undefined;
  const gate = real ?? { pausedBy: () => paused, idleForMs: () => idle };
  let power: PowerState = opts.power ?? "mains";
  let powerQueries = 0;
  const open = new Set(opts.open ?? []);
  indexer = new RootIndexer({
    ports, clock: realClock, gate, power: { current: async () => { powerQueries += 1; return power; } },
    priorityOf: (p) => (open.has(p) ? PRIORITY.open : PRIORITY.rest),
    publish: (s) => status.push(s), telemetry, log: (what, error) => { errors.push(`${what}: ${String(error)}`); },
    quietPollMs: 100,
  });
  return {
    ports, status, telemetry, indexer, real, errors,
    /** `edited` drains with event-loop yields: advance the fake clock while it runs. */
    edit: async (batch: string[]) => { const run = indexer!.edited(batch); await vi.advanceTimersByTimeAsync(10); await run; },
    setIdle: (ms: number) => { idle = ms; },
    setPaused: (p: "typing" | undefined) => { paused = p; },
    setPower: (p: PowerState) => { power = p; },
    powerQueries: () => powerQueries,
    last: () => status[status.length - 1]!,
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("RootIndexer — open a folder (PRD 41 §6)", () => {
  it("a warm root with nothing changed reaches L2 from the plan alone: no extraction, no map pass", async () => {
    const h = harness();
    await h.indexer.reconcile();
    expect(h.ports.plan).toHaveBeenCalledTimes(1);
    expect(h.ports.mapPass).not.toHaveBeenCalled();
    expect(h.ports.extractEdited).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ rootId: "r", ready: 2, working: null, files: TREE });
    expect(h.telemetry).toHaveBeenCalledWith("index.plan_ms", { ms: 7, files: TREE, changed: 0 });
    expect(h.telemetry.mock.calls.filter(([n]) => n === "index.level_ready").map(([, p]) => p.level)).toEqual([0, 1, 2]);
  });

  it("extracts open changed files first, then maps the rest once the person is quiet, then runs the derived step", async () => {
    const changed = [paths[5]!, paths[9]!, paths[11]!];
    const h = harness({ changed, open: [paths[9]!], idle: 0 });
    const done = h.indexer.reconcile();
    await vi.advanceTimersByTimeAsync(50);
    // The open file is re-extracted at once; the long pass waits for quiet.
    expect(h.ports.extractEdited).toHaveBeenCalledWith([paths[9]]);
    expect(h.ports.mapPass).not.toHaveBeenCalled();
    h.setIdle(LONG_PASS_IDLE_MS);
    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(h.ports.mapPass).toHaveBeenCalledTimes(1);
    expect(h.ports.mapPass.mock.calls[0]![1].analyzers).toBe(false);
    expect(h.ports.onFactsChanged).toHaveBeenLastCalledWith([...changed].sort(), ALL_FACT_KINDS);
    expect(h.last().ready).toBe(2);
  });

  it("a never-reviewed root maps the whole tree in one map pass (nothing to re-extract against)", async () => {
    const h = harness({ changed: paths.slice(0, 3), reviewed: false, open: [paths[1]!] });
    await h.indexer.reconcile();
    expect(h.ports.extractEdited).not.toHaveBeenCalled();
    expect(h.ports.mapPass).toHaveBeenCalledTimes(1);
  });
});

describe("RootIndexer — edit a file (PRD 41 §6, done-check: one save in a 16k-file tree)", () => {
  it("a single save reaches updated L1/L2 facts for that file with O(changed) work: one extract of one file, no walk, no map pass", async () => {
    const h = harness();
    await h.indexer.reconcile();
    h.ports.plan.mockClear();
    const coalescer = new PathCoalescer(realClock, (_rootId, batch) => { void h.indexer.edited(batch); });
    const saved = paths[12_345]!;
    const started = Date.now();
    coalescer.push({ rootId: "r", rootPath: "/w" }, [`/w/${saved}`, `/w/${saved}`, "/w/.builderforce/cache/knowledge/index.sqlite"]);
    await vi.advanceTimersByTimeAsync(COALESCE_MS + 10);
    expect(Date.now() - started).toBeLessThan(200);
    expect(h.ports.extractEdited).toHaveBeenCalledTimes(1);
    expect(h.ports.extractEdited).toHaveBeenCalledWith([saved]);
    expect(h.ports.onFactsChanged).toHaveBeenCalledTimes(1);
    expect(h.ports.onFactsChanged).toHaveBeenCalledWith([saved], ALL_FACT_KINDS);
    expect(h.ports.plan).not.toHaveBeenCalled();
    expect(h.ports.mapPass).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ ready: 2, pending: 0, working: null });
    expect(h.errors).toEqual([]);
  });

  it("early cutoff: a save that leaves the content unchanged runs nothing derived", async () => {
    const h = harness();
    await h.indexer.reconcile();
    h.ports.extractEdited.mockResolvedValueOnce({ changed: [], unreviewed: [] });
    await h.edit([paths[1]!]);
    expect(h.ports.extractEdited).toHaveBeenCalledTimes(1);
    expect(h.ports.onFactsChanged).not.toHaveBeenCalled();
  });

  it("a new file the manifest does not know asks for a reconciling plan", async () => {
    const h = harness();
    await h.indexer.reconcile();
    h.ports.extractEdited.mockResolvedValueOnce({ changed: [], unreviewed: ["src/new.ts"] });
    await h.edit(["src/new.ts"]);
    expect(h.ports.plan).toHaveBeenCalledTimes(2);
  });

  it("queues open files first, then recently committed ones, then the rest", async () => {
    const h = harness({ open: [paths[3]!] });
    Object.assign(h.ports, { recent: async () => new Set([paths[2]!]) });
    await h.indexer.reconcile();
    await h.edit([paths[1]!, paths[2]!, paths[3]!]);
    expect(h.ports.extractEdited.mock.calls.flatMap(([b]) => [...b])).toEqual([paths[3], paths[2], paths[1]]);
  });

  it("a keystroke pauses the queue (reported as paused) until typing is quiet", async () => {
    const h = harness({ gate: "real" });
    await h.indexer.reconcile();
    h.real!.keystroke();
    void h.indexer.edited([paths[3]!]);
    await vi.advanceTimersByTimeAsync(TYPING_QUIET_MS - 1);
    expect(h.ports.extractEdited).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ pending: 1, paused: "typing" });
    await vi.advanceTimersByTimeAsync(10);
    expect(h.ports.extractEdited).toHaveBeenCalledWith([paths[3]]);
  });
});

/** A map pass that runs until its signal aborts or the test releases it. */
function blockingPass() {
  const signals: AbortSignal[] = [];
  let release: (() => void) | undefined;
  const impl = (plan: IndexPlan, o: { analyzers: boolean; signal: AbortSignal }) => {
    signals.push(o.signal);
    return new Promise<{ changed: string[] }>((resolve) => {
      release = () => resolve({ changed: [...plan.changed] });
      o.signal.addEventListener("abort", () => resolve({ changed: [] }));
    });
  };
  return { impl, signals, release: () => release?.() };
}

describe("RootIndexer — long passes yield to the person (Risks: background indexing slows typing; review preemption)", () => {
  it("a keystroke during the map pass stops it at once; it reruns once the person is quiet", async () => {
    const h = harness({ changed: paths.slice(0, 2), reviewed: false });
    const pass = blockingPass();
    h.ports.mapPass.mockImplementationOnce(pass.impl);
    const done = h.indexer.reconcile();
    await vi.advanceTimersByTimeAsync(10);
    expect(h.ports.mapPass).toHaveBeenCalledTimes(1);
    h.setPaused("typing");
    h.indexer.pauseLongPass();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pass.signals[0]!.aborted).toBe(true);
    expect(h.ports.mapPass).toHaveBeenCalledTimes(1); // still typing: nothing reruns
    h.setPaused(undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(h.ports.plan).toHaveBeenCalledTimes(2); // the rerun re-plans: the manifest keeps what the first pass finished
    expect(h.ports.mapPass).toHaveBeenCalledTimes(2);
    expect(h.last().ready).toBe(2);
  });

  it("a keystroke during L3 stops it; L3 stays owed and runs when its gate opens again", async () => {
    const h = harness({ power: "mains", idle: L3_IDLE_MAINS_MS });
    await h.indexer.reconcile();
    const pass = blockingPass();
    h.ports.mapPass.mockImplementationOnce(pass.impl);
    const l3 = h.indexer.maybeRunL3();
    await vi.advanceTimersByTimeAsync(10);
    h.indexer.pauseLongPass();
    expect(await l3).toBe(false);
    expect(pass.signals[0]!.aborted).toBe(true);
    expect(h.indexer.status().ready).toBe(2);
    expect(await h.indexer.maybeRunL3()).toBe(true);
    expect(h.last().ready).toBe(3);
  });

  it("slices wait while a map pass holds the root; edits seen meanwhile are extracted after it", async () => {
    const h = harness({ changed: [paths[0]!], reviewed: false });
    const pass = blockingPass();
    h.ports.mapPass.mockImplementationOnce(pass.impl);
    const done = h.indexer.reconcile();
    await vi.advanceTimersByTimeAsync(10);
    void h.indexer.edited([paths[7]!]);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.ports.extractEdited).not.toHaveBeenCalled();
    expect(h.indexer.status()).toMatchObject({ pending: 1, paused: "pass" });
    pass.release();
    await vi.advanceTimersByTimeAsync(50);
    await done;
    expect(h.ports.extractEdited).toHaveBeenCalledWith([paths[7]]);
  });

  it("a map pass waits for the slice in flight before it starts", async () => {
    const h = harness({ changed: [paths[0]!], reviewed: false, idle: 0 });
    let finishSlice: (() => void) | undefined;
    h.ports.extractEdited.mockImplementationOnce((batch) => new Promise((resolve) => { finishSlice = () => resolve({ changed: [...batch], unreviewed: [] }); }));
    void h.indexer.edited([paths[3]!]);
    await vi.advanceTimersByTimeAsync(5);
    const done = h.indexer.reconcile();
    h.setIdle(LONG_PASS_IDLE_MS);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.ports.mapPass).not.toHaveBeenCalled();
    finishSlice!();
    await vi.advanceTimersByTimeAsync(50);
    await done;
    expect(h.ports.mapPass).toHaveBeenCalledTimes(1);
  });

  it("preempt stops the pass, resolves once it has stopped, and holds background passes off until released — however long the person's setup takes", async () => {
    const h = harness({ changed: paths.slice(0, 2), reviewed: false });
    const pass = blockingPass();
    h.ports.mapPass.mockImplementationOnce(pass.impl);
    const done = h.indexer.reconcile();
    await vi.advanceTimersByTimeAsync(10);
    const release = await h.indexer.preempt();
    expect(pass.signals[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000); // the person's review is still setting up its ports
    expect(h.ports.mapPass).toHaveBeenCalledTimes(1);
    release(); // their review holds the root now (or ended)
    release(); // idempotent
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(h.ports.mapPass).toHaveBeenCalledTimes(2); // the aborted work was owed, and ran after
  });

  it("a hold never released expires, so a failed caller cannot stall the indexer for good", async () => {
    const h = harness({ changed: paths.slice(0, 2), reviewed: false });
    await h.indexer.preempt();
    const done = h.indexer.reconcile();
    await vi.advanceTimersByTimeAsync(PREEMPT_HOLD_MAX_MS - 1_000);
    expect(h.ports.mapPass).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    await done;
    expect(h.ports.mapPass).toHaveBeenCalledTimes(1);
  });

  it("a reconcile that finds work while L3 runs waits for it instead of failing", async () => {
    const h = harness({ power: "mains", idle: L3_IDLE_MAINS_MS });
    await h.indexer.reconcile();
    const pass = blockingPass();
    h.ports.mapPass.mockImplementationOnce(pass.impl);
    const l3 = h.indexer.maybeRunL3();
    await vi.advanceTimersByTimeAsync(10);
    h.ports.plan.mockResolvedValueOnce(planOf([paths[4]!]));
    const done = h.indexer.reconcile();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.ports.mapPass).toHaveBeenCalledTimes(1); // the map pass waits for L3
    pass.release();
    expect(await l3).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(h.ports.mapPass).toHaveBeenCalledTimes(2);
    expect(h.errors).toEqual([]);
  });
});

describe("RootIndexer — hand-overs with the live view and the person's reviews", () => {
  it("its first write waits for the live view's own watcher batch still in flight", async () => {
    const h = harness();
    let land!: () => void;
    trackLiveBatch("r", new Promise<void>((resolve) => { land = resolve; }));
    Object.assign(h.ports, { liveIdle: () => liveWatcherIdle("r", LIVE_IDLE_WAIT_MS) });
    await h.indexer.reconcile();
    void h.indexer.edited([paths[1]!]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.ports.extractEdited).not.toHaveBeenCalled();
    land();
    await vi.advanceTimersByTimeAsync(10);
    expect(h.ports.extractEdited).toHaveBeenCalledWith([paths[1]]);
  });

  it("a live batch that never lands holds the first write at most LIVE_IDLE_WAIT_MS, and only the first", async () => {
    const h = harness();
    trackLiveBatch("r", new Promise<void>(() => undefined));
    const liveIdle = vi.fn(() => liveWatcherIdle("r", LIVE_IDLE_WAIT_MS));
    Object.assign(h.ports, { liveIdle });
    await h.indexer.reconcile();
    void h.indexer.edited([paths[1]!]);
    await vi.advanceTimersByTimeAsync(LIVE_IDLE_WAIT_MS - 100);
    expect(h.ports.extractEdited).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(h.ports.extractEdited).toHaveBeenCalledTimes(1);
    await h.edit([paths[2]!]);
    expect(h.ports.extractEdited).toHaveBeenCalledTimes(2);
    expect(liveIdle).toHaveBeenCalledTimes(1);
  });

  it("the folder's map pass does not start while busy() — a review of the folder or of a sub-folder root of it — runs", async () => {
    const h = harness({ changed: paths.slice(0, 2), reviewed: false });
    let reviewing = true;
    Object.assign(h.ports, { busy: () => reviewing });
    const done = h.indexer.reconcile();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.ports.mapPass).not.toHaveBeenCalled();
    reviewing = false;
    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(h.ports.mapPass).toHaveBeenCalledTimes(1);
  });
});

describe("RootIndexer — unknown paths and bulk edits never storm the tree", () => {
  it("a file the plan would not list (ignored, under a skipped folder) never triggers a reconcile", async () => {
    const h = harness();
    Object.assign(h.ports, { wouldList: async () => [] });
    await h.indexer.reconcile();
    h.ports.extractEdited.mockResolvedValue({ changed: [], unreviewed: ["dist/out.js"] });
    await h.edit(["dist/out.js"]);
    expect(h.ports.plan).toHaveBeenCalledTimes(1);
  });

  it("unknown-path reconciles run at most once per 30 s; the ones in between share one at the window's end", async () => {
    const h = harness();
    await h.indexer.reconcile();
    h.ports.extractEdited.mockImplementation(async (batch) => ({ changed: [], unreviewed: [...batch] }));
    await h.edit(["src/new1.ts"]);
    expect(h.ports.plan).toHaveBeenCalledTimes(2);
    for (let i = 2; i < 12; i++) await h.edit([`src/new${i}.ts`]);
    expect(h.ports.plan).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(UNKNOWN_RECONCILE_MS);
    expect(h.ports.plan).toHaveBeenCalledTimes(3);
  });

  it("a batch over 100 files (a branch switch) goes to the reconcile and its map pass, not the per-file path", async () => {
    const h = harness();
    await h.indexer.reconcile();
    await h.edit(paths.slice(0, BULK_EDIT_FILES + 1));
    expect(h.ports.extractEdited).not.toHaveBeenCalled();
    expect(h.ports.plan).toHaveBeenCalledTimes(2);
  });

  it("a refocus that finds nothing new emits no telemetry", async () => {
    const h = harness();
    await h.indexer.reconcile();
    const sent = h.telemetry.mock.calls.length;
    await h.indexer.reconcile();
    await h.indexer.reconcile();
    expect(h.telemetry.mock.calls.length).toBe(sent);
  });
});

describe("RootIndexer — L3 only when idle and on mains power (§12.3)", () => {
  it("is blocked while the person's own review runs, and says so", async () => {
    const h = harness({ power: "mains", idle: 24 * 3_600_000 });
    Object.assign(h.ports, { busy: () => true });
    await h.indexer.reconcile();
    expect(await h.indexer.maybeRunL3()).toBe(false);
    expect(h.ports.mapPass).not.toHaveBeenCalled();
    expect(h.last()).toMatchObject({ l3Waiting: "busy" });
  });

  it("reports waiting for idle apart from busy, and asks the power source only once idle long enough", async () => {
    const h = harness({ power: "mains", idle: 1_000 });
    await h.indexer.reconcile();
    expect(await h.indexer.maybeRunL3()).toBe(false);
    expect(h.last()).toMatchObject({ l3Waiting: "idle-wait" });
    expect(h.powerQueries()).toBe(0);
  });

  const analyzerPasses = (h: ReturnType<typeof harness>) => h.ports.mapPass.mock.calls.filter(([, o]) => o.analyzers).length;

  it("never runs on battery, however long idle", async () => {
    const h = harness({ power: "battery", idle: 24 * 3_600_000 });
    await h.indexer.reconcile();
    expect(await h.indexer.maybeRunL3()).toBe(false);
    expect(analyzerPasses(h)).toBe(0);
    expect(h.last()).toMatchObject({ ready: 2, l3Waiting: "battery" });
  });

  it("never runs while the person is not idle, on mains or unknown power", async () => {
    const h = harness({ power: "mains", idle: L3_IDLE_MAINS_MS - 1 });
    await h.indexer.reconcile();
    expect(await h.indexer.maybeRunL3()).toBe(false);
    h.setPower("unknown");
    h.setIdle(L3_IDLE_UNKNOWN_MS - 1);
    expect(await h.indexer.maybeRunL3()).toBe(false);
    h.setPaused("typing");
    h.setPower("mains");
    h.setIdle(L3_IDLE_UNKNOWN_MS);
    expect(await h.indexer.maybeRunL3()).toBe(false);
    expect(analyzerPasses(h)).toBe(0);
  });

  it("runs once idle on mains (or long idle on unknown power), then reports L3 ready until facts change", async () => {
    const h = harness({ power: "mains", idle: L3_IDLE_MAINS_MS });
    await h.indexer.reconcile();
    expect(await h.indexer.maybeRunL3()).toBe(true);
    expect(analyzerPasses(h)).toBe(1);
    expect(h.last().ready).toBe(3);
    expect(await h.indexer.maybeRunL3()).toBe(false); // not owed again
    await h.edit([paths[2]!]);
    expect(h.indexer.status().ready).toBe(2);
    h.setPower("unknown");
    h.setIdle(L3_IDLE_UNKNOWN_MS);
    expect(await h.indexer.maybeRunL3()).toBe(true);
    expect(analyzerPasses(h)).toBe(2);
  });
});
