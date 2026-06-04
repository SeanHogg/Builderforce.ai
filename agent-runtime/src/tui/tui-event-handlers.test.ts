import { describe, expect, it, vi } from "vitest";
import { createEventHandlers } from "./tui-event-handlers.js";
import type { AgentEvent, ChatEvent, TuiStateAccess } from "./tui-types.js";

type MockFn = ReturnType<typeof vi.fn>;
type HandlerChatLog = {
  startTool: (...args: unknown[]) => void;
  updateToolResult: (...args: unknown[]) => void;
  addSystem: (...args: unknown[]) => void;
  updateAssistant: (...args: unknown[]) => void;
  finalizeAssistant: (...args: unknown[]) => void;
  dropAssistant: (...args: unknown[]) => void;
};
type HandlerTui = { requestRender: (...args: unknown[]) => void };
type MockChatLog = {
  startTool: MockFn;
  updateToolResult: MockFn;
  addSystem: MockFn;
  updateAssistant: MockFn;
  finalizeAssistant: MockFn;
  dropAssistant: MockFn;
};
type MockTui = { requestRender: MockFn };

describe("tui-event-handlers: handleAgentEvent", () => {
  const makeState = (overrides?: Partial<TuiStateAccess>): TuiStateAccess => ({
    agentDefaultId: "main",
    sessionMainKey: "agent:main:main",
    sessionScope: "global",
    agents: [],
    currentAgentId: "main",
    currentSessionKey: "agent:main:main",
    currentSessionId: "session-1",
    activeChatRunId: "run-1",
    historyLoaded: true,
    sessionInfo: { verboseLevel: "on" },
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
    ...overrides,
  });

  const makeContext = (state: TuiStateAccess) => {
    const chatLog = {
      startTool: vi.fn(),
      updateToolResult: vi.fn(),
      addSystem: vi.fn(),
      updateAssistant: vi.fn(),
      finalizeAssistant: vi.fn(),
      dropAssistant: vi.fn(),
    } as unknown as MockChatLog & HandlerChatLog;
    const tui = { requestRender: vi.fn() } as unknown as MockTui & HandlerTui;
    const setActivityStatus = vi.fn();
    const reportAction = vi.fn();
    const loadHistory = vi.fn();
    const localRunIds = new Set<string>();
    const noteLocalRunId = (runId: string) => {
      localRunIds.add(runId);
    };
    const forgetLocalRunId = (runId: string) => {
      localRunIds.delete(runId);
    };
    const isLocalRunId = (runId: string) => localRunIds.has(runId);
    const clearLocalRunIds = () => {
      localRunIds.clear();
    };

    return {
      chatLog,
      tui,
      state,
      setActivityStatus,
      reportAction,
      loadHistory,
      noteLocalRunId,
      forgetLocalRunId,
      isLocalRunId,
      clearLocalRunIds,
    };
  };

  const createHandlersHarness = (params?: {
    state?: Partial<TuiStateAccess>;
    chatLog?: HandlerChatLog;
  }) => {
    const state = makeState(params?.state);
    const context = makeContext(state);
    const chatLog = (params?.chatLog ?? context.chatLog) as MockChatLog & HandlerChatLog;
    const sendMessage = vi.fn(async (_: string) => {});
    const handlers = createEventHandlers({
      chatLog,
      tui: context.tui,
      state,
      setActivityStatus: context.setActivityStatus,
      reportAction: context.reportAction,
      loadHistory: context.loadHistory,
      isLocalRunId: context.isLocalRunId,
      forgetLocalRunId: context.forgetLocalRunId,
      sendMessage,
    });
    return {
      ...context,
      state,
      chatLog,
      sendMessage,
      ...handlers,
    };
  };

  it("processes tool events when runId matches activeChatRunId (even if sessionId differs)", () => {
    const { chatLog, tui, reportAction, handleAgentEvent } = createHandlersHarness({
      state: { currentSessionId: "session-xyz", activeChatRunId: "run-123" },
    });

    const evt: AgentEvent = {
      runId: "run-123",
      stream: "tool",
      data: {
        phase: "start",
        toolCallId: "tc1",
        name: "exec",
        args: { command: "echo hi" },
      },
    };

    handleAgentEvent(evt);

    expect(chatLog.startTool).toHaveBeenCalledWith("tc1", "exec", { command: "echo hi" });
    expect(reportAction).toHaveBeenCalledWith('Run "echo hi"');
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });

  it("formats grep and read tool actions in execution trace", () => {
    const { chatLog, reportAction, handleAgentEvent } = createHandlersHarness({
      state: { activeChatRunId: "run-ops" },
    });

    handleAgentEvent({
      runId: "run-ops",
      stream: "tool",
      data: {
        phase: "start",
        toolCallId: "tc-grep",
        name: "grep_search",
        args: { query: "auth choice", includePattern: "src/commands/**" },
      },
    });

    handleAgentEvent({
      runId: "run-ops",
      stream: "tool",
      data: {
        phase: "start",
        toolCallId: "tc-read",
        name: "read_file",
        args: { filePath: "src/tui/tui.ts", startLine: 340, endLine: 380 },
      },
    });

    expect(reportAction).toHaveBeenCalledWith('Grep "auth choice" in src/commands/**');
    expect(reportAction).toHaveBeenCalledWith("Read src/tui/tui.ts (340-380)");
    expect(chatLog.addSystem).toHaveBeenCalledWith('exec: Grep "auth choice" in src/commands/**');
    expect(chatLog.addSystem).toHaveBeenCalledWith("exec: Read src/tui/tui.ts (340-380)");
  });

  it("ignores tool events when runId does not match activeChatRunId", () => {
    const { chatLog, tui, handleAgentEvent } = createHandlersHarness({
      state: { activeChatRunId: "run-1" },
    });

    const evt: AgentEvent = {
      runId: "run-2",
      stream: "tool",
      data: { phase: "start", toolCallId: "tc1", name: "exec" },
    };

    handleAgentEvent(evt);

    expect(chatLog.startTool).not.toHaveBeenCalled();
    expect(chatLog.updateToolResult).not.toHaveBeenCalled();
    expect(tui.requestRender).not.toHaveBeenCalled();
  });

  it("processes lifecycle events when runId matches activeChatRunId", () => {
    const chatLog = {
      startTool: vi.fn(),
      updateToolResult: vi.fn(),
      addSystem: vi.fn(),
      updateAssistant: vi.fn(),
      finalizeAssistant: vi.fn(),
      dropAssistant: vi.fn(),
    } as unknown as HandlerChatLog;
    const { tui, setActivityStatus, reportAction, handleAgentEvent } = createHandlersHarness({
      state: { activeChatRunId: "run-9" },
      chatLog,
    });

    const evt: AgentEvent = {
      runId: "run-9",
      stream: "lifecycle",
      data: { phase: "start" },
    };

    handleAgentEvent(evt);

    expect(setActivityStatus).toHaveBeenCalledWith("running");
    expect(reportAction).toHaveBeenCalledWith("Thinking…");
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });

  it("keeps active run on lifecycle end while waiting for final chat event", () => {
    const { state, setActivityStatus, reportAction, loadHistory, handleAgentEvent } =
      createHandlersHarness({
        state: { activeChatRunId: "run-end" },
      });

    handleAgentEvent({
      runId: "run-end",
      stream: "lifecycle",
      data: { phase: "end" },
    });

    expect(setActivityStatus).toHaveBeenCalledWith("waiting");
    expect(reportAction).toHaveBeenCalledWith("Composing response…");
    expect(state.activeChatRunId).toBe("run-end");
    expect(loadHistory).not.toHaveBeenCalled();
  });

  it("includes lifecycle stop reason in composing trace", () => {
    const { reportAction, handleAgentEvent } = createHandlersHarness({
      state: { activeChatRunId: "run-stop" },
    });

    handleAgentEvent({
      runId: "run-stop",
      stream: "lifecycle",
      data: { phase: "end", stopReason: "max_output_tokens" },
    });

    expect(reportAction).toHaveBeenCalledWith(
      "Composing response… (stop reason: max_output_tokens)",
    );
  });

  it("falls back to idle when final chat event is not received", () => {
    vi.useFakeTimers();
    try {
      const { state, setActivityStatus, loadHistory, handleAgentEvent } = createHandlersHarness({
        state: { activeChatRunId: "run-timeout" },
      });

      handleAgentEvent({
        runId: "run-timeout",
        stream: "lifecycle",
        data: { phase: "end" },
      });

      expect(setActivityStatus).toHaveBeenCalledWith("waiting");
      expect(state.activeChatRunId).toBe("run-timeout");

      vi.advanceTimersByTime(3001);

      expect(setActivityStatus).toHaveBeenCalledWith("idle");
      expect(state.activeChatRunId).toBeNull();
      expect(loadHistory).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces lifecycle error details and clears active run", () => {
    const { state, chatLog, setActivityStatus, reportAction, loadHistory, handleAgentEvent } =
      createHandlersHarness({
        state: { activeChatRunId: "run-err" },
      });

    handleAgentEvent({
      runId: "run-err",
      stream: "lifecycle",
      data: { phase: "error", error: "No API key found for provider builderforcellm" },
    });

    expect(chatLog.addSystem).toHaveBeenCalledWith(
      "run error: No API key found for provider builderforcellm",
    );
    expect(setActivityStatus).toHaveBeenCalledWith("error");
    expect(reportAction).toHaveBeenCalledWith(
      "agent execution error: No API key found for provider builderforcellm",
    );
    expect(state.activeChatRunId).toBeNull();
    expect(loadHistory).toHaveBeenCalledTimes(1);
  });

  it("surfaces tool failure detail and carries it into empty final diagnostics", () => {
    const { state, chatLog, reportAction, handleAgentEvent, handleChatEvent } =
      createHandlersHarness({
        state: { activeChatRunId: "run-tool-fail" },
      });

    handleAgentEvent({
      runId: "run-tool-fail",
      stream: "tool",
      data: {
        phase: "result",
        toolCallId: "tc-fail",
        name: "edit",
        isError: true,
        result: { errorMessage: "validation failed: unmatched block" },
      },
    });

    handleAgentEvent({
      runId: "run-tool-fail",
      stream: "lifecycle",
      data: { phase: "end" },
    });

    handleChatEvent({
      runId: "run-tool-fail",
      sessionKey: state.currentSessionKey,
      state: "final",
    });

    expect(reportAction).toHaveBeenCalledWith(
      "Tool failed: edit — validation failed: unmatched block",
    );
    expect(reportAction).toHaveBeenCalledWith(
      "run completed with no final message (validation failed: unmatched block)",
    );
    expect(chatLog.addSystem).toHaveBeenCalledWith(
      "run ended with no output (validation failed: unmatched block)",
    );
  });

  it("captures runId from chat events when activeChatRunId is unset", () => {
    const { state, chatLog, handleChatEvent, handleAgentEvent } = createHandlersHarness({
      state: { activeChatRunId: null },
    });

    const chatEvt: ChatEvent = {
      runId: "run-42",
      sessionKey: state.currentSessionKey,
      state: "delta",
      message: { content: "hello" },
    };

    handleChatEvent(chatEvt);

    expect(state.activeChatRunId).toBe("run-42");

    const agentEvt: AgentEvent = {
      runId: "run-42",
      stream: "tool",
      data: { phase: "start", toolCallId: "tc1", name: "exec" },
    };

    handleAgentEvent(agentEvt);

    expect(chatLog.startTool).toHaveBeenCalledWith("tc1", "exec", undefined);
  });

  it("clears run mapping when the session changes", () => {
    const { state, chatLog, tui, handleChatEvent, handleAgentEvent } = createHandlersHarness({
      state: { activeChatRunId: null },
    });

    handleChatEvent({
      runId: "run-old",
      sessionKey: state.currentSessionKey,
      state: "delta",
      message: { content: "hello" },
    });

    state.currentSessionKey = "agent:main:other";
    state.activeChatRunId = null;
    tui.requestRender.mockClear();

    handleAgentEvent({
      runId: "run-old",
      stream: "tool",
      data: { phase: "start", toolCallId: "tc2", name: "exec" },
    });

    expect(chatLog.startTool).not.toHaveBeenCalled();
    expect(tui.requestRender).not.toHaveBeenCalled();
  });

  it("accepts tool events after chat final for the same run", () => {
    const { state, chatLog, tui, handleChatEvent, handleAgentEvent } = createHandlersHarness({
      state: { activeChatRunId: null },
    });

    handleChatEvent({
      runId: "run-final",
      sessionKey: state.currentSessionKey,
      state: "final",
      message: { content: [{ type: "text", text: "done" }] },
    });

    handleAgentEvent({
      runId: "run-final",
      stream: "tool",
      data: { phase: "start", toolCallId: "tc-final", name: "session_status" },
    });

    expect(chatLog.startTool).toHaveBeenCalledWith("tc-final", "session_status", undefined);
    expect(tui.requestRender).toHaveBeenCalled();
  });

  it("ignores lifecycle updates for non-active runs in the same session", () => {
    const { state, tui, setActivityStatus, handleChatEvent, handleAgentEvent } =
      createHandlersHarness({
        state: { activeChatRunId: "run-active" },
      });

    handleChatEvent({
      runId: "run-other",
      sessionKey: state.currentSessionKey,
      state: "delta",
      message: { content: "hello" },
    });
    setActivityStatus.mockClear();
    tui.requestRender.mockClear();

    handleAgentEvent({
      runId: "run-other",
      stream: "lifecycle",
      data: { phase: "end" },
    });

    expect(setActivityStatus).not.toHaveBeenCalled();
    expect(tui.requestRender).not.toHaveBeenCalled();
  });

  it("suppresses tool chat-log entries when verbose is off but still renders", () => {
    const { chatLog, tui, handleAgentEvent } = createHandlersHarness({
      state: {
        activeChatRunId: "run-123",
        sessionInfo: { verboseLevel: "off" },
      },
    });

    handleAgentEvent({
      runId: "run-123",
      stream: "tool",
      data: { phase: "start", toolCallId: "tc-off", name: "session_status" },
    });

    expect(chatLog.startTool).not.toHaveBeenCalled();
    // Still renders because tool activity is reported in the status trace
    expect(tui.requestRender).toHaveBeenCalledTimes(1);
  });

  it("omits tool output when verbose is on (non-full)", () => {
    const { chatLog, handleAgentEvent } = createHandlersHarness({
      state: {
        activeChatRunId: "run-123",
        sessionInfo: { verboseLevel: "on" },
      },
    });

    handleAgentEvent({
      runId: "run-123",
      stream: "tool",
      data: {
        phase: "update",
        toolCallId: "tc-on",
        name: "session_status",
        partialResult: { content: [{ type: "text", text: "secret" }] },
      },
    });

    handleAgentEvent({
      runId: "run-123",
      stream: "tool",
      data: {
        phase: "result",
        toolCallId: "tc-on",
        name: "session_status",
        result: { content: [{ type: "text", text: "secret" }] },
        isError: false,
      },
    });

    expect(chatLog.updateToolResult).toHaveBeenCalledTimes(1);
    expect(chatLog.updateToolResult).toHaveBeenCalledWith(
      "tc-on",
      { content: [] },
      { isError: false },
    );
  });

  it("refreshes history after a non-local chat final", () => {
    const { state, loadHistory, handleChatEvent } = createHandlersHarness({
      state: { activeChatRunId: null },
    });

    handleChatEvent({
      runId: "external-run",
      sessionKey: state.currentSessionKey,
      state: "final",
      message: { content: [{ type: "text", text: "done" }] },
    });

    expect(loadHistory).toHaveBeenCalledTimes(1);
  });

  it("accepts chat events for legacy main session aliases", () => {
    const { chatLog, handleChatEvent } = createHandlersHarness({
      state: {
        activeChatRunId: null,
        currentSessionKey: "agent:main:main",
        currentAgentId: "main",
      },
    });

    handleChatEvent({
      runId: "run-alias-main",
      sessionKey: "main",
      state: "final",
      message: { content: [{ type: "text", text: "main alias" }] },
    });

    handleChatEvent({
      runId: "run-alias-default",
      sessionKey: "default",
      state: "final",
      message: { content: [{ type: "text", text: "default alias" }] },
    });

    expect(chatLog.finalizeAssistant).toHaveBeenCalledWith("main alias", "run-alias-main");
    expect(chatLog.finalizeAssistant).toHaveBeenCalledWith("default alias", "run-alias-default");
  });

  it("ignores chat events from other agent sessions", () => {
    const { chatLog, handleChatEvent } = createHandlersHarness({
      state: {
        activeChatRunId: null,
        currentSessionKey: "agent:main:main",
        currentAgentId: "main",
      },
    });

    handleChatEvent({
      runId: "run-other-agent",
      sessionKey: "agent:ops:main",
      state: "final",
      message: { content: [{ type: "text", text: "should be ignored" }] },
    });

    expect(chatLog.finalizeAssistant).not.toHaveBeenCalledWith(
      "should be ignored",
      "run-other-agent",
    );
  });

  it("reports activity summary with unique files read on run completion", () => {
    const { state, reportAction, handleAgentEvent, handleChatEvent } = createHandlersHarness({
      state: { activeChatRunId: "run-summary" },
    });

    handleAgentEvent({
      runId: "run-summary",
      stream: "tool",
      data: {
        phase: "start",
        toolCallId: "tc-r1",
        name: "read",
        args: { path: "src/a.ts" },
      },
    });
    handleAgentEvent({
      runId: "run-summary",
      stream: "tool",
      data: {
        phase: "start",
        toolCallId: "tc-r2",
        name: "read",
        args: { file_path: "src/b.ts" },
      },
    });
    handleAgentEvent({
      runId: "run-summary",
      stream: "tool",
      data: {
        phase: "start",
        toolCallId: "tc-r3",
        name: "read",
        args: { path: "src/a.ts" },
      },
    });

    handleChatEvent({
      runId: "run-summary",
      sessionKey: state.currentSessionKey,
      state: "final",
      message: { content: [{ type: "text", text: "done" }] },
    });

    expect(reportAction).toHaveBeenCalledWith("✓ 2 files read");
    expect(reportAction).toHaveBeenCalledWith("run completed");
  });

  it("schedules session-info refresh backfill after final events", () => {
    vi.useFakeTimers();
    try {
      const state = makeState({ activeChatRunId: null });
      const context = makeContext(state);
      const refreshSessionInfo = vi.fn().mockResolvedValue(undefined);
      const { handleChatEvent } = createEventHandlers({
        chatLog: context.chatLog,
        tui: context.tui,
        state,
        setActivityStatus: context.setActivityStatus,
        loadHistory: context.loadHistory,
        refreshSessionInfo,
        isLocalRunId: context.isLocalRunId,
        forgetLocalRunId: context.forgetLocalRunId,
      });

      handleChatEvent({
        runId: "run-refresh",
        sessionKey: state.currentSessionKey,
        state: "final",
        message: { content: [{ type: "text", text: "done" }] },
      });

      expect(refreshSessionInfo).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(700);
      expect(refreshSessionInfo).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1500);
      expect(refreshSessionInfo).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  function createConcurrentRunHarness(localContent = "partial") {
    const { state, chatLog, setActivityStatus, loadHistory, handleChatEvent } =
      createHandlersHarness({
        state: { activeChatRunId: "run-active" },
      });

    handleChatEvent({
      runId: "run-active",
      sessionKey: state.currentSessionKey,
      state: "delta",
      message: { content: localContent },
    });

    return { state, chatLog, setActivityStatus, loadHistory, handleChatEvent };
  }

  it("does not reload history or clear active run when another run final arrives mid-stream", () => {
    const { state, chatLog, setActivityStatus, loadHistory, handleChatEvent } =
      createConcurrentRunHarness("partial");

    loadHistory.mockClear();
    setActivityStatus.mockClear();

    handleChatEvent({
      runId: "run-other",
      sessionKey: state.currentSessionKey,
      state: "final",
      message: { content: [{ type: "text", text: "other final" }] },
    });

    expect(loadHistory).not.toHaveBeenCalled();
    expect(state.activeChatRunId).toBe("run-active");
    expect(setActivityStatus).not.toHaveBeenCalledWith("idle");

    handleChatEvent({
      runId: "run-active",
      sessionKey: state.currentSessionKey,
      state: "delta",
      message: { content: "continued" },
    });

    expect(chatLog.updateAssistant).toHaveBeenLastCalledWith("continued", "run-active");
  });

  it("auto-continues when run contains only reads", async () => {
    const { sendMessage, handleAgentEvent } = createHandlersHarness({
      state: { activeChatRunId: "r1" },
    });

    // start a read tool event and then a lifecycle end
    handleAgentEvent({
      runId: "r1",
      stream: "tool",
      data: {
        phase: "start",
        toolCallId: "tc-read",
        name: "read",
        args: { filePath: "foo.txt" },
      },
    });
    handleAgentEvent({
      runId: "r1",
      stream: "lifecycle",
      data: { phase: "end" },
    });

    // sendMessage is invoked asynchronously; wait a tick to allow promise to fire
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith("continuing plan");
  });

  it("suppresses non-local empty final placeholders during concurrent runs", () => {
    const { state, chatLog, loadHistory, handleChatEvent } =
      createConcurrentRunHarness("local stream");

    loadHistory.mockClear();
    chatLog.finalizeAssistant.mockClear();
    chatLog.dropAssistant.mockClear();

    handleChatEvent({
      runId: "run-other",
      sessionKey: state.currentSessionKey,
      state: "final",
      message: { content: [] },
    });

    expect(chatLog.finalizeAssistant).not.toHaveBeenCalledWith("(no output)", "run-other");
    expect(chatLog.dropAssistant).toHaveBeenCalledWith("run-other");
    expect(loadHistory).not.toHaveBeenCalled();
    expect(state.activeChatRunId).toBe("run-active");
  });

  it("inserts a placeholder when chat final has no message", () => {
    const { state, chatLog, handleChatEvent } = createHandlersHarness({
      state: { activeChatRunId: null },
    });

    handleChatEvent({
      runId: "run-silent",
      sessionKey: state.currentSessionKey,
      state: "delta",
      message: { content: "hello" },
    });
    chatLog.dropAssistant.mockClear();
    chatLog.finalizeAssistant.mockClear();
    chatLog.addSystem.mockClear();

    handleChatEvent({
      runId: "run-silent",
      sessionKey: state.currentSessionKey,
      state: "final",
    });

    expect(chatLog.dropAssistant).toHaveBeenCalledWith("run-silent");
    expect(chatLog.finalizeAssistant).toHaveBeenCalledWith("(no output)", "run-silent");
    expect(chatLog.addSystem).toHaveBeenCalledWith("run ended with no output");
  });
});
