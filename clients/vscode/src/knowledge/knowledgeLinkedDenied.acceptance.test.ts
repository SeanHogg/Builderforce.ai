/**
 * PRD 41 A7 acceptance, through the editor's linked path (`openRoot` / `reviewRoot` / `loadGraph`): a
 * LINKED root of 2,000 files whose server answers 429 to EVERY request still reviews, and the drawn
 * model equals the unlinked run's — compared by a digest of node ids, per-node badges, edges, findings
 * and stats. The local store is the source of truth; the replica only waits.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";

const mocks = vi.hoisted(() => ({
  folder: "",
  linked: true,
  files: new Map<string, string>(),
  /** Every request the "server" saw; each one answers 429. */
  requests: [] as string[],
  fixture: {} as Record<string, string>,
}));

vi.mock("vscode", () => ({
  workspace: { get workspaceFolders() { return [{ uri: { fsPath: mocks.folder } }]; } },
  window: {},
  l10n: { t: (m: string) => m },
}));
vi.mock("../bfApi", () => ({
  fetchAuthed: async (_secrets: unknown, requested: string): Promise<Response> => {
    mocks.requests.push(requested);
    return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
  },
}));
vi.mock("../projectState", () => ({ getSelectedProject: () => (mocks.linked ? { id: 7, name: "linked" } : undefined) }));
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
vi.mock("./knowledgeJudgement", () => ({ editorJudgement: async () => undefined }));
vi.mock("@builderforce/agent-tools/prefetch", () => ({ readPartitions: async () => undefined }));
vi.mock("@builderforce/agent-tools/node-git-history", () => ({ gitHistoryPort: async () => undefined }));
vi.mock("@builderforce/repo-map", () => ({ repoMapPort: {} }));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({ NOT_SIGNED_IN: "not-signed-in" }));
// No shell here: the analyzers are stubbed to "nothing collected"; the per-file extractor is the real one.
vi.mock("@builderforce/agent-tools/knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@builderforce/agent-tools/knowledge")>()),
  workspaceCodeAnalyzers: () => ({ analyse: async () => [] }),
}));

import { forgetRootPorts } from "@builderforce/agent-tools/knowledge";
import { loadGraph, reviewRoot } from "./knowledgeService";
import { rootForPath } from "./knowledgeRoots";
import { disposeReplicas, replicaStatusOf } from "./knowledgeReplica";

const FILES = 2000;

/** 2,000 generated files in 40 folders, each importing the one before it. */
function generatedFixture(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < FILES; i++) {
    out[`src/area${i % 40}/file${i}.ts`] = i === 0
      ? "export const v0 = 0;\n"
      : `import { v${i - 1} } from "../area${(i - 1) % 40}/file${i - 1}";\nexport const v${i} = v${i - 1} + 1;\n`;
  }
  return out;
}

/** What the view draws: node ids with their badges and areas, the edges, the findings, the stats. */
function digestOf(graph: KnowledgeGraph): string {
  return JSON.stringify({
    nodes: graph.nodes.map((n) => [n.ref, n.kind, n.pack, n.area ?? "", n.badges ?? {}]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    edges: graph.edges.map((e) => `${e.from}>${e.to}:${e.kind}`).sort(),
    findings: graph.findings.map((f) => `${f.kind}:${f.nodes.join(",")}`).sort(),
    stats: graph.stats,
    outline: graph.outline ?? null,
  });
}

async function reviewAndDraw(linked: boolean): Promise<{ graph: KnowledgeGraph | null; failed: boolean }> {
  mocks.linked = linked;
  // The SAME folder for both runs: a root id is the folder's (its git remote, else a hash of its URI), never the
  // link state's, so the digests compare like with like. Only the stored snapshot is cleared between runs.
  mocks.files.clear();
  forgetRootPorts();
  const root = rootForPath(mocks.folder, [{ path: mocks.folder }])!;
  const review = reviewRoot({} as never, root);
  const report = await review.run({});
  const graph = await loadGraph({} as never, root.rootId, { maxNodes: 5000 });
  return { graph, failed: report.aborted };
}

beforeEach(() => {
  mocks.requests.length = 0;
  mocks.fixture = generatedFixture();
  mocks.folder = fs.mkdtempSync(path.join(os.tmpdir(), "bf-acceptance-"));
});
afterEach(async () => { await disposeReplicas(); });

describe("a linked root whose server answers 429 to every request", () => {
  it("finishes the review and draws the same model as the unlinked run", async () => {
    const unlinked = await reviewAndDraw(false);
    await disposeReplicas();
    mocks.requests.length = 0;
    const linked = await reviewAndDraw(true);

    expect(unlinked.failed).toBe(false);
    expect(linked.failed).toBe(false);
    expect(unlinked.graph).not.toBeNull();
    expect(linked.graph).not.toBeNull();
    expect(linked.graph!.nodes.length).toBeGreaterThan(FILES / 2);
    expect(digestOf(linked.graph!)).toBe(digestOf(unlinked.graph!));

    // Nothing was drawn from the server: its graph route was never asked, and the replica is still waiting.
    expect(mocks.requests.some((r) => r.includes("knowledge-graph"))).toBe(false);
    const root = rootForPath(mocks.folder, [{ path: mocks.folder }])!;
    await vi.waitFor(async () => expect((await replicaStatusOf(root.rootId, { read: async () => undefined, write: async () => undefined })).queued).toBeGreaterThan(0));
  }, 120_000);
});
