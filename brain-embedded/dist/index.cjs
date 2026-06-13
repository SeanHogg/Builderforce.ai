"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  BrainActionsProvider: () => BrainActionsProvider,
  BrainContextProvider: () => BrainContextProvider,
  BrainProvider: () => BrainProvider,
  buildBrainTriageReport: () => buildBrainTriageReport,
  isFailedToolResult: () => isFailedToolResult,
  prepareImageDataUrl: () => prepareImageDataUrl,
  savePendingPrompt: () => savePendingPrompt,
  streamChatCompletion: () => streamChatCompletion,
  takePendingPrompt: () => takePendingPrompt,
  useBrainActions: () => useBrainActions,
  useBrainChats: () => useBrainChats,
  useBrainConfig: () => useBrainConfig,
  useBrainContext: () => useBrainContext,
  useBrainConversation: () => useBrainConversation,
  useMcpExtensions: () => useMcpExtensions,
  useOptionalBrainContext: () => useOptionalBrainContext,
  useRegisterBrainActions: () => useRegisterBrainActions
});
module.exports = __toCommonJS(src_exports);

// src/config.tsx
var import_react = require("react");

// src/streamChatCompletion.ts
async function defaultMapError(res) {
  const body = await res.json().catch(() => ({}));
  const msg = typeof body.error === "string" && body.error || typeof body.message === "string" && body.message || res.statusText || `Request failed (${res.status})`;
  return new Error(msg);
}
async function streamChatCompletion(opts, handlers = {}) {
  const { transport } = opts;
  const token = transport.getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const body = {
    model: opts.model ?? transport.defaultModel ?? "openai/gpt-4o-mini",
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 4096,
    stream: true
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = opts.tool_choice ?? "auto";
  }
  const res = await fetch(`${transport.baseUrl}/llm/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal
  });
  if (res.status === 401) transport.onUnauthorized?.(res, !!token);
  if (!res.ok) throw await (transport.mapError ?? defaultMapError)(res);
  const toolAcc = /* @__PURE__ */ new Map();
  let text = "";
  let finishReason = null;
  const reader = res.body?.getReader();
  if (!reader) {
    const data = await res.json().catch(() => null);
    const choice = data?.choices?.[0];
    text = choice?.message?.content ?? "";
    if (text) handlers.onTextDelta?.(text);
    (choice?.message?.tool_calls ?? []).forEach((tc, i) => {
      const idx = tc.index ?? i;
      toolAcc.set(idx, { id: tc.id ?? "", name: tc.function?.name ?? "", args: tc.function?.arguments ?? "" });
    });
    finishReason = choice?.finish_reason ?? null;
    handlers.onDone?.(finishReason);
    return { text, toolCalls: assemble(toolAcc), finishReason };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6).trim();
      if (payload === "[DONE]") {
        handlers.onDone?.(finishReason);
        return { text, toolCalls: assemble(toolAcc), finishReason };
      }
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      const choice = parsed.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const contentDelta = (typeof choice?.delta?.content === "string" ? choice.delta.content : null) || parsed.response || parsed.text || parsed.delta || "";
      if (contentDelta) {
        text += contentDelta;
        handlers.onTextDelta?.(contentDelta);
      }
      const tcDeltas = choice?.delta?.tool_calls;
      if (tcDeltas) {
        for (let i = 0; i < tcDeltas.length; i++) {
          const d = tcDeltas[i];
          const idx = d.index ?? i;
          const cur = toolAcc.get(idx) ?? { id: "", name: "", args: "" };
          if (d.id) cur.id = d.id;
          if (d.function?.name) cur.name = d.function.name;
          if (d.function?.arguments) cur.args += d.function.arguments;
          toolAcc.set(idx, cur);
          handlers.onToolCallDelta?.(idx, {
            id: d.id,
            name: d.function?.name,
            argsFragment: d.function?.arguments
          });
        }
      }
    }
  }
  handlers.onDone?.(finishReason);
  return { text, toolCalls: assemble(toolAcc), finishReason };
}
function assemble(acc) {
  return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => ({ id: v.id, name: v.name, args: v.args })).filter((c) => c.name.length > 0);
}

// src/config.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var DEFAULT_SYSTEM_PROMPT = "You are Brain, a helpful AI assistant. Be concise and use markdown when helpful.";
var BrainConfigContext = (0, import_react.createContext)(null);
function BrainProvider({
  config,
  children
}) {
  const runtime = (0, import_react.useMemo)(
    () => ({
      transport: config.transport,
      persistence: config.persistence,
      resolveSystemPrompt: config.resolveSystemPrompt ?? (() => DEFAULT_SYSTEM_PROMPT),
      stream: (opts, handlers) => streamChatCompletion({ ...opts, transport: config.transport }, handlers)
    }),
    [config]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BrainConfigContext.Provider, { value: runtime, children });
}
function useBrainConfig() {
  const ctx = (0, import_react.useContext)(BrainConfigContext);
  if (!ctx) throw new Error("useBrainConfig must be used within a BrainProvider");
  return ctx;
}

// src/imagePrep.ts
var MAX_EDGE = 1568;
var MAX_DATA_URL_BYTES = 35e5;
var QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];
function isRasterImage(type) {
  return /^image\/(png|jpeg|jpg|gif|webp|bmp)$/i.test(type);
}
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image"));
    };
    img.src = url;
  });
}
function dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor(b64.length * 3 / 4);
}
async function prepareImageDataUrl(file) {
  if (typeof document === "undefined" || !isRasterImage(file.type)) return null;
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  for (const q of QUALITY_STEPS) {
    const dataUrl = canvas.toDataURL("image/jpeg", q);
    if (dataUrlBytes(dataUrl) <= MAX_DATA_URL_BYTES) return { dataUrl };
  }
  return { tooLarge: true };
}

// src/BrainActionsContext.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
var BrainActionsContext = (0, import_react2.createContext)(null);
function BrainActionsProvider({ children }) {
  const registry = (0, import_react2.useRef)(/* @__PURE__ */ new Map());
  const [version, setVersion] = (0, import_react2.useState)(0);
  const bump = (0, import_react2.useCallback)(() => setVersion((v) => v + 1), []);
  const register = (0, import_react2.useCallback)((actions) => {
    const token = /* @__PURE__ */ Symbol("brain-action-registration");
    for (const action of actions) {
      registry.current.set(action.name, { action, token });
    }
    bump();
    return () => {
      for (const action of actions) {
        const cur = registry.current.get(action.name);
        if (cur && cur.token === token) registry.current.delete(action.name);
      }
      bump();
    };
  }, [bump]);
  const runTool = (0, import_react2.useCallback)(async (name, args) => {
    const entry = registry.current.get(name);
    if (!entry) {
      return { error: `Unknown tool: ${name}` };
    }
    try {
      return await entry.action.run(args);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Tool execution failed" };
    }
  }, []);
  const isMutating = (0, import_react2.useCallback)((name, args) => {
    const entry = registry.current.get(name);
    if (!entry) return false;
    const m = entry.action.mutates;
    if (typeof m === "function") {
      try {
        return !!m(args);
      } catch {
        return true;
      }
    }
    return !!m;
  }, []);
  const toolSpecs = (0, import_react2.useMemo)(() => {
    return [...registry.current.values()].map(({ action }) => ({
      type: "function",
      function: {
        name: action.name,
        description: action.description,
        parameters: action.parameters
      }
    }));
  }, [version]);
  const value = (0, import_react2.useMemo)(
    () => ({ toolSpecs, runTool, isMutating, register }),
    [toolSpecs, runTool, isMutating, register]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(BrainActionsContext.Provider, { value, children });
}
function useBrainActions() {
  const ctx = (0, import_react2.useContext)(BrainActionsContext);
  if (!ctx) {
    throw new Error("useBrainActions must be used within a BrainActionsProvider");
  }
  return ctx;
}
function useRegisterBrainActions(actions) {
  const ctx = (0, import_react2.useContext)(BrainActionsContext);
  const register = ctx?.register;
  (0, import_react2.useEffect)(() => {
    if (!register) return;
    return register(actions);
  }, [register, actions]);
}

// src/useMcpExtensions.ts
var import_react3 = require("react");
function useMcpExtensions(options) {
  const { transport } = useBrainConfig();
  const [entries, setEntries] = (0, import_react3.useState)([]);
  const [loading, setLoading] = (0, import_react3.useState)(true);
  const skipKey = (options?.skipExtensionIds ?? []).join(",");
  (0, import_react3.useEffect)(() => {
    let cancelled = false;
    const token = transport.getToken();
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const skip = new Set(skipKey ? skipKey.split(",") : []);
    fetch(`${transport.baseUrl}/llm/v1/mcp/tools`, { headers }).then((res) => res.ok ? res.json() : { tools: [] }).then((body) => {
      if (!cancelled) setEntries((body.tools ?? []).filter((t) => !skip.has(t.extensionId)));
    }).catch(() => {
      if (!cancelled) setEntries([]);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [transport, skipKey]);
  const actions = (0, import_react3.useMemo)(
    () => entries.map((entry) => ({
      name: entry.name,
      description: entry.description,
      parameters: entry.parameters,
      run: async (args) => {
        const token = transport.getToken();
        const headers = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${transport.baseUrl}/llm/v1/mcp/call`, {
          method: "POST",
          headers,
          body: JSON.stringify({ extensionId: entry.extensionId, tool: entry.tool, arguments: args })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { error: body.error ?? `MCP call failed (${res.status})` };
        return body.result ?? body;
      }
    })),
    [entries, transport]
  );
  useRegisterBrainActions(actions);
  return { loading, toolCount: actions.length };
}

// src/BrainContext.tsx
var import_react4 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
var DEFAULT_CONTEXT = {
  projectId: null,
  viewingProjectId: null,
  modality: "designer",
  extraSystem: void 0,
  initialChatId: null
};
var BrainContext = (0, import_react4.createContext)(null);
function BrainContextProvider({ children }) {
  const [open, setOpen] = (0, import_react4.useState)(false);
  const [pageContext, setPageContext] = (0, import_react4.useState)(DEFAULT_CONTEXT);
  const setContext = (0, import_react4.useCallback)((patch) => {
    setPageContext((prev) => {
      const next = { ...prev, ...patch };
      if (next.projectId === prev.projectId && next.viewingProjectId === prev.viewingProjectId && next.modality === prev.modality && next.extraSystem === prev.extraSystem && next.initialChatId === prev.initialChatId) {
        return prev;
      }
      return next;
    });
  }, []);
  const value = (0, import_react4.useMemo)(
    () => ({ ...pageContext, open, setOpen, setContext }),
    [pageContext, open, setContext]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(BrainContext.Provider, { value, children });
}
function useBrainContext() {
  const ctx = (0, import_react4.useContext)(BrainContext);
  if (!ctx) throw new Error("useBrainContext must be used within a BrainContextProvider");
  return ctx;
}
function useOptionalBrainContext() {
  return (0, import_react4.useContext)(BrainContext);
}

// src/useBrainChats.ts
var import_react5 = require("react");
function useBrainChats(options = {}) {
  const { persistence } = useBrainConfig();
  const { filterProjectId, pinnedProjectId } = options;
  const [chats, setChats] = (0, import_react5.useState)([]);
  const [loading, setLoading] = (0, import_react5.useState)(true);
  const [error, setError] = (0, import_react5.useState)("");
  const [activeChatId, setActiveChatId] = (0, import_react5.useState)(null);
  const assigningRef = (0, import_react5.useRef)(false);
  const defaultProjectId = (0, import_react5.useCallback)(() => {
    if (pinnedProjectId != null) return pinnedProjectId;
    return filterProjectId && filterProjectId !== "none" ? Number(filterProjectId) : null;
  }, [pinnedProjectId, filterProjectId]);
  const reload = (0, import_react5.useCallback)(async () => {
    setLoading(true);
    setError("");
    try {
      const params = pinnedProjectId != null ? { projectId: String(pinnedProjectId) } : filterProjectId === "none" ? { projectId: "none" } : filterProjectId ? { projectId: filterProjectId } : void 0;
      const list = await persistence.listChats(params);
      setChats(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chats");
    } finally {
      setLoading(false);
    }
  }, [persistence, filterProjectId, pinnedProjectId]);
  (0, import_react5.useEffect)(() => {
    reload();
  }, [reload]);
  const select = (0, import_react5.useCallback)(async (id) => {
    setError("");
    if (id === null) {
      setActiveChatId(null);
      return null;
    }
    setActiveChatId(id);
    const existing = chats.find((c) => c.id === id);
    if (existing) return existing;
    try {
      const chat = await persistence.getChat(id);
      setChats((prev) => prev.some((c) => c.id === chat.id) ? prev : [chat, ...prev]);
      return chat;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open chat");
      return null;
    }
  }, [persistence, chats]);
  const create = (0, import_react5.useCallback)(async (opts) => {
    setError("");
    try {
      const projectId = opts?.projectId !== void 0 ? opts.projectId : defaultProjectId();
      const chat = await persistence.createChat({ title: opts?.title ?? "New chat", projectId });
      setChats((prev) => [chat, ...prev]);
      setActiveChatId(chat.id);
      return chat;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create chat");
      return null;
    }
  }, [persistence, defaultProjectId]);
  const rename = (0, import_react5.useCallback)(async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const updated = await persistence.updateChat(id, { title: trimmed });
      setChats((prev) => prev.map((c) => c.id === id ? { ...c, title: updated.title } : c));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    }
  }, [persistence]);
  const summarize = (0, import_react5.useCallback)(async (id) => {
    setError("");
    try {
      const result = await persistence.summarizeChat(id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (result.summary) {
        const updated = await persistence.updateChat(id, { title: result.summary });
        setChats((prev) => prev.map((c) => c.id === id ? { ...c, title: updated.title } : c));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Summarize failed");
    }
  }, [persistence]);
  const remove = (0, import_react5.useCallback)(async (id) => {
    try {
      await persistence.deleteChat(id);
      setChats((prev) => prev.filter((c) => c.id !== id));
      setActiveChatId((cur) => cur === id ? null : cur);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [persistence]);
  const assignToProject = (0, import_react5.useCallback)(async (id, projectId) => {
    if (assigningRef.current) return;
    assigningRef.current = true;
    setError("");
    try {
      const updated = await persistence.updateChat(id, { projectId });
      setChats((prev) => prev.map((c) => c.id === id ? { ...c, projectId: updated.projectId } : c));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assign to project");
    } finally {
      assigningRef.current = false;
    }
  }, [persistence]);
  const touch = (0, import_react5.useCallback)(async (id) => {
    await reload();
    setActiveChatId(id);
  }, [reload]);
  const activeChat = (0, import_react5.useMemo)(
    () => chats.find((c) => c.id === activeChatId) ?? null,
    [chats, activeChatId]
  );
  return {
    chats,
    loading,
    error,
    activeChatId,
    activeChat,
    setError,
    select,
    create,
    rename,
    summarize,
    remove,
    assignToProject,
    reload,
    touch
  };
}

// src/useBrainConversation.ts
var import_react6 = require("react");

// src/brainTriage.ts
function isFailedToolResult(result) {
  if (result == null) return false;
  if (typeof result === "object") {
    const r = result;
    if (r.ok === false) return true;
    if (typeof r.error === "string" && r.error) return true;
  }
  const s = (typeof result === "string" ? result : JSON.stringify(result)).toLowerCase();
  return s.includes('"ok":false') || /\b(error|failed|exception)\b/.test(s);
}
function cap(s, n = 2e3) {
  const str = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return str.length > n ? str.slice(0, n) + `\u2026 (+${str.length - n} chars)` : str;
}
function buildBrainTriageReport(opts) {
  const { capturedAt, events, messages = [], chatId, chatTitle, agentLabel, error } = opts;
  const errors = events.filter((e) => e.isError || e.category === "error");
  const lines = [];
  lines.push("=== BuilderForce Brain Triage ===");
  lines.push(`Captured:  ${capturedAt}`);
  if (chatId != null) lines.push(`Chat:      #${chatId}${chatTitle ? ` \u2014 ${chatTitle}` : ""}`);
  lines.push(`Brain:     ${agentLabel || "Brain (default)"}`);
  lines.push(`Steps: ${events.length} \xB7 Errors: ${errors.length} \xB7 Messages: ${messages.length}`);
  if (error) lines.push(`Last error: ${error}`);
  if (errors.length) {
    lines.push("", `--- Errors (${errors.length}) ---`);
    for (const ev of errors) {
      lines.push(`[${ev.ts}] ${ev.label} (${ev.category}) \u2014 ${cap(ev.result ?? ev.args ?? "")}`);
    }
  }
  lines.push("", `--- Execution trace (${events.length}) ---`);
  for (const ev of events) {
    lines.push(
      `[${ev.ts}] ${ev.label} (${ev.category})${ev.durationMs != null ? ` \xB7 ${ev.durationMs}ms` : ""}${ev.isError ? " \xB7 ERROR" : ""}`
    );
    if (ev.args !== void 0) lines.push(`    args:   ${cap(ev.args)}`);
    if (ev.result !== void 0) lines.push(`    result: ${cap(ev.result)}`);
  }
  lines.push("", `--- Logs (${events.length}) ---`);
  for (const ev of events) {
    const level = ev.isError || ev.category === "error" ? "ERROR" : "INFO";
    const summary = ev.result !== void 0 ? cap(ev.result, 300) : cap(ev.args, 300);
    lines.push(`[${ev.ts}] ${level.padEnd(5)} ${ev.label}${summary ? ` \u2014 ${summary}` : ""}`);
  }
  if (messages.length) {
    lines.push("", `--- Conversation (${messages.length}) ---`);
    for (const m of messages) {
      lines.push(`[${m.createdAt ?? ""}] ${m.role.toUpperCase()}: ${cap(m.content, 1500)}`);
    }
  }
  return lines.join("\n");
}

// src/useBrainConversation.ts
var MAX_TOOL_ITERATIONS = 5;
var HISTORY_WINDOW = 80;
function parseArgs(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function windowed(convo) {
  let w = convo.slice(-HISTORY_WINDOW);
  while (w.length > 0 && w[0].role === "tool") w = w.slice(1);
  return w;
}
function useBrainConversation(options) {
  const { persistence, resolveSystemPrompt, stream } = useBrainConfig();
  const {
    chatId,
    modality = "designer",
    extraSystem,
    systemPrompt,
    model,
    toolSpecs,
    runTool,
    confirmTool,
    ensureChatId,
    onActivity
  } = options;
  const [messages, setMessages] = (0, import_react6.useState)([]);
  const [loadingMessages, setLoadingMessages] = (0, import_react6.useState)(false);
  const [sending, setSending] = (0, import_react6.useState)(false);
  const [error, setError] = (0, import_react6.useState)("");
  const [streamingText, setStreamingText] = (0, import_react6.useState)("");
  const [copiedMessageId, setCopiedMessageId] = (0, import_react6.useState)(null);
  const [feedbackMap, setFeedbackMap] = (0, import_react6.useState)({});
  const [pendingAttachments, setPendingAttachments] = (0, import_react6.useState)([]);
  const [uploading, setUploading] = (0, import_react6.useState)(false);
  const autoRepliedChatIdRef = (0, import_react6.useRef)(null);
  const transcriptRef = (0, import_react6.useRef)(/* @__PURE__ */ new Map());
  const traceRef = (0, import_react6.useRef)(/* @__PURE__ */ new Map());
  const [traceVersion, setTraceVersion] = (0, import_react6.useState)(0);
  const pushTrace = (0, import_react6.useCallback)((id, ev) => {
    const list = traceRef.current.get(id) ?? [];
    list.push(ev);
    traceRef.current.set(id, list);
    setTraceVersion((v) => v + 1);
  }, []);
  (0, import_react6.useEffect)(() => {
    let cancelled = false;
    if (chatId == null) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    setError("");
    persistence.getMessages(chatId).then((list) => {
      if (!cancelled) setMessages(list);
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load messages");
    }).finally(() => {
      if (!cancelled) setLoadingMessages(false);
    });
    return () => {
      cancelled = true;
    };
  }, [persistence, chatId]);
  (0, import_react6.useEffect)(() => {
    const map = {};
    for (const msg of messages) {
      if (!msg.metadata) continue;
      try {
        const meta = JSON.parse(msg.metadata);
        if (meta.feedback === "up" || meta.feedback === "down") map[msg.id] = meta.feedback;
      } catch {
      }
    }
    setFeedbackMap(map);
  }, [messages]);
  const resolvedSystemPrompt = (0, import_react6.useMemo)(() => {
    const base = systemPrompt ?? resolveSystemPrompt(modality);
    return extraSystem ? `${base}
${extraSystem}` : base;
  }, [resolveSystemPrompt, systemPrompt, modality, extraSystem]);
  const startUserTurn = (0, import_react6.useCallback)((id, priorHistory, userContent) => {
    let convo = transcriptRef.current.get(id);
    if (!convo) {
      convo = priorHistory.map((m) => ({
        role: m.role,
        content: m.content
      }));
      transcriptRef.current.set(id, convo);
    }
    convo.push({ role: "user", content: userContent });
  }, []);
  const runAgentLoop = (0, import_react6.useCallback)(
    async (id) => {
      const convo = transcriptRef.current.get(id) ?? [];
      transcriptRef.current.set(id, convo);
      const tools = toolSpecs && toolSpecs.length > 0 ? toolSpecs : void 0;
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        setStreamingText("");
        const working = [
          { role: "system", content: resolvedSystemPrompt },
          ...windowed(convo)
        ];
        const llmStart = Date.now();
        let result;
        try {
          result = await stream(
            { messages: working, tools, tool_choice: tools ? "auto" : void 0, model },
            { onTextDelta: (d) => setStreamingText((s) => s + d) }
          );
        } catch (e) {
          pushTrace(id, {
            ts: (/* @__PURE__ */ new Date()).toISOString(),
            category: "error",
            label: "llm.complete",
            durationMs: Date.now() - llmStart,
            args: { model: model ?? "default", step: iter },
            result: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
            isError: true
          });
          throw e;
        }
        pushTrace(id, {
          ts: (/* @__PURE__ */ new Date()).toISOString(),
          category: "llm",
          label: "llm.complete",
          durationMs: Date.now() - llmStart,
          args: { model: model ?? "default", step: iter, toolCalls: result.toolCalls.length },
          result: `${result.toolCalls.length} tool call(s) \xB7 ${result.text.length} chars \xB7 finish: ${result.finishReason ?? "\u2014"}`
        });
        if (result.text.trim()) {
          pushTrace(id, {
            ts: (/* @__PURE__ */ new Date()).toISOString(),
            category: "message",
            label: "agent.message",
            args: { step: iter },
            result: result.text
          });
        }
        if (result.toolCalls.length > 0 && runTool) {
          convo.push({
            role: "assistant",
            content: result.text,
            tool_calls: result.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.args }
            }))
          });
          for (const tc of result.toolCalls) {
            const args = parseArgs(tc.args);
            if (confirmTool && !await confirmTool({ name: tc.name, args })) {
              convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ cancelled: true, reason: "User declined this action." }) });
              pushTrace(id, {
                ts: (/* @__PURE__ */ new Date()).toISOString(),
                category: "tool",
                label: tc.name,
                args,
                result: { cancelled: true, reason: "User declined this action." }
              });
              continue;
            }
            const toolStart = Date.now();
            let out;
            try {
              out = await runTool(tc.name, args);
            } catch (e) {
              const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
              out = { ok: false, error: message };
              convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
              pushTrace(id, {
                ts: (/* @__PURE__ */ new Date()).toISOString(),
                category: "tool",
                label: tc.name,
                durationMs: Date.now() - toolStart,
                args,
                result: out,
                isError: true
              });
              continue;
            }
            convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out ?? null) });
            pushTrace(id, {
              ts: (/* @__PURE__ */ new Date()).toISOString(),
              category: "tool",
              label: tc.name,
              durationMs: Date.now() - toolStart,
              args,
              result: out ?? null,
              isError: isFailedToolResult(out)
            });
          }
          setStreamingText("");
          continue;
        }
        const finalText = result.text.trim() || "No response.";
        convo.push({ role: "assistant", content: finalText });
        const [assistantMsg] = await persistence.sendMessages(id, [{ role: "assistant", content: finalText }]);
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingText("");
        onActivity?.(id);
        return;
      }
      setStreamingText("");
      const exhausted = "The assistant kept calling tools without finishing. Try rephrasing.";
      pushTrace(id, {
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        category: "error",
        label: "agent.loop",
        result: `Loop exhausted after ${MAX_TOOL_ITERATIONS} tool iterations`,
        isError: true
      });
      setError(exhausted);
    },
    [persistence, stream, resolvedSystemPrompt, toolSpecs, runTool, confirmTool, onActivity, model, pushTrace]
  );
  const send = (0, import_react6.useCallback)(
    async (text) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      let id = chatId;
      if (id == null) {
        id = await ensureChatId?.() ?? null;
        if (id == null) {
          setError("Could not start a chat.");
          return;
        }
      }
      autoRepliedChatIdRef.current = id;
      const attachments = [...pendingAttachments];
      setPendingAttachments([]);
      setSending(true);
      setError("");
      let displayContent = trimmed;
      if (attachments.length > 0) {
        const refs = attachments.map((a) => `[Attached: ${a.name}](${persistence.uploadUrl(a.key)})`).join("\n");
        displayContent = `${trimmed}

${refs}`;
      }
      const metadata = attachments.length > 0 ? JSON.stringify({ attachments }) : void 0;
      const imageAtts = attachments.filter((a) => a.imageUrl);
      let modelContent = displayContent;
      if (imageAtts.length > 0) {
        const nonImageRefs = attachments.filter((a) => !a.imageUrl).map((a) => `[Attached: ${a.name}](${persistence.uploadUrl(a.key)})`).join("\n");
        const text2 = [trimmed, nonImageRefs].filter(Boolean).join("\n\n");
        modelContent = [
          { type: "text", text: text2 },
          ...imageAtts.map((a) => ({ type: "image_url", image_url: { url: a.imageUrl } }))
        ];
      }
      try {
        const [userMsg] = await persistence.sendMessages(id, [{ role: "user", content: displayContent, metadata }]);
        setMessages((prev) => [...prev, userMsg]);
        startUserTurn(id, messages, modelContent);
        await runAgentLoop(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Send failed");
      } finally {
        setSending(false);
      }
    },
    [persistence, chatId, sending, pendingAttachments, messages, ensureChatId, runAgentLoop, startUserTurn]
  );
  (0, import_react6.useEffect)(() => {
    if (chatId == null || loadingMessages || sending || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== "user") return;
    if (autoRepliedChatIdRef.current === chatId) return;
    autoRepliedChatIdRef.current = chatId;
    setSending(true);
    setError("");
    startUserTurn(chatId, messages.slice(0, -1), last.content);
    runAgentLoop(chatId).catch((e) => setError(e instanceof Error ? e.message : "Reply failed")).finally(() => setSending(false));
  }, [chatId, loadingMessages, sending, messages, runAgentLoop, startUserTurn]);
  const copyMessage = (0, import_react6.useCallback)(async (msg) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMessageId(msg.id);
      setTimeout(() => setCopiedMessageId((cur) => cur === msg.id ? null : cur), 2e3);
    } catch {
    }
  }, []);
  const submitFeedback = (0, import_react6.useCallback)(async (msg, value) => {
    const current = feedbackMap[msg.id];
    const next = current === value ? null : value;
    setFeedbackMap((prev) => {
      const copy = { ...prev };
      if (next) copy[msg.id] = next;
      else delete copy[msg.id];
      return copy;
    });
    try {
      await persistence.setMessageFeedback(msg.id, next);
    } catch {
    }
  }, [persistence, feedbackMap]);
  const attach = (0, import_react6.useCallback)(async (file) => {
    setUploading(true);
    try {
      const result = await persistence.upload(file);
      const attachment = { key: result.key, name: result.name, type: result.type };
      try {
        const prepared = await prepareImageDataUrl(file);
        if (prepared?.dataUrl) {
          attachment.imageUrl = prepared.dataUrl;
        } else if (prepared?.tooLarge && persistence.signedUploadUrl) {
          attachment.imageUrl = await persistence.signedUploadUrl(result.key);
        }
      } catch {
      }
      setPendingAttachments((prev) => [...prev, attachment]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [persistence]);
  const removeAttachment = (0, import_react6.useCallback)((key) => {
    setPendingAttachments((prev) => prev.filter((a) => a.key !== key));
  }, []);
  const activeTrace = chatId != null ? traceRef.current.get(chatId) ?? [] : [];
  const hasTrace = activeTrace.length > 0;
  void traceVersion;
  const buildTriageReport = (0, import_react6.useCallback)(
    (agentLabel) => buildBrainTriageReport({
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      events: chatId != null ? traceRef.current.get(chatId) ?? [] : [],
      messages,
      chatId,
      agentLabel,
      error
    }),
    [chatId, messages, error]
  );
  return {
    messages,
    loadingMessages,
    sending,
    error,
    streamingText,
    copiedMessageId,
    feedbackMap,
    pendingAttachments,
    uploading,
    send,
    copyMessage,
    submitFeedback,
    attach,
    removeAttachment,
    setError,
    hasTrace,
    buildTriageReport
  };
}

// src/pendingPrompt.ts
var PENDING_PROMPT_KEY = "bf_pending_prompt";
function savePendingPrompt(text) {
  if (typeof window === "undefined") return;
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    window.localStorage.setItem(PENDING_PROMPT_KEY, trimmed);
  } catch {
  }
}
function takePendingPrompt() {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(PENDING_PROMPT_KEY);
    if (value != null) window.localStorage.removeItem(PENDING_PROMPT_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BrainActionsProvider,
  BrainContextProvider,
  BrainProvider,
  buildBrainTriageReport,
  isFailedToolResult,
  prepareImageDataUrl,
  savePendingPrompt,
  streamChatCompletion,
  takePendingPrompt,
  useBrainActions,
  useBrainChats,
  useBrainConfig,
  useBrainContext,
  useBrainConversation,
  useMcpExtensions,
  useOptionalBrainContext,
  useRegisterBrainActions
});
//# sourceMappingURL=index.cjs.map