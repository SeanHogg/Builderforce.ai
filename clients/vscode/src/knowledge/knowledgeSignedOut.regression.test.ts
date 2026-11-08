/**
 * PRD 41 A2 / done-check: signed out with a PERSISTED project selection, a review completes on the local
 * store. regression: the selection alone used to make the workspace "linked", so every knowledge call
 * built a server client whose fetch threw `NOT_SIGNED_IN` into the review.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localSqliteAvailable } from "@builderforce/agent-tools/node-local-sqlite";

const mocks = vi.hoisted(() => ({
  folder: "",
  inputs: { signedIn: false, synchronize: false, gatewayInference: false, connectedFeatures: false },
  files: new Map<string, string>(),
  requests: [] as string[],
  fixture: {} as Record<string, string>,
}));

vi.mock("vscode", () => ({
  workspace: { get workspaceFolders() { return [{ uri: { fsPath: mocks.folder } }]; } },
  window: {},
  l10n: { t: (m: string) => m },
}));
// Signed out there is no session: fetchAuthed resolves undefined, which the client turns into NOT_SIGNED_IN.
vi.mock("../bfApi", () => ({
  fetchAuthed: async (_secrets: unknown, requested: string): Promise<undefined> => { mocks.requests.push(requested); return undefined; },
}));
vi.mock("../projectState", () => ({ getSelectedProject: () => ({ id: 7, name: "persisted-while-signed-out" }) }));
vi.mock("../capabilityContext", () => ({ currentCapabilityInputs: () => mocks.inputs }));
vi.mock("../errorReporter", () => ({ logLine: vi.fn() }));
vi.mock("../localCapabilities", () => ({ buildLocalCapabilityProvider: () => ({}) }));
vi.mock("../workspaceSymbols", () => ({ workspaceSymbolIndex: () => ({ filesUnder: async () => [] }) }));
vi.mock("./index/hostKnowledgeIndex", () => ({ getHostKnowledgeIndex: async () => undefined }));
vi.mock("./knowledgeFs", () => ({
  vscodeKnowledgeFs: () => ({ readDirectory: async () => { throw new Error("ENOENT"); }, stat: async () => { throw new Error("ENOENT"); }, readFile: async () => new Uint8Array() }),
  workspaceKnowledgeFiles: () => ({
    read: async (name: string) => mocks.files.get(name),
    write: async (name: string, text: string) => { mocks.files.set(name, text); },
  }),
}));
vi.mock("./vscodeDirectorySource", () => ({
  createDirectorySource: (o: { rootId: string; title: string }) => ({
    rootId: o.rootId,
    title: o.title,
    skippedFolders: () => [],
    async *list() {
      for (const [p, text] of Object.entries(mocks.fixture)) yield { path: p, hash: `h:${p}:${text.length}`, size: text.length };
    },
    async read(p: string) {
      return { id: p, tenantId: "code", title: p, content: { kind: "text", text: mocks.fixture[p] ?? "", mediaType: "text/typescript" } };
    },
  }),
}));
vi.mock("./knowledgeJudgement", () => ({ editorJudgement: async () => undefined, judgeConfigured: async () => false }));
vi.mock("@builderforce/agent-tools/prefetch", () => ({ readPartitions: async () => undefined }));
vi.mock("@builderforce/agent-tools/node-git-history", () => ({ gitHistoryPort: async () => undefined }));
vi.mock("@builderforce/repo-map", () => ({ repoMapPort: {} }));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({ NOT_SIGNED_IN: "not-signed-in" }));
vi.mock("@builderforce/agent-tools/knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@builderforce/agent-tools/knowledge")>()),
  workspaceCodeAnalyzers: () => ({ analyse: async () => [] }),
}));

import { forgetRootPorts } from "@builderforce/agent-tools/knowledge";
import { linkedKnowledgeClient, loadGraph, reviewRoot } from "./knowledgeService";
import { rootForPath } from "./knowledgeRoots";
import { disposeReplicas } from "./knowledgeReplica";

beforeEach(() => {
  mocks.requests.length = 0;
  mocks.files.clear();
  mocks.folder = fs.mkdtempSync(path.join(os.tmpdir(), "bf-signed-out-"));
  mocks.fixture = {
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": 'import { a } from "./a";\nexport const b = a + 1;\n',
  };
  forgetRootPorts();
});
afterEach(async () => { await disposeReplicas(); });

describe.skipIf(!localSqliteAvailable())("regression: signed out with a persisted project selection", () => {
  it("is not linked, so there is no server client to throw NOT_SIGNED_IN", () => {
    mocks.inputs = { signedIn: false, synchronize: false, gatewayInference: false, connectedFeatures: false };
    expect(linkedKnowledgeClient({} as never)).toBeUndefined();
    // Signed in but sync not granted is not linked either; signed in AND granted is.
    mocks.inputs = { signedIn: true, synchronize: false, gatewayInference: true, connectedFeatures: true };
    expect(linkedKnowledgeClient({} as never)).toBeUndefined();
    mocks.inputs = { signedIn: true, synchronize: true, gatewayInference: true, connectedFeatures: true };
    expect(linkedKnowledgeClient({} as never)).toBeDefined();
  });

  it("a review completes on the local store and the map draws from it, with no request made", async () => {
    mocks.inputs = { signedIn: false, synchronize: false, gatewayInference: false, connectedFeatures: false };
    const root = rootForPath(mocks.folder, [{ path: mocks.folder }])!;
    const report = await reviewRoot({} as never, root).run({});
    expect(report.aborted).toBe(false);
    const graph = await loadGraph({} as never, root.rootId, { maxNodes: 100 });
    expect(graph).not.toBeNull();
    expect(graph!.nodes.length).toBeGreaterThanOrEqual(2);
    expect(mocks.requests).toEqual([]);
  });
});
