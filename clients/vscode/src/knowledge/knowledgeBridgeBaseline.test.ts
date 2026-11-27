import { beforeEach, describe, expect, it, vi } from "vitest";

// The bridge's `baseline` op only: every collaborator is a stub. What is asserted is that the platform's previous review's commit
// (`previousCommitSha`) reaches `knowledgeBaseline` as the baseline's `rev` — the code pane reads the "before" source at it.
const host = vi.hoisted(() => ({
  scopes: vi.fn(async () => [] as unknown[]),
  graph: vi.fn(async () => null as unknown),
  baseline: vi.fn((graph: unknown, _measured: unknown, _after: unknown, rev?: string) => ({ graph, comparable: true, reasons: [], ...(rev ? { rev } : {}) })),
}));
const GRAPH = { scope: { rootId: "r1", packs: ["code"], digest: "d1" }, nodes: [], edges: [], findings: [], stats: { sources: 0, nodes: 0, edges: 0, stale: 0, truncated: false } };

vi.mock("vscode", () => ({ l10n: { t: (s: string) => s }, workspace: { isTrusted: true, workspaceFolders: [] }, window: {} }));
vi.mock("@seanhogg/builderforce-memory/knowledge", () => ({ factKeyOf: () => undefined }));
vi.mock("@builderforce/agent-tools/knowledge", () => ({
  factRightsCache: () => ({}), humanFactBatch: vi.fn(), proposeDomainLayout: vi.fn(), readSystems: vi.fn(),
}));
vi.mock("./knowledgeBaseline", () => ({ knowledgeBaseline: host.baseline }));
vi.mock("../workspace/openWorkspace", () => ({ openWorkspace: vi.fn() }));
vi.mock("../project/projectState", () => ({ SELECTED_TENANT_KEY: "tenant" }));
vi.mock("./index/hostKnowledgeIndex", () => ({ getHostKnowledgeIndex: vi.fn() }));
vi.mock("./knowledgeProtocol", () => ({ KNOWLEDGE_EVENT: "knowledge.event" }));
vi.mock("./knowledgeFixSession", () => ({ KnowledgeFixSession: class { dispose(): void {} } }));
vi.mock("./knowledgeLoadTrace", () => ({ createLoadTrace: () => ({ run: async (_name: string, _root: unknown, fn: (traced: unknown) => unknown) => fn({}) }) }));
vi.mock("./knowledgeLastSeen", () => ({ readLastSeen: vi.fn(), workspaceKey: vi.fn(), writeLastSeen: vi.fn() }));
vi.mock("./knowledgeFixesHost", () => ({ vscodeFixPorts: {} }));
vi.mock("./knowledgeHistory", () => ({ rootHistory: vi.fn() }));
vi.mock("./knowledgePinpointHost", () => ({ pinpointRoot: vi.fn() }));
vi.mock("./knowledgeSync", () => ({ retryRootSync: vi.fn(), rootSyncStatus: vi.fn() }));
vi.mock("./knowledgeSymbols", () => ({ rootSymbols: vi.fn(), SymbolsGate: class {} }));
vi.mock("./sourcePort", () => ({ openSource: vi.fn(), readSource: vi.fn(), readSourceAt: vi.fn() }));
vi.mock("./knowledgeTryRequestHost", () => ({ tryRequestOf: vi.fn() }));
vi.mock("./knowledgeRoots", () => ({ reviewedRoots: vi.fn(() => []), rootById: vi.fn(() => undefined), rootForPath: vi.fn() }));
vi.mock("./knowledgeReviewSessions", () => ({ KnowledgeReviewSessions: class { dispose(): void {} } }));
vi.mock("./knowledgeExclude", () => ({ excludeFromReview: vi.fn() }));
vi.mock("./knowledgeFs", () => ({ rootIgnoreFile: vi.fn() }));
vi.mock("./knowledgeReplica", () => ({ duringReview: vi.fn(), isRootReviewing: vi.fn() }));
vi.mock("./knowledgeDomains", () => ({ nodeDomainPorts: vi.fn(), organizeDomains: vi.fn(), planDomainMoves: vi.fn(), rootDomainInput: vi.fn(), rootDomainLayout: vi.fn() }));
vi.mock("./knowledgeFixText", () => ({ fixText: {} }));
vi.mock("./knowledgeLive", () => ({ subscribeLiveGraph: vi.fn() }));
vi.mock("./lastBuiltCounts", () => ({ LastBuiltCounts: class {} }));
vi.mock("./visualizerSession", () => ({ visualizerSessions: {} }));
vi.mock("./indexLevels", () => ({ onIndexLevel: vi.fn(), preemptBackground: vi.fn(), requestL3: vi.fn(), withdrawL3Request: vi.fn() }));
vi.mock("./knowledgeNotHere", () => ({ notReviewedHere: vi.fn() }));
vi.mock("./packs/packRoots", () => ({ assertWritable: vi.fn(), packRootGraph: vi.fn(), packScopeRows: vi.fn(() => []), readOnlyPack: vi.fn() }));
vi.mock("./knowledgeService", () => ({
  linkedKnowledgeClient: vi.fn(() => ({ scopes: host.scopes, graph: host.graph })), linkedProject: vi.fn(), loadGraph: vi.fn(), log: vi.fn(), openRoot: vi.fn(),
  rootKnowledgeFiles: vi.fn(), workspaceFolders: () => [],
}));
vi.mock("./review/reviewRuns", () => ({ getRun: vi.fn(), listRuns: vi.fn() }));
vi.mock("./agentRuns", () => ({ createAgentRuns: vi.fn() }));
vi.mock("./rootLoads", () => ({ beginRootLoad: vi.fn() }));
vi.mock("../localFirst/localFirstStore", () => ({ localBrainApplication: vi.fn() }));
vi.mock("../shared/messageOf", () => ({ messageOf: (e: unknown) => String(e) }));

import { tmpdir } from "node:os";
import { KnowledgeBridge } from "./knowledgeBridge";

const bridge = (): KnowledgeBridge =>
  new KnowledgeBridge({ ctx: { secrets: {}, globalStorageUri: { fsPath: tmpdir() }, extension: { packageJSON: { version: "0" } } } as never, post: vi.fn() });

const scope = (extra: Record<string, unknown>) => ({ rootId: "r1", title: "r1", packs: ["code"], lastDigest: "d2", previousDigest: "d1", ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  host.graph.mockResolvedValue(GRAPH);
});

describe("KnowledgeBridge baseline op: the commit of the previous review", () => {
  it("hands the platform's previousCommitSha to the baseline as its rev (the old source is read at it)", async () => {
    host.scopes.mockResolvedValue([scope({ commitSha: "f".repeat(40), previousCommitSha: "a".repeat(40) })]);
    const answer = await bridge().handle({ op: "baseline", rootId: "r1" });
    expect(host.graph).toHaveBeenCalledWith("r1", { at: "d1" });
    expect(host.baseline).toHaveBeenCalledWith(GRAPH, undefined, expect.objectContaining({ rootId: "r1", local: false }), "a".repeat(40));
    expect(answer).toMatchObject({ rev: "a".repeat(40) });
  });

  it("leaves rev off when the platform holds no commit for the previous review (a review from before it was recorded, or not a git folder)", async () => {
    host.scopes.mockResolvedValue([scope({ commitSha: "f".repeat(40) })]);
    const answer = await bridge().handle({ op: "baseline", rootId: "r1" });
    expect(host.baseline).toHaveBeenCalledWith(GRAPH, undefined, expect.anything(), undefined);
    expect(answer).not.toHaveProperty("rev");
  });
});
