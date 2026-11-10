import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));
vi.mock("../telemetry/productEvents", () => ({ emitProductEvent: vi.fn() }));
vi.mock("../errorReporter", () => ({ logLine: vi.fn() }));
vi.mock("./indexHostPorts", () => ({ hostIndexPorts: vi.fn() }));
vi.mock("./knowledgeService", () => ({ log: vi.fn(), workspaceFolders: () => [] }));
vi.mock("./knowledgeFs", () => ({ vscodeKnowledgeFs: () => ({}) }));
vi.mock("./folderKnowledge", () => ({ beforeKnowledgeShutdown: () => () => undefined }));

import type { PlanDetail } from "@seanhogg/builderforce-memory/knowledge";
import { BackgroundIndexer, L3_CHECK_MS, type IndexerHost } from "./backgroundIndexer";
import { COALESCE_MS, realClock } from "./indexBudget";
import { indexerWatches, preemptBackground } from "./indexLevels";
import type { KnowledgeRoot } from "./knowledgeRoots";

const rootOf = (path: string): KnowledgeRoot => ({ rootId: `id:${path}`, title: path, rootPath: path, folderPath: path, rel: "" });

function fakeHost(initial: string[]) {
  let folders = initial;
  const watchers = new Map<string, (abs: string[]) => void>();
  const unwatched: string[] = [];
  const disposed: string[] = [];
  const signals: AbortSignal[] = [];
  const ports = new Map<string, ReturnType<typeof portsFor>>();
  let editors = { visible: [] as string[], open: [] as string[] };
  function portsFor(root: KnowledgeRoot) {
    return {
      rootId: root.rootId,
      plan: vi.fn(async () => ({ files: 3, changed: [] as string[], removed: [] as string[], reviewed: true, ms: 1, detail: { prior: new Map() } as unknown as PlanDetail })),
      extractEdited: vi.fn(async (batch: readonly string[]) => ({ changed: [...batch], unreviewed: [] as string[] })),
      mapPass: vi.fn(async (_p: unknown, o: { analyzers: boolean; signal: AbortSignal }) => { signals.push(o.signal); return { changed: [] as string[] }; }),
      onFactsChanged: vi.fn(async () => undefined),
      dispose: vi.fn(() => { disposed.push(root.rootId); }),
    };
  }
  const host: IndexerHost = {
    folders: () => folders.map((path) => ({ path })),
    rootFor: (path) => rootOf(path),
    ports: (root) => { const p = portsFor(root); ports.set(root.rootId, p); return p; },
    watch: (rootPath, cb) => { watchers.set(rootPath, cb); return () => { watchers.delete(rootPath); unwatched.push(rootPath); }; },
    editors: () => editors,
    power: { current: async () => "mains" },
    clock: realClock,
    telemetry: () => vi.fn(),
    log: vi.fn(),
  };
  return {
    host, watchers, unwatched, disposed, ports, signals,
    setFolders: (f: string[]) => { folders = f; },
    setEditors: (e: { visible: string[]; open: string[] }) => { editors = e; },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("BackgroundIndexer — one indexer per workspace folder (multi-root)", () => {
  it("starts a watched, reconciled root per folder, and follows folders being added and removed", async () => {
    const f = fakeHost(["/a", "/b"]);
    const bi = new BackgroundIndexer(f.host);
    bi.start(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(bi.rootIds.sort()).toEqual(["id:/a", "id:/b"]);
    expect([...f.watchers.keys()].sort()).toEqual(["/a", "/b"]);
    expect(f.ports.get("id:/a")!.plan).toHaveBeenCalledTimes(1);
    expect(indexerWatches("id:/a")).toBe(true);

    f.setFolders(["/b", "/c"]);
    bi.syncFolders();
    await vi.advanceTimersByTimeAsync(10);
    expect(bi.rootIds.sort()).toEqual(["id:/b", "id:/c"]);
    expect(f.unwatched).toEqual(["/a"]);
    expect(f.disposed).toEqual(["id:/a"]);
    expect(indexerWatches("id:/a")).toBe(false);
    await bi.dispose();
  });

  it("routes a watcher burst to its own root only", async () => {
    const f = fakeHost(["/a", "/b"]);
    const bi = new BackgroundIndexer(f.host);
    bi.start(true);
    await vi.advanceTimersByTimeAsync(10);
    f.watchers.get("/b")!(["/b/src/x.ts", "/b/.builderforce/cache/knowledge/index.sqlite"]);
    await vi.advanceTimersByTimeAsync(COALESCE_MS + 20);
    expect(f.ports.get("id:/b")!.extractEdited).toHaveBeenCalledWith(["src/x.ts"]);
    expect(f.ports.get("id:/a")!.extractEdited).not.toHaveBeenCalled();
    await bi.dispose();
  });

  it("indexes files open in editors before visible ones", async () => {
    const f = fakeHost(["/a"]);
    f.setEditors({ visible: ["/a/v.ts"], open: ["/a/o.ts"] });
    const bi = new BackgroundIndexer(f.host);
    bi.start(true);
    await vi.advanceTimersByTimeAsync(10);
    f.watchers.get("/a")!(["/a/r.ts", "/a/v.ts", "/a/o.ts"]);
    await vi.advanceTimersByTimeAsync(COALESCE_MS + 20);
    expect(f.ports.get("id:/a")!.extractEdited.mock.calls.flatMap(([b]) => [...b])).toEqual(["o.ts", "v.ts", "r.ts"]);
    await bi.dispose();
  });
});

describe("BackgroundIndexer — keystrokes, preemption and shutdown", () => {
  it("a keystroke stops a running long pass", async () => {
    const f = fakeHost(["/a"]);
    const bi = new BackgroundIndexer(f.host);
    bi.start(true);
    await vi.advanceTimersByTimeAsync(10);
    const p = f.ports.get("id:/a")!;
    p.plan.mockResolvedValue({ files: 3, changed: ["x.ts"], removed: [], reviewed: false, ms: 1, detail: { prior: new Map() } as unknown as PlanDetail });
    p.mapPass.mockImplementationOnce((_plan, o) => new Promise((resolve) => { f.signals.push(o.signal); o.signal.addEventListener("abort", () => resolve({ changed: [] })); }));
    bi.windowFocus(false);
    await vi.advanceTimersByTimeAsync(6_000);
    bi.windowFocus(true); // refocus: the reconciling plan runs, and its map pass starts once quiet
    await vi.advanceTimersByTimeAsync(3_000);
    expect(p.mapPass).toHaveBeenCalled();
    bi.keystroke();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.signals[0]!.aborted).toBe(true);
    // The aborted reconcile waits for quiet (polling on the clock): dispose ends it at its next poll.
    const disposing = bi.dispose();
    await vi.advanceTimersByTimeAsync(1_000);
    await disposing;
  });

  it("preemptBackground reaches the root's indexer — and the containing folder's for a sub-folder root — and hands back the release", async () => {
    const f = fakeHost(["/a", "/b"]);
    const bi = new BackgroundIndexer(f.host);
    bi.start(true);
    await vi.advanceTimersByTimeAsync(10);
    const a = f.ports.get("id:/a")!;
    a.plan.mockResolvedValue({ files: 3, changed: ["x.ts"], removed: [], reviewed: false, ms: 1, detail: { prior: new Map() } as unknown as PlanDetail });
    a.mapPass.mockImplementation((_plan, o) => new Promise((resolve) => { f.signals.push(o.signal); o.signal.addEventListener("abort", () => resolve({ changed: [] })); }));
    bi.windowFocus(false);
    await vi.advanceTimersByTimeAsync(6_000);
    bi.windowFocus(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(f.signals).toHaveLength(1);

    const release = await preemptBackground("id:/a:packages/x"); // a sub-folder root of /a
    expect(f.signals[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.signals).toHaveLength(1); // held off until released
    release();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(f.signals).toHaveLength(2); // the owed pass reruns

    const none = await preemptBackground("id:/elsewhere");
    expect(typeof none).toBe("function");
    const disposing = bi.dispose();
    await vi.advanceTimersByTimeAsync(3_000);
    await disposing;
  });

  it("dispose stops every watcher and timer and resolves only after the slice in flight has finished", async () => {
    const f = fakeHost(["/a", "/b"]);
    const bi = new BackgroundIndexer(f.host);
    bi.start(true);
    await vi.advanceTimersByTimeAsync(10);
    let finish: (() => void) | undefined;
    f.ports.get("id:/a")!.extractEdited.mockImplementationOnce((batch) => new Promise((resolve) => { finish = () => resolve({ changed: [...batch], unreviewed: [] }); }));
    f.watchers.get("/a")!(["/a/x.ts"]);
    await vi.advanceTimersByTimeAsync(COALESCE_MS + 20);
    expect(finish).toBeDefined();

    let settled = false;
    const disposing = bi.dispose().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false); // the slice is still writing
    expect([...f.watchers.keys()]).toEqual([]);
    finish!();
    await vi.advanceTimersByTimeAsync(10);
    await disposing;
    expect(settled).toBe(true);
    expect(f.disposed.sort()).toEqual(["id:/a", "id:/b"]);
    expect(indexerWatches("id:/a")).toBe(false);
    const plansBefore = f.ports.get("id:/b")!.plan.mock.calls.length;
    await vi.advanceTimersByTimeAsync(L3_CHECK_MS * 3);
    expect(vi.getTimerCount()).toBe(0); // the L3 tick, the coalescer and the gate are gone
    expect(f.ports.get("id:/b")!.plan.mock.calls.length).toBe(plansBefore);
  });
});
