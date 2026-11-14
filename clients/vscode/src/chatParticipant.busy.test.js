/**
 * The native participant refuses a turn while the chat already has a run in flight - BEFORE it
 * builds the tool catalog, reads the workspace or saves a user row. The check reads the Brain chat
 * id the handler resolved earlier in the same turn; reading `runChatId` (declared further down)
 * threw a ReferenceError on EVERY turn. These drive the real handler up to that line.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const isRunning = vi.hoisted(() => vi.fn((_chatId) => false));
const createChat = vi.hoisted(() => vi.fn(async () => ({ id: 77 })));
const reachedTools = new Error("reached the tool catalog");
vi.mock("vscode", () => ({
    l10n: { t: (message) => message },
    workspace: { workspaceFolders: [{ uri: { fsPath: "/workspace" } }], getConfiguration: () => ({ get: () => undefined }) },
    ChatRequestTurn: class {
    },
    ChatResponseTurn: class {
    },
}));
vi.mock("@seanhogg/builderforce-brain-embedded", () => ({ isRunning, runAbortSignal: vi.fn(), withRunUsage: vi.fn() }));
vi.mock("@builderforce/agent-tools", () => ({ RunKnowledgeRecorder: class {
    } }));
vi.mock("./gateway", () => ({ SECRET_KEY: "secret", getLocalModelsConfig: vi.fn() }));
vi.mock("./modelRouting", () => ({
    resolveModelRoute: async () => ({}),
    routeNeedsLocalModel: () => false,
    routeNeedsSpecificModel: () => false,
    routeRequiresSignIn: () => false,
    routeStream: vi.fn(),
}));
vi.mock("./bfApi", () => ({ getCurrentUserId: async () => null, fetchRunContextSection: async () => "", projectEvermindHooks: vi.fn() }));
vi.mock("./personalityLimbic", () => ({ turnLimbicBlock: async () => "" }));
vi.mock("./editorContext", () => ({ getEditorContextLive: async () => ({}) }));
vi.mock("./idePersona", () => ({ editorContextDirective: () => "" }));
vi.mock("./projectState", () => ({ getSelectedProject: () => null }));
vi.mock("./permissionMode", () => ({ permissionMode: () => "acceptEdits" }));
vi.mock("./localFirstStore", () => ({
    localBrainApplication: () => ({
        persistence: { getChat: vi.fn(), createChat },
        identity: { bind: async () => undefined, clientIdFor: async () => "client-1" },
        usage: {},
    }),
}));
vi.mock("./grounding", () => ({ getGroundingWithHistory: async () => "" }));
vi.mock("./prompt", () => ({ buildSystemMessages: () => [] }));
vi.mock("./policyGates", () => ({ PolicyGatesUnavailableError: class extends Error {
    }, resolveRunPolicyGates: async () => [] }));
vi.mock("./brainToolCatalog", () => ({ brainToolCatalog: async () => { throw reachedTools; } }));
vi.mock("./brainRunHost", () => ({ OWNER_NAME: "owner" }));
vi.mock("./chatReferences", () => ({ referencesTurnBlock: async () => "", workspaceReferenceReader: () => ({}) }));
vi.mock("./hostIngress", () => ({ hostIngressDeps: () => ({}), routeMentionBudget: () => 0 }));
vi.mock("./contextPack/preSearchSource", () => ({ whereDefinedOnce: vi.fn() }));
vi.mock("./contextPack/deadline", () => ({ CONTEXT_PACK_DEADLINE_MS: 1 }));
vi.mock("./editorRunEnd", () => ({}));
vi.mock("./editorRunSettings", () => ({}));
vi.mock("./noLocalModelPrompt", () => ({}));
vi.mock("./upgradeAction", () => ({}));
vi.mock("./hooks/editorDirectives", () => ({}));
vi.mock("./memoryStaleness", () => ({}));
vi.mock("./nativeBrainRun", () => ({}));
vi.mock("./runSetupPorts", () => ({}));
import { createBuilderForceHandler } from "./chatParticipant";
function turn(runHost) {
    const markdown = vi.fn();
    const handler = createBuilderForceHandler({ secrets: { get: async () => "key" } }, runHost);
    const run = () => handler({ prompt: "hello" }, { history: [] }, { markdown, button: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() { } }) });
    return { markdown, run };
}
beforeEach(() => {
    isRunning.mockReset().mockReturnValue(false);
    createChat.mockClear();
});
describe("the participant's busy check", () => {
    it("refuses a turn while the chat has a run in the store, naming the chat it resolved", async () => {
        isRunning.mockImplementation((chatId) => chatId === 77);
        const { markdown, run } = turn();
        const result = await run();
        expect(markdown).toHaveBeenCalledWith(expect.stringContaining("still working on this chat"));
        expect(result).toEqual({ metadata: { brainChatId: 77 } });
    });
    it("refuses a turn while the run host holds the chat (a participant run, a panel run)", async () => {
        const busy = vi.fn((chatId) => chatId === 77);
        const { markdown, run } = turn({ isBusy: busy, childControls: () => undefined });
        await expect(run()).resolves.toEqual({ metadata: { brainChatId: 77 } });
        expect(busy).toHaveBeenCalledWith(77);
        expect(markdown).toHaveBeenCalledWith(expect.stringContaining("still working on this chat"));
    });
    it("lets an idle chat through to the tool catalog", async () => {
        const { markdown, run } = turn({ isBusy: () => false, childControls: () => undefined });
        await expect(run()).rejects.toBe(reachedTools);
        expect(markdown).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=chatParticipant.busy.test.js.map