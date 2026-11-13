import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyReplicaState, runFileName, runsIndexFileName, type KnowledgeFiles } from "@builderforce/agent-tools/knowledge";
import type { ReviewReport } from "@seanhogg/builderforce-memory/knowledge";
import type { KnowledgeStoredRun } from "../knowledgeProtocol";
import type { LagHistogram } from "./reviewHostLag";
import { getRun, listRuns, onTheWire, RUN_SAVE_INTERVAL_MS, stopRunById, trackRun, WIRE_FAILURES } from "./reviewRuns";
import { createRunStore, RUN_STALE_MS, RUNS_KEPT } from "./reviewRunStore";

type Mem = KnowledgeFiles & { files: Map<string, string>; renames: string[] };

function memoryFiles(caps: { remove?: boolean; list?: boolean; rename?: boolean } = {}): Mem {
  const { remove = true, list = true, rename = true } = caps;
  const files = new Map<string, string>();
  const renames: string[] = [];
  return {
    files, renames,
    read: async (name) => files.get(name),
    write: async (name, text) => { files.set(name, text); },
    ...(rename ? { rename: async (from: string, to: string) => { renames.push(`${from}>${to}`); files.set(to, files.get(from)!); files.delete(from); } } : {}),
    ...(remove ? { remove: async (name: string) => { files.delete(name); } } : {}),
    ...(list ? { list: async (folder: string) => [...files.keys()].filter((k) => k.startsWith(`${folder}/`)).map((k) => k.slice(folder.length + 1)) } : {}),
  };
}

const runOf = (id: string, root: string, at: number, over: Partial<KnowledgeStoredRun> = {}): KnowledgeStoredRun => ({
  id, root, kind: "review", startedAt: at, endedAt: at + 10, updatedAt: at + 10, outcome: "done",
  phases: [{ phase: "extract", startedAt: at, endedAt: at + 10, done: 3, total: 3 }],
  lanes: [{ phase: "extract", id: 0, path: "a.ts", done: 3, busyMs: 9 }],
  steps: [{ path: "a.ts", phase: "extract", ms: 3, outcome: "ok", lane: 0 }],
  failures: [{ path: "a.ts", phase: "extract", reason: "boom" }],
  ...over,
});

const report = { rootId: "root-a", extracted: 3, judged: 0, extractErrors: 0, failures: [], aborted: false, durationMs: 10 } as unknown as ReviewReport;

afterEach(() => { vi.useRealTimers(); });

/** A fixed fake clock: no test reads the real time. Far after every fixture's `updatedAt`. */
const CLOCK = 5_000_000;
const storeOn = (files: KnowledgeFiles, opts: Parameters<typeof createRunStore>[1] = {}) => createRunStore(files, { now: () => CLOCK, ...opts });
/** Waits for every queued (fire-and-forget) save in this process to land. */
const settle = (files: KnowledgeFiles) => storeOn(files).idle();

describe("the run store", () => {
  it("keeps the last 20 runs per root, newest first, and deletes the older run files", async () => {
    const files = memoryFiles();
    const store = storeOn(files);
    for (let i = 0; i < RUNS_KEPT + 5; i += 1) await store.save(runOf(`a${i}`, "root-a", i));
    for (let i = 0; i < 2; i += 1) await store.save(runOf(`b${i}`, "root-b", i));

    const listed = await store.list("root-a");
    expect(listed).toHaveLength(RUNS_KEPT);
    expect(listed[0]!.id).toBe(`a${RUNS_KEPT + 4}`);
    expect(listed.at(-1)!.id).toBe("a5");
    for (let i = 0; i < 5; i += 1) expect(files.files.has(runFileName(`a${i}`))).toBe(false);
    expect(files.files.has(runFileName("a5"))).toBe(true);
    expect((await store.list("root-b")).map((r) => r.id)).toEqual(["b1", "b0"]);
  });

  it("lists runs without steps, lanes and failures (the count stays), and reads one whole", async () => {
    const store = storeOn(memoryFiles());
    await store.save(runOf("r1", "root-a", 1));
    const [summary] = await store.list("root-a");
    expect(summary).not.toHaveProperty("steps");
    expect(summary).not.toHaveProperty("lanes");
    expect(summary).not.toHaveProperty("failures");
    expect(summary).toMatchObject({ id: "r1", outcome: "done", failureCount: 1 });
    expect((await store.get("r1"))!.steps).toHaveLength(1);
    expect((await store.get("r1"))!.failures).toHaveLength(1);
  });

  it("writes every file atomically: a temp file, then a rename", async () => {
    const files = memoryFiles();
    await storeOn(files).save(runOf("r1", "root-a", 1));
    const tempTo = (name: string) => new RegExp(`^${name.replace(/[.\\/]/g, "\\$&")}\\.\\d+\\.${CLOCK.toString(36)}-[a-z0-9]+\\.tmp>${name.replace(/[.\\/]/g, "\\$&")}$`);
    expect(files.renames.some((r) => tempTo(runFileName("r1")).test(r))).toBe(true);
    expect(files.renames.some((r) => tempTo(runsIndexFileName("root-a")).test(r))).toBe(true);
    expect([...files.files.keys()].some((k) => k.endsWith(".tmp"))).toBe(false);
  });

  it("saving a run again does not list it twice", async () => {
    const store = storeOn(memoryFiles());
    await store.save(runOf("r1", "root-a", 1));
    await store.save({ ...runOf("r1", "root-a", 1), outcome: "failed" });
    expect((await store.list("root-a")).map((r) => `${r.id}:${r.outcome}`)).toEqual(["r1:failed"]);
  });

  it("refuses an id that is not a run id, and a missing run", async () => {
    const store = storeOn(memoryFiles());
    expect(await store.get("../manifest")).toBeUndefined();
    expect(await store.get("nope")).toBeUndefined();
  });

  it("on a host that cannot delete or list, still caps what is listed", async () => {
    const store = storeOn(memoryFiles({ remove: false, list: false, rename: false }), { keep: 3 });
    for (let i = 0; i < 5; i += 1) await store.save(runOf(`r${i}`, "root-a", i));
    expect((await store.list("root-a")).map((r) => r.id)).toEqual(["r4", "r3", "r2"]);
  });

  it("rebuilds a missing index from the runs folder, newest first, for this root only", async () => {
    const files = memoryFiles();
    const store = storeOn(files);
    for (let i = 0; i < 3; i += 1) await store.save(runOf(`a${i}`, "root-a", i));
    await store.save(runOf("b0", "root-b", 9));
    files.files.delete(runsIndexFileName("root-a"));
    expect((await store.list("root-a")).map((r) => r.id)).toEqual(["a2", "a1", "a0"]);
    // list is read only: it rebuilds in memory and never writes the index back.
    expect(files.files.has(runsIndexFileName("root-a"))).toBe(false);
  });

  it("rebuilds a torn index the same way", async () => {
    const files = memoryFiles();
    const store = storeOn(files);
    await store.save(runOf("a0", "root-a", 1));
    await store.save(runOf("a1", "root-a", 2));
    files.files.set(runsIndexFileName("root-a"), '{"ids":["a1","a');
    expect((await store.list("root-a")).map((r) => r.id)).toEqual(["a1", "a0"]);
  });

  it("reads a run left running by a closed window as interrupted, but not one that is live or recent", async () => {
    const files = memoryFiles();
    let clock = 1_000_000;
    const live = new Set<string>();
    const store = createRunStore(files, { now: () => clock, isLive: (id) => live.has(id) });
    const running = (id: string): KnowledgeStoredRun => runOf(id, "root-a", clock, { outcome: undefined, endedAt: undefined, updatedAt: clock });
    await store.save(running("old"));
    await store.save(running("live"));
    live.add("live");
    clock += RUN_STALE_MS + 1;
    await store.save(running("fresh"));

    const byId = Object.fromEntries((await store.list("root-a")).map((r) => [r.id, r]));
    expect(byId.old).toMatchObject({ outcome: "interrupted" });
    expect(byId.old!.endedAt).toBeDefined();
    expect(byId.live!.outcome).toBeUndefined();
    expect(byId.fresh!.outcome).toBeUndefined();
    expect((await store.get("old"))!.outcome).toBe("interrupted");
  });

  it("prunes run files past the ring once a run finishes, keeping other roots' files", async () => {
    const files = memoryFiles();
    // A finished run file in the folder that is within the ring is adopted into the index (it is not an orphan);
    // one past the ring is.
    const store = storeOn(files, { keep: 1 });
    await store.save(runOf("keep", "root-a", 5));
    await store.save(runOf("other", "root-b", 5));
    files.files.set(runFileName("orphan"), JSON.stringify(runOf("orphan", "root-a", 1)));
    await store.save(runOf("keep", "root-a", 5), { prune: true });
    expect(files.files.has(runFileName("orphan"))).toBe(false);
    expect(files.files.has(runFileName("keep"))).toBe(true);
    expect(files.files.has(runFileName("other"))).toBe(true);
  });
});

describe("trackRun", () => {
  it("records a review from start to end, posts it, keeps it with the replica state, and lists it back", async () => {
    const files = memoryFiles();
    const posted: KnowledgeStoredRun[] = [];
    const replica = { ...emptyReplicaState(), dirty: 4 };
    const tracker = trackRun({ rootId: "root-a", request: { force: true }, files, post: (r) => posted.push(r), replica: async () => replica });

    tracker.progress({ phase: "extract", done: 0, total: 2 });
    tracker.step({ path: "a.ts", phase: "extract", ms: 4, outcome: "failed", reason: "boom", lane: 0 });
    await tracker.finish("done", report);

    expect(posted[0]).toMatchObject({ id: tracker.id, kind: "re-review" });
    const final = posted.at(-1)!;
    expect(final).toMatchObject({ outcome: "done", replica, report: { extracted: 3 }, failureCount: 1 });
    expect(final.failures).toEqual([{ path: "a.ts", phase: "extract", reason: "boom" }]);

    const [listed] = await listRuns(files, "root-a");
    expect(listed).toMatchObject({ id: tracker.id, kind: "re-review", outcome: "done", replica, failureCount: 1 });
    expect(await getRun([memoryFiles(), files], tracker.id)).toMatchObject({ id: tracker.id, steps: [{ path: "a.ts" }] });
    expect(await getRun([files], "missing")).toBeNull();
  });

  it("saves a running record at the start and refreshes it every 5 seconds, then stops", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const files = memoryFiles();
    const tracker = trackRun({ rootId: "root-a", request: {}, files, post: () => undefined, replica: async () => undefined });
    await vi.advanceTimersByTimeAsync(0);
    await settle(files);
    const first = JSON.parse(files.files.get(runFileName(tracker.id))!) as KnowledgeStoredRun;
    expect(first).toMatchObject({ id: tracker.id, startedAt: 2_000_000 });
    expect(first.outcome).toBeUndefined();
    expect((await listRuns(files, "root-a"))[0]!.outcome).toBeUndefined(); // live in this process: not interrupted

    tracker.step({ path: "a.ts", phase: "extract", ms: 1, outcome: "ok", lane: 0 });
    await vi.advanceTimersByTimeAsync(RUN_SAVE_INTERVAL_MS);
    await settle(files);
    const refreshed = JSON.parse(files.files.get(runFileName(tracker.id))!) as KnowledgeStoredRun;
    expect(refreshed.steps).toHaveLength(1);
    expect(refreshed.updatedAt).toBe(2_000_000 + RUN_SAVE_INTERVAL_MS);

    await tracker.finish("stopped");
    const after = files.files.get(runFileName(tracker.id));
    await vi.advanceTimersByTimeAsync(RUN_SAVE_INTERVAL_MS * 3);
    await settle(files);
    expect(files.files.get(runFileName(tracker.id))).toBe(after);
    expect((JSON.parse(after!) as KnowledgeStoredRun).outcome).toBe("stopped");
  });

  it("keeps the run before it posts the final one, so the panel can fetch it at once", async () => {
    const files = memoryFiles();
    let keptWhenPosted: string | undefined;
    const tracker = trackRun({
      rootId: "root-a", request: {}, files, replica: async () => undefined,
      post: (r) => { if (r.outcome) keptWhenPosted = files.files.get(runFileName(r.id)); },
    });
    await tracker.finish("done", report);
    expect(JSON.parse(keptWhenPosted!)).toMatchObject({ id: tracker.id, outcome: "done" });
  });

  it("posts only the latest failures and their count, and keeps every failure", async () => {
    const files = memoryFiles();
    const posted: KnowledgeStoredRun[] = [];
    const tracker = trackRun({ rootId: "root-a", request: {}, files, post: (r) => posted.push(r), replica: async () => undefined });
    const total = WIRE_FAILURES + 30;
    for (let i = 0; i < total; i += 1) tracker.step({ path: `f${i}.ts`, phase: "extract", ms: 1, outcome: "failed", reason: "boom", lane: 0 });
    await tracker.finish("done", report);

    const final = posted.at(-1)!;
    expect(final.failures).toHaveLength(WIRE_FAILURES);
    expect(final.failures.at(-1)!.path).toBe(`f${total - 1}.ts`);
    expect(final.failureCount).toBe(total);
    expect((await getRun([files], tracker.id))!.failures).toHaveLength(total);
    expect((await listRuns(files, "root-a"))[0]).toMatchObject({ failureCount: total });
    expect(onTheWire(runOf("x", "r", 1)).failureCount).toBe(1);
  });

  it("names a seed run, and records why parallel extraction was down", async () => {
    const files = memoryFiles();
    const posted: KnowledgeStoredRun[] = [];
    const tracker = trackRun({
      rootId: "root-a", request: { seed: true }, files, post: (r) => posted.push(r), replica: async () => undefined, poolDown: () => "the worker crashed",
    });
    await tracker.finish("stopped");
    const [listed] = await listRuns(files, "root-a");
    expect(listed).toMatchObject({ kind: "seed", outcome: "stopped", poolDown: "the worker crashed" });
    expect(listed).not.toHaveProperty("replica");
    expect(posted.at(-1)!.poolDown).toBe("the worker crashed");
  });

  it("reports a record that cannot be kept, and still posts the final run", async () => {
    const files = memoryFiles();
    files.write = async () => { throw new Error("disk full"); };
    const posted: KnowledgeStoredRun[] = [];
    const errors: unknown[] = [];
    const tracker = trackRun({ rootId: "root-a", request: {}, files, post: (r) => posted.push(r), replica: async () => undefined, onSaveError: (e) => errors.push(e) });
    await tracker.finish("done", report);
    expect(posted.at(-1)!.outcome).toBe("done");
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});

describe("run payload contract", () => {
  const bigReport = (n: number) => ({ ...report, failures: Array.from({ length: n }, (_, i) => ({ path: `f${i}.ts`, phase: "extract", reason: "boom" })) }) as unknown as ReviewReport;

  it("never ships or stores report.failures: the wire event and the list summary carry none of them", async () => {
    const files = memoryFiles();
    const posted: KnowledgeStoredRun[] = [];
    const tracker = trackRun({ rootId: "root-a", request: {}, files, post: (r) => posted.push(r), replica: async () => undefined });
    const total = WIRE_FAILURES + 30;
    for (let i = 0; i < total; i += 1) tracker.step({ path: `f${i}.ts`, phase: "extract", ms: 1, outcome: "failed", reason: "boom", lane: 0 });
    await tracker.finish("done", bigReport(total));

    expect(posted.at(-1)!.report!.failures).toEqual([]);
    expect(posted.at(-1)!.failures).toHaveLength(WIRE_FAILURES);
    expect((await getRun([files], tracker.id))!.report!.failures).toEqual([]);
    const [summary] = await listRuns(files, "root-a");
    expect(summary!.report?.failures ?? []).toEqual([]);
    expect(summary!.failureCount).toBe(total);
    expect(onTheWire(runOf("x", "r", 1, { report: bigReport(200) })).report!.failures).toEqual([]);
  });

  it("lists a record that has no failures array as zero", async () => {
    const files = memoryFiles();
    const bare = { ...runOf("r1", "root-a", 1) } as Partial<KnowledgeStoredRun>;
    delete bare.failures;
    await storeOn(files).save(bare as KnowledgeStoredRun);
    expect((await storeOn(files).list("root-a"))[0]!.failureCount).toBe(0);
  });
});

describe("the run store under concurrent windows", () => {
  it("writes each file through a unique temp name", async () => {
    const files = memoryFiles();
    const store = storeOn(files);
    await store.save(runOf("r1", "root-a", 1));
    await store.save(runOf("r2", "root-a", 2));
    const temps = files.renames.map((r) => r.split(">")[0]!);
    expect(new Set(temps).size).toBe(temps.length);
    for (const t of temps) expect(t).toMatch(new RegExp(`\\.${process.pid}\\.[0-9a-z]+-[0-9a-z]+\\.tmp$`));
  });

  it("writes an index that merges the folder with the on-disk index, not one window's view", async () => {
    const files = memoryFiles();
    const store = storeOn(files);
    await store.save(runOf("a", "root-a", 1));
    // Another window saved "b" (its record is on disk) but its index write has not landed here.
    files.files.set(runFileName("b"), JSON.stringify(runOf("b", "root-a", 2)));
    await store.save(runOf("c", "root-a", 3));
    const index = JSON.parse(files.files.get(runsIndexFileName("root-a"))!) as { ids: string[] };
    expect(index.ids).toEqual(["c", "b", "a"]);
  });

  it("prune keeps a record still running (not stale) and deletes a stale or finished orphan", async () => {
    const files = memoryFiles();
    let clock = 1_000_000;
    const store = createRunStore(files, { keep: 1, now: () => clock });
    files.files.set(runFileName("live"), JSON.stringify(runOf("live", "root-a", 5, { outcome: undefined, endedAt: undefined, updatedAt: clock - 1000 })));
    files.files.set(runFileName("old"), JSON.stringify(runOf("old", "root-a", 1)));
    files.files.set(runFileName("stale"), JSON.stringify(runOf("stale", "root-a", 2, { outcome: undefined, endedAt: undefined, updatedAt: clock - RUN_STALE_MS - 1 })));
    await store.save(runOf("new", "root-a", 9), { prune: true });
    expect(files.files.has(runFileName("live"))).toBe(true);
    expect(files.files.has(runFileName("old"))).toBe(false);
    expect(files.files.has(runFileName("stale"))).toBe(false);
    expect(files.files.has(runFileName("new"))).toBe(true);
  });

  it("prune deletes leftover temp files older than the stale window and keeps a fresh one", async () => {
    const files = memoryFiles();
    const clock = CLOCK;
    const tmpAt = (at: number) => `runs/x.json.1234.${at.toString(36)}-abc123.tmp`;
    files.files.set(tmpAt(clock - RUN_STALE_MS - 1), "{");
    files.files.set(tmpAt(clock - 100), "{");
    await storeOn(files).save(runOf("new", "root-a", 9), { prune: true });
    expect(files.files.has(tmpAt(clock - RUN_STALE_MS - 1))).toBe(false);
    expect(files.files.has(tmpAt(clock - 100))).toBe(true);
  });

  it("list rebuilds a torn index without writing it", async () => {
    const files = memoryFiles();
    files.files.set(runFileName("a"), JSON.stringify(runOf("a", "root-a", 1)));
    files.files.set(runsIndexFileName("root-a"), "{torn");
    const before = files.files.get(runsIndexFileName("root-a"));
    expect((await storeOn(files).list("root-a")).map((r) => r.id)).toEqual(["a"]);
    expect(files.files.get(runsIndexFileName("root-a"))).toBe(before);
  });
});

describe("stopRunById", () => {
  it("aborts a live run from anywhere in the process, and forgets it once finished", async () => {
    const abort = new AbortController();
    const tracker = trackRun({ rootId: "root-a", request: {}, files: memoryFiles(), post: () => undefined, replica: async () => undefined, abort });
    expect(stopRunById(tracker.id)).toBe(true);
    expect(abort.signal.aborted).toBe(true);
    await tracker.finish("stopped");
    expect(stopRunById(tracker.id)).toBe(false);
  });
});

describe("host thread measurement", () => {
  const NS = 1e6;
  const fakeHistogram = () => {
    const calls: string[] = [];
    const histogram: LagHistogram = {
      enable: () => { calls.push("enable"); return true; },
      disable: () => { calls.push("disable"); return true; },
      reset: () => { calls.push("reset"); },
      max: 31_000 * NS, mean: 12 * NS, percentile: (p) => (p === 99 ? 900 * NS : 0),
    };
    return { histogram, calls };
  };

  it("samples the event loop for the run, records the stall on posted and kept runs, and stops sampling at the end", async () => {
    const files = memoryFiles();
    const posted: KnowledgeStoredRun[] = [];
    const { histogram, calls } = fakeHistogram();
    const tracker = trackRun({ rootId: "root-a", request: {}, files, post: (r) => posted.push(r), replica: async () => undefined, lagSampler: () => histogram });
    expect(calls).toEqual(["enable"]);
    await tracker.finish("done", report);
    expect(calls).toEqual(["enable", "disable"]);
    expect(posted.at(-1)!.hostLag).toEqual({ maxMs: 31_000, p99Ms: 900, meanMs: 12 });
    const [listed] = await listRuns(files, "root-a");
    expect(listed!.hostLag).toEqual({ maxMs: 31_000, p99Ms: 900, meanMs: 12 });
  });

  it("keeps the slowest record save as saveMsMax", async () => {
    const files = memoryFiles();
    const write = files.write.bind(files);
    let clock = 0;
    let step = 0;
    const costs = [5, 40];
    // A save is two writes (the run record, then the index): charge the fake clock once per SAVE, on the record's write,
    // so the first save costs 5 and the second 40 (charging per write made the opening save span both costs: 45).
    files.write = async (name, text) => { if (!text.startsWith('{"ids"')) clock += costs[Math.min(step++, costs.length - 1)]!; await write(name, text); };
    const { histogram } = fakeHistogram();
    const tracker = trackRun({ rootId: "root-a", request: {}, files, post: () => undefined, replica: async () => undefined, lagSampler: () => histogram, now: () => clock });
    await settle(files); // the opening save has landed and been timed
    await tracker.finish("done", report);
    const [listed] = await listRuns(files, "root-a");
    expect(listed!.saveMsMax).toBe(5);
  });

  it("records no lag when the sampler is unavailable", async () => {
    const files = memoryFiles();
    const posted: KnowledgeStoredRun[] = [];
    const tracker = trackRun({ rootId: "root-a", request: {}, files, post: (r) => posted.push(r), replica: async () => undefined, lagSampler: () => { throw new Error("no perf_hooks"); } });
    await tracker.finish("done", report);
    expect(posted.at(-1)).not.toHaveProperty("hostLag");
  });
});
