import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  key: "k1" as string | null,
  jobs: [] as Array<{ fresh?: boolean }>,
  gate: undefined as Promise<void> | undefined,
  fail: undefined as Error | undefined,
  analysed: [] as Array<{ l3?: { cache: { get(k: string, t: string): Promise<unknown>; put(k: string, e: unknown): Promise<void> } } }>,
  binding: {
    cache: { get: vi.fn(async () => ({ result: "stale" })), put: vi.fn(async () => undefined) },
    keyOf: async () => "tool-key",
    ignored: async () => [],
    toResult: () => undefined,
  },
}));
vi.mock("../localCapabilities", () => ({ buildLocalCapabilityProvider: () => ({}) }));
vi.mock("@builderforce/repo-map", () => ({ repoMapPort: {} }));
vi.mock("@builderforce/agent-tools/node-git-history", () => ({ recentCommits: async () => [{ sha: "aaa", paths: [] }] }));
vi.mock("./knowledgeSyncStatus", () => ({ hostMemento: () => undefined }));
vi.mock("../runDelta/analyzers/l3Binding", () => ({ indexerL3Binding: () => h.binding }));
vi.mock("./l3Worker", () => ({
  runL3InWorker: vi.fn(async (job: { fresh?: boolean }) => {
    h.jobs.push(job);
    await h.gate;
    if (h.fail) throw h.fail;
    return { extracted: [], snapshot: { tools: [{ status: "complete" }] }, edges: h.jobs.length };
  }),
}));
vi.mock("@builderforce/agent-tools/knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@builderforce/agent-tools/knowledge")>()),
  // Other layers, another key (the prefetch reads the workspace's own registry).
  workspaceAnalysisKey: async (deps: { partitions?: unknown }) => (deps.partitions ? "k-layers" : h.key),
  analyseWorkspaceExtracted: vi.fn(async (input: (typeof h.analysed)[number]) => { h.analysed.push(input); return { extracted: [], snapshot: null }; }),
}));

import { forgetL3Guards } from "./l3CrashGuard";
import { forgetSharedAnalyses, holdFreshAnalysis, sharedAnalysis } from "./l3SharedAnalysis";
import { runL3Job } from "./l3WorkerJob";

const job = { folderPath: "/ws", rootId: "r", l3RootPath: "/ws" };

beforeEach(() => {
  forgetSharedAnalyses();
  forgetL3Guards();
  h.key = "k1";
  h.jobs = [];
  h.gate = undefined;
  h.fail = undefined;
  h.analysed = [];
  h.binding.cache.get.mockClear();
  h.binding.cache.put.mockClear();
});

describe("the explicit retry runs the analyzers afresh — end to end", () => {
  // regression: "fresh" skipped only the in-memory cache; the worker's on-disk analyzer cache (keyed by tree hash) still served the retry.
  it("regression: a fresh analysis reaches the worker as a fresh JOB, which never reads the on-disk cache and overwrites it", async () => {
    await sharedAnalysis(job);
    expect(h.jobs[0]!.fresh).toBeUndefined();
    const release = holdFreshAnalysis("r");
    await sharedAnalysis(job);
    release();
    expect(h.jobs[1]!.fresh).toBe(true);

    await runL3Job({ ...job, fresh: true });
    // The in-thread fallback's own per-sha cache (agent-tools `analyseWorkspace`) is told too.
    expect(h.analysed[0]).toMatchObject({ fresh: true });
    const l3 = h.analysed[0]!.l3!;
    expect(await l3.cache.get("tool-key", "knip")).toBeUndefined();
    expect(h.binding.cache.get).not.toHaveBeenCalled();
    await l3.cache.put("tool-key", { result: "new" });
    expect(h.binding.cache.put).toHaveBeenCalledWith("tool-key", { result: "new" });

    await runL3Job(job); // an ordinary job is served by the on-disk cache as before
    expect(h.analysed[1]!.l3).toBe(h.binding);
  });

  // regression: a fresh run used a null key, so its result never replaced the stale entry and the next ask got the old one.
  it("regression: the fresh result is stored under the real key and serves the next ask", async () => {
    expect((await sharedAnalysis(job)).edges).toBe(1);
    const release = holdFreshAnalysis("r");
    expect((await sharedAnalysis(job)).edges).toBe(2);
    release();
    expect((await sharedAnalysis(job)).edges).toBe(2);
    expect(h.jobs).toHaveLength(2);
  });

  // regression: the hold made EVERY analysis of the root fresh, so a prefetch during a retry started a second worker.
  it("regression: a prefetch during the retry joins the ONE fresh worker instead of starting another", async () => {
    await sharedAnalysis(job);
    let open: () => void = () => undefined;
    h.gate = new Promise((resolve) => { open = resolve; });
    const release = holdFreshAnalysis("r");
    const retry = sharedAnalysis(job);
    const prefetch = sharedAnalysis({ folderPath: "/ws", rootId: "r" });
    await vi.waitFor(() => expect(h.jobs).toHaveLength(2));
    open();
    const [a, b] = await Promise.all([retry, prefetch]);
    release();
    expect(h.jobs).toHaveLength(2); // the first analysis, then ONE fresh worker for both askers
    expect([a.edges, b.edges]).toEqual([2, 2]);
  });

  // regression: the ticket was per root, so a prefetch asking first (no on-disk binding) used up the retry's fresh run.
  it("regression: a prefetch asking FIRST does not satisfy the retry — the retry gets its own fresh, disk-writing run", async () => {
    await sharedAnalysis(job);
    const release = holdFreshAnalysis("r");
    await sharedAnalysis({ folderPath: "/ws", rootId: "r" }); // prefetch: same key, no l3RootPath
    const retried = await sharedAnalysis(job);
    release();
    expect(h.jobs.map((j) => j.fresh)).toEqual([undefined, true, true]);
    expect(h.jobs[2]).toMatchObject({ l3RootPath: "/ws", fresh: true });
    expect(retried.edges).toBe(3);
    expect((await sharedAnalysis({ folderPath: "/ws", rootId: "r" })).edges).toBe(3); // the retry's result serves both now
  });

  it("regression: a prefetch with other layers (another key) first: each key gets ONE fresh run, the retry is never served stale", async () => {
    const prefetch = { folderPath: "/ws", rootId: "r", partitions: {} as never };
    await sharedAnalysis(job);
    await sharedAnalysis(prefetch);
    const release = holdFreshAnalysis("r");
    expect((await sharedAnalysis(prefetch)).edges).toBe(3);
    expect((await sharedAnalysis(job)).edges).toBe(4);
    expect((await sharedAnalysis(prefetch)).edges).toBe(3); // already fresh under this hold: joined, not rerun
    release();
    expect(h.jobs.map((j) => j.fresh)).toEqual([undefined, undefined, true, true]);
  });

  it("a stopped fresh run gives the ticket back at once — before its worker settles", async () => {
    await sharedAnalysis(job);
    let open: () => void = () => undefined;
    h.gate = new Promise((resolve) => { open = resolve; });
    const release = holdFreshAnalysis("r");
    const stop = new AbortController();
    const stopped = sharedAnalysis(job, { signal: stop.signal });
    await vi.waitFor(() => expect(h.jobs).toHaveLength(2));
    stop.abort();
    const again = sharedAnalysis(job);
    await vi.waitFor(() => expect(h.jobs).toHaveLength(3));
    open();
    await Promise.all([stopped, again]);
    release();
    expect(h.jobs.map((j) => j.fresh)).toEqual([undefined, true, true]);
  });

  it("a hold released while its fresh run is in progress: the run goes on, later asks join it and its result is kept", async () => {
    await sharedAnalysis(job);
    let open: () => void = () => undefined;
    h.gate = new Promise((resolve) => { open = resolve; });
    const release = holdFreshAnalysis("r");
    const retry = sharedAnalysis(job);
    await vi.waitFor(() => expect(h.jobs).toHaveLength(2));
    release();
    const after = sharedAnalysis(job);
    open();
    expect((await Promise.all([retry, after])).map((r) => r.edges)).toEqual([2, 2]);
    expect((await sharedAnalysis(job)).edges).toBe(2);
    expect(h.jobs).toHaveLength(2);
  });

  it("a fresh run that fails gives the ticket back: the hold's next analysis is fresh again", async () => {
    await sharedAnalysis(job);
    const release = holdFreshAnalysis("r");
    h.fail = new Error("boom");
    await expect(sharedAnalysis(job)).rejects.toThrow("boom");
    h.fail = undefined;
    await sharedAnalysis(job);
    release();
    expect(h.jobs.map((j) => j.fresh)).toEqual([undefined, true, true]);
  });
});
