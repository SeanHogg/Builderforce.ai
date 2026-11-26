import { beforeEach, describe, expect, it, vi } from "vitest";

// The bridge's `readSourceAt` dispatch only: every collaborator is a stub, `sourcePort` is the seam asserted on.
const port = vi.hoisted(() => ({
  readSource: vi.fn(async () => ({ startLine: 1, lines: ["today"], truncated: false })),
  readSourceAt: vi.fn(async () => ({ startLine: 2, lines: ["then"], truncated: false })),
  openSource: vi.fn(async () => null),
  rootById: vi.fn((id: string) => (id === "r1" ? { rootId: "r1", title: "root", rootPath: "/repo", folderPath: "/repo", rel: "" } : undefined)),
}));

vi.mock("vscode", () => ({ l10n: { t: (s: string) => s }, workspace: { isTrusted: true, workspaceFolders: [] }, window: {} }));
vi.mock("@seanhogg/builderforce-memory/knowledge", () => ({ factKeyOf: () => undefined }));
vi.mock("@builderforce/agent-tools/knowledge", () => ({
  factRightsCache: () => ({}), humanFactBatch: vi.fn(), proposeDomainLayout: vi.fn(), readSystems: vi.fn(),
}));
vi.mock("./knowledgeBaseline", () => ({ knowledgeBaseline: vi.fn() }));
vi.mock("../workspace/openWorkspace", () => ({ openWorkspace: vi.fn() }));
vi.mock("../project/projectState", () => ({ SELECTED_TENANT_KEY: "tenant" }));
vi.mock("./index/hostKnowledgeIndex", () => ({ getHostKnowledgeIndex: vi.fn() }));
vi.mock("./knowledgeProtocol", () => ({ KNOWLEDGE_EVENT: "knowledge.event" }));
vi.mock("./knowledgeFixSession", () => ({ KnowledgeFixSession: class { dispose(): void {} } }));
vi.mock("./knowledgeLoadTrace", () => ({ createLoadTrace: () => ({}) }));
vi.mock("./knowledgeLastSeen", () => ({ readLastSeen: vi.fn(), workspaceKey: vi.fn(), writeLastSeen: vi.fn() }));
vi.mock("./knowledgeFixesHost", () => ({ vscodeFixPorts: {} }));
vi.mock("./knowledgeHistory", () => ({ rootHistory: vi.fn() }));
vi.mock("./knowledgePinpointHost", () => ({ pinpointRoot: vi.fn() }));
vi.mock("./knowledgeSync", () => ({ retryRootSync: vi.fn(), rootSyncStatus: vi.fn() }));
vi.mock("./knowledgeSymbols", () => ({ rootSymbols: vi.fn(), SymbolsGate: class {} }));
vi.mock("./sourcePort", () => ({ openSource: port.openSource, readSource: port.readSource, readSourceAt: port.readSourceAt }));
vi.mock("./knowledgeTryRequestHost", () => ({ tryRequestOf: vi.fn() }));
vi.mock("./knowledgeRoots", () => ({ reviewedRoots: vi.fn(() => []), rootById: port.rootById, rootForPath: vi.fn() }));
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
  linkedKnowledgeClient: vi.fn(), linkedProject: vi.fn(), loadGraph: vi.fn(), log: vi.fn(), openRoot: vi.fn(),
  rootKnowledgeFiles: vi.fn(), workspaceFolders: () => [],
}));
vi.mock("./review/reviewRuns", () => ({ getRun: vi.fn(), listRuns: vi.fn() }));
vi.mock("./agentRuns", () => ({ createAgentRuns: vi.fn() }));
vi.mock("./rootLoads", () => ({ beginRootLoad: vi.fn() }));
vi.mock("../localFirst/localFirstStore", () => ({ localBrainApplication: vi.fn() }));
vi.mock("../shared/messageOf", () => ({ messageOf: (e: unknown) => String(e) }));

import { KnowledgeBridge } from "./knowledgeBridge";

const bridge = (): KnowledgeBridge =>
  new KnowledgeBridge({ ctx: { secrets: {}, extension: { packageJSON: { version: "0" } } } as never, post: vi.fn() });

beforeEach(() => { vi.clearAllMocks(); });

describe("KnowledgeBridge readSourceAt op", () => {
  it("answers from sourcePort.readSourceAt with the root, path, rev and range, never readSource", async () => {
    const answer = await bridge().handle({ op: "readSourceAt", rootId: "r1", path: "src/a.ts", rev: "abc1234", startLine: 2, endLine: 9 });
    expect(answer).toEqual({ startLine: 2, lines: ["then"], truncated: false });
    expect(port.readSourceAt).toHaveBeenCalledWith(expect.objectContaining({ rootId: "r1" }), "src/a.ts", "abc1234", 2, 9);
    expect(port.readSource).not.toHaveBeenCalled();
  });

  it("refuses a root no open folder holds, before any git is reached", async () => {
    await expect(bridge().handle({ op: "readSourceAt", rootId: "nope", path: "a.ts", rev: "abc1234", startLine: 1, endLine: 1 })).rejects.toThrow();
    expect(port.readSourceAt).not.toHaveBeenCalled();
  });

  it("propagates a failed read as a rejection (the view treats null as 'absent then', never a failure)", async () => {
    port.readSourceAt.mockRejectedValueOnce(new Error("git timed out"));
    await expect(bridge().handle({ op: "readSourceAt", rootId: "r1", path: "a.ts", rev: "abc1234", startLine: 1, endLine: 1 })).rejects.toThrow("git timed out");
  });
});
