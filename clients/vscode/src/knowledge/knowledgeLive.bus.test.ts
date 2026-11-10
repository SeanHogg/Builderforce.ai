import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadGraph: vi.fn(async (_s: unknown, _root: string, _q?: unknown) => ({ scope: { rootId: "r" }, nodes: [], edges: [], findings: [] })),
  stopOwnWatcher: vi.fn(),
  watchFileEdits: vi.fn((_args: { source: { watch?(cb: (paths: string[]) => void): () => void }; onEdited?(paths: string[]): void }) => mocks.stopOwnWatcher),
  fire: undefined as ((paths: string[]) => void) | undefined,
}));

vi.mock("./knowledgeService", () => ({
  loadGraph: mocks.loadGraph,
  log: vi.fn(),
  onKnowledgeChanged: () => () => undefined,
  openRoot: () => ({ store: {}, manifest: {} }),
  workspaceFolders: () => [],
}));
vi.mock("./knowledgeRoots", () => ({ rootById: () => ({ rootId: "r", rootPath: "/w", folderPath: "/w", title: "w" }) }));
vi.mock("./vscodeDirectorySource", () => ({ createDirectorySource: () => ({ watch: (cb: (paths: string[]) => void) => { mocks.fire = cb; return () => undefined; } }) }));
vi.mock("./rootModules", () => ({ rootModules: async () => ({ aliases: { scopes: [] } }) }));
vi.mock("./knowledgeFs", () => ({ vscodeKnowledgeFs: () => ({}) }));
vi.mock("../gitChanges", () => ({ detectPendingChanges: async () => undefined, watchPendingChanges: () => ({ dispose: () => undefined }) }));
vi.mock("../localCapabilities", () => ({ buildLocalCapabilityProvider: () => ({}) }));
vi.mock("@builderforce/agent-tools/knowledge", () => ({ reviewPacks: () => [], knownKeysCache: () => ({ invalidate: () => undefined }), watchFileEdits: mocks.watchFileEdits }));
vi.mock("@builderforce/agent-tools/prefetch", () => ({ readPartitions: async () => undefined }));

import { liveWatcherIdle, publishIndexedFacts, setIndexerWatching } from "./indexLevels";
import { subscribeLiveGraph } from "./knowledgeLive";

const secrets = {} as never;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { setIndexerWatching("r", false); vi.useRealTimers(); vi.clearAllMocks(); });

describe("the live graph and the background indexer (PRD 41 B6)", () => {
  it("while the indexer watches the root, hears its changed facts and runs no watcher of its own", async () => {
    setIndexerWatching("r", true);
    const onGraph = vi.fn();
    const stop = subscribeLiveGraph(secrets, "r", onGraph);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.watchFileEdits).not.toHaveBeenCalled();
    publishIndexedFacts({ rootId: "r", paths: ["src/a.ts"], kinds: ["structure", "body", "content"] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onGraph).toHaveBeenCalledTimes(1);
    expect(onGraph.mock.calls[0]![1]).toEqual(["src/a.ts"]);
    stop();
  });

  it("switches to its own watcher when the indexer stops (auto-index turned off), and back when it starts again", async () => {
    setIndexerWatching("r", true);
    const onGraph = vi.fn();
    const stop = subscribeLiveGraph(secrets, "r", onGraph);
    setIndexerWatching("r", false);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.watchFileEdits).toHaveBeenCalledTimes(1);
    setIndexerWatching("r", true);
    expect(mocks.stopOwnWatcher).toHaveBeenCalledTimes(1);
    publishIndexedFacts({ rootId: "r", paths: ["src/b.ts"], kinds: ["body"] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onGraph.mock.calls.at(-1)![1]).toEqual(["src/b.ts"]);
    stop();
  });

  it("switching to the indexer waits for the own watcher's batch in flight before it listens", async () => {
    const onGraph = vi.fn();
    const stop = subscribeLiveGraph(secrets, "r", onGraph);
    await vi.advanceTimersByTimeAsync(0);
    const args = mocks.watchFileEdits.mock.calls[0]![0];
    // The own watcher took a batch (its event arrived through the source's watch) and is still writing it.
    args.source.watch!(() => undefined);
    mocks.fire!(["src/x.ts"]);
    setIndexerWatching("r", true);
    publishIndexedFacts({ rootId: "r", paths: ["src/early.ts"], kinds: ["body"] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onGraph).not.toHaveBeenCalled(); // not listening yet
    // The other direction: the indexer's first write waits for the same batch.
    let indexerMayWrite = false;
    void liveWatcherIdle("r", 5_000).then(() => { indexerMayWrite = true; });
    await vi.advanceTimersByTimeAsync(10);
    expect(indexerMayWrite).toBe(false);
    args.onEdited!(["src/x.ts"]); // the batch landed
    await vi.advanceTimersByTimeAsync(0);
    expect(indexerMayWrite).toBe(true);
    publishIndexedFacts({ rootId: "r", paths: ["src/late.ts"], kinds: ["body"] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onGraph.mock.calls.at(-1)![1]).toEqual(["src/late.ts", "src/x.ts"]);
    stop();
  });

  it("a watcher still starting when the indexer takes over never installs itself", async () => {
    const stop = subscribeLiveGraph(secrets, "r", vi.fn());
    setIndexerWatching("r", true); // before the own watcher's partitions read resolved
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.watchFileEdits).not.toHaveBeenCalled();
    stop();
  });
});
