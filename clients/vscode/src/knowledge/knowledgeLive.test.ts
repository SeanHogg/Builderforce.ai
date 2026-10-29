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
});
