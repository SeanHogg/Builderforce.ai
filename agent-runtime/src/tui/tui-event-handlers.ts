import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";
import { asString, extractTextFromMessage, isCommandMessage } from "./tui-formatters.js";
import { TuiStreamAssembler } from "./tui-stream-assembler.js";
import type { AgentEvent, ChatEvent, TuiStateAccess } from "./tui-types.js";

type EventHandlerChatLog = {
  addUser?: (text: string) => void;
  startTool: (toolCallId: string, toolName: string, args: unknown) => void;
  updateToolResult: (
    toolCallId: string,
    result: unknown,
    options?: { partial?: boolean; isError?: boolean },
  ) => void;
  addSystem: (text: string) => void;
  updateAssistant: (text: string, runId: string) => void;
  finalizeAssistant: (text: string, runId: string) => void;
  dropAssistant: (runId: string) => void;
};

type EventHandlerTui = {
  requestRender: () => void;
};

type EventHandlerContext = {
  chatLog: EventHandlerChatLog;
  tui: EventHandlerTui;
  state: TuiStateAccess;
  setActivityStatus: (text: string) => void;
  reportAction?: (text: string) => void;
  refreshSessionInfo?: () => Promise<void>;
  loadHistory?: () => Promise<void>;
  isLocalRunId?: (runId: string) => boolean;
  forgetLocalRunId?: (runId: string) => void;
  clearLocalRunIds?: () => void;
  // callback the UI can provide to send a fresh chat message; used to
  // automatically continue after a read-only run
  sendMessage?: (text: string) => Promise<void>;
};

type RunActivityStats = {
  toolStarts: number;
  toolFailures: number;
  readFiles: Set<string>;
  editFiles: Set<string>;
  writeFiles: Set<string>;
  applyPatchCalls: number;
  execCalls: number;
};

type RunTerminationContext = {
  stopReason?: string;
  errorMessage?: string;
  lastToolFailure?: string;
};

const TOOL_NAME_ALIASES: Record<string, string> = {
  str_replace_editor: "edit",
  replace_editor: "edit",
};

function normalizeToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

function extractPathArg(args: unknown): string | null {
  if (!args || typeof args !== "object") {
    return null;
  }
  const record = args as Record<string, unknown>;
  const candidates = [
    record.path,
    record.file_path,
    record.filePath,
    record.filepath,
    record.relative_path,
    record.filename,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function getStringArg(args: unknown, keys: string[]): string | null {
  const record = asRecord(args);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function shortenText(value: string, max = 60): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(1, max - 1))}…`;
}

function shortenPath(path: string): string {
  const cleaned = path.replace(/\\/g, "/");
  const segments = cleaned.split("/").filter(Boolean);
  if (segments.length <= 3) {
    return cleaned;
  }
  return `…/${segments.slice(-3).join("/")}`;
}

function formatReadRange(args: unknown): string {
  const record = asRecord(args);
  if (!record) {
    return "";
  }
  const start = record.startLine;
  const end = record.endLine;
  if (typeof start === "number" && typeof end === "number") {
    return ` (${start}-${end})`;
  }
  if (typeof start === "number") {
    return ` (${start}+)`;
  }
  return "";
}

function formatToolAction(toolName: string, args: unknown): string {
  const normalizedToolName = normalizeToolName(toolName);
  const pathArg = extractPathArg(args);
  if (normalizedToolName === "grep_search") {
    const query = getStringArg(args, ["query"]);
    const scope = getStringArg(args, ["includePattern"]);
    const queryPart = query ? ` "${shortenText(query, 44)}"` : "";
    const scopePart = scope ? ` in ${shortenPath(scope)}` : "";
    return `Grep${queryPart}${scopePart}`;
  }
  if (normalizedToolName === "file_search") {
    const query = getStringArg(args, ["query"]);
    return query ? `Find files "${shortenText(query, 48)}"` : "Find files";
  }
  if (normalizedToolName === "read" || normalizedToolName === "read_file") {
    if (pathArg) {
      return `Read ${shortenPath(pathArg)}${formatReadRange(args)}`;
    }
    return "Read file";
  }
  if (normalizedToolName === "edit" || normalizedToolName === "str_replace_editor") {
    return pathArg ? `Edit ${shortenPath(pathArg)}` : "Edit file";
  }
  if (normalizedToolName === "write") {
    return pathArg ? `Write ${shortenPath(pathArg)}` : "Write file";
  }
  if (normalizedToolName === "apply_patch") {
    return "Apply patch";
  }
  if (normalizedToolName === "exec" || normalizedToolName === "run_in_terminal") {
    const command = getStringArg(args, ["command"]);
    return command ? `Run "${shortenText(command, 52)}"` : "Run command";
  }
  if (normalizedToolName === "search_subagent" || normalizedToolName === "semantic_search") {
    const query = getStringArg(args, ["query"]);
    return query ? `Search "${shortenText(query, 48)}"` : "Search workspace";
  }
  return `Use ${toolName}`;
}

function formatCount(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function sanitizeReasonText(value: string, max = 140): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "";
  }
  if (collapsed.length <= max) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(1, max - 1))}…`;
}

function extractErrorSummary(value: unknown): string {
  if (typeof value === "string") {
    return sanitizeReasonText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const keys = [
    "errorMessage",
    "error",
    "message",
    "detail",
    "reason",
    "stderr",
    "text",
    "summary",
  ];

  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      const text = sanitizeReasonText(candidate);
      if (text) {
        return text;
      }
    }
    if (candidate && typeof candidate === "object") {
      const nested = extractErrorSummary(candidate);
      if (nested) {
        return nested;
      }
    }
  }

  const content = record.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const text = extractErrorSummary(block);
      if (text) {
        return text;
      }
    }
  }

  return "";
}

function extractStopReason(data: unknown): string {
  const record = asRecord(data);
  if (!record) {
    return "";
  }
  const keys = ["stopReason", "reason", "finishReason", "status", "outcome"];
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      const text = sanitizeReasonText(candidate, 80);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

export function createEventHandlers(context: EventHandlerContext) {
  const {
    chatLog,
    tui,
    state,
    setActivityStatus,
    reportAction,
    refreshSessionInfo,
    loadHistory,
    isLocalRunId,
    forgetLocalRunId,
    clearLocalRunIds,
  } = context;
  const finalizedRuns = new Map<string, number>();
  const sessionRuns = new Map<string, number>();
  const runActivity = new Map<string, RunActivityStats>();
  const runTermination = new Map<string, RunTerminationContext>();
  const pendingFinalTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  const FINAL_EVENT_GRACE_MS = 3_000;
  const SESSION_REFRESH_BACKFILL_DELAY_MS = 1_500;
  const SESSION_REFRESH_MIN_INTERVAL_MS = 2_500;
  let pendingSessionRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSessionRefreshRequestedAt = 0;
  let streamAssembler = new TuiStreamAssembler();
  let lastSessionKey = state.currentSessionKey;

  const normalizeLegacySessionAlias = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (normalized === "default") {
      return "main";
    }
    return normalized;
  };

  const sessionsMatch = (incoming: string | undefined, current: string): boolean => {
    const incomingRaw = normalizeLegacySessionAlias(incoming ?? "");
    const currentRaw = normalizeLegacySessionAlias(current);
    if (!incomingRaw || !currentRaw) {
      return false;
    }
    if (incomingRaw === currentRaw) {
      return true;
    }

    const incomingParsed = parseAgentSessionKey(incomingRaw);
    const currentParsed = parseAgentSessionKey(currentRaw);
    const currentAgent = normalizeAgentId(state.currentAgentId);

    if (incomingParsed && currentParsed) {
      return (
        normalizeAgentId(incomingParsed.agentId) === normalizeAgentId(currentParsed.agentId) &&
        normalizeLegacySessionAlias(incomingParsed.rest) ===
          normalizeLegacySessionAlias(currentParsed.rest)
      );
    }

    if (incomingParsed && !currentParsed) {
      return (
        normalizeAgentId(incomingParsed.agentId) === currentAgent &&
        normalizeLegacySessionAlias(incomingParsed.rest) === currentRaw
      );
    }

    if (!incomingParsed && currentParsed) {
      return (
        normalizeAgentId(currentParsed.agentId) === currentAgent &&
        incomingRaw === normalizeLegacySessionAlias(currentParsed.rest)
      );
    }

    return false;
  };

  const clearPendingFinalTimeout = (runId: string) => {
    const timer = pendingFinalTimeouts.get(runId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    pendingFinalTimeouts.delete(runId);
  };

  const clearAllPendingFinalTimeouts = () => {
    for (const timer of pendingFinalTimeouts.values()) {
      clearTimeout(timer);
    }
    pendingFinalTimeouts.clear();
  };

  const getRunActivity = (runId: string): RunActivityStats => {
    const existing = runActivity.get(runId);
    if (existing) {
      return existing;
    }
    const created: RunActivityStats = {
      toolStarts: 0,
      toolFailures: 0,
      readFiles: new Set<string>(),
      editFiles: new Set<string>(),
      writeFiles: new Set<string>(),
      applyPatchCalls: 0,
      execCalls: 0,
    };
    runActivity.set(runId, created);
    return created;
  };

  const clearRunActivity = (runId: string) => {
    runActivity.delete(runId);
  };

  const getRunTermination = (runId: string): RunTerminationContext => {
    const existing = runTermination.get(runId);
    if (existing) {
      return existing;
    }
    const created: RunTerminationContext = {};
    runTermination.set(runId, created);
    return created;
  };

  const clearRunTermination = (runId: string) => {
    runTermination.delete(runId);
  };

  const emitExecutionAction = (text: string) => {
    const message = text.trim();
    if (!message) {
      return;
    }
    reportAction?.(message);
    chatLog.addSystem(`exec: ${message}`);
  };

  const reportRunActivitySummary = (runId: string) => {
    const stats = runActivity.get(runId);
    if (!stats) {
      return;
    }

    const parts: string[] = [];
    if (stats.readFiles.size > 0) {
      parts.push(formatCount(stats.readFiles.size, "file read", "files read"));
    }
    if (stats.editFiles.size > 0) {
      parts.push(formatCount(stats.editFiles.size, "file edited", "files edited"));
    }
    if (stats.writeFiles.size > 0) {
      parts.push(formatCount(stats.writeFiles.size, "file written", "files written"));
    }
    if (stats.applyPatchCalls > 0) {
      parts.push(formatCount(stats.applyPatchCalls, "patch applied", "patches applied"));
    }
    if (stats.execCalls > 0) {
      parts.push(formatCount(stats.execCalls, "command run", "commands run"));
    }
    if (parts.length === 0) {
      parts.push(formatCount(stats.toolStarts, "tool call", "tool calls"));
    }
    if (stats.toolFailures > 0) {
      parts.push(formatCount(stats.toolFailures, "tool failure", "tool failures"));
    }

    emitExecutionAction(`✓ ${parts.join(" · ")}`);

    // if the run read any files, prompt the agent to continue planning. this
    // ensures we don't stop prematurely right after memory/config reads.
    if (stats.readFiles.size > 0 && context.sendMessage) {
      void context.sendMessage("continuing plan").catch(() => {});
    }

    clearRunActivity(runId);
  };

  const clearPendingSessionRefreshTimer = () => {
    if (!pendingSessionRefreshTimer) {
      return;
    }
    clearTimeout(pendingSessionRefreshTimer);
    pendingSessionRefreshTimer = null;
  };

  const scheduleSessionInfoRefresh = () => {
    if (!refreshSessionInfo) {
      return;
    }
    const now = Date.now();
    if (now - lastSessionRefreshRequestedAt < SESSION_REFRESH_MIN_INTERVAL_MS) {
      return;
    }
    lastSessionRefreshRequestedAt = now;
    void refreshSessionInfo();
    clearPendingSessionRefreshTimer();
    const shouldBackfill =
      typeof state.sessionInfo.totalTokens !== "number" || state.sessionInfo.totalTokens <= 0;
    if (!shouldBackfill) {
      return;
    }
    pendingSessionRefreshTimer = setTimeout(() => {
      pendingSessionRefreshTimer = null;
      if (typeof state.sessionInfo.totalTokens === "number" && state.sessionInfo.totalTokens > 0) {
        return;
      }
      lastSessionRefreshRequestedAt = Date.now();
      void refreshSessionInfo();
    }, SESSION_REFRESH_BACKFILL_DELAY_MS);
    pendingSessionRefreshTimer.unref?.();
  };

  const scheduleFinalEventTimeout = (runId: string) => {
    clearPendingFinalTimeout(runId);
    const timer = setTimeout(() => {
      pendingFinalTimeouts.delete(runId);
      if (finalizedRuns.has(runId)) {
        return;
      }
      if (state.activeChatRunId !== runId) {
        return;
      }
      sessionRuns.delete(runId);
      reportRunActivitySummary(runId);
      clearActiveRunIfMatch(runId);
      maybeRefreshHistoryForRun(runId);
      setActivityStatus("idle");
      const context = runTermination.get(runId);
      const reason = context?.errorMessage || context?.lastToolFailure || context?.stopReason || "";
      if (reason) {
        emitExecutionAction(`run settled to idle (final event not received: ${reason})`);
      } else {
        emitExecutionAction("run settled to idle (final event not received)");
      }
      clearRunTermination(runId);
      tui.requestRender();
    }, FINAL_EVENT_GRACE_MS);
    timer.unref?.();
    pendingFinalTimeouts.set(runId, timer);
  };

  const pruneRunMap = (runs: Map<string, number>) => {
    if (runs.size <= 200) {
      return;
    }
    const keepUntil = Date.now() - 10 * 60 * 1000;
    for (const [key, ts] of runs) {
      if (runs.size <= 150) {
        break;
      }
      if (ts < keepUntil) {
        runs.delete(key);
      }
    }
    if (runs.size > 200) {
      for (const key of runs.keys()) {
        runs.delete(key);
        if (runs.size <= 150) {
          break;
        }
      }
    }
  };

  const syncSessionKey = () => {
    if (state.currentSessionKey === lastSessionKey) {
      return;
    }
    lastSessionKey = state.currentSessionKey;
    finalizedRuns.clear();
    sessionRuns.clear();
    clearAllPendingFinalTimeouts();
    clearPendingSessionRefreshTimer();
    runActivity.clear();
    runTermination.clear();
    streamAssembler = new TuiStreamAssembler();
    clearLocalRunIds?.();
  };

  const noteSessionRun = (runId: string) => {
    sessionRuns.set(runId, Date.now());
    pruneRunMap(sessionRuns);
  };

  const noteFinalizedRun = (runId: string) => {
    clearPendingFinalTimeout(runId);
    finalizedRuns.set(runId, Date.now());
    sessionRuns.delete(runId);
    streamAssembler.drop(runId);
    clearRunActivity(runId);
    clearRunTermination(runId);
    pruneRunMap(finalizedRuns);
  };

  const clearActiveRunIfMatch = (runId: string) => {
    if (state.activeChatRunId === runId) {
      state.activeChatRunId = null;
    }
  };

  const hasConcurrentActiveRun = (runId: string) => {
    const activeRunId = state.activeChatRunId;
    if (!activeRunId || activeRunId === runId) {
      return false;
    }
    return sessionRuns.has(activeRunId);
  };

  const maybeRefreshHistoryForRun = (runId: string) => {
    if (isLocalRunId?.(runId)) {
      forgetLocalRunId?.(runId);
      return;
    }
    if (hasConcurrentActiveRun(runId)) {
      return;
    }
    void loadHistory?.();
  };

  const handleChatEvent = (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const evt = payload as ChatEvent;
    syncSessionKey();
    if (!sessionsMatch(evt.sessionKey, state.currentSessionKey)) {
      return;
    }
    if (finalizedRuns.has(evt.runId)) {
      if (evt.state === "delta") {
        return;
      }
      if (evt.state === "final") {
        return;
      }
    }
    const wasKnownRun = sessionRuns.has(evt.runId);
    noteSessionRun(evt.runId);
    if (!state.activeChatRunId) {
      state.activeChatRunId = evt.runId;
    }
    if (!wasKnownRun && evt.state === "delta") {
      emitExecutionAction("run started");
    }
    if (evt.state === "delta") {
      clearPendingFinalTimeout(evt.runId);
      const displayText = streamAssembler.ingestDelta(evt.runId, evt.message, state.showThinking);
      if (!displayText) {
        return;
      }
      chatLog.updateAssistant(displayText, evt.runId);
      setActivityStatus("streaming");
    }
    if (evt.state === "final") {
      const wasActiveRun = state.activeChatRunId === evt.runId;
      const termination = getRunTermination(evt.runId);
      const role =
        evt.message && typeof evt.message === "object" && !Array.isArray(evt.message)
          ? typeof (evt.message as Record<string, unknown>).role === "string"
            ? String((evt.message as Record<string, unknown>).role)
            : ""
          : "";

      if (role === "user") {
        const text = extractTextFromMessage(evt.message);
        // Only render user messages that originate from OTHER clients (e.g.
        // relay, history replay).  Messages sent by THIS TUI were already
        // rendered in sendMessage(); rendering again would duplicate them.
        if (text && !isLocalRunId?.(evt.runId)) {
          chatLog.addUser?.(text);
        }
        noteFinalizedRun(evt.runId);
        clearActiveRunIfMatch(evt.runId);
        if (wasActiveRun) {
          setActivityStatus("idle");
        }
        scheduleSessionInfoRefresh();
        tui.requestRender();
        return;
      }

      if (!evt.message) {
        maybeRefreshHistoryForRun(evt.runId);
        chatLog.dropAssistant(evt.runId);
        // show user something so the conversation doesn't freeze
        const reason =
          termination.errorMessage || termination.lastToolFailure || termination.stopReason || "";
        const systemMsg = reason
          ? `run ended with no output (${reason})`
          : "run ended with no output";
        // add both system note and a lightweight assistant placeholder
        chatLog.addSystem(systemMsg);
        chatLog.finalizeAssistant(reason ? `(no output; ${reason})` : "(no output)", evt.runId);

        reportRunActivitySummary(evt.runId);
        noteFinalizedRun(evt.runId);
        clearActiveRunIfMatch(evt.runId);
        if (wasActiveRun) {
          setActivityStatus("idle");
        }
        if (reason) {
          emitExecutionAction(`run completed with no final message (${reason})`);
        } else {
          emitExecutionAction("run completed with no final message");
        }
        scheduleSessionInfoRefresh();
        tui.requestRender();
        return;
      }
      if (isCommandMessage(evt.message)) {
        maybeRefreshHistoryForRun(evt.runId);
        const text = extractTextFromMessage(evt.message);
        if (text) {
          chatLog.addSystem(text);
        }
        streamAssembler.drop(evt.runId);
        reportRunActivitySummary(evt.runId);
        noteFinalizedRun(evt.runId);
        clearActiveRunIfMatch(evt.runId);
        if (wasActiveRun) {
          setActivityStatus("idle");
        }
        const reason = termination.stopReason || "";
        emitExecutionAction(reason ? `run completed (stop reason: ${reason})` : "run completed");
        scheduleSessionInfoRefresh();
        tui.requestRender();
        return;
      }
      maybeRefreshHistoryForRun(evt.runId);
      const stopReason =
        evt.message && typeof evt.message === "object" && !Array.isArray(evt.message)
          ? typeof (evt.message as Record<string, unknown>).stopReason === "string"
            ? ((evt.message as Record<string, unknown>).stopReason as string)
            : ""
          : "";

      const finalText = streamAssembler.finalize(evt.runId, evt.message, state.showThinking);
      const suppressEmptyExternalPlaceholder =
        finalText === "(no output)" && !isLocalRunId?.(evt.runId);
      if (suppressEmptyExternalPlaceholder) {
        chatLog.dropAssistant(evt.runId);
      } else {
        chatLog.finalizeAssistant(finalText, evt.runId);
      }
      reportRunActivitySummary(evt.runId);
      noteFinalizedRun(evt.runId);
      clearActiveRunIfMatch(evt.runId);
      if (wasActiveRun) {
        setActivityStatus(stopReason === "error" ? "error" : "idle");
      }
      const messageError =
        evt.message && typeof evt.message === "object" && !Array.isArray(evt.message)
          ? sanitizeReasonText(asString((evt.message as Record<string, unknown>).errorMessage, ""))
          : "";
      if (stopReason === "error") {
        const detail =
          messageError || termination.errorMessage || termination.lastToolFailure || "";
        emitExecutionAction(detail ? `run ended with error: ${detail}` : "run ended with error");
      } else if (stopReason && stopReason !== "stop") {
        emitExecutionAction(`run completed (stop reason: ${stopReason})`);
      } else {
        emitExecutionAction("run completed");
      }
      // Refresh session info to update token counts in footer
      scheduleSessionInfoRefresh();
    }
    if (evt.state === "aborted") {
      clearPendingFinalTimeout(evt.runId);
      const wasActiveRun = state.activeChatRunId === evt.runId;
      chatLog.addSystem("run aborted");
      streamAssembler.drop(evt.runId);
      reportRunActivitySummary(evt.runId);
      sessionRuns.delete(evt.runId);
      clearActiveRunIfMatch(evt.runId);
      if (wasActiveRun) {
        setActivityStatus("aborted");
      }
      const reason = getRunTermination(evt.runId).stopReason;
      emitExecutionAction(reason ? `run aborted (${reason})` : "run aborted");
      scheduleSessionInfoRefresh();
      maybeRefreshHistoryForRun(evt.runId);
    }
    if (evt.state === "error") {
      clearPendingFinalTimeout(evt.runId);
      const wasActiveRun = state.activeChatRunId === evt.runId;
      chatLog.addSystem(`run error: ${evt.errorMessage ?? "unknown"}`);
      streamAssembler.drop(evt.runId);
      reportRunActivitySummary(evt.runId);
      sessionRuns.delete(evt.runId);
      clearActiveRunIfMatch(evt.runId);
      if (wasActiveRun) {
        setActivityStatus("error");
      }
      const errorMessage = sanitizeReasonText(evt.errorMessage ?? "");
      emitExecutionAction(errorMessage ? `run error: ${errorMessage}` : "run error");
      scheduleSessionInfoRefresh();
      maybeRefreshHistoryForRun(evt.runId);
    }
    tui.requestRender();
  };

  const handleAgentEvent = (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const evt = payload as AgentEvent;
    syncSessionKey();
    // Agent events (tool streaming, lifecycle) are emitted per-run. Filter against the
    // active chat run id, not the session id. Tool results can arrive after the chat
    // final event, so accept finalized runs for tool updates.
    // Ensure we always have a stats object for the run as soon as it starts so we can
    // emit an activity summary even if no tools are invoked.
    if (
      evt.stream === "lifecycle" &&
      evt.data &&
      (evt.data as { phase?: string }).phase === "start"
    ) {
      getRunActivity(evt.runId);
    }
    const isActiveRun = evt.runId === state.activeChatRunId;
    const isKnownRun = isActiveRun || sessionRuns.has(evt.runId) || finalizedRuns.has(evt.runId);
    if (!isKnownRun) {
      return;
    }
    if (evt.stream === "tool") {
      // ensure we have a stats object even if no tool starts yet (shouldn't
      // happen since this is a tool event, but keep consistent)
      getRunActivity(evt.runId);
      const verbose = state.sessionInfo.verboseLevel ?? "off";
      const allowToolEvents = verbose !== "off";
      const allowToolOutput = verbose === "full";
      const data = evt.data ?? {};
      const phase = asString(data.phase, "");
      const toolCallId = asString(data.toolCallId, "");
      const toolName = asString(data.name, "tool");
      const normalizedToolName = normalizeToolName(toolName);
      if (!toolCallId) {
        return;
      }
      // Always report tool activity in the trace, regardless of verbose level
      if (phase === "start") {
        emitExecutionAction(formatToolAction(toolName, data.args));
        const stats = getRunActivity(evt.runId);
        stats.toolStarts += 1;
        const toolPath = extractPathArg(data.args);
        if (normalizedToolName === "read" && toolPath) {
          stats.readFiles.add(toolPath);
        } else if (normalizedToolName === "edit" && toolPath) {
          stats.editFiles.add(toolPath);
        } else if (normalizedToolName === "write" && toolPath) {
          stats.writeFiles.add(toolPath);
        } else if (normalizedToolName === "apply_patch") {
          stats.applyPatchCalls += 1;
        } else if (normalizedToolName === "exec") {
          stats.execCalls += 1;
        }
      } else if (phase === "result" && Boolean(data.isError)) {
        const detail =
          extractErrorSummary(data.result) ||
          extractErrorSummary(data.error) ||
          extractErrorSummary(data.partialResult) ||
          extractErrorSummary(data);
        emitExecutionAction(
          detail ? `Tool failed: ${toolName} — ${detail}` : `Tool failed: ${toolName}`,
        );
        const stats = getRunActivity(evt.runId);
        stats.toolFailures += 1;
        const termination = getRunTermination(evt.runId);
        termination.lastToolFailure = detail || termination.lastToolFailure;
      }
      if (!allowToolEvents) {
        tui.requestRender();
        return;
      }
      if (phase === "start") {
        chatLog.startTool(toolCallId, toolName, data.args);
      } else if (phase === "update") {
        if (!allowToolOutput) {
          tui.requestRender();
          return;
        }
        chatLog.updateToolResult(toolCallId, data.partialResult, {
          partial: true,
        });
      } else if (phase === "result") {
        if (allowToolOutput) {
          chatLog.updateToolResult(toolCallId, data.result, {
            isError: Boolean(data.isError),
          });
        } else {
          chatLog.updateToolResult(toolCallId, { content: [] }, { isError: Boolean(data.isError) });
        }
      }
      tui.requestRender();
      return;
    }
    if (evt.stream === "lifecycle") {
      if (!isActiveRun) {
        return;
      }
      const phase = typeof evt.data?.phase === "string" ? evt.data.phase : "";
      if (phase === "start") {
        setActivityStatus("running");
        emitExecutionAction("Thinking…");
      }
      if (phase === "end") {
        setActivityStatus("waiting");
        const stopReason = extractStopReason(evt.data);
        if (stopReason) {
          getRunTermination(evt.runId).stopReason = stopReason;
        }
        emitExecutionAction(
          stopReason ? `Composing response… (stop reason: ${stopReason})` : "Composing response…",
        );
        // emit activity summary immediately on lifecycle end as well as on chat
        // final to ensure we report statistics even if a chat event never arrives.
        reportRunActivitySummary(evt.runId);
        scheduleFinalEventTimeout(evt.runId);
      }
      if (phase === "error") {
        const errorMessage =
          asString(evt.data?.error, "") ||
          asString(evt.data?.errorMessage, "") ||
          asString(evt.data?.message, "") ||
          asString(evt.data?.detail, "") ||
          "unknown";
        const termination = getRunTermination(evt.runId);
        termination.errorMessage = sanitizeReasonText(errorMessage);
        termination.stopReason = termination.stopReason || "error";
        chatLog.addSystem(`run error: ${errorMessage}`);
        reportRunActivitySummary(evt.runId);
        noteFinalizedRun(evt.runId);
        clearActiveRunIfMatch(evt.runId);
        maybeRefreshHistoryForRun(evt.runId);
        scheduleSessionInfoRefresh();
        setActivityStatus("error");
        emitExecutionAction(`agent execution error: ${termination.errorMessage || "unknown"}`);
      }
      tui.requestRender();
    }
  };

  return { handleChatEvent, handleAgentEvent };
}
