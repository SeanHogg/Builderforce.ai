import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
  loadGraph: vi.fn(async (_s: unknown, _root: string, _q?: unknown) => ({ scope: { rootId: "r" }, nodes: [], edges: [], findings: [] })),
  reviewed: [] as Array<(rootId: string) => void>,
  onEdited: undefined as ((paths: string[]) => void) | undefined,
  hashes: new Map<string, string>(),
}));

vi.mock("./knowledgeService", () => ({
  loadGraph: mocks.loadGraph,
  log: mocks.log,
  onKnowledgeChanged: (cb: (rootId: string) => void) => { mocks.reviewed.push(cb); return () => undefined; },
  openRoot: () => ({ store: {}, manifest: {} }),
  workspaceFolders: () => [],
}));
vi.mock("./knowledgeRoots", () => ({ rootById: () => ({ rootId: "r", rootPath: "/w", folderPath: "/w", title: "w" }) }));
vi.mock("./vscodeDirectorySource", () => ({ createDirectorySource: () => ({}) }));
vi.mock("./rootModules", () => ({ rootModules: async () => ({ aliases: { scopes: [] } }) }));
vi.mock("./knowledgeFs", () => ({ vscodeKnowledgeFs: () => ({}) }));
vi.mock("../git/gitChanges", () => ({ detectPendingChanges: async () => undefined, watchPendingChanges: () => ({ dispose: () => undefined }) }));
vi.mock("../tools/localCapabilities", () => ({ buildLocalCapabilityProvider: () => ({}) }));
vi.mock("@builderforce/agent-tools/knowledge", () => ({
  reviewPacks: () => [],
  knownKeysCache: () => ({ invalidate: () => undefined }),
  watchFileEdits: (args: { onEdited?(paths: string[]): void }) => { mocks.onEdited = args.onEdited; return () => undefined; },
  currentFileHashes: async () => new Map(mocks.hashes),
}));
vi.mock("@builderforce/agent-tools/prefetch", () => ({ readPartitions: async () => undefined }));

import { FULL_REFRESH_MIN_MS, subscribeLiveGraph } from "./knowledgeLive";
import { beginRootLoad } from "./rootLoads";
import { GRAPH_BUILD_ABORTED } from "./graphBuildErrors";
import { PATCH_MAX_FILES } from "./livePatch";

const secrets = {} as never;
const handlers = () => ({ onGraph: vi.fn(), onPatch: vi.fn() });
/** Past the whole-graph refresh window (which opens from the subscription: the Run's own load). */
const WINDOW = FULL_REFRESH_MIN_MS + 1_000;

beforeEach(() => { vi.useFakeTimers(); mocks.reviewed.length = 0; mocks.onEdited = undefined; mocks.hashes.clear(); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

async function refreshOnce(queryOf?: (rootId: string) => { focus?: string[]; maxNodes?: number } | undefined) {
  const stop = subscribeLiveGraph(secrets, "r", handlers(), queryOf);
  await vi.advanceTimersByTimeAsync(0);
  mocks.reviewed[0]!("r");
  await vi.advanceTimersByTimeAsync(WINDOW);
  stop();
}

describe("the editor's Live refresh of a running root", () => {
  it("re-reads the graph by the query the view last loaded the root with", async () => {
    await refreshOnce(() => ({ focus: ["src:r::a.md"], maxNodes: 50 }));
    expect(mocks.loadGraph).toHaveBeenCalledWith(secrets, "r", { focus: ["src:r::a.md"], maxNodes: 50 }, undefined, undefined, { signal: expect.any(AbortSignal), view: true });
  });

  it("asks that of the root it watches, and falls back to an unfocused read when the view recorded none", async () => {
    const queryOf = vi.fn(() => undefined);
    await refreshOnce(queryOf);
    expect(queryOf).toHaveBeenCalledWith("r");
    expect(mocks.loadGraph).toHaveBeenCalledWith(secrets, "r", undefined, undefined, undefined, { signal: expect.any(AbortSignal), view: true });
  });

  it("aborts the build in flight on unlive, and an aborted build is a quiet return (not an error, no push)", async () => {
    let signal: AbortSignal | undefined;
    mocks.loadGraph.mockImplementationOnce((_s: unknown, _r: string, _q?: unknown, _t?: unknown, _n?: unknown, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(Object.assign(new Error(GRAPH_BUILD_ABORTED), { code: GRAPH_BUILD_ABORTED })));
      }) as never;
    });
    const h = handlers();
    const stop = subscribeLiveGraph(secrets, "r", h);
    await vi.advanceTimersByTimeAsync(0);
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(signal?.aborted).toBe(false);
    stop();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.log).not.toHaveBeenCalledWith("live refresh", expect.anything());
    expect(h.onGraph).not.toHaveBeenCalled();
  });

  it("one build per root: a refresh does not start while the view's own load of the root runs, and runs at once when it is asked again", async () => {
    const view = beginRootLoad("r");
    const h = handlers();
    const stop = subscribeLiveGraph(secrets, "r", h);
    await vi.advanceTimersByTimeAsync(0);
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(mocks.loadGraph).not.toHaveBeenCalled(); // skipped: the view's load brings a fresh graph
    view.end(); // the skipped refresh asks again by itself: no top-up is lost
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.loadGraph).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a view load of the root stops the refresh building for it (quietly)", async () => {
    let signal: AbortSignal | undefined;
    mocks.loadGraph.mockImplementationOnce((_s: unknown, _r: string, _q?: unknown, _t?: unknown, _n?: unknown, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(Object.assign(new Error(GRAPH_BUILD_ABORTED), { code: GRAPH_BUILD_ABORTED })));
      }) as never;
    });
    const h = handlers();
    const stop = subscribeLiveGraph(secrets, "r", h);
    await vi.advanceTimersByTimeAsync(0);
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(signal?.aborted).toBe(false);
    const view = beginRootLoad("r");
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onGraph).not.toHaveBeenCalled();
    view.end();
    stop();
  });

  it("builds nothing on its own: subscribed with nothing changed, no graph is ever re-read", async () => {
    const h = handlers();
    const stop = subscribeLiveGraph(secrets, "r", h);
    await vi.advanceTimersByTimeAsync(5 * WINDOW);
    expect(mocks.loadGraph).not.toHaveBeenCalled();
    expect(h.onGraph).not.toHaveBeenCalled();
    stop();
  });

  it("coalesces a burst of refresh triggers into one rebuild (throttle, not one-per-event)", async () => {
    const h = handlers();
    const stop = subscribeLiveGraph(secrets, "r", h);
    await vi.advanceTimersByTimeAsync(0);
    // A burst: several triggers land in the same tick.
    mocks.reviewed[0]!("r");
    mocks.reviewed[0]!("r");
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(WINDOW);
    // The burst produced ONE rebuild + push, not three.
    expect(mocks.loadGraph).toHaveBeenCalledTimes(1);
    expect(h.onGraph).toHaveBeenCalledTimes(1);
    stop();
  });

  it("throttles rebuilds to one per window: the first waits for the window opened by the Run's load, the next for its own", async () => {
    const h = handlers();
    const stop = subscribeLiveGraph(secrets, "r", h);
    await vi.advanceTimersByTimeAsync(0);
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(FULL_REFRESH_MIN_MS - 2_000);
    expect(h.onGraph).not.toHaveBeenCalled(); // the Run's own load is still fresh
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.onGraph).toHaveBeenCalledTimes(1);
    // Another trigger right away: the window is open again from that rebuild.
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.onGraph).toHaveBeenCalledTimes(1); // still one push
    await vi.advanceTimersByTimeAsync(FULL_REFRESH_MIN_MS); // window elapses -> the trailing rebuild runs
    expect(h.onGraph).toHaveBeenCalledTimes(2);
    stop();
  });

  it("drops a re-push whose graph identity AND changed-set match the last push (no-op guard)", async () => {
    // A graph WITH a real identity: same digest + counts every time.
    const identified = {
      scope: { rootId: "r", packs: [], digest: "abc123" },
      nodes: [], edges: [], findings: [],
      stats: { sources: 5, nodes: 10, edges: 20, stale: 0, truncated: false },
    };
    mocks.loadGraph.mockResolvedValue(identified as never);
    const h = handlers();
    const stop = subscribeLiveGraph(secrets, "r", h);
    await vi.advanceTimersByTimeAsync(0);
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(h.onGraph).toHaveBeenCalledTimes(1);
    // Same picture again: the no-op guard drops it (the view would re-layout identically).
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(h.onGraph).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("the editor's Live deltas of a running root", () => {
  it("an edited batch becomes a patch, never a rebuild per change; the whole graph follows once per window", async () => {
    mocks.hashes.set("src/a.ts", "h1");
    const h = handlers();
    const stop = subscribeLiveGraph(secrets, "r", h);
    await vi.advanceTimersByTimeAsync(0);
    mocks.hashes.set("src/a.ts", "h2"); // the watcher re-extracted it by its new hash
    mocks.onEdited!(["src/a.ts"]);
    mocks.onEdited!(["src/a.ts"]); // same content again: nothing moves on screen
    await vi.advanceTimersByTimeAsync(10);
    expect(h.onPatch).toHaveBeenCalledTimes(1);
    expect(h.onPatch.mock.calls[0]![0]).toMatchObject({ rootId: "r", files: ["src:r::src/a.ts"], stale: ["src:r::src/a.ts"], changed: ["src/a.ts"] });
    expect(mocks.loadGraph).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(mocks.loadGraph).toHaveBeenCalledTimes(1);
    stop();
  });

  it(`a batch of more than ${PATCH_MAX_FILES} files (a branch switch) is the throttled full refresh, not a patch`, async () => {
    const h = handlers();
    const stop = subscribeLiveGraph(secrets, "r", h);
    await vi.advanceTimersByTimeAsync(0);
    mocks.onEdited!(Array.from({ length: PATCH_MAX_FILES + 1 }, (_, i) => `f${i}.ts`));
    await vi.advanceTimersByTimeAsync(WINDOW);
    expect(h.onPatch).not.toHaveBeenCalled();
    expect(mocks.loadGraph).toHaveBeenCalledTimes(1);
    expect(h.onGraph.mock.calls[0]![1]).toHaveLength(PATCH_MAX_FILES + 1);
    stop();
  });
});
