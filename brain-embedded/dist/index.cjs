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

// src/xmlToolCalls.ts
var OPEN = "<tool_call>";
var CLOSE = "</tool_call>";
function partialTailPrefix(buf, tag) {
  const max = Math.min(buf.length, tag.length - 1);
  for (let L = max; L > 0; L--) {
    if (buf.slice(buf.length - L) === tag.slice(0, L)) return L;
  }
  return 0;
}
function coerceArg(raw) {
  const v = raw.trim();
  if (v === "") return "";
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}
function parseInner(inner, seq) {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  const firstArg = trimmed.indexOf("<arg_key>");
  if (firstArg >= 0) {
    const name = trimmed.slice(0, firstArg).trim();
    if (!name) return null;
    const args = {};
    const re = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
    let m;
    while ((m = re.exec(trimmed)) !== null) {
      const key = m[1].trim();
      if (key) args[key] = coerceArg(m[2]);
    }
    return { id: `xmltc_${seq}`, name, args: JSON.stringify(args) };
  }
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart >= 0) {
    const maybeName = trimmed.slice(0, jsonStart).trim();
    try {
      const obj = JSON.parse(trimmed.slice(jsonStart));
      if (maybeName) {
        return { id: `xmltc_${seq}`, name: maybeName, args: JSON.stringify(obj ?? {}) };
      }
      if (obj && typeof obj === "object" && typeof obj.name === "string") {
        const a = obj.arguments ?? obj.parameters ?? {};
        const argsStr = typeof a === "string" ? a : JSON.stringify(a ?? {});
        return { id: `xmltc_${seq}`, name: obj.name, args: argsStr };
      }
    } catch {
      if (maybeName) return { id: `xmltc_${seq}`, name: maybeName, args: "{}" };
    }
    return null;
  }
  return { id: `xmltc_${seq}`, name: trimmed, args: "{}" };
}
var XmlToolCallFilter = class {
  buf = "";
  inside = false;
  innerBuf = "";
  clean = "";
  calls = [];
  seq = 0;
  /** Feed a content delta; returns clean (markup-free) text to emit now. */
  push(delta) {
    this.buf += delta;
    let emit2 = "";
    for (; ; ) {
      if (!this.inside) {
        const open = this.buf.indexOf(OPEN);
        if (open >= 0) {
          emit2 += this.buf.slice(0, open);
          this.buf = this.buf.slice(open + OPEN.length);
          this.inside = true;
          this.innerBuf = "";
          continue;
        }
        const hold2 = partialTailPrefix(this.buf, OPEN);
        emit2 += this.buf.slice(0, this.buf.length - hold2);
        this.buf = hold2 ? this.buf.slice(this.buf.length - hold2) : "";
        break;
      }
      const close = this.buf.indexOf(CLOSE);
      if (close >= 0) {
        this.innerBuf += this.buf.slice(0, close);
        this.buf = this.buf.slice(close + CLOSE.length);
        this.inside = false;
        const parsed = parseInner(this.innerBuf, this.seq++);
        if (parsed) this.calls.push(parsed);
        this.innerBuf = "";
        continue;
      }
      const hold = partialTailPrefix(this.buf, CLOSE);
      this.innerBuf += this.buf.slice(0, this.buf.length - hold);
      this.buf = hold ? this.buf.slice(this.buf.length - hold) : "";
      break;
    }
    this.clean += emit2;
    return emit2;
  }
  /** End of stream: flush held-back text and close any unterminated call. */
  flush() {
    let emit2 = "";
    if (this.inside) {
      this.innerBuf += this.buf;
      const parsed = parseInner(this.innerBuf, this.seq++);
      if (parsed) this.calls.push(parsed);
    } else {
      emit2 = this.buf;
    }
    this.buf = "";
    this.innerBuf = "";
    this.inside = false;
    this.clean += emit2;
    return emit2;
  }
  /** The full clean text accumulated so far. */
  cleanText() {
    return this.clean;
  }
  /** Tool calls lifted out of the text. */
  toolCalls() {
    return this.calls;
  }
};
function extractXmlToolCalls(raw) {
  const f = new XmlToolCallFilter();
  f.push(raw);
  f.flush();
  return { text: f.cleanText(), toolCalls: f.toolCalls() };
}

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
  const xml = new XmlToolCallFilter();
  let finishReason = null;
  const allToolCalls = () => [...assemble(toolAcc), ...xml.toolCalls()];
  const reader = res.body?.getReader();
  if (!reader) {
    const data = await res.json().catch(() => null);
    const choice = data?.choices?.[0];
    const { text, toolCalls: xmlCalls } = extractXmlToolCalls(choice?.message?.content ?? "");
    if (text) handlers.onTextDelta?.(text);
    (choice?.message?.tool_calls ?? []).forEach((tc, i) => {
      const idx = tc.index ?? i;
      toolAcc.set(idx, { id: tc.id ?? "", name: tc.function?.name ?? "", args: tc.function?.arguments ?? "" });
    });
    finishReason = choice?.finish_reason ?? null;
    handlers.onDone?.(finishReason);
    return { text, toolCalls: [...assemble(toolAcc), ...xmlCalls], finishReason };
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
        const tail2 = xml.flush();
        if (tail2) handlers.onTextDelta?.(tail2);
        handlers.onDone?.(finishReason);
        return { text: xml.cleanText(), toolCalls: allToolCalls(), finishReason };
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
        const visible = xml.push(contentDelta);
        if (visible) handlers.onTextDelta?.(visible);
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
  const tail = xml.flush();
  if (tail) handlers.onTextDelta?.(tail);
  handlers.onDone?.(finishReason);
  return { text: xml.cleanText(), toolCalls: allToolCalls(), finishReason };
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
var CREATE_DEDUPE_MS = 8e3;
var recentCreates = /* @__PURE__ */ new Map();
function nowMs() {
  return typeof Date !== "undefined" ? Date.now() : 0;
}
function stableStringify(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const o = value;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}
function isCreateTool(name, tool) {
  return /(^|_)create($|_)/.test(name) || tool.endsWith(".create");
}
function isErrorResult(out) {
  return !!out && typeof out === "object" && typeof out.error === "string";
}
function useMcpExtensions(options) {
  const { transport } = useBrainConfig();
  const [entries, setEntries] = (0, import_react3.useState)([]);
  const [loading, setLoading] = (0, import_react3.useState)(true);
  const skipKey = (options?.skipExtensionIds ?? []).join(",");
  const onToolResultRef = (0, import_react3.useRef)(options?.onToolResult);
  onToolResultRef.current = options?.onToolResult;
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
      // Gate writes off the advertised flag; only an explicit mutates=false is
      // read-only. Undefined (external servers) ⇒ mutating, so the host's
      // confirm-before-mutate gate fires (fail safe).
      mutates: entry.mutates !== false,
      run: (args) => {
        const mutating = entry.mutates !== false;
        const exec = async () => {
          const token = transport.getToken();
          const headers = { "Content-Type": "application/json" };
          if (token) headers.Authorization = `Bearer ${token}`;
          const res = await fetch(`${transport.baseUrl}/llm/v1/mcp/call`, {
            method: "POST",
            headers,
            body: JSON.stringify({ extensionId: entry.extensionId, tool: entry.tool, arguments: args })
          });
          const body = await res.json().catch(() => ({}));
          const out = !res.ok ? { error: body.error ?? `MCP call failed (${res.status})` } : body.result ?? body;
          onToolResultRef.current?.({
            name: entry.name,
            tool: entry.tool,
            extensionId: entry.extensionId,
            mutating,
            ok: res.ok && !isErrorResult(out)
          });
          return out;
        };
        if (mutating && isCreateTool(entry.name, entry.tool)) {
          const key = `${entry.extensionId}:${entry.tool}:${stableStringify(args)}`;
          const now = nowMs();
          const prior = recentCreates.get(key);
          if (prior && now - prior.at < CREATE_DEDUPE_MS) return prior.result;
          const result = exec();
          recentCreates.set(key, { at: now, result });
          for (const [k, v] of recentCreates) if (now - v.at >= CREATE_DEDUPE_MS) recentCreates.delete(k);
          result.then((out) => {
            if (isErrorResult(out)) recentCreates.delete(key);
          }).catch(() => recentCreates.delete(key));
          return result;
        }
        return exec();
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
var OPEN_KEY = "brain.drawer.open";
var CHAT_KEY = "brain.drawer.activeChatId";
function readSession(key) {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSession(key, value) {
  if (typeof window === "undefined") return;
  try {
    if (value == null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
  }
}
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
  const [activeChatId, setActiveChatId] = (0, import_react4.useState)(null);
  (0, import_react4.useEffect)(() => {
    if (readSession(OPEN_KEY) === "1") setOpen(true);
    const savedChat = readSession(CHAT_KEY);
    if (savedChat != null) {
      const n = Number(savedChat);
      if (Number.isFinite(n)) setActiveChatId(n);
    }
  }, []);
  (0, import_react4.useEffect)(() => {
    writeSession(OPEN_KEY, open ? "1" : "0");
  }, [open]);
  (0, import_react4.useEffect)(() => {
    writeSession(CHAT_KEY, activeChatId == null ? null : String(activeChatId));
  }, [activeChatId]);
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
    () => ({ ...pageContext, open, setOpen, setContext, activeChatId, setActiveChatId }),
    [pageContext, open, setContext, activeChatId]
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
  const { filterProjectId, pinnedProjectId, activeChatId: controlledActiveId, onActiveChatChange } = options;
  const [chats, setChats] = (0, import_react5.useState)([]);
  const [loading, setLoading] = (0, import_react5.useState)(true);
  const [error, setError] = (0, import_react5.useState)("");
  const [internalActiveId, setInternalActiveId] = (0, import_react5.useState)(null);
  const assigningRef = (0, import_react5.useRef)(false);
  const isControlled = controlledActiveId !== void 0;
  const activeChatId = isControlled ? controlledActiveId ?? null : internalActiveId;
  const activeIdRef = (0, import_react5.useRef)(activeChatId);
  activeIdRef.current = activeChatId;
  const setActiveChatId = (0, import_react5.useCallback)(
    (id) => {
      if (isControlled) onActiveChatChange?.(id);
      else setInternalActiveId(id);
    },
    [isControlled, onActiveChatChange]
  );
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
  }, [persistence, chats, setActiveChatId]);
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
  }, [persistence, defaultProjectId, setActiveChatId]);
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
      if (activeIdRef.current === id) setActiveChatId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [persistence, setActiveChatId]);
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
  }, [reload, setActiveChatId]);
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
    return false;
  }
  if (typeof result === "string") {
    return /"ok"\s*:\s*false/.test(result) || /"error"\s*:\s*"[^"]/.test(result);
  }
  return false;
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

// src/brainRunStore.ts
var MAX_TOOL_ITERATIONS = 25;
var HISTORY_WINDOW = 80;
var MAX_CELLS = 50;
var MAX_TRACE_EVENTS = 500;
var MAX_APPENDED = 50;
var cells = /* @__PURE__ */ new Map();
var EMPTY_SNAPSHOT = {
  running: false,
  streamingText: "",
  error: "",
  pendingConfirm: null,
  messagesEpoch: 0,
  appended: [],
  hasTrace: false
};
function makeCell() {
  return {
    transcript: [],
    trace: [],
    running: false,
    streamingText: "",
    error: "",
    pendingConfirm: null,
    confirmResolver: null,
    appended: [],
    messagesEpoch: 0,
    listeners: /* @__PURE__ */ new Set(),
    snapshot: EMPTY_SNAPSHOT
  };
}
function getCell(chatId) {
  const existing = cells.get(chatId);
  if (existing) {
    cells.delete(chatId);
    cells.set(chatId, existing);
    return existing;
  }
  const c = makeCell();
  cells.set(chatId, c);
  evictIdleCells(chatId);
  return c;
}
function evictIdleCells(protectId) {
  if (cells.size <= MAX_CELLS) return;
  for (const [id, cell] of cells) {
    if (cells.size <= MAX_CELLS) break;
    if (id === protectId || cell.running || cell.listeners.size > 0) continue;
    cells.delete(id);
  }
}
function emit(c) {
  c.snapshot = {
    running: c.running,
    streamingText: c.streamingText,
    error: c.error,
    pendingConfirm: c.pendingConfirm,
    messagesEpoch: c.messagesEpoch,
    appended: c.appended,
    hasTrace: c.trace.length > 0
  };
  for (const l of c.listeners) l();
}
function pushTrace(c, ev) {
  c.trace.push(ev);
  if (c.trace.length > MAX_TRACE_EVENTS) c.trace.splice(0, c.trace.length - MAX_TRACE_EVENTS);
  emit(c);
}
function recordAppended(c, msg) {
  const next = [...c.appended, msg];
  c.appended = next.length > MAX_APPENDED ? next.slice(next.length - MAX_APPENDED) : next;
  c.messagesEpoch += 1;
}
function nowMs2() {
  return typeof Date !== "undefined" ? Date.now() : 0;
}
function nowIso() {
  return typeof Date !== "undefined" ? (/* @__PURE__ */ new Date()).toISOString() : "";
}
function parseArgs(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function windowed(convo) {
  let w = convo.slice(-HISTORY_WINDOW);
  while (w.length > 0 && w[0].role !== "user") w = w.slice(1);
  if (w.length === 0) {
    const lastUser = convo.map((m) => m.role).lastIndexOf("user");
    w = lastUser >= 0 ? convo.slice(lastUser) : convo.slice();
  }
  return w;
}
function subscribeRun(chatId, listener) {
  const c = getCell(chatId);
  c.listeners.add(listener);
  return () => {
    c.listeners.delete(listener);
  };
}
function getRunSnapshot(chatId) {
  if (chatId == null) return EMPTY_SNAPSHOT;
  return cells.get(chatId)?.snapshot ?? EMPTY_SNAPSHOT;
}
function isRunning(chatId) {
  return chatId != null && (cells.get(chatId)?.running ?? false);
}
function getRunTrace(chatId) {
  if (chatId == null) return [];
  return cells.get(chatId)?.trace ?? [];
}
function resolveRunConfirm(chatId, ok) {
  const c = cells.get(chatId);
  if (!c || !c.confirmResolver) return;
  const resolve = c.confirmResolver;
  c.confirmResolver = null;
  c.pendingConfirm = null;
  emit(c);
  resolve(ok);
}
async function startRun(chatId, req) {
  const c = getCell(chatId);
  if (c.running) return;
  c.running = true;
  c.error = "";
  c.streamingText = "";
  if (req.seed && c.transcript.length === 0) c.transcript = req.seed.slice();
  if (req.userTurn !== void 0) c.transcript.push({ role: "user", content: req.userTurn });
  emit(c);
  try {
    await runLoop(chatId, c, req);
  } catch (e) {
    c.error = e instanceof Error ? e.message : "Reply failed";
  } finally {
    c.running = false;
    c.streamingText = "";
    emit(c);
  }
}
async function runLoop(chatId, c, req) {
  const { resolvedSystemPrompt, tools: toolSpecs, model, runTool, needsConfirm, stream, persistence, onActivity } = req;
  const convo = c.transcript;
  const tools = toolSpecs && toolSpecs.length > 0 ? toolSpecs : void 0;
  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    c.streamingText = "";
    emit(c);
    const working = [
      { role: "system", content: resolvedSystemPrompt },
      ...windowed(convo)
    ];
    const llmStart = nowMs2();
    let result;
    try {
      result = await stream(
        { messages: working, tools, tool_choice: tools ? "auto" : void 0, model },
        { onTextDelta: (d) => {
          c.streamingText += d;
          emit(c);
        } }
      );
    } catch (e) {
      pushTrace(c, {
        ts: nowIso(),
        category: "error",
        label: "llm.complete",
        durationMs: nowMs2() - llmStart,
        args: { model: model ?? "default", step: iter },
        result: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        isError: true
      });
      throw e;
    }
    pushTrace(c, {
      ts: nowIso(),
      category: "llm",
      label: "llm.complete",
      durationMs: nowMs2() - llmStart,
      args: { model: model ?? "default", step: iter, toolCalls: result.toolCalls.length },
      result: `${result.toolCalls.length} tool call(s) \xB7 ${result.text.length} chars \xB7 finish: ${result.finishReason ?? "\u2014"}`
    });
    if (result.text.trim()) {
      pushTrace(c, { ts: nowIso(), category: "message", label: "agent.message", args: { step: iter }, result: result.text });
    }
    if (result.toolCalls.length > 0 && runTool) {
      convo.push({
        role: "assistant",
        content: result.text,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          // An empty `arguments` string is not valid JSON; strict vendors (Gemini)
          // reject it. Normalize a no-arg call to an empty object.
          function: { name: tc.name, arguments: tc.args && tc.args.trim() ? tc.args : "{}" }
        }))
      });
      const narration = result.text.trim();
      if (narration) {
        const [narrationMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: result.text }]);
        recordAppended(c, narrationMsg);
      }
      c.streamingText = "";
      emit(c);
      for (const tc of result.toolCalls) {
        const args = parseArgs(tc.args);
        if (needsConfirm && needsConfirm({ name: tc.name, args })) {
          const ok = await new Promise((resolve) => {
            c.pendingConfirm = { name: tc.name, args };
            c.confirmResolver = resolve;
            emit(c);
          });
          if (!ok) {
            convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ cancelled: true, reason: "User declined this action." }) });
            pushTrace(c, { ts: nowIso(), category: "tool", label: tc.name, args, result: { cancelled: true, reason: "User declined this action." } });
            continue;
          }
        }
        const toolStart = nowMs2();
        let out;
        try {
          out = await runTool(tc.name, args);
        } catch (e) {
          const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          out = { ok: false, error: message };
          convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
          pushTrace(c, { ts: nowIso(), category: "tool", label: tc.name, durationMs: nowMs2() - toolStart, args, result: out, isError: true });
          continue;
        }
        convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out ?? null) });
        pushTrace(c, { ts: nowIso(), category: "tool", label: tc.name, durationMs: nowMs2() - toolStart, args, result: out ?? null, isError: isFailedToolResult(out) });
      }
      continue;
    }
    const finalText = result.text.trim() || "No response.";
    convo.push({ role: "assistant", content: finalText });
    const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: finalText }]);
    c.streamingText = "";
    recordAppended(c, assistantMsg);
    emit(c);
    onActivity?.(chatId);
    return;
  }
  c.streamingText = "";
  pushTrace(c, {
    ts: nowIso(),
    category: "error",
    label: "agent.loop",
    result: `Loop exhausted after ${MAX_TOOL_ITERATIONS} tool iterations`,
    isError: true
  });
  c.error = "The assistant kept calling tools without finishing. Try rephrasing.";
  emit(c);
}

// src/useBrainConversation.ts
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
    needsConfirm,
    ensureChatId,
    onActivity
  } = options;
  const [messages, setMessages] = (0, import_react6.useState)([]);
  const [loadingMessages, setLoadingMessages] = (0, import_react6.useState)(false);
  const [localSending, setLocalSending] = (0, import_react6.useState)(false);
  const [localError, setLocalError] = (0, import_react6.useState)("");
  const [copiedMessageId, setCopiedMessageId] = (0, import_react6.useState)(null);
  const [feedbackMap, setFeedbackMap] = (0, import_react6.useState)({});
  const [pendingAttachments, setPendingAttachments] = (0, import_react6.useState)([]);
  const [uploading, setUploading] = (0, import_react6.useState)(false);
  const autoRepliedChatIdRef = (0, import_react6.useRef)(null);
  const [snapshot, setSnapshot] = (0, import_react6.useState)(() => getRunSnapshot(chatId));
  (0, import_react6.useEffect)(() => {
    setSnapshot(getRunSnapshot(chatId));
    if (chatId == null) return;
    return subscribeRun(chatId, () => setSnapshot(getRunSnapshot(chatId)));
  }, [chatId]);
  (0, import_react6.useEffect)(() => {
    let cancelled = false;
    if (chatId == null) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    setLocalError("");
    persistence.getMessages(chatId).then((list) => {
      if (!cancelled) setMessages(list);
    }).catch((e) => {
      if (!cancelled) setLocalError(e instanceof Error ? e.message : "Failed to load messages");
    }).finally(() => {
      if (!cancelled) setLoadingMessages(false);
    });
    return () => {
      cancelled = true;
    };
  }, [persistence, chatId]);
  (0, import_react6.useEffect)(() => {
    const appended = snapshot.appended;
    if (appended.length === 0) return;
    setMessages((prev) => {
      const have = new Set(prev.map((m) => m.id));
      const fresh = appended.filter((m) => !have.has(m.id));
      return fresh.length === 0 ? prev : [...prev, ...fresh];
    });
  }, [snapshot.messagesEpoch, snapshot.appended]);
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
  const resolvedSystemPrompt = systemPrompt ?? resolveSystemPrompt(modality);
  const fullSystemPrompt = extraSystem ? `${resolvedSystemPrompt}
${extraSystem}` : resolvedSystemPrompt;
  const buildRequest = (0, import_react6.useCallback)(
    (seed, userTurn) => ({
      resolvedSystemPrompt: fullSystemPrompt,
      tools: toolSpecs && toolSpecs.length > 0 ? toolSpecs : void 0,
      model,
      runTool,
      needsConfirm,
      stream,
      persistence,
      onActivity,
      seed,
      userTurn
    }),
    [fullSystemPrompt, toolSpecs, model, runTool, needsConfirm, stream, persistence, onActivity]
  );
  const send = (0, import_react6.useCallback)(
    async (text) => {
      const trimmed = text.trim();
      if (!trimmed || localSending || isRunning(chatId)) return;
      let id = chatId;
      if (id == null) {
        id = await ensureChatId?.() ?? null;
        if (id == null) {
          setLocalError("Could not start a chat.");
          return;
        }
      }
      autoRepliedChatIdRef.current = id;
      const attachments = [...pendingAttachments];
      setPendingAttachments([]);
      setLocalSending(true);
      setLocalError("");
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
        const textPart = [trimmed, nonImageRefs].filter(Boolean).join("\n\n");
        modelContent = [
          { type: "text", text: textPart },
          ...imageAtts.map((a) => ({ type: "image_url", image_url: { url: a.imageUrl } }))
        ];
      }
      try {
        const [userMsg] = await persistence.sendMessages(id, [{ role: "user", content: displayContent, metadata }]);
        setMessages((prev) => [...prev, userMsg]);
        const seed = messages.map((m) => ({
          role: m.role,
          content: m.content
        }));
        await startRun(id, buildRequest(seed, modelContent));
      } catch (e) {
        setLocalError(e instanceof Error ? e.message : "Send failed");
      } finally {
        setLocalSending(false);
      }
    },
    [persistence, chatId, localSending, pendingAttachments, messages, ensureChatId, buildRequest]
  );
  (0, import_react6.useEffect)(() => {
    if (chatId == null || loadingMessages || localSending || messages.length === 0) return;
    if (isRunning(chatId)) return;
    const last = messages[messages.length - 1];
    if (last.role !== "user") return;
    if (autoRepliedChatIdRef.current === chatId) return;
    autoRepliedChatIdRef.current = chatId;
    setLocalError("");
    const seed = messages.slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content
    }));
    void startRun(chatId, buildRequest(seed, last.content));
  }, [chatId, loadingMessages, localSending, messages, buildRequest]);
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
      setLocalError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [persistence]);
  const removeAttachment = (0, import_react6.useCallback)((key) => {
    setPendingAttachments((prev) => prev.filter((a) => a.key !== key));
  }, []);
  const resolveConfirm = (0, import_react6.useCallback)((ok) => {
    if (chatId != null) resolveRunConfirm(chatId, ok);
  }, [chatId]);
  const buildTriageReport = (0, import_react6.useCallback)(
    (agentLabel) => buildBrainTriageReport({
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      events: getRunTrace(chatId),
      messages,
      chatId,
      agentLabel,
      error: localError || snapshot.error
    }),
    [chatId, messages, localError, snapshot.error]
  );
  return {
    messages,
    loadingMessages,
    sending: localSending || snapshot.running,
    error: localError || snapshot.error,
    streamingText: snapshot.streamingText,
    copiedMessageId,
    feedbackMap,
    pendingAttachments,
    uploading,
    send,
    copyMessage,
    submitFeedback,
    attach,
    removeAttachment,
    setError: setLocalError,
    pendingConfirm: snapshot.pendingConfirm,
    resolveConfirm,
    hasTrace: snapshot.hasTrace,
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