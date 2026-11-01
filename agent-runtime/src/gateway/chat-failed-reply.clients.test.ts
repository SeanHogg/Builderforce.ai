/**
 * What each client does with the chat events a run produces when it FAILED but said why as its reply, driven by the events the REAL
 * server handler broadcasts: the person sees the notice exactly once, and the portal records the text on the execution.
 */
import { describe, expect, it, vi } from "vitest";
import { BuilderforceRelayService } from "../infra/builderforce-relay.js";
import { createEventHandlers } from "../tui/tui-event-handlers.js";
import type { ChatEvent, TuiStateAccess } from "../tui/tui-types.js";
import { NOTICE, chatEventsFor } from "./chat-events.testkit.js";

const failedReply = [
  { stream: "assistant", data: { text: NOTICE } },
  { stream: "lifecycle", data: { phase: "error", error: NOTICE, runFailed: true } },
];

const count = (haystack: string[], needle: string): number => haystack.filter((line) => line.includes(needle)).length;

describe("the TUI", () => {
  function run(chat: Array<Record<string, unknown>>) {
    const state = {
      agentDefaultId: "main",
      sessionMainKey: "agent:main:main",
      sessionScope: "global",
      agents: [],
      currentAgentId: "main",
      currentSessionKey: "session-1",
      currentSessionId: "s",
      activeChatRunId: "client-1",
      historyLoaded: true,
      sessionInfo: {},
      initialSessionApplied: true,
      isConnected: true,
      autoMessageSent: false,
      toolsExpanded: false,
      showThinking: false,
      connectionStatus: "connected",
      activityStatus: "idle",
      statusTimeout: null,
      lastCtrlCAt: 0,
      loggingEnabled: false,
    } as unknown as TuiStateAccess;
    const shown: string[] = [];
    const chatLog = {
      startTool: vi.fn(),
      updateToolResult: vi.fn(),
      addSystem: vi.fn((text: string) => void shown.push(`system: ${text}`)),
      updateAssistant: vi.fn((text: string) => void shown.push(`assistant: ${text}`)),
      finalizeAssistant: vi.fn(),
      dropAssistant: vi.fn(),
    };
    const handlers = createEventHandlers({
      chatLog,
      tui: { requestRender: vi.fn() },
      state,
      setActivityStatus: vi.fn(),
      reportAction: vi.fn(),
      loadHistory: vi.fn(),
      isLocalRunId: () => true,
      forgetLocalRunId: vi.fn(),
      sendMessage: vi.fn(async () => {}),
    } as never);
    for (const evt of chat) handlers.handleChatEvent({ ...evt, runId: "client-1", sessionKey: "session-1" } as ChatEvent);
    return shown;
  }

  it("shows the notice exactly once: the streamed reply stays, and the error line does not repeat it", () => {
    const shown = run(chatEventsFor(failedReply) as never);

    expect(count(shown, NOTICE)).toBe(1);
    expect(shown.some((line) => line.startsWith("assistant:") && line.includes(NOTICE))).toBe(true);
    expect(shown).toContain("system: run failed");
  });

  it("an ordinary error still prints its message", () => {
    const shown = run(chatEventsFor([{ stream: "lifecycle", data: { phase: "error", error: "provider timeout" } }]) as never);

    expect(shown).toEqual(["system: run error: provider timeout", "system: exec: run error: provider timeout"]);
  });
});

describe("the portal relay", () => {
  function relay() {
    const instance = new BuilderforceRelayService({ baseUrl: "https://bf.test", agentNodeId: "7", apiKey: "k" });
    const internals = instance as unknown as {
      pendingExecutionId: number | null;
      sendToRelay: (frame: unknown) => void;
      reportExecutionState: (id: number, state: string, detail: Record<string, unknown>) => Promise<void>;
      handleGatewayEvent: (evt: { event: string; payload: unknown }) => void;
    };
    const frames: Array<Record<string, unknown>> = [];
    const reported: Array<[number, string, Record<string, unknown>]> = [];
    internals.sendToRelay = (frame) => void frames.push(frame as Record<string, unknown>);
    internals.reportExecutionState = async (id, state, detail) => void reported.push([id, state, detail]);
    internals.pendingExecutionId = 42;
    return { internals, frames, reported };
  }

  it("shows the notice once as the committed message, and records it on the failed execution", () => {
    const { internals, frames, reported } = relay();
    for (const payload of chatEventsFor(failedReply)) internals.handleGatewayEvent({ event: "chat", payload: { ...payload, sessionKey: "main" } });

    const committed = frames.filter((f) => f.type === "chat.message");
    expect(committed).toHaveLength(1);
    expect(String(committed[0]!.text)).toContain(NOTICE);
    expect(reported).toEqual([[42, "failed", { errorMessage: NOTICE }]]);
  });
});
