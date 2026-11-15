/**
 * GUARD: the extension host never builds a knowledge graph on its own thread. The knowledge view's `loadGraph` and a run
 * delta's `sideFacts` hand their build to the graph worker (`graphWorker.ts`); the in-thread builders are wired to fail here,
 * and a fake worker answers — so a build that slipped back onto the host thread fails this test.
 */
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  folder: "",
  inThread: vi.fn((): never => { throw new Error("a graph was built on the extension host thread"); }),
}));

vi.mock("@builderforce/agent-tools/knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@builderforce/agent-tools/knowledge")>()),
  buildStoredGraph: mocks.inThread,
  buildCodeGraph: mocks.inThread,
  codeGraphFindings: mocks.inThread,
  packGraph: mocks.inThread,
}));
vi.mock("vscode", () => ({
  workspace: { get workspaceFolders() { return [{ uri: { fsPath: mocks.folder } }]; } },
  window: {},
  l10n: { t: (m: string) => m },
}));
vi.mock("../bfApi", () => ({ fetchAuthed: async () => { throw new Error("offline"); } }));
vi.mock("../projectState", () => ({ getSelectedProject: () => undefined }));
vi.mock("../capabilityContext", () => ({ currentCapabilityInputs: () => ({ signedIn: false, synchronize: false, gatewayInference: false, connectedFeatures: false }) }));
vi.mock("../errorReporter", () => ({ logLine: vi.fn() }));
vi.mock("../localCapabilities", () => ({ buildLocalCapabilityProvider: () => ({}) }));
vi.mock("../workspaceSymbols", () => ({ workspaceSymbolIndex: () => ({ filesUnder: async () => [] }), symbolGrammarOptions: () => ({}) }));
vi.mock("./index/hostKnowledgeIndex", () => ({
  getHostKnowledgeIndex: async () => ({ nearDuplicates: () => [] }),
  ownsKnowledgeRoot: () => false,
  hostKnowledgeIndexCore: () => ({ upsertFromGraph: async () => undefined }),
}));
vi.mock("./knowledgeFs", () => ({
  vscodeKnowledgeFs: () => ({ readDirectory: async () => { throw new Error("ENOENT"); }, stat: async () => { throw new Error("ENOENT"); }, readFile: async () => new Uint8Array() }),
  workspaceKnowledgeFiles: () => ({ read: async () => undefined, write: async () => undefined }),
}));
vi.mock("./vscodeDirectorySource", () => ({ createDirectorySource: () => ({ skippedFolders: () => [] }) }));
vi.mock("./knowledgeJudgement", () => ({ editorJudgement: async () => undefined, judgeConfigured: async () => false }));
vi.mock("@builderforce/agent-tools/prefetch", () => ({ readPartitions: async () => ({ partitions: [] }) }));
vi.mock("@builderforce/repo-map", () => ({ repoMapPort: {} }));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({ NOT_SIGNED_IN: "not-signed-in" }));
vi.mock("../runDelta/sideFileFacts", () => ({ sideFileFacts: async () => new Map() }));

import { InMemoryIngestManifest } from "@seanhogg/builderforce-memory/ingest";
import { MAX_NODES_CAP, localSnapshotStore, srcRef } from "@seanhogg/builderforce-memory/knowledge";
import { forgetRootPorts } from "@builderforce/agent-tools/knowledge";
import { localSqliteAvailable } from "@builderforce/agent-tools/node-local-sqlite";
import { closeFolderKnowledge } from "./folderKnowledge";
import { useGraphWorkerSeams, type GraphWorkerHandle } from "./graphWorker";
import type { GraphBuildRequest, GraphWorkerMessage } from "./graphBuildProtocol";
import { loadGraph } from "./knowledgeService";
import { rootForPath } from "./knowledgeRoots";
import { disposeReplicas } from "./knowledgeReplica";
import { sideFacts } from "../runDelta/sideFacts";
import { indexPack } from "./packs/packIndexing";
import { packRootGraph } from "./packs/packRoots";

const graph = (rootId: string) => ({ scope: { rootId, packs: [], digest: "d" }, nodes: [], edges: [], findings: [], stats: { sources: 1, nodes: 0, edges: 0, stale: 0, truncated: false } });

/** A worker that answers every build with a graph of the request's root, recording the requests. */
function fakeWorker(requests: GraphBuildRequest[]): GraphWorkerHandle {
  const listeners: Array<(reply: unknown) => void> = [];
  return {
    postMessage(message: unknown) {
      const m = message as GraphWorkerMessage;
      if (m.type !== "build") return;
      requests.push(m.request);
      queueMicrotask(() => { for (const l of listeners) l({ type: "done", id: m.id, result: graph(m.request.kind === "pack" ? "pack" : m.request.rootId) }); });
    },
    on(event: string, listener: (value: any) => void) { if (event === "message") listeners.push(listener); return undefined; },
    terminate: () => Promise.resolve(0),
  };
}

let requests: GraphBuildRequest[] = [];
let restore: (() => void) | undefined;

beforeEach(() => {
  mocks.folder = fs.mkdtempSync(path.join(os.tmpdir(), "bf-graph-off-thread-"));
  mocks.inThread.mockClear();
  forgetRootPorts();
  requests = [];
  restore = useGraphWorkerSeams({ file: "fake-graph-worker.js", spawn: () => fakeWorker(requests) });
});

afterEach(async () => {
  restore?.();
  await disposeReplicas();
  await closeFolderKnowledge();
});

describe.skipIf(!localSqliteAvailable())("the knowledge view's graph", () => {
  it("is built in the graph worker from the folder's file, never on the host thread", async () => {
    const root = rootForPath(mocks.folder, [{ path: mocks.folder }])!;
    const built = await loadGraph({} as never, root.rootId, { focus: ["src:x::a.ts"], maxNodes: 50 });
    expect(built?.scope.rootId).toBe(root.rootId);
    expect(mocks.inThread).not.toHaveBeenCalled();
    expect(requests).toEqual([{ kind: "stored", folderPath: root.folderPath, rootId: root.rootId, partitions: { partitions: [] }, nearDuplicates: [], focus: ["src:x::a.ts"], maxNodes: 50 }]);
  });
});

describe("a loaded pack's graph", () => {
  it("is built in the graph worker from the pack's file, for a read-only pack root and for its index cards", async () => {
    const entry = { name: "lease", path: "/packs/lease.bfpack", rootId: "vscode:f-pack", title: "Lease", loadedAt: "" };
    expect(await packRootGraph(entry, { focus: ["src:vscode:f-pack::a.md"], maxNodes: 40 })).not.toBeNull();
    // The fake worker's graph has no nodes: nothing indexed, but the build went through the worker.
    expect(await indexPack({ rootId: "vscode:f-pack" }, "/packs/lease.bfpack")).toBe(0);
    expect(mocks.inThread).not.toHaveBeenCalled();
    expect(requests).toEqual([
      { kind: "pack", file: "/packs/lease.bfpack", focus: ["src:vscode:f-pack::a.md"], maxNodes: 40 },
      { kind: "pack", file: "/packs/lease.bfpack" },
    ]);
  });
});

describe("a run delta's side", () => {
  it("is built in the graph worker with the side's overrides and focus, never on the host thread", async () => {
    const store = localSnapshotStore({ read: async () => undefined, write: async () => undefined });
    const facts = await sideFacts({
      rootId: "r", folderPath: "/ws", placement: { folder: "/ws", add: "", strip: "" }, store, manifest: new InMemoryIngestManifest(),
      packs: [], partitions: { partitions: [] } as never, generation: () => "3",
    }, [{ path: "a.ts", hash: "h-after" }, { path: "gone.ts", absent: true }]);
    expect(facts.manifestGeneration).toBe("3");
    expect(mocks.inThread).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      kind: "stored", folderPath: "/ws", rootId: "r", partitions: { partitions: [] },
      hashOverrides: new Map<string, string | null>([["a.ts", "h-after"], ["gone.ts", null]]),
      focus: [srcRef("r", "a.ts")], maxNodes: MAX_NODES_CAP,
    });
  });
});
