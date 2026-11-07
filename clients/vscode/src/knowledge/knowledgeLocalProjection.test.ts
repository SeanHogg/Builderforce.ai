/**
 * PRD 41 A7: a LINKED workspace draws from the local projection and never from the server's graph;
 * the sync status counts the local graph; an unreviewed root says so with a typed answer.
 */
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filesManifestKey, srcRef, type Extracted } from "@seanhogg/builderforce-memory/knowledge";

const mocks = vi.hoisted(() => ({
  folder: "",
  files: new Map<string, string>(),
  // The server: every call is observed, and the graph read throws like a down API would.
  fetchAuthed: vi.fn(async (_secrets?: unknown, _path?: string, _init?: unknown): Promise<Response> => { throw new Error("platform_network_denied"); }),
}));

vi.mock("vscode", () => ({
  workspace: { get workspaceFolders() { return [{ uri: { fsPath: mocks.folder } }]; } },
  window: {},
  l10n: { t: (m: string) => m },
}));
vi.mock("../bfApi", () => ({ fetchAuthed: mocks.fetchAuthed }));
vi.mock("../projectState", () => ({ getSelectedProject: () => ({ id: 7, name: "linked" }) }));
vi.mock("../errorReporter", () => ({ logLine: vi.fn() }));
vi.mock("../localCapabilities", () => ({ buildLocalCapabilityProvider: () => ({}) }));
vi.mock("../workspaceSymbols", () => ({ workspaceSymbolIndex: () => ({ filesUnder: async () => [] }) }));
vi.mock("../platformPolicy", () => ({ platformCapabilityAllows: () => true }));
vi.mock("./index/hostKnowledgeIndex", () => ({ getHostKnowledgeIndex: async () => ({ nearDuplicates: () => [] }) }));
vi.mock("./knowledgeFs", () => ({
  vscodeKnowledgeFs: () => ({ readDirectory: async () => { throw new Error("ENOENT"); }, stat: async () => { throw new Error("ENOENT"); }, readFile: async () => new Uint8Array() }),
  workspaceKnowledgeFiles: () => ({
    read: async (name: string) => mocks.files.get(name),
    write: async (name: string, text: string) => { mocks.files.set(name, text); },
  }),
}));
vi.mock("./vscodeDirectorySource", () => ({ createDirectorySource: () => ({ skippedFolders: () => [] }) }));
vi.mock("./knowledgeJudgement", () => ({ editorJudgement: async () => undefined }));
vi.mock("@builderforce/agent-tools/prefetch", () => ({ readPartitions: async () => undefined }));
vi.mock("@builderforce/agent-tools/node-git-history", () => ({ gitHistoryPort: async () => undefined }));
vi.mock("@builderforce/repo-map", () => ({ repoMapPort: {} }));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({ NOT_SIGNED_IN: "not-signed-in" }));

import { codeFileNode, forgetRootPorts } from "@builderforce/agent-tools/knowledge";
import { fileManifest, localKnowledgeStore, manifestFileName } from "./knowledgeStores";
import { loadGraph, rootKnowledgeFiles } from "./knowledgeService";
import { rootForPath } from "./knowledgeRoots";
import { forgetReachability, notReviewedHere } from "./knowledgeNotHere";
import { rootSyncStatus } from "./knowledgeSync";
import { disposeReplicas } from "./knowledgeReplica";

const secrets = {} as never;

beforeEach(() => {
  mocks.folder = fs.mkdtempSync(path.join(os.tmpdir(), "bf-local-projection-"));
  mocks.files.clear();
  mocks.fetchAuthed.mockClear();
  forgetRootPorts();
  forgetReachability();
});

afterEach(async () => { await disposeReplicas(); });

async function reviewedLocally() {
  const root = rootForPath(mocks.folder, [{ path: mocks.folder }])!;
  const files = rootKnowledgeFiles(root);
  const ref = srcRef(root.rootId, "a.ts");
  const ex: Extracted = { sourceRef: ref, sourceHash: "h1", nodes: [codeFileNode(root.rootId, "a.ts", { sourceHash: "h1" })], edges: [], keys: [] };
  await localKnowledgeStore(files, root.rootId).putExtracted!("h1", [ex]);
  await fileManifest(files, manifestFileName(root.rootId)).set(filesManifestKey(root.rootId), [{ id: "a.ts", hash: "h1" }]);
  return root;
}

describe("a linked workspace draws from the local projection", () => {
  it("builds the graph from the local store and never reads the server's graph", async () => {
    const root = await reviewedLocally();
    const graph = await loadGraph(secrets, root.rootId, { maxNodes: 50 });
    expect(graph).not.toBeNull();
    expect(graph!.scope.rootId).toBe(root.rootId);
    expect(mocks.fetchAuthed).not.toHaveBeenCalled();
  });

  it("with no local review says so (typed), never reads the server's graph, and offers the server's copy only when the project is reachable", async () => {
    const root = rootForPath(mocks.folder, [{ path: mocks.folder }])!;
    expect(await loadGraph(secrets, root.rootId)).toBeNull();
    // Every call rejected: linked but unreachable, so no server copy is offered.
    expect(await notReviewedHere(secrets, root.rootId)).toEqual({ notReviewedHere: { canSeed: false } });
    expect(await notReviewedHere(secrets, "vscode:elsewhere")).toBeNull();
    // Reachable (a cheap scopes probe answers): the copy is offered.
    forgetReachability();
    mocks.fetchAuthed.mockImplementationOnce(async () => new Response(JSON.stringify({ scopes: [] }), { status: 200 }));
    expect(await notReviewedHere(secrets, root.rootId)).toEqual({ notReviewedHere: { canSeed: true } });
    // The probe is cached for 30 s: a second ask does not call again.
    const calls = mocks.fetchAuthed.mock.calls.length;
    await notReviewedHere(secrets, root.rootId);
    expect(mocks.fetchAuthed.mock.calls.length).toBe(calls);
    expect(mocks.fetchAuthed.mock.calls.every(([, path]) => !String(path).includes("knowledge-graph"))).toBe(true);
  });

  it("sync status: local counts come from the local graph, the server column is empty when unreachable, and the replica state is present", async () => {
    const root = await reviewedLocally();
    const status = await rootSyncStatus(secrets, root);
    expect(status.local.files).toBe(1);
    expect(status.server).toBeUndefined();
    expect(status.replica).toMatchObject({ queued: 0, sending: false, skipped: 0, failed: [] });
    expect(status.sources.find((s) => s.id === "code")?.state).toBe("collected");
  });
});
