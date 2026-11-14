import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadGraph: vi.fn(async (_s: unknown, _root: string, _q?: unknown) => ({ scope: { rootId: "r" }, nodes: [], edges: [], findings: [] })),
  reviewed: [] as Array<(rootId: string) => void>,
}));

vi.mock("./knowledgeService", () => ({
  loadGraph: mocks.loadGraph,
  log: vi.fn(),
  onKnowledgeChanged: (cb: (rootId: string) => void) => { mocks.reviewed.push(cb); return () => undefined; },
  openRoot: () => ({ store: {}, manifest: {} }),
  workspaceFolders: () => [],
}));
vi.mock("./knowledgeRoots", () => ({ rootById: () => ({ rootId: "r", rootPath: "/w", folderPath: "/w", title: "w" }) }));
vi.mock("./vscodeDirectorySource", () => ({ createDirectorySource: () => ({}) }));
vi.mock("./knowledgeFs", () => ({ vscodeKnowledgeFs: () => ({}) }));
vi.mock("../gitChanges", () => ({ detectPendingChanges: async () => undefined, watchPendingChanges: () => ({ dispose: () => undefined }) }));
vi.mock("../localCapabilities", () => ({ buildLocalCapabilityProvider: () => ({}) }));
vi.mock("@builderforce/agent-tools/knowledge", () => ({ reviewPacks: () => [], watchFileEdits: () => () => undefined }));
vi.mock("@builderforce/agent-tools/prefetch", () => ({ readPartitions: async () => undefined }));

import { subscribeLiveGraph } from "./knowledgeLive";

const secrets = {} as never;

beforeEach(() => { vi.useFakeTimers(); mocks.reviewed.length = 0; });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

async function refreshOnce(queryOf?: (rootId: string) => { focus?: string[]; maxNodes?: number } | undefined) {
  const stop = subscribeLiveGraph(secrets, "r", () => undefined, queryOf);
  await vi.advanceTimersByTimeAsync(0);
  mocks.reviewed[0]!("r");
  await vi.advanceTimersByTimeAsync(1000);
  stop();
}

describe("the editor's Live refresh", () => {
  it("re-reads the graph by the query the view last loaded the root with", async () => {
    await refreshOnce(() => ({ focus: ["src:r::a.md"], maxNodes: 50 }));
    expect(mocks.loadGraph).toHaveBeenCalledWith(secrets, "r", { focus: ["src:r::a.md"], maxNodes: 50 });
  });

  it("asks that of the root it watches, and falls back to an unfocused read when the view recorded none", async () => {
    const queryOf = vi.fn(() => undefined);
    await refreshOnce(queryOf);
    expect(queryOf).toHaveBeenCalledWith("r");
    expect(mocks.loadGraph).toHaveBeenCalledWith(secrets, "r", undefined);
  });

  it("coalesces a burst of refresh triggers into one rebuild (throttle, not one-per-event)", async () => {
    const onGraph = vi.fn();
    const stop = subscribeLiveGraph(secrets, "r", onGraph);
    await vi.advanceTimersByTimeAsync(0);
    // A burst: several watcher events land in the same tick.
    mocks.reviewed[0]!("r");
    mocks.reviewed[0]!("r");
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(1000);
    // The burst produced ONE rebuild + push, not three.
    expect(mocks.loadGraph).toHaveBeenCalledTimes(1);
    expect(onGraph).toHaveBeenCalledTimes(1);
    stop();
  });

  it("throttles rebuilds: a second refresh inside the window does not trigger an immediate rebuild", async () => {
    const onGraph = vi.fn();
    const stop = subscribeLiveGraph(secrets, "r", onGraph);
    await vi.advanceTimersByTimeAsync(0);
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(1000); // first rebuild ran
    expect(onGraph).toHaveBeenCalledTimes(1);
    // Another event right away: the throttle window is still open, so no rebuild fires yet.
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(1000);
    expect(onGraph).toHaveBeenCalledTimes(1); // still one push
    await vi.advanceTimersByTimeAsync(5000); // window elapses -> the trailing rebuild runs
    expect(onGraph).toHaveBeenCalledTimes(2);
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
    const onGraph = vi.fn();
    const stop = subscribeLiveGraph(secrets, "r", onGraph);
    await vi.advanceTimersByTimeAsync(0);
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(1000);
    expect(onGraph).toHaveBeenCalledTimes(1);
    // Same picture again: the no-op guard drops it (the view would re-layout identically).
    mocks.reviewed[0]!("r");
    await vi.advanceTimersByTimeAsync(5000);
    expect(onGraph).toHaveBeenCalledTimes(1);
    stop();
  });
});
