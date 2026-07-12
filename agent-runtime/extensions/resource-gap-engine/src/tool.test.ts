/**
 * @file tool.test.ts
 * @module @builderforce/resource-gap-engine
 * @description Unit tests integrating the RGE tool with repository conventions (AnyAgentTool, ToolInputError, readStringParam filesystem-cached API mapping).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createResourceGapTool } from "./tool.js";

// Mock the plugin runtime, config, and logger; in source-land tests BuilderForceAgents internals live under src/.
const mockRuntime = {
  version: "test",
  config: { loadConfig: vi.fn(), writeConfigFile: vi.fn() },
  system: { enqueueSystemEvent: vi.fn(), runCommandWithTimeout: vi.fn(), formatNativeDependencyHint: vi.fn() },
  media: { loadWebMedia: vi.fn(), detectMime: vi.fn(), mediaKindFromMime: vi.fn(), isVoiceCompatibleAudio: vi.fn(), getImageMetadata: vi.fn(), resizeToJpeg: vi.fn() },
  tts: { textToSpeechTelephony: vi.fn() },
  tools: { createMemoryGetTool: vi.fn(), createMemorySearchTool: vi.fn(), registerMemoryCli: vi.fn() },
  channel: {
    text: { chunkByNewline: vi.fn(), chunkMarkdownText: vi.fn(), chunkMarkdownTextWithMode: vi.fn(), chunkText: vi.fn(), chunkTextWithMode: vi.fn(), resolveChunkMode: vi.fn(), resolveTextChunkLimit: vi.fn(), hasControlCommand: vi.fn(), resolveMarkdownTableMode: vi.fn(), convertMarkdownTables: vi.fn() },
    reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn(), createReplyDispatcherWithTyping: vi.fn(), resolveEffectiveMessagesConfig: vi.fn(), resolveHumanDelayConfig: vi.fn(), dispatchReplyFromConfig: vi.fn(), finalizeInboundContext: vi.fn(), formatAgentEnvelope: vi.fn(), formatInboundEnvelope: vi.fn(), resolveEnvelopeFormatOptions: vi.fn() },
    routing: { resolveAgentRoute: vi.fn() },
    pairing: { buildPairingReply: vi.fn(), readAllowFromStore: vi.fn(), upsertPairingRequest: vi.fn() },
    media: { fetchRemoteMedia: vi.fn(), saveMediaBuffer: vi.fn() },
    activity: { record: vi.fn(), get: vi.fn() },
    session: { resolveStorePath: vi.fn(), readSessionUpdatedAt: vi.fn(), recordSessionMetaFromInbound: vi.fn(), recordInboundSession: vi.fn(), updateLastRoute: vi.fn() },
    mentions: { buildMentionRegexes: vi.fn(), matchesMentionPatterns: vi.fn(), matchesMentionWithExplicit: vi.fn() },
    reactions: { shouldAckReaction: vi.fn(), removeAckReactionAfterReply: vi.fn() },
    groups: { resolveGroupPolicy: vi.fn(), resolveRequireMention: vi.fn() },
    debounce: { createInboundDebouncer: vi.fn(), resolveInboundDebounceMs: vi.fn() },
    commands: { resolveCommandAuthorizedFromAuthorizers: vi.fn(), isControlCommandMessage: vi.fn(), shouldComputeCommandAuthorized: vi.fn(), shouldHandleTextCommands: vi.fn() },
    discord: { messageActions: vi.fn(), auditChannelPermissions: vi.fn(), listDirectoryGroupsLive: vi.fn(), listDirectoryPeersLive: vi.fn(), probeDiscord: vi.fn(), resolveChannelAllowlist: vi.fn(), resolveUserAllowlist: vi.fn(), sendMessageDiscord: vi.fn(), sendPollDiscord: vi.fn(), monitorDiscordProvider: vi.fn() },
    slack: { listDirectoryGroupsLive: vi.fn(), listDirectoryPeersLive: vi.fn(), probeSlack: vi.fn(), resolveChannelAllowlist: vi.fn(), resolveUserAllowlist: vi.fn(), sendMessageSlack: vi.fn(), monitorSlackProvider: vi.fn(), handleSlackAction: vi.fn() },
    telegram: { auditGroupMembership: vi.fn(), collectUnmentionedGroupIds: vi.fn(), probeTelegram: vi.fn(), resolveTelegramToken: vi.fn(), sendMessageTelegram: vi.fn(), sendPollTelegram: vi.fn(), monitorTelegramProvider: vi.fn(), messageActions: vi.fn() },
    signal: { probeSignal: vi.fn(), sendMessageSignal: vi.fn(), monitorSignalProvider: vi.fn(), messageActions: vi.fn() },
    imessage: { monitorIMessageProvider: vi.fn(), probeIMessage: vi.fn(), sendMessageIMessage: vi.fn() },
    whatsapp: { getActiveWebListener: vi.fn(), getWebAuthAgeMs: vi.fn(), logoutWeb: vi.fn(), logWebSelfId: vi.fn(), readWebSelfId: vi.fn(), webAuthExists: vi.fn(), sendMessageWhatsApp: vi.fn(), sendPollWhatsApp: vi.fn(), loginWeb: vi.fn(), startWebLoginWithQr: vi.fn(), waitForWebLogin: vi.fn(), monitorWebChannel: vi.fn(), handleWhatsAppAction: vi.fn(), createLoginTool: vi.fn() },
    line: { listLineAccountIds: vi.fn(), resolveDefaultLineAccountId: vi.fn(), resolveLineAccount: vi.fn(), normalizeAccountId: vi.fn(), probeLineBot: vi.fn(), sendMessageLine: vi.fn(), pushMessageLine: vi.fn(), pushMessagesLine: vi.fn(), pushFlexMessage: vi.fn(), pushTemplateMessage: vi.fn(), pushLocationMessage: vi.fn(), pushTextMessageWithQuickReplies: vi.fn(), createQuickReplyItems: vi.fn(), buildTemplateMessageFromPayload: vi.fn(), monitorLineProvider: vi.fn() },
  },
  logging: { shouldLogVerbose: vi.fn(), getChildLogger: vi.fn() },
  state: { resolveStateDir: vi.fn() },
} as any;
const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// Fake plugin API references used in tool.ts for registering and accessing config.
function fakeApi() {
  return {
    id: "resource-gap-engine",
    name: "Resource Gap Engine",
    source: "test",
    config: {},
    pluginConfig: {},
    runtime: mockRuntime,
    logger: mockLogger,
    registerTool: () => {},
  } as unknown as BuilderForceAgentsPluginApi;
}

describe("resource-gap-tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("succeeds with minimal valid input", async () => {
    const tool = createResourceGapTool(fakeApi());

    const res = await tool.execute("test-id", {
      employees: [
        { employeeId: "1", role: "Senior-Engineer:FullTime", team: { name: "Platform:Group", orgUnitId: "cu000" }, skills: [{ name: "JavaScript", level: 5 }], location: "HQ", utilization: 1, managerContactId: "mgr-1" },
      ],
      projectRequirements: [
        {
          projectId: "PRJ-001",
          requiredSkills: [{ skillName: "JavaScript", minProficiency: 5 }],
          seniorityBand: "Mid",
          demandFte: 1.0,
          quarters: [{ year: 2026, quarter: 1, label: "2026-Q1" }],
          includeUnitSpecific: true,
        },
      ],
    });

    expect(res.content).toEqual([
      { type: "text", text: expect.stringContaining('"summary"'), },
    ]);
    expect(res.content[0].text).toMatch(/"summary":\s*\{.*"title":\s*"Gap and Recommendation Summary"/s);
  });

  it("fails with empty employees array", async () => {
    const tool = createResourceGapTool(fakeApi());

    const error = await tool.execute("test-id", {
      employees: [],
      projectRequirements: [
        {
          projectId: "PRJ-001",
          requiredSkills: [{ skillName: "JavaScript", minProficiency: 5 }],
          seniorityBand: "Mid",
          demandFte: 1.0,
          quarters: [{ year: 2026, quarter: 1, label: "2026-Q1" }],
          includeUnitSpecific: true,
        },
      ],
    });

    expect(error).resolves.toThrow(/employees array must contain at least one employee/i);
  });

  it("fails with empty projectRequirements array", async () => {
    const tool = createResourceGapTool(fakeApi());

    const error = await tool.execute("test-id", {
      employees: [
        { employeeId: "1", role: "Senior-Engineer:FullTime", team: { name: "Platform:Group", orgUnitId: "cu000" }, skills: [{ name: "JavaScript", level: 5 }], location: "HQ", utilization: 1, managerContactId: "mgr-1" },
      ],
      projectRequirements: [],
    });

    expect(error).resolves.toThrow(/projectRequirements array must contain at least one project/i);
  });

  it("fails when employees is not an array", async () => {
    const tool = createResourceGapTool(fakeApi());

    const error = await tool.execute("test-id", {
      employees: "invalid",
      projectRequirements: [
        {
          projectId: "PRJ-001",
          requiredSkills: [{ skillName: "JavaScript", minProficiency: 5 }],
          seniorityBand: "Mid",
          demandFte: 1.0,
          quarters: [{ year: 2026, quarter: 1, label: "2026-Q1" }],
          includeUnitSpecific: true,
        },
      ],
    });
    expect(error).resolves.toThrow(/employees must be an array/i);
  });

  it("fails when projectRequirements is not an array", async () => {
    const tool = createResourceGapTool(fakeApi());

    const error = await tool.execute("test-id", {
      employees: [
        { employeeId: "1", role: "Senior-Engineer:FullTime", team: { name: "Platform:Group", orgUnitId: "cu000" }, skills: [{ name: "JavaScript", level: 5 }], location: "HQ", utilization: 1, managerContactId: "mgr-1" },
      ],
      projectRequirements: "invalid",
    });
    expect(error).resolves.toThrow(/projectRequirements must be an array/i);
  });

  it("sets summary title to Gap and Recommendation Summary", async () => {
    const tool = createResourceGapTool(fakeApi());

    const res = await tool.execute("test-id", {
      employees: [
        { employeeId: "1", role: "Senior-Engineer:FullTime", team: { name: "Platform:Group", orgUnitId: "cu000" }, skills: [{ name: "JavaScript", level: 5 }], location: "HQ", utilization: 1, managerContactId: "mgr-1" },
      ],
      projectRequirements: [
        {
          projectId: "PRJ-001",
          requiredSkills: [{ skillName: "JavaScript", minProficiency: 5 }],
          seniorityBand: "Mid",
          demandFte: 1.0,
          quarters: [{ year: 2026, quarter: 1, label: "2026-Q1" }],
          includeUnitSpecific: true,
        },
      ],
    });

    expect((JSON.parse(res.content[0].text) as any).summary.title).toBe("Gap and Recommendation Summary");
  });

  it("includes metrics object populated with counts", async () => {
    const tool = createResourceGapTool(fakeApi());

    const res = await tool.execute("test-id", {
      employees: [
        { employeeId: "1", role: "Senior-Engineer:FullTime", team: { name: "Platform:Group", orgUnitId: "cu000" }, skills: [{ name: "JavaScript", level: 5 }], location: "HQ", utilization: 1, managerContactId: "mgr-1" },
      ],
      projectRequirements: [
        {
          projectId: "PRJ-001",
          requiredSkills: [{ skillName: "JavaScript", minProficiency: 5 }],
          seniorityBand: "Mid",
          demandFte: 1.0,
          quarters: [{ year: 2026, quarter: 1, label: "2026-Q1" }],
          includeUnitSpecific: true,
        },
      ],
    });

    const result = JSON.parse(res.content[0].text) as any;
    expect(result.metrics).toBeObject();
    expect(result.metrics.hiringRecs).toBe(0);
    expect(result.metrics.deploymentRecs).toBe(0);
    expect(result.metrics.upskillRecs).toBe(0);
    expect(result.metrics.criticalGaps).toBe(0);
  });
});