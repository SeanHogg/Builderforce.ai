import { buildAgentMainSessionKey } from "../routing/session-key.js";

export type TuiOptions = {
  url?: string;
  token?: string;
  password?: string;
  session?: string;
  deliver?: boolean;
  thinking?: string;
  timeoutMs?: number;
  historyLimit?: number;
  message?: string;
};

export type ChatEvent = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
  /** The error's text was already streamed as the run's reply (a run that failed and said why): do not print it again as an error. */
  replyStreamed?: boolean;
};

export type AgentEvent = {
  runId: string;
  stream: string;
  data?: Record<string, unknown>;
};

export type SessionInfo = {
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  model?: string;
  modelProvider?: string;
  contextTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  responseUsage?: "on" | "off" | "tokens" | "full";
  updatedAt?: number | null;
  displayName?: string;
};

export type SessionScope = "per-sender" | "global";

export type AgentSummary = {
  id: string;
  name?: string;
};

export type GatewayStatusSummary = {
  linkChannel?: {
    id?: string;
    label?: string;
    linked?: boolean;
    authAgeMs?: number | null;
  };
  heartbeat?: {
    defaultAgentId?: string;
    agents?: Array<{
      agentId?: string;
      enabled?: boolean;
      every?: string;
      everyMs?: number | null;
    }>;
  };
  providerSummary?: string[];
  queuedSystemEvents?: string[];
  sessions?: {
    paths?: string[];
    count?: number;
    defaults?: { model?: string | null; contextTokens?: number | null };
    recent?: Array<{
      agentId?: string;
      key: string;
      kind?: string;
      updatedAt?: number | null;
      age?: number | null;
      model?: string | null;
      totalTokens?: number | null;
      contextTokens?: number | null;
      remainingTokens?: number | null;
      percentUsed?: number | null;
      flags?: string[];
    }>;
  };
};

export type TuiStateAccess = {
  agentDefaultId: string;
  sessionMainKey: string;
  sessionScope: SessionScope;
  agents: AgentSummary[];
  currentAgentId: string;
  currentSessionKey: string;
  currentSessionId: string | null;
  activeChatRunId: string | null;
  historyLoaded: boolean;
  sessionInfo: SessionInfo;
  initialSessionApplied: boolean;
  isConnected: boolean;
  autoMessageSent: boolean;
  toolsExpanded: boolean;
  showThinking: boolean;
  connectionStatus: string;
  activityStatus: string;
  statusTimeout: ReturnType<typeof setTimeout> | null;
  lastCtrlCAt: number;
  /** whether the gateway is currently configured to write a file log */
  loggingEnabled: boolean;
};

/**
 * Routes an editor submission: trims it, clears the buffer, and dispatches to the
 * bang line (bash mode), slash-command handler, or message sender. Pure logic the
 * TUI wires to whatever editor the active renderer provides.
 */
export function createEditorSubmitHandler(params: {
  editor: {
    setText: (value: string) => void;
    addToHistory: (value: string) => void;
  };
  handleCommand: (value: string) => Promise<void> | void;
  sendMessage: (value: string) => Promise<void> | void;
  handleBangLine: (value: string) => Promise<void> | void;
}) {
  return (text: string) => {
    const raw = text;
    const value = raw.trim();
    params.editor.setText("");

    // Keep previous behavior: ignore empty/whitespace-only submissions.
    if (!value) {
      return;
    }

    // Bash mode: only if the very first character is '!' and it's not just '!'.
    // IMPORTANT: use the raw (untrimmed) text so leading spaces do NOT trigger.
    // Per requirement: a lone '!' should be treated as a normal message.
    if (raw.startsWith("!") && raw !== "!") {
      params.editor.addToHistory(raw);
      void params.handleBangLine(raw);
      return;
    }

    // Enable built-in editor prompt history navigation (up/down).
    params.editor.addToHistory(value);

    if (value.startsWith("/")) {
      void params.handleCommand(value);
      return;
    }

    void params.sendMessage(value);
  };
}

export function shouldEnableWindowsGitBashPasteFallback(params?: {
  platform?: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const platform = params?.platform ?? process.platform;
  if (platform !== "win32") {
    return false;
  }
  const env = params?.env ?? process.env;
  const msystem = (env.MSYSTEM ?? "").toUpperCase();
  const shell = env.SHELL ?? "";
  const termProgram = (env.TERM_PROGRAM ?? "").toLowerCase();
  if (msystem.startsWith("MINGW") || msystem.startsWith("MSYS")) {
    return true;
  }
  if (shell.toLowerCase().includes("bash")) {
    return true;
  }
  return termProgram.includes("mintty");
}

/**
 * Coalesces rapid successive single-line submits (a paste burst) into one multiline
 * submit once the burst window elapses. Passed through immediately when disabled.
 */
export function createSubmitBurstCoalescer(params: {
  submit: (value: string) => void;
  enabled: boolean;
  burstWindowMs?: number;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}) {
  const windowMs = Math.max(1, params.burstWindowMs ?? 50);
  const now = params.now ?? (() => Date.now());
  const setTimer = params.setTimer ?? setTimeout;
  const clearTimer = params.clearTimer ?? clearTimeout;
  let pending: string | null = null;
  let pendingAt = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const clearFlushTimer = () => {
    if (!flushTimer) {
      return;
    }
    clearTimer(flushTimer);
    flushTimer = null;
  };

  const flushPending = () => {
    if (pending === null) {
      return;
    }
    const value = pending;
    pending = null;
    pendingAt = 0;
    clearFlushTimer();
    params.submit(value);
  };

  const scheduleFlush = () => {
    clearFlushTimer();
    flushTimer = setTimer(() => {
      flushPending();
    }, windowMs);
  };

  return (value: string) => {
    if (!params.enabled) {
      params.submit(value);
      return;
    }
    if (value.includes("\n")) {
      flushPending();
      params.submit(value);
      return;
    }
    const ts = now();
    if (pending === null) {
      pending = value;
      pendingAt = ts;
      scheduleFlush();
      return;
    }
    if (ts - pendingAt <= windowMs) {
      pending = `${pending}\n${value}`;
      pendingAt = ts;
      scheduleFlush();
      return;
    }
    flushPending();
    pending = value;
    pendingAt = ts;
    scheduleFlush();
  };
}

/**
 * Resolves the session key the TUI should switch to from a raw `/session` argument.
 * Bare names are namespaced under the current agent; `global`, `unknown`, and
 * explicit `agent:`-prefixed keys pass through unchanged.
 */
export function resolveTuiSessionKey(params: {
  raw?: string;
  sessionScope: SessionScope;
  currentAgentId: string;
  sessionMainKey: string;
}) {
  const trimmed = (params.raw ?? "").trim();
  if (!trimmed) {
    if (params.sessionScope === "global") {
      return "global";
    }
    return buildAgentMainSessionKey({
      agentId: params.currentAgentId,
      mainKey: params.sessionMainKey,
    });
  }
  if (trimmed === "global" || trimmed === "unknown") {
    return trimmed;
  }
  if (trimmed.startsWith("agent:")) {
    return trimmed;
  }
  return `agent:${params.currentAgentId}:${trimmed}`;
}
