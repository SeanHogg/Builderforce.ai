// src/config.tsx
import { createContext, useContext, useMemo } from "react";

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
    stream: true,
    // Ask the gateway to emit a trailing `usage` chunk (OpenAI stream_options).
    // Providers that ignore it simply omit usage — the parse below is tolerant.
    stream_options: { include_usage: true }
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = opts.tool_choice ?? "auto";
  }
  const doFetch = transport.fetch ?? ((input, init) => fetch(input, init));
  const res = await doFetch(`${transport.baseUrl}/llm/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal
  });
  if (res.status === 401) transport.onUnauthorized?.(res, !!token);
  if (!res.ok) throw await (transport.mapError ?? defaultMapError)(res);
  let headerModel = null;
  try {
    headerModel = res.headers?.get?.("x-builderforce-model") || null;
  } catch {
    headerModel = null;
  }
  let streamModel = null;
  const resolvedModel = () => headerModel ?? streamModel ?? void 0;
  let headerAccount = null;
  try {
    headerAccount = res.headers?.get?.("x-builderforce-account") || null;
  } catch {
    headerAccount = null;
  }
  const account = () => headerAccount ?? void 0;
  let headerByoUnresolved = null;
  try {
    headerByoUnresolved = res.headers?.get?.("x-builderforce-byo-unresolved") || null;
  } catch {
    headerByoUnresolved = null;
  }
  const byoUnresolved = () => headerByoUnresolved ?? void 0;
  let headerProviderCap = null;
  try {
    headerProviderCap = res.headers?.get?.("x-builderforce-provider-cap") || null;
  } catch {
    headerProviderCap = null;
  }
  const providerCap = () => headerProviderCap ?? void 0;
  let usage;
  const readUsage = (u) => {
    if (!u || typeof u !== "object") return;
    const o = u;
    const num = (x) => typeof x === "number" && Number.isFinite(x) ? x : void 0;
    const next = { prompt: num(o.prompt_tokens), completion: num(o.completion_tokens), total: num(o.total_tokens) };
    if (next.prompt != null || next.completion != null || next.total != null) usage = next;
  };
  const toolAcc = /* @__PURE__ */ new Map();
  const xml = new XmlToolCallFilter();
  let finishReason = null;
  const allToolCalls = () => [...assemble(toolAcc), ...xml.toolCalls()];
  const reader = res.body?.getReader();
  if (!reader) {
    const data = await res.json().catch(() => null);
    if (typeof data?.model === "string" && data.model) streamModel = data.model;
    readUsage(data?.usage);
    const choice = data?.choices?.[0];
    const { text, toolCalls: xmlCalls } = extractXmlToolCalls(choice?.message?.content ?? "");
    if (text) handlers.onTextDelta?.(text);
    (choice?.message?.tool_calls ?? []).forEach((tc, i) => {
      const idx = tc.index ?? i;
      toolAcc.set(idx, { id: tc.id ?? "", name: tc.function?.name ?? "", args: tc.function?.arguments ?? "" });
    });
    finishReason = choice?.finish_reason ?? null;
    handlers.onDone?.(finishReason);
    return { text, toolCalls: [...assemble(toolAcc), ...xmlCalls], finishReason, resolvedModel: resolvedModel(), account: account(), byoUnresolved: byoUnresolved(), providerCap: providerCap(), usage };
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
        return { text: xml.cleanText(), toolCalls: allToolCalls(), finishReason, resolvedModel: resolvedModel(), account: account(), byoUnresolved: byoUnresolved(), providerCap: providerCap(), usage };
      }
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      if (!streamModel && typeof parsed.model === "string" && parsed.model) streamModel = parsed.model;
      if (parsed.usage) readUsage(parsed.usage);
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
  return { text: xml.cleanText(), toolCalls: allToolCalls(), finishReason, resolvedModel: resolvedModel(), account: account(), byoUnresolved: byoUnresolved(), usage };
}
function assemble(acc) {
  return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => ({ id: v.id, name: v.name, args: v.args })).filter((c) => c.name.length > 0);
}

// src/config.tsx
import { jsx } from "react/jsx-runtime";
var DEFAULT_SYSTEM_PROMPT = "You are Brain, a helpful AI assistant. Be concise and use markdown when helpful.";
var BrainConfigContext = createContext(null);
function BrainProvider({
  config,
  children
}) {
  const runtime = useMemo(
    () => ({
      transport: config.transport,
      persistence: config.persistence,
      resolveSystemPrompt: config.resolveSystemPrompt ?? (() => DEFAULT_SYSTEM_PROMPT),
      stream: (opts, handlers) => streamChatCompletion({ ...opts, transport: config.transport }, handlers)
    }),
    [config]
  );
  return /* @__PURE__ */ jsx(BrainConfigContext.Provider, { value: runtime, children });
}
function useBrainConfig() {
  const ctx = useContext(BrainConfigContext);
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

// src/evermindMemory.ts
var EVERMIND_LEARN_MIN_CHARS = 40;
var RECONCILE_OVERLAP = 0.6;
var STOP = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "be",
  "as",
  "at",
  "by",
  "it",
  "this",
  "that",
  "from",
  "you",
  "your",
  "i",
  "we",
  "they",
  "he",
  "she",
  "can",
  "will",
  "how",
  "do",
  "does",
  "what",
  "why",
  "when",
  "which",
  "use",
  "using",
  "used",
  "please",
  "need",
  "want",
  "me",
  "my",
  "so",
  "if"
]);
function tokenSet(s) {
  return new Set((s.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((w) => w.length >= 2 && !STOP.has(w)));
}
function formatEvermindMemoryBlock(items) {
  if (items.length === 0) return "";
  const lines = items.map((it, i) => `${i + 1}. ${it.text.replace(/\s+/g, " ").trim()}`).filter((l) => l.length > 3);
  if (lines.length === 0) return "";
  return [
    "[Evermind Memory \u2014 recalled from this project's self-learning model]",
    "Prior learnings this project recalled as relevant to the request. Treat them as grounding; if any is outdated or wrong, correct it in your answer (this project learns write-through \u2014 your reply updates its memory).",
    ...lines
  ].join("\n");
}
function countReconciledMemories(items, answer) {
  const ans = tokenSet(answer);
  if (ans.size === 0) return 0;
  let n = 0;
  for (const it of items) {
    const mem = tokenSet(it.text);
    if (mem.size === 0) continue;
    let hit = 0;
    for (const tok of mem) if (ans.has(tok)) hit++;
    if (hit / mem.size >= RECONCILE_OVERLAP) n++;
  }
  return n;
}

// src/BrainActionsContext.tsx
import { createContext as createContext2, useCallback, useContext as useContext2, useEffect, useMemo as useMemo2, useRef, useState } from "react";
import { jsx as jsx2 } from "react/jsx-runtime";
var BrainActionsContext = createContext2(null);
function BrainActionsProvider({ children }) {
  const registry = useRef(/* @__PURE__ */ new Map());
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const register = useCallback((actions) => {
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
  const runTool = useCallback(async (name, args) => {
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
  const isMutating = useCallback((name, args) => {
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
  const toolSpecs = useMemo2(() => {
    return [...registry.current.values()].map(({ action }) => ({
      type: "function",
      function: {
        name: action.name,
        description: action.description,
        parameters: action.parameters
      }
    }));
  }, [version]);
  const value = useMemo2(
    () => ({ toolSpecs, runTool, isMutating, register }),
    [toolSpecs, runTool, isMutating, register]
  );
  return /* @__PURE__ */ jsx2(BrainActionsContext.Provider, { value, children });
}
function useBrainActions() {
  const ctx = useContext2(BrainActionsContext);
  if (!ctx) {
    throw new Error("useBrainActions must be used within a BrainActionsProvider");
  }
  return ctx;
}
function useRegisterBrainActions(actions) {
  const ctx = useContext2(BrainActionsContext);
  const register = ctx?.register;
  useEffect(() => {
    if (!register) return;
    return register(actions);
  }, [register, actions]);
}

// src/useMcpExtensions.ts
import { useEffect as useEffect2, useMemo as useMemo3, useRef as useRef2, useState as useState2 } from "react";
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
  const [entries, setEntries] = useState2([]);
  const [loading, setLoading] = useState2(true);
  const skipKey = (options?.skipExtensionIds ?? []).join(",");
  const onToolResultRef = useRef2(options?.onToolResult);
  onToolResultRef.current = options?.onToolResult;
  useEffect2(() => {
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
  const actions = useMemo3(
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
import { createContext as createContext3, useCallback as useCallback2, useContext as useContext3, useEffect as useEffect3, useMemo as useMemo4, useState as useState3 } from "react";
import { jsx as jsx3 } from "react/jsx-runtime";
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
var BrainContext = createContext3(null);
function BrainContextProvider({ children }) {
  const [open, setOpen] = useState3(false);
  const [pageContext, setPageContext] = useState3(DEFAULT_CONTEXT);
  const [activeChatId, setActiveChatId] = useState3(null);
  useEffect3(() => {
    if (readSession(OPEN_KEY) === "1") setOpen(true);
    const savedChat = readSession(CHAT_KEY);
    if (savedChat != null) {
      const n = Number(savedChat);
      if (Number.isFinite(n)) setActiveChatId(n);
    }
  }, []);
  useEffect3(() => {
    writeSession(OPEN_KEY, open ? "1" : "0");
  }, [open]);
  useEffect3(() => {
    writeSession(CHAT_KEY, activeChatId == null ? null : String(activeChatId));
  }, [activeChatId]);
  const setContext = useCallback2((patch) => {
    setPageContext((prev) => {
      const next = { ...prev, ...patch };
      if (next.projectId === prev.projectId && next.viewingProjectId === prev.viewingProjectId && next.modality === prev.modality && next.extraSystem === prev.extraSystem && next.initialChatId === prev.initialChatId && next.initialPrompt === prev.initialPrompt && next.initialTicket === prev.initialTicket) {
        return prev;
      }
      return next;
    });
  }, []);
  const value = useMemo4(
    () => ({ ...pageContext, open, setOpen, setContext, activeChatId, setActiveChatId }),
    [pageContext, open, setContext, activeChatId]
  );
  return /* @__PURE__ */ jsx3(BrainContext.Provider, { value, children });
}
function useBrainContext() {
  const ctx = useContext3(BrainContext);
  if (!ctx) throw new Error("useBrainContext must be used within a BrainContextProvider");
  return ctx;
}
function useOptionalBrainContext() {
  return useContext3(BrainContext);
}

// src/useBrainChats.ts
import { useCallback as useCallback3, useEffect as useEffect4, useMemo as useMemo5, useRef as useRef3, useState as useState4 } from "react";
var DEFAULT_CHAT_TITLE = "New chat";
function deriveChatTitle(text) {
  const firstLine = (text.split("\n").find((l) => l.trim()) ?? "").replace(/\s+/g, " ").trim();
  if (!firstLine) return "";
  if (firstLine.length <= 60) return firstLine;
  const cut = firstLine.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim()}\u2026`;
}
function useBrainChats(options = {}) {
  const { persistence } = useBrainConfig();
  const { filterProjectId, pinnedProjectId, activeChatId: controlledActiveId, onActiveChatChange } = options;
  const [chats, setChats] = useState4([]);
  const [loading, setLoading] = useState4(true);
  const [error, setError] = useState4("");
  const [internalActiveId, setInternalActiveId] = useState4(null);
  const assigningRef = useRef3(false);
  const chatsRef = useRef3(chats);
  chatsRef.current = chats;
  const autoTitledRef = useRef3(/* @__PURE__ */ new Set());
  const isControlled = controlledActiveId !== void 0;
  const activeChatId = isControlled ? controlledActiveId ?? null : internalActiveId;
  const activeIdRef = useRef3(activeChatId);
  activeIdRef.current = activeChatId;
  const setActiveChatId = useCallback3(
    (id) => {
      if (isControlled) onActiveChatChange?.(id);
      else setInternalActiveId(id);
    },
    [isControlled, onActiveChatChange]
  );
  const defaultProjectId = useCallback3(() => {
    if (pinnedProjectId != null) return pinnedProjectId;
    return filterProjectId && filterProjectId !== "none" ? Number(filterProjectId) : null;
  }, [pinnedProjectId, filterProjectId]);
  const reload = useCallback3(async () => {
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
  useEffect4(() => {
    reload();
  }, [reload]);
  const select = useCallback3(async (id) => {
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
  const create = useCallback3(async (opts) => {
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
  const rename = useCallback3(async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const updated = await persistence.updateChat(id, { title: trimmed });
      setChats((prev) => prev.map((c) => c.id === id ? { ...c, title: updated.title } : c));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    }
  }, [persistence]);
  const autoTitle = useCallback3(async (id, firstUserText) => {
    if (autoTitledRef.current.has(id)) return;
    const chat = chatsRef.current.find((c) => c.id === id);
    if (chat && chat.title && chat.title !== DEFAULT_CHAT_TITLE) return;
    const title = deriveChatTitle(firstUserText);
    if (!title) return;
    autoTitledRef.current.add(id);
    try {
      const updated = await persistence.updateChat(id, { title });
      setChats((prev) => prev.map((c) => c.id === id ? { ...c, title: updated.title } : c));
    } catch {
      autoTitledRef.current.delete(id);
    }
  }, [persistence]);
  const summarize = useCallback3(async (id) => {
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
  const remove = useCallback3(async (id) => {
    try {
      await persistence.deleteChat(id);
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (activeIdRef.current === id) setActiveChatId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [persistence, setActiveChatId]);
  const assignToProject = useCallback3(async (id, projectId) => {
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
  const touch = useCallback3(async (id) => {
    await reload();
    setActiveChatId(id);
  }, [reload, setActiveChatId]);
  const activeChat = useMemo5(
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
    autoTitle,
    summarize,
    remove,
    assignToProject,
    reload,
    touch
  };
}

// src/useBrainConversation.ts
import { useCallback as useCallback4, useEffect as useEffect5, useRef as useRef4, useState as useState5 } from "react";

// src/types.ts
var STEP_MESSAGE_ROLE = "tool";
function isStepMessage(m) {
  return m.role === STEP_MESSAGE_ROLE;
}
function attachEvermindLearn(messages, outcome) {
  if (!outcome) return messages;
  return messages.map((m) => m.role === "assistant" ? { ...m, evermindLearn: outcome } : m);
}
function formatEvermindLearnStep(outcome) {
  if (!outcome) return null;
  const targets = outcome.targets;
  if (targets && targets.length > 0) {
    const label = (t) => `${t.name} (proj #${t.projectId}${t.version ? ` v${t.version}` : ""})`;
    const learned = targets.filter((t) => t.learned);
    const skipped = targets.filter((t) => !t.learned && t.reason && t.reason !== "too-short");
    const parts = [];
    if (learned.length > 0) parts.push(`Contributed this turn to ${learned.map(label).join(", ")}`);
    for (const t of skipped) {
      const why = t.reason === "not-seeded" ? "not set up yet" : t.reason === "frozen" ? "frozen (read-only)" : String(t.reason);
      parts.push(`skipped ${label(t)} \u2014 ${why}`);
    }
    return parts.length > 0 ? `\u{1F9E0} ${parts.join("; ")}.` : null;
  }
  if (outcome.learned) return `\u{1F9E0} Contributed this turn to the project Evermind (v${outcome.version}).`;
  switch (outcome.reason) {
    case "not-attached":
      return "\u{1F9E0} Not learned this turn \u2014 this chat isn't attached to a project, so it can't train a project Evermind.";
    case "not-seeded":
      return "\u{1F9E0} Not learned this turn \u2014 this project's Evermind isn't set up yet.";
    case "frozen":
      return "\u{1F9E0} Not learned this turn \u2014 this project's Evermind is frozen (read-only).";
    default:
      return null;
  }
}

// src/consolidation.ts
var CONSOLIDATION_META = { consolidation: true };
function consolidationMetadata() {
  return JSON.stringify(CONSOLIDATION_META);
}
function isConsolidationMarker(msg) {
  if (!msg.metadata) return false;
  try {
    return JSON.parse(msg.metadata)?.consolidation === true;
  } catch {
    return false;
  }
}
function lastConsolidationIndex(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isConsolidationMarker(messages[i])) return i;
  }
  return -1;
}
function scopeToConsolidation(messages) {
  const idx = lastConsolidationIndex(messages);
  return idx >= 0 ? messages.slice(idx) : messages;
}
var CONSOLIDATION_MARKER_PREFIX = "\u{1F4CC} **Consolidated summary** \u2014 context continues from here.\n\n";
function consolidationMarkerContent(summary) {
  return `${CONSOLIDATION_MARKER_PREFIX}${summary.trim()}`;
}

// src/directedMessage.ts
var ADDRESSED_TO_META_KEY = "addressedTo";
var AUTHORED_BY_META_KEY = "authoredBy";
function parseMessageAuthor(msg) {
  if (!msg.metadata) return null;
  try {
    const a = JSON.parse(msg.metadata).authoredBy;
    if (a && typeof a.ref === "string" && typeof a.name === "string" && (a.kind === "agent" || a.kind === "human")) {
      return { kind: a.kind, ref: a.ref, name: a.name };
    }
  } catch {
  }
  return null;
}
function withDirectedMetadata(recipient, base) {
  const meta = { ...base ?? {} };
  if (recipient) meta[ADDRESSED_TO_META_KEY] = recipient;
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : void 0;
}
function parseDirectedRecipient(msg) {
  if (!msg.metadata) return null;
  try {
    const a = JSON.parse(msg.metadata).addressedTo;
    if (a && typeof a.ref === "string" && typeof a.name === "string" && (a.kind === "agent" || a.kind === "human")) {
      return { kind: a.kind, ref: a.ref, name: a.name };
    }
  } catch {
  }
  return null;
}
function isDirectedToParticipant(msg) {
  return parseDirectedRecipient(msg) !== null;
}
function activeMentionToken(text, caret) {
  const at = text.lastIndexOf("@", Math.max(0, caret - 1));
  if (at < 0 || at >= caret) return null;
  if (at > 0 && !/\s/.test(text[at - 1])) return null;
  const query = text.slice(at + 1, caret);
  if (/[\s@]/.test(query)) return null;
  return { query, start: at, end: caret };
}
function filterMentionCandidates(participants, query) {
  const q = query.trim().toLowerCase();
  if (!q) return participants;
  return participants.map((p) => ({ p, idx: p.name.toLowerCase().indexOf(q) })).filter((s) => s.idx >= 0).sort((a, b) => a.idx - b.idx || a.p.name.localeCompare(b.p.name)).map((s) => s.p);
}
function mentionRecipient(text, participants) {
  const m = /^\s*@([^\s@]+)/.exec(text);
  if (!m) return null;
  const tag = m[1].toLowerCase();
  return participants.find((p) => {
    const name = p.name.toLowerCase();
    return name === tag || name.split(/\s+/)[0] === tag || name.startsWith(tag);
  }) ?? null;
}
function resolveRecipient(choice, mention) {
  if (choice === "brain") return null;
  return choice ?? mention;
}

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
var FILE_WRITE_TOOL = /(attachments|files?|project_files)[._](write|save|update)/i;
var FILE_SAVE_CLAIM = /\b(saved|updated|wrote|written|edited|persisted|added)\b[^.!?\n]*\b(file|attachment|roadmap|document|upload|\.md|\.csv|\.txt|\.json)\b/i;
var TICKET_WRITE_TOOL = /(tasks|objectives|key_results|initiatives|portfolios|specs|roadmap)[._]create|chats[._]link_ticket|tickets[._]from_delta/i;
var TICKET_CLAIM = /\b(created|filed|opened|logged|added|linked|tracked)\b[^.!?\n]*\b(ticket|task|gap|epic|issue|objective|bug|card|board)\b/i;
function detectUnbackedWriteClaim(events, messages) {
  const wroteOk = events.some(
    (e) => e.category === "tool" && FILE_WRITE_TOOL.test(e.label) && !e.isError && !isFailedToolResult(e.result)
  );
  if (wroteOk) return false;
  return messages.some((m) => m.role === "assistant" && typeof m.content === "string" && FILE_SAVE_CLAIM.test(m.content));
}
function detectUnbackedTicketClaim(events, messages) {
  const filedOk = events.some(
    (e) => e.category === "tool" && TICKET_WRITE_TOOL.test(e.label) && !e.isError && !isFailedToolResult(e.result)
  );
  if (filedOk) return false;
  return messages.some((m) => m.role === "assistant" && typeof m.content === "string" && TICKET_CLAIM.test(m.content));
}
function cap(s, n = 2e3) {
  const str = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return str.length > n ? str.slice(0, n) + `\u2026 (+${str.length - n} chars)` : str;
}
function isEvermindModel(model) {
  return /(^|\/)evermind\b|^project_evermind:|^tenant_model:/i.test(model);
}
function modelsUsedInTrace(events) {
  const seen = [];
  for (const ev of events) {
    if (ev.category !== "llm" && ev.category !== "error") continue;
    const m = ev.args?.model;
    if (typeof m === "string" && m && m !== "default" && !seen.includes(m)) seen.push(m);
  }
  return seen;
}
function accountUsedInTrace(events) {
  let account;
  for (const ev of events) {
    if (ev.category !== "llm") continue;
    const a = ev.args?.account;
    if (typeof a === "string" && a) account = a;
  }
  return account;
}
function byoUnresolvedInTrace(events) {
  const seen = [];
  for (const ev of events) {
    if (ev.category !== "llm") continue;
    const raw = ev.args?.byoUnresolved;
    if (typeof raw !== "string" || !raw) continue;
    for (const p of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!seen.includes(p)) seen.push(p);
    }
  }
  return seen;
}
function parseByoUnresolved(entries) {
  return entries.map((e) => {
    const i = e.indexOf(":");
    return i === -1 ? { provider: e, reason: "" } : { provider: e.slice(0, i), reason: e.slice(i + 1) };
  });
}
function byoReasonHint(reason) {
  switch (reason) {
    case "revoked":
      return "its token was revoked or expired \u2014 reconnect it in the web app under Settings \u25B8 API Keys";
    case "expired":
      return "its token expired and the refresh failed (often transient) \u2014 retry, or reconnect it under Settings \u25B8 API Keys";
    case "undecryptable":
      return "its stored credential could not be read \u2014 re-enter it under Settings \u25B8 API Keys";
    case "other-workspace":
      return "you connected this account in a DIFFERENT workspace \u2014 switch to that workspace, or connect it in this one under Settings \u25B8 API Keys";
    default:
      return "it could not be used this run \u2014 reconnect it under Settings \u25B8 API Keys";
  }
}
function byoUnresolvedSummary(entry) {
  return `${entry.provider}${entry.reason ? ` (${entry.reason})` : ""}: ${byoReasonHint(entry.reason)}`;
}
function accountLabel(account) {
  return account === "own" ? "the tenant's own connected account" : account === "shared_byo_unused" ? "the shared model pool (a connected account existed but was NOT used)" : account === "shared" ? "the shared model pool" : account;
}
function formatBrainProvenance(events, opts = {}) {
  const lines = [];
  if (opts.surface) lines.push(`Surface: ${opts.surface}`);
  lines.push(`Configured model: ${opts.configuredModel || "(gateway auto-select)"}`);
  const used = modelsUsedInTrace(events);
  if (used.length) lines.push(`Models used: ${used.join(", ")}`);
  const evermind = used.filter(isEvermindModel);
  if (evermind.length) lines.push(`Evermind: yes \u2014 ${evermind.join(", ")}`);
  const account = accountUsedInTrace(events);
  if (account) lines.push(`Account: ${accountLabel(account)}`);
  const byoUnresolved = parseByoUnresolved(byoUnresolvedInTrace(events));
  if (byoUnresolved.length) {
    lines.push("\u26A0 CONNECTED ACCOUNT NOT USED \u2014 a connected account existed but the run fell back to the shared pool instead of your own model:");
    for (const e of byoUnresolved) lines.push(`  \u2022 ${byoUnresolvedSummary(e)}`);
  }
  return lines;
}
function byteLen(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length;
}
function computeBrainDiagnostics(events, requestedModel) {
  const llm = events.filter((e) => e.category === "llm");
  const toolEvents = events.filter((e) => e.category === "tool");
  const errors = events.filter((e) => e.isError || e.category === "error");
  const loopExhausted = events.some((e) => e.label === "agent.loop" && e.isError);
  let promptTokenPeak = 0;
  let completionTokenTotal = 0;
  let lastPromptTokens = 0;
  let tokensMeasured = false;
  let emptyOrLengthFinishes = 0;
  let downgradeEvents = 0;
  const req = requestedModel && requestedModel !== "default" ? requestedModel : void 0;
  for (const ev of llm) {
    const u = ev.usage;
    if (u) {
      tokensMeasured = true;
      if (typeof u.prompt === "number") {
        promptTokenPeak = Math.max(promptTokenPeak, u.prompt);
        lastPromptTokens = u.prompt;
      }
      if (typeof u.completion === "number") completionTokenTotal += u.completion;
    }
    const finish = ev.finishReason ?? null;
    const emptyText = typeof ev.textChars === "number" && ev.textChars === 0;
    const toolCallsThisTurn = ev.args?.toolCalls;
    const askedNoTools = typeof toolCallsThisTurn === "number" ? toolCallsThisTurn === 0 : true;
    if (finish === "length" || emptyText && askedNoTools) emptyOrLengthFinishes += 1;
    const resolved = ev.args?.model;
    if (req && typeof resolved === "string" && resolved && resolved !== "default" && resolved !== req) downgradeEvents += 1;
  }
  let toolResultBytes = 0;
  let truncatedToolResults = 0;
  let largestToolResult = null;
  for (const ev of toolEvents) {
    const bytes = typeof ev.resultBytes === "number" ? ev.resultBytes : byteLen(ev.result);
    toolResultBytes += bytes;
    if (ev.truncated) truncatedToolResults += 1;
    if (!largestToolResult || bytes > largestToolResult.bytes) largestToolResult = { label: ev.label, bytes };
  }
  const modelsUsed = modelsUsedInTrace(events);
  const evermindUsed = modelsUsed.filter(isEvermindModel);
  const contextSignal = promptTokenPeak >= 24e3 || truncatedToolResults > 0 || downgradeEvents > 0 || largestToolResult != null && largestToolResult.bytes >= 2e4;
  const degradationSignal = evermindUsed.length > 0 && emptyOrLengthFinishes > 0 && (!tokensMeasured || promptTokenPeak < 24e3) && truncatedToolResults === 0;
  const likelyCause = contextSignal && !degradationSignal ? "context-exhaustion" : degradationSignal && !contextSignal ? "model-degradation" : "inconclusive";
  return {
    turns: llm.length,
    toolCalls: toolEvents.length,
    errors: errors.length,
    loopExhausted,
    tokensMeasured,
    promptTokenPeak,
    completionTokenTotal,
    lastPromptTokens,
    toolResultBytes,
    truncatedToolResults,
    largestToolResult,
    modelsUsed,
    evermindUsed,
    downgradeEvents,
    emptyOrLengthFinishes,
    likelyCause
  };
}
function kb(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
function formatBrainDiagnostics(d) {
  const verdict = d.likelyCause === "context-exhaustion" ? "Likely CONTEXT EXHAUSTION (case A) \u2014 the transcript outgrew the model window." : d.likelyCause === "model-degradation" ? "Likely MODEL DEGRADATION (case B) \u2014 an Evermind/SSM turn returned empty while tokens stayed low." : "Inconclusive \u2014 not enough signal to separate context exhaustion from model degradation.";
  const lines = ["--- Diagnostics ---", `Likely cause: ${verdict}`];
  lines.push(`Turns: ${d.turns} \xB7 Tool calls: ${d.toolCalls} \xB7 Errors: ${d.errors}${d.loopExhausted ? " \xB7 LOOP EXHAUSTED" : ""}`);
  if (d.tokensMeasured) {
    lines.push(
      `Tokens: prompt peak ${d.promptTokenPeak.toLocaleString()} \xB7 last-turn prompt ${d.lastPromptTokens.toLocaleString()} \xB7 completion total ${d.completionTokenTotal.toLocaleString()}`
    );
  } else {
    lines.push("Tokens: not reported by the gateway for this run.");
  }
  lines.push(
    `Tool results: ${kb(d.toolResultBytes)} total${d.largestToolResult ? ` \xB7 largest ${d.largestToolResult.label} (${kb(d.largestToolResult.bytes)})` : ""}${d.truncatedToolResults ? ` \xB7 ${d.truncatedToolResults} truncated before the model saw them` : ""}`
  );
  if (d.downgradeEvents > 0) lines.push(`Model downgrades: ${d.downgradeEvents} turn(s) answered by a different model than requested (gateway failover).`);
  if (d.emptyOrLengthFinishes > 0) lines.push(`Degenerate turns: ${d.emptyOrLengthFinishes} ended on \`length\` or returned empty text.`);
  if (d.evermindUsed.length) lines.push(`Evermind/SSM answered: ${d.evermindUsed.join(", ")}`);
  return lines;
}
function buildBrainTriageReport(opts) {
  const { capturedAt, events, messages = [], chatId, chatTitle, agentLabel, configuredModel, surface, error } = opts;
  const errors = events.filter((e) => e.isError || e.category === "error");
  const lines = [];
  lines.push("=== BuilderForce Brain Triage ===");
  lines.push(`Captured:  ${capturedAt}`);
  if (chatId != null) lines.push(`Chat:      #${chatId}${chatTitle ? ` \u2014 ${chatTitle}` : ""}`);
  lines.push(`Brain:     ${agentLabel || "Brain (default)"}`);
  lines.push(...formatBrainProvenance(events, { configuredModel, surface }));
  lines.push(`Steps: ${events.length} \xB7 Errors: ${errors.length} \xB7 Messages: ${messages.length}`);
  if (error) lines.push(`Last error: ${error}`);
  lines.push("", ...formatBrainDiagnostics(computeBrainDiagnostics(events, configuredModel)));
  if (detectUnbackedWriteClaim(events, messages)) {
    lines.push("", "\u26A0 UNBACKED WRITE CLAIM \u2014 an assistant turn claimed it saved/updated a file, but no file-write tool (attachments.write / project_files.save) succeeded in this run. The file was NOT modified.");
  }
  if (detectUnbackedTicketClaim(events, messages)) {
    lines.push("", "\u26A0 UNBACKED TICKET CLAIM \u2014 an assistant turn claimed it created/filed/linked a ticket or gap, but no create/link tool (tasks.create / chats.link_ticket / tickets.from_delta) succeeded in this run. Nothing was filed or linked to the chat.");
  }
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

// src/provenance.ts
var PROVENANCE_META_KEY = "provenance";
function isConnectedAccountUnused(prov) {
  return prov?.account === "shared_byo_unused";
}
function parseMessageProvenance(msg) {
  if (!msg.metadata) return null;
  try {
    const p = JSON.parse(msg.metadata).provenance;
    if (p && typeof p.model === "string" && p.model.length > 0 && (p.account === "own" || p.account === "shared" || p.account === "shared_byo_unused")) {
      const ev = p.evermind;
      const evermind = ev && typeof ev.version === "number" && ev.version >= 1 ? { version: ev.version } : void 0;
      return {
        model: p.model,
        account: p.account,
        ...typeof p.vendor === "string" ? { vendor: p.vendor } : {},
        ...evermind ? { evermind } : {}
      };
    }
  } catch {
  }
  return null;
}
function withProvenanceMetadata(provenance, base) {
  const meta = { ...base ?? {} };
  if (provenance) meta[PROVENANCE_META_KEY] = provenance;
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : void 0;
}

// src/chatWorkLinking.ts
var TICKET_RECORDING_TOOLS = /* @__PURE__ */ new Set([
  "builtin_tickets_from_delta",
  "builtin_chats_link_ticket",
  "builtin_reviews_record"
]);
var CODE_CHANGE_TOOLS = /* @__PURE__ */ new Set([
  "write_file",
  "edit_file",
  "delete_file"
]);
function isCodeChangeTool(name) {
  return CODE_CHANGE_TOOLS.has(name);
}
var CREATE_TOOL_KIND = {
  builtin_objectives_create: "objective",
  builtin_specs_create: "spec",
  builtin_portfolios_create: "portfolio",
  builtin_initiatives_create: "initiative"
};
function workItemLinkFromCreate(toolName, result) {
  if (!result || typeof result !== "object") return null;
  const row = result;
  const id = row.id;
  const ref = typeof id === "number" ? String(id) : typeof id === "string" && id.trim() ? id : null;
  if (!ref) return null;
  const linkType = row.deduped === true ? "linked" : "created";
  if (toolName === "builtin_tasks_create") {
    const t = typeof row.taskType === "string" ? row.taskType : "task";
    const kind2 = t === "epic" || t === "gap" ? t : "task";
    return { kind: kind2, ref, linkType };
  }
  const kind = CREATE_TOOL_KIND[toolName];
  return kind ? { kind, ref, linkType } : null;
}
function isTicketRecordingTool(name) {
  return TICKET_RECORDING_TOOLS.has(name);
}
var READ_ONLY_PLATFORM_SUFFIXES = [
  "_list",
  "_get",
  "_search",
  "_recall",
  "_read",
  "_assignees",
  "_audit",
  "_trace",
  "_tree",
  "_rollup",
  "_runs",
  "_graph",
  "_triggers",
  "_metrics",
  "_usage",
  "_query",
  "_health",
  "_models",
  "_providers",
  "_proposals",
  "_ticket_lineage",
  "_get_messages",
  "_run_targets",
  "_activity_calendar",
  "_check_key",
  "_browse_public",
  "_tool_audit",
  "_task_file_changes",
  "_list_active",
  "_list_agents",
  "_list_all",
  "_list_for_task",
  "_list_mine",
  "_list_recent",
  "_list_tickets",
  "_list_sessions",
  "_list_users",
  "_list_templates",
  "_list_purchased",
  "_list_directories",
  "_list_error_groups",
  "_list_pull_requests",
  "_get_session",
  "_get_stats",
  "_get_user",
  "_get_config",
  "_get_access",
  "_get_error_group"
];
function isReadOnlyPlatformTool(name) {
  if (!name.startsWith("builtin_")) return false;
  return READ_ONLY_PLATFORM_SUFFIXES.some((s) => name.endsWith(s));
}
var NOT_STARTED_TASK_STATUSES = /* @__PURE__ */ new Set(["backlog", "todo", "ready"]);
var TASK_TIER_KINDS = /* @__PURE__ */ new Set(["task", "epic", "gap"]);
function linkedTicketsToAdvance(listResult) {
  let rows = listResult;
  if (typeof rows === "string") {
    try {
      rows = JSON.parse(rows);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r;
    if (typeof row.kind !== "string" || !TASK_TIER_KINDS.has(row.kind)) continue;
    if (row.exists === false) continue;
    const ref = typeof row.ref === "number" ? String(row.ref) : typeof row.ref === "string" && row.ref.trim() ? row.ref : null;
    if (!ref) continue;
    if (typeof row.status !== "string" || !NOT_STARTED_TASK_STATUSES.has(row.status.toLowerCase())) continue;
    out.push({ kind: row.kind, ref });
  }
  return out;
}
function codeChangeFile(args) {
  if (args && typeof args === "object" && "path" in args) {
    const p = args.path;
    if (typeof p === "string" && p.trim()) return p;
  }
  return null;
}
function chatWorkLinkingDirective(chatId) {
  return `You are working inside Brain chat #${chatId}. Tie the work of this conversation back to it:
\u2022 When your investigation concludes that something needs to be DONE \u2014 a bug to fix, a missing capability, a follow-up, or a gap you identified \u2014 do not merely describe it. Create the work item now (builtin_tasks_create with taskType "task", "epic", or "gap"; or the matching builtin_*_create for an objective, spec, or roadmap item) AND link it to this conversation with builtin_chats_link_ticket (chatId=${chatId}, linkType="created"). To hand a large or long-horizon job off to run autonomously, set assignedAgentRef on the created task.
\u2022 When your turn ADDS or CHANGES code, record it with builtin_tickets_from_delta (chatId=${chatId}, the current projectId, the files you touched, kind improvement|fix|bug, modality "ide") so the change becomes a ticket linked to this chat that completes when it ships.
\u2022 Keep the board honest about STATUS. The MOMENT you start actively working an existing linked task/epic/gap \u2014 investigating its fix, editing code for it, or driving it \u2014 move it out of the backlog with builtin_tasks_update (id=<the ticket's ref>, status="in_progress"). When the work is finished and shipped, advance it to "in_review" (or "done" if it needs no review). Never leave a ticket you are actively working sitting in backlog.
\u2022 Call builtin_chats_list_tickets (chatId=${chatId}) to see what is already linked \u2014 both to AVOID creating a duplicate and to know which linked tickets need their status advanced. Never end a turn having identified actionable work or changed code without it being a ticket linked to this chat whose status reflects the work you did.`;
}

// src/brainRunStore.ts
function provenanceMetadata(result) {
  const model = result.resolvedModel;
  const account = result.account;
  if (!model || account !== "own" && account !== "shared" && account !== "shared_byo_unused") return void 0;
  return withProvenanceMetadata({ model, account });
}
var MAX_TOOL_ITERATIONS = 25;
var HISTORY_WINDOW = 80;
var DEDUP_READ_TOOLS = /* @__PURE__ */ new Set(["read_file", "search_code", "list_files"]);
var isDedupableRead = (name) => DEDUP_READ_TOOLS.has(name) || isReadOnlyPlatformTool(name);
function accrueByoUnresolved(c, raw) {
  if (!raw) return;
  const before = c.byoUnresolved.length;
  const next = new Set(c.byoUnresolved);
  for (const p of raw.split(",").map((s) => s.trim()).filter(Boolean)) next.add(p);
  if (next.size !== before) c.byoUnresolved = [...next];
}
function accrueProviderCap(c, raw) {
  if (!raw) return;
  const before = c.providerCap.length;
  const next = new Set(c.providerCap);
  for (const p of raw.split(",").map((s) => s.trim()).filter(Boolean)) next.add(p);
  if (next.size !== before) c.providerCap = [...next];
}
var HISTORY_TOKEN_BUDGET = 24e3;
var MAX_TOOL_RESULT_CHARS = 6e3;
function estimateTokens(chars) {
  return Math.ceil(chars / 4);
}
function messageTokens(m) {
  let chars = typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length;
  if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  return estimateTokens(chars) + 4;
}
function trimToolResult(out) {
  const full = JSON.stringify(out ?? null);
  const bytes = full.length;
  if (bytes <= MAX_TOOL_RESULT_CHARS) return { content: full, bytes, truncated: false };
  const itemNote = Array.isArray(out) ? ` The full result had ${out.length} items; re-call this tool with a narrower filter (e.g. status, projectId, or limit) to see specific ones.` : " The full result was large; re-call with a narrower query if you need the elided fields.";
  const head = full.slice(0, MAX_TOOL_RESULT_CHARS);
  const content = `${head}
\u2026[truncated ${bytes - MAX_TOOL_RESULT_CHARS} of ${bytes} chars to protect the context window.${itemNote}]`;
  return { content, bytes, truncated: true };
}
var MAX_CELLS = 50;
var MAX_TRACE_EVENTS = 500;
var MAX_APPENDED = 50;
var cells = /* @__PURE__ */ new Map();
var storeListeners = /* @__PURE__ */ new Set();
var EMPTY_SNAPSHOT = {
  running: false,
  streamingText: "",
  error: "",
  pendingConfirm: null,
  messagesEpoch: 0,
  appended: [],
  hasTrace: false,
  trace: [],
  byoUnresolved: [],
  providerCap: []
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
    abort: null,
    byoUnresolved: [],
    providerCap: [],
    codeChanged: false,
    ticketRecorded: false,
    touchedFiles: [],
    compactMemo: null,
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
    hasTrace: c.trace.length > 0,
    trace: c.trace,
    byoUnresolved: c.byoUnresolved,
    providerCap: c.providerCap
  };
  for (const l of c.listeners) l();
  for (const l of storeListeners) l();
}
function pushTrace(c, ev) {
  c.trace.push(ev);
  if (c.trace.length > MAX_TRACE_EVENTS) c.trace.splice(0, c.trace.length - MAX_TRACE_EVENTS);
  emit(c);
}
var STEP_RESULT_CAP = 4e3;
function persistStep(chatId, persistence, ev) {
  let result = ev.result ?? null;
  try {
    const s = JSON.stringify(result);
    if (s.length > STEP_RESULT_CAP) result = `${s.slice(0, STEP_RESULT_CAP)}\u2026[${s.length - STEP_RESULT_CAP} more chars]`;
  } catch {
    result = String(result);
  }
  const metadata = JSON.stringify({
    kind: "step",
    category: ev.category,
    label: ev.label,
    args: ev.args ?? null,
    result,
    isError: ev.isError ?? false,
    ...ev.durationMs != null ? { durationMs: ev.durationMs } : {},
    ts: ev.ts
  });
  void persistence.sendMessages(chatId, [{ role: "tool", content: "", metadata }]).catch(() => {
  });
}
function pushDurableStep(c, chatId, persistence, ev) {
  pushTrace(c, ev);
  persistStep(chatId, persistence, ev);
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
function latestUserText(convo) {
  for (let i = convo.length - 1; i >= 0; i--) {
    const m = convo[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content.trim();
    if (Array.isArray(m.content)) {
      return m.content.map((p) => p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : "").join(" ").trim();
    }
    return "";
  }
  return "";
}
function windowed(convo) {
  let w = convo.slice(-HISTORY_WINDOW);
  while (w.length > 0 && w[0].role !== "user") w = w.slice(1);
  if (w.length === 0) {
    const lastUser = convo.map((m) => m.role).lastIndexOf("user");
    w = lastUser >= 0 ? convo.slice(lastUser) : convo.slice();
  }
  return tokenBounded(w);
}
function tokenBounded(w) {
  let total = w.reduce((sum, m) => sum + messageTokens(m), 0);
  if (total <= HISTORY_TOKEN_BUDGET) return w;
  const lastUser = w.map((m) => m.role).lastIndexOf("user");
  let start = 0;
  while (total > HISTORY_TOKEN_BUDGET && start < lastUser) {
    total -= messageTokens(w[start]);
    start += 1;
  }
  let trimmed = w.slice(start);
  while (trimmed.length > 1 && trimmed[0].role !== "user") trimmed = trimmed.slice(1);
  return trimmed;
}
var COMPACT_TAIL_TURNS = 8;
function compactTailStart(convo, tailTurns) {
  let start = Math.max(0, convo.length - tailTurns);
  while (start < convo.length && convo[start].role === "tool") start += 1;
  return start;
}
function pinnedDirectiveIndex(convo, tailTurns) {
  const tailStart = compactTailStart(convo, tailTurns);
  const lastUser = convo.map((m) => m.role).lastIndexOf("user");
  return lastUser >= 0 && lastUser < tailStart ? lastUser : -1;
}
function compactMiddleRange(convo, tailTurns) {
  return { start: 0, end: compactTailStart(convo, tailTurns) };
}
function assembleCompacted(systemPrompt, convo, note, tailTurns) {
  const tailStart = compactTailStart(convo, tailTurns);
  const out = [{ role: "system", content: systemPrompt }];
  out.push({ role: "assistant", content: note });
  const directiveIdx = pinnedDirectiveIndex(convo, tailTurns);
  if (directiveIdx >= 0) out.push(convo[directiveIdx]);
  out.push(...convo.slice(tailStart));
  return out;
}
function renderForSummary(msgs) {
  return msgs.map((m) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    const calls = m.tool_calls?.length ? ` [called: ${m.tool_calls.map((t) => t.function?.name).filter(Boolean).join(", ")}]` : "";
    return `${m.role}${calls}: ${content}`;
  }).join("\n\n");
}
async function summarizeMiddle(stream, model, msgs, signal) {
  if (msgs.length === 0) return null;
  try {
    const res = await stream({
      messages: [
        {
          role: "system",
          content: "You compress an in-progress AI agent transcript into a concise MEMORY the agent keeps working from. Capture: the CURRENT outstanding instruction from the user (the most recent user message is authoritative \u2014 earlier requests it supersedes are history, not the active task), concrete facts/answers discovered, tool results that matter (ids, paths, values), decisions made, and what still remains to do. Be information-dense; drop pleasantries. No preamble."
        },
        { role: "user", content: renderForSummary(msgs) }
      ],
      model,
      signal
    });
    const out = (res.text ?? "").trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
async function buildWorkingTranscript(c, systemPrompt, stream, model) {
  const convo = c.transcript;
  const total = convo.reduce((sum, m) => sum + messageTokens(m), 0);
  if (total <= HISTORY_TOKEN_BUDGET) {
    c.compactMemo = null;
    return [{ role: "system", content: systemPrompt }, ...windowed(convo)];
  }
  const stale = !c.compactMemo || convo.length - c.compactMemo.atLen >= COMPACT_TAIL_TURNS;
  let note = c.compactMemo?.note ?? null;
  if (stale) {
    const { start, end } = compactMiddleRange(convo, COMPACT_TAIL_TURNS);
    const middle = convo.slice(start, end);
    const summary = await summarizeMiddle(stream, model, middle, c.abort?.signal);
    if (summary != null) {
      note = `Compressed memory of ${middle.length} earlier step(s):
${summary}`;
      c.compactMemo = { note, atLen: convo.length };
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: "context.compacted",
        args: { droppedMessages: middle.length },
        result: `Compressed ${middle.length} earlier step(s) into a memory to stay within the context window.`
      });
      emit(c);
    }
  }
  if (note == null) {
    return [{ role: "system", content: systemPrompt }, ...windowed(convo)];
  }
  return assembleCompacted(systemPrompt, convo, note, COMPACT_TAIL_TURNS);
}
function subscribeRunStore(listener) {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}
function getGlobalRunState() {
  const running = [];
  const awaiting = [];
  for (const [id, cell] of cells) {
    if (cell.pendingConfirm) awaiting.push(id);
    else if (cell.running) running.push(id);
  }
  return { running, awaiting };
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
function stopRun(chatId) {
  const c = cells.get(chatId);
  if (!c || !c.running) return;
  c.abort?.abort();
  if (c.confirmResolver) {
    const resolve = c.confirmResolver;
    c.confirmResolver = null;
    c.pendingConfirm = null;
    resolve(false);
  }
  c.streamingText = "";
  pushTrace(c, { ts: nowIso(), category: "message", label: "agent.stopped", result: "Stopped by user." });
}
function clearRunError(chatId) {
  if (chatId == null) return;
  const c = cells.get(chatId);
  if (!c || !c.error) return;
  c.error = "";
  emit(c);
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
  c.byoUnresolved = [];
  c.providerCap = [];
  c.codeChanged = false;
  c.ticketRecorded = false;
  c.touchedFiles = [];
  c.abort = new AbortController();
  if (req.seed && c.transcript.length === 0) c.transcript = req.seed.slice();
  if (req.userTurn !== void 0) c.transcript.push({ role: "user", content: req.userTurn });
  emit(c);
  try {
    await runLoop(chatId, c, req);
  } catch (e) {
    if (!c.abort?.signal.aborted) c.error = e instanceof Error ? e.message : "Reply failed";
  } finally {
    const aborted = c.abort?.signal.aborted ?? false;
    c.running = false;
    c.streamingText = "";
    c.abort = null;
    if (!aborted && c.codeChanged && !c.ticketRecorded && req.projectId != null && req.runTool) {
      await recordCodeChangeTicket(chatId, c, req).catch(() => {
      });
    }
    if (!aborted && c.codeChanged && req.projectId != null && req.runTool) {
      await advanceLinkedTickets(chatId, c, req).catch(() => {
      });
    }
    emit(c);
  }
}
async function recordCodeChangeTicket(chatId, c, req) {
  if (!req.runTool || req.projectId == null) return;
  const files = c.touchedFiles.slice(0, 50);
  const summary = files.length ? `Code change (${files.length} file${files.length === 1 ? "" : "s"}) from Brain chat #${chatId}` : `Code change from Brain chat #${chatId}`;
  const toolStart = nowMs2();
  let out;
  try {
    out = await req.runTool("builtin_tickets_from_delta", {
      projectId: req.projectId,
      summary,
      detail: "Auto-captured: this chat changed code without recording a ticket, so the platform minted one to keep the work visible on the board and linked to the conversation.",
      files,
      kind: "improvement",
      modality: "ide",
      chatId
    });
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  pushDurableStep(c, chatId, req.persistence, {
    ts: nowIso(),
    category: "tool",
    label: "builtin_tickets_from_delta",
    durationMs: nowMs2() - toolStart,
    args: { projectId: req.projectId, summary, files, auto: true, chatId },
    result: out ?? null,
    isError: isFailedToolResult(out)
  });
}
async function advanceLinkedTickets(chatId, c, req) {
  if (!req.runTool) return;
  let listed;
  try {
    listed = await req.runTool("builtin_chats_list_tickets", { chatId });
  } catch {
    return;
  }
  const toAdvance = linkedTicketsToAdvance(listed);
  for (const t of toAdvance) {
    const id = Number(t.ref);
    if (!Number.isInteger(id)) continue;
    const toolStart = nowMs2();
    let out;
    try {
      out = await req.runTool("builtin_tasks_update", { id, status: "in_progress" });
    } catch (e) {
      out = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    pushDurableStep(c, chatId, req.persistence, {
      ts: nowIso(),
      category: "tool",
      label: "builtin_tasks_update",
      durationMs: nowMs2() - toolStart,
      args: { id, status: "in_progress", auto: true, reason: "worked-ticket-off-backlog" },
      result: out ?? null,
      isError: isFailedToolResult(out)
    });
  }
}
async function autoLinkCreatedItem(chatId, c, persistence, runTool, toolName, out) {
  const link = workItemLinkFromCreate(toolName, out);
  if (!link) return;
  const toolStart = nowMs2();
  let result;
  try {
    result = await runTool("builtin_chats_link_ticket", {
      chatId,
      kind: link.kind,
      ref: link.ref,
      linkType: link.linkType
    });
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!isFailedToolResult(result)) c.ticketRecorded = true;
  pushDurableStep(c, chatId, persistence, {
    ts: nowIso(),
    category: "tool",
    label: "builtin_chats_link_ticket",
    durationMs: nowMs2() - toolStart,
    args: { chatId, kind: link.kind, ref: link.ref, linkType: link.linkType, auto: true },
    result: result ?? null,
    isError: isFailedToolResult(result)
  });
}
async function runLoop(chatId, c, req) {
  const { resolvedSystemPrompt, tools: toolSpecs, model, runTool, needsConfirm, stream, persistence, onActivity, evermind } = req;
  const convo = c.transcript;
  const tools = toolSpecs && toolSpecs.length > 0 ? toolSpecs : void 0;
  let systemPrompt = resolvedSystemPrompt;
  let recalled = null;
  if (evermind?.recall) {
    const query = latestUserText(convo);
    if (query) {
      try {
        recalled = await evermind.recall(query);
      } catch {
        recalled = null;
      }
      if (recalled?.seeded && recalled.items.length > 0) {
        const block = formatEvermindMemoryBlock(recalled.items);
        if (block) {
          systemPrompt = `${systemPrompt}

${block}`;
          pushDurableStep(c, chatId, persistence, {
            ts: nowIso(),
            category: "recall",
            label: "evermind.recall",
            args: { query, version: recalled.version },
            result: { count: recalled.items.length, version: recalled.version, mode: recalled.mode, items: recalled.items }
          });
        }
      }
    }
  }
  if (evermind?.answer && !c.abort?.signal.aborted) {
    const query = latestUserText(convo);
    if (query) {
      let memAnswer = null;
      try {
        memAnswer = await evermind.answer(query);
      } catch {
        memAnswer = null;
      }
      const finalText = memAnswer?.text.trim();
      if (finalText) {
        convo.push({ role: "assistant", content: finalText });
        const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: finalText }]);
        c.streamingText = "";
        recordAppended(c, assistantMsg);
        pushDurableStep(c, chatId, persistence, {
          ts: nowIso(),
          category: "recall",
          label: memAnswer.source === "evermind" ? "evermind.answer" : "memory.answer",
          args: { query },
          result: {
            source: memAnswer.source,
            skippedLlm: true,
            ...memAnswer.evermindVersion != null ? { version: memAnswer.evermindVersion } : {}
          }
        });
        emit(c);
        onActivity?.(chatId);
        return;
      }
    }
  }
  if (req.augmentSystemPrompt) {
    try {
      const extra = await req.augmentSystemPrompt(latestUserText(convo));
      if (typeof extra === "string" && extra.trim()) {
        systemPrompt = `${systemPrompt}

${extra}`;
      }
    } catch {
    }
  }
  systemPrompt = `${systemPrompt}

${chatWorkLinkingDirective(chatId)}`;
  const readDedupe = /* @__PURE__ */ new Set();
  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    if (c.abort?.signal.aborted) return;
    c.streamingText = "";
    emit(c);
    const working = await buildWorkingTranscript(c, systemPrompt, stream, model);
    if (c.abort?.signal.aborted) return;
    const llmStart = nowMs2();
    let firstTokenAt;
    let result;
    try {
      result = await stream(
        { messages: working, tools, tool_choice: tools ? "auto" : void 0, model, signal: c.abort?.signal },
        { onTextDelta: (d) => {
          if (firstTokenAt === void 0) firstTokenAt = nowMs2();
          c.streamingText += d;
          emit(c);
        } }
      );
    } catch (e) {
      if (c.abort?.signal.aborted) return;
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
    accrueByoUnresolved(c, result.byoUnresolved);
    accrueProviderCap(c, result.providerCap);
    const resolved = result.resolvedModel ?? model ?? "default";
    const requested = model ?? "default";
    if (requested !== "default" && resolved !== "default" && resolved !== requested) {
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: "llm.model_downgrade",
        args: { requestedModel: requested, model: resolved, step: iter },
        result: `Gateway answered with ${resolved} instead of the requested ${requested} (failover) \u2014 a smaller context window can truncate long transcripts.`
      });
    }
    pushTrace(c, {
      ts: nowIso(),
      category: "llm",
      label: "llm.complete",
      durationMs: nowMs2() - llmStart,
      ttftMs: firstTokenAt !== void 0 ? firstTokenAt - llmStart : void 0,
      // `model` is the model the gateway ACTUALLY used (resolved), falling back to
      // what we requested when the gateway didn't report one. `requestedModel`
      // keeps the caller's ask (empty/'default' ⇒ gateway auto-selects) so triage
      // can tell "what I asked for" from "what answered".
      args: {
        model: resolved,
        requestedModel: requested,
        step: iter,
        toolCalls: result.toolCalls.length,
        // Which account served the turn + any connected-BYO provider the gateway
        // could NOT resolve — so triage tells "ran on the shared pool despite a
        // connected Claude account (expired?)" apart from "nothing connected".
        account: result.account,
        byoUnresolved: result.byoUnresolved
      },
      // Structured diagnostics fields — the A-vs-B triage reads these directly.
      usage: result.usage,
      finishReason: result.finishReason,
      textChars: result.text.length,
      result: `${result.toolCalls.length} tool call(s) \xB7 ${result.text.length} chars \xB7 finish: ${result.finishReason ?? "\u2014"}${result.usage?.prompt != null ? ` \xB7 prompt ${result.usage.prompt} tok` : ""}`
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
        const meta = provenanceMetadata(result);
        const [narrationMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: result.text, ...meta ? { metadata: meta } : {} }]);
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
            pushDurableStep(c, chatId, persistence, { ts: nowIso(), category: "tool", label: tc.name, args, result: { cancelled: true, reason: "User declined this action." } });
            continue;
          }
        }
        const isReadTool = isDedupableRead(tc.name);
        const dedupeKey = `${tc.name}:${tc.args ?? ""}`;
        if (isReadTool) {
          if (readDedupe.has(dedupeKey)) {
            const stub = {
              note: `Duplicate ${tc.name} call \u2014 identical arguments to an earlier call this turn, whose result is already in the conversation above. Reuse that result instead of re-reading; do not repeat it (this saves context and avoids looping).`
            };
            convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(stub) });
            pushTrace(c, { ts: nowIso(), category: "tool", label: tc.name, args, result: stub });
            continue;
          }
        } else {
          readDedupe.clear();
        }
        const toolStart = nowMs2();
        let out;
        try {
          out = await runTool(tc.name, args);
        } catch (e) {
          const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          out = { ok: false, error: message };
          convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
          pushDurableStep(c, chatId, persistence, { ts: nowIso(), category: "tool", label: tc.name, durationMs: nowMs2() - toolStart, args, result: out, isError: true });
          continue;
        }
        if (isCodeChangeTool(tc.name)) {
          c.codeChanged = true;
          const f = codeChangeFile(args);
          if (f && !c.touchedFiles.includes(f)) c.touchedFiles.push(f);
        }
        if (isTicketRecordingTool(tc.name)) c.ticketRecorded = true;
        if (runTool) await autoLinkCreatedItem(chatId, c, persistence, runTool, tc.name, out);
        const trimmedOut = trimToolResult(out ?? null);
        convo.push({ role: "tool", tool_call_id: tc.id, content: trimmedOut.content });
        pushDurableStep(c, chatId, persistence, {
          ts: nowIso(),
          category: "tool",
          label: tc.name,
          durationMs: nowMs2() - toolStart,
          args,
          result: out ?? null,
          isError: isFailedToolResult(out),
          resultBytes: trimmedOut.bytes,
          truncated: trimmedOut.truncated
        });
        if (isReadTool && !isFailedToolResult(out)) readDedupe.add(dedupeKey);
      }
      continue;
    }
    const finalText = result.text.trim() || "No response.";
    convo.push({ role: "assistant", content: finalText });
    const finalMeta = provenanceMetadata(result);
    const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: finalText, ...finalMeta ? { metadata: finalMeta } : {} }]);
    c.streamingText = "";
    recordAppended(c, assistantMsg);
    emit(c);
    const learn = assistantMsg?.evermindLearn;
    if (learn?.learned) {
      pushDurableStep(c, chatId, persistence, {
        ts: nowIso(),
        category: "learn",
        label: "evermind.learn",
        result: { version: learn.version, queued: true }
      });
      const reconciled = recalled?.items ? countReconciledMemories(recalled.items, finalText) : 0;
      if (reconciled > 0) {
        pushDurableStep(c, chatId, persistence, {
          ts: nowIso(),
          category: "reconcile",
          label: "evermind.reconcile",
          result: { count: reconciled, version: learn.version }
        });
      }
    } else if (learn && learn.reason && learn.reason !== "too-short") {
      pushDurableStep(c, chatId, persistence, {
        ts: nowIso(),
        category: "learn",
        label: "evermind.learn",
        result: { version: learn.version, skipped: true, reason: learn.reason }
      });
    }
    if (evermind?.cacheAnswer) {
      const q = latestUserText(convo);
      if (q) {
        void Promise.resolve(evermind.cacheAnswer(q, finalText)).catch(() => {
        });
      }
    }
    onActivity?.(chatId);
    return;
  }
  c.streamingText = "";
  if (!c.abort?.signal.aborted) {
    const closeStart = nowMs2();
    try {
      const working = [
        { role: "system", content: systemPrompt },
        ...windowed(convo),
        {
          role: "user",
          content: "You have reached your tool-call budget for this turn. Do NOT call any more tools. Answer the user now, in prose, using what you have already gathered \u2014 summarise your findings and state plainly anything you could not finish."
        }
      ];
      let closeFirstTokenAt;
      const closing = await stream(
        // No `tools` → the model can't call another tool and must produce text.
        { messages: working, model, signal: c.abort?.signal },
        { onTextDelta: (d) => {
          if (closeFirstTokenAt === void 0) closeFirstTokenAt = nowMs2();
          c.streamingText += d;
          emit(c);
        } }
      );
      accrueByoUnresolved(c, closing.byoUnresolved);
      accrueProviderCap(c, closing.providerCap);
      pushTrace(c, {
        ts: nowIso(),
        category: "llm",
        label: "llm.complete",
        durationMs: nowMs2() - closeStart,
        ttftMs: closeFirstTokenAt !== void 0 ? closeFirstTokenAt - closeStart : void 0,
        args: { model: closing.resolvedModel ?? model ?? "default", requestedModel: model ?? "default", step: MAX_TOOL_ITERATIONS, toolCalls: 0, forcedFinish: true, account: closing.account, byoUnresolved: closing.byoUnresolved },
        usage: closing.usage,
        finishReason: closing.finishReason,
        textChars: closing.text.length,
        result: `forced final synthesis (tool budget reached) \xB7 ${closing.text.length} chars \xB7 finish: ${closing.finishReason ?? "\u2014"}`
      });
      const closingText = closing.text.trim();
      if (closingText) {
        convo.push({ role: "assistant", content: closingText });
        const meta = provenanceMetadata(closing);
        const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: closingText, ...meta ? { metadata: meta } : {} }]);
        c.streamingText = "";
        recordAppended(c, assistantMsg);
        emit(c);
        onActivity?.(chatId);
        return;
      }
    } catch (e) {
      if (c.abort?.signal.aborted) return;
    }
  }
  if (c.abort?.signal.aborted) return;
  c.streamingText = "";
  pushTrace(c, {
    ts: nowIso(),
    category: "error",
    label: "agent.loop",
    result: `Loop exhausted after ${MAX_TOOL_ITERATIONS} tool iterations (a forced final answer without tools also came back empty)`,
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
    projectId,
    extraSystem,
    systemPrompt,
    model,
    toolSpecs,
    runTool,
    needsConfirm,
    ensureChatId,
    onActivity,
    onFirstUserTurn,
    evermind,
    augmentSystemPrompt
  } = options;
  const [messages, setMessages] = useState5([]);
  const [loadingMessages, setLoadingMessages] = useState5(false);
  const [reloadNonce, setReloadNonce] = useState5(0);
  const reloadMessages = useCallback4(() => setReloadNonce((n) => n + 1), []);
  const [localSending, setLocalSending] = useState5(false);
  const [localError, setLocalError] = useState5("");
  const [copiedMessageId, setCopiedMessageId] = useState5(null);
  const [feedbackMap, setFeedbackMap] = useState5({});
  const [pendingAttachments, setPendingAttachments] = useState5([]);
  const [uploading, setUploading] = useState5(false);
  const autoRepliedChatIdRef = useRef4(null);
  const [snapshot, setSnapshot] = useState5(() => getRunSnapshot(chatId));
  useEffect5(() => {
    setSnapshot(getRunSnapshot(chatId));
    if (chatId == null) return;
    return subscribeRun(chatId, () => setSnapshot(getRunSnapshot(chatId)));
  }, [chatId]);
  useEffect5(() => {
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
  }, [persistence, chatId, reloadNonce]);
  useEffect5(() => {
    const appended = snapshot.appended;
    if (appended.length === 0) return;
    setMessages((prev) => {
      const have = new Set(prev.map((m) => m.id));
      const fresh = appended.filter((m) => !have.has(m.id));
      return fresh.length === 0 ? prev : [...prev, ...fresh];
    });
  }, [snapshot.messagesEpoch, snapshot.appended]);
  useEffect5(() => {
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
  const buildRequest = useCallback4(
    (seed, userTurn) => ({
      resolvedSystemPrompt: fullSystemPrompt,
      tools: toolSpecs && toolSpecs.length > 0 ? toolSpecs : void 0,
      model,
      runTool,
      needsConfirm,
      stream,
      persistence,
      onActivity,
      evermind,
      augmentSystemPrompt,
      seed,
      userTurn,
      projectId
    }),
    [fullSystemPrompt, toolSpecs, model, runTool, needsConfirm, stream, persistence, onActivity, evermind, augmentSystemPrompt, projectId]
  );
  const send = useCallback4(
    async (text, opts) => {
      const trimmed = text.trim();
      if (!trimmed || localSending || isRunning(chatId)) return false;
      const addressedTo = opts?.addressedTo ?? null;
      let id = chatId;
      if (id == null) {
        id = await ensureChatId?.() ?? null;
        if (id == null) {
          setLocalError("Could not start a chat.");
          return false;
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
      const metadata = withDirectedMetadata(addressedTo, attachments.length > 0 ? { attachments } : void 0);
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
        onActivity?.(id);
        if (messages.length === 0) onFirstUserTurn?.(id, trimmed);
        if (addressedTo) {
          if (addressedTo.kind === "agent" && persistence.requestAgentReply) {
            try {
              const reply = await persistence.requestAgentReply(id, { agentRef: addressedTo.ref, agentName: addressedTo.name });
              setMessages((prev) => [...prev, reply]);
              onActivity?.(id);
            } catch (e) {
              setLocalError(e instanceof Error ? e.message : "The agent could not reply.");
            }
          }
          return true;
        }
        const seed = scopeToConsolidation(messages).filter((m) => !isStepMessage(m)).map((m) => ({
          role: m.role,
          content: m.content
        }));
        await startRun(id, buildRequest(seed, modelContent));
        return true;
      } catch (e) {
        setPendingAttachments(attachments);
        setLocalError(e instanceof Error ? e.message : "Send failed");
        return false;
      } finally {
        setLocalSending(false);
      }
    },
    [persistence, chatId, localSending, pendingAttachments, messages, ensureChatId, buildRequest, onActivity, onFirstUserTurn]
  );
  useEffect5(() => {
    if (chatId == null || loadingMessages || localSending || messages.length === 0) return;
    if (isRunning(chatId)) return;
    const last = messages[messages.length - 1];
    if (last.role !== "user") return;
    if (isDirectedToParticipant(last)) return;
    if (autoRepliedChatIdRef.current === chatId) return;
    autoRepliedChatIdRef.current = chatId;
    setLocalError("");
    const seed = scopeToConsolidation(messages.slice(0, -1)).filter((m) => !isStepMessage(m)).map((m) => ({
      role: m.role,
      content: m.content
    }));
    void startRun(chatId, buildRequest(seed, last.content));
  }, [chatId, loadingMessages, localSending, messages, buildRequest]);
  const copyMessage = useCallback4(async (msg) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMessageId(msg.id);
      setTimeout(() => setCopiedMessageId((cur) => cur === msg.id ? null : cur), 2e3);
    } catch {
    }
  }, []);
  const submitFeedback = useCallback4(async (msg, value) => {
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
  const attach = useCallback4(async (file) => {
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
  const removeAttachment = useCallback4((key) => {
    setPendingAttachments((prev) => prev.filter((a) => a.key !== key));
  }, []);
  const resolveConfirm = useCallback4((ok) => {
    if (chatId != null) resolveRunConfirm(chatId, ok);
  }, [chatId]);
  const clearError = useCallback4(() => {
    setLocalError("");
    clearRunError(chatId);
  }, [chatId]);
  const stop = useCallback4(() => {
    if (chatId != null) stopRun(chatId);
  }, [chatId]);
  const buildTriageReport = useCallback4(
    (agentLabel, surface) => buildBrainTriageReport({
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      events: getRunTrace(chatId),
      messages,
      chatId,
      agentLabel,
      surface,
      configuredModel: model,
      error: localError || snapshot.error
    }),
    [chatId, messages, localError, snapshot.error, model]
  );
  return {
    messages,
    loadingMessages,
    reloadMessages,
    sending: localSending || snapshot.running,
    error: localError || snapshot.error,
    streamingText: snapshot.streamingText,
    copiedMessageId,
    feedbackMap,
    pendingAttachments,
    uploading,
    send,
    stop,
    copyMessage,
    submitFeedback,
    attach,
    removeAttachment,
    setError: setLocalError,
    clearError,
    pendingConfirm: snapshot.pendingConfirm,
    resolveConfirm,
    hasTrace: snapshot.hasTrace,
    trace: snapshot.trace,
    /** Connected providers the gateway couldn't use this run (e.g. an expired Claude
     *  subscription) — a mounted view renders a passive "reconnect your account"
     *  banner off this. Empty when everything resolved. */
    byoUnresolved: snapshot.byoUnresolved,
    providerCap: snapshot.providerCap,
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

// src/chatDiagnostics.ts
function fmtProject(id, name) {
  if (id == null) return "none";
  return name ? `${name} (#${id})` : `#${id}`;
}
function diagnosticsSignals(d) {
  const out = [];
  const ev = d.evermind;
  if (d.projectId == null || d.lastLearn?.reason === "not-attached") {
    out.push(
      "\u26A0\uFE0F Chat is NOT attached to a project (chat.projectId is null). The learn gate keys on the CHAT's project, so this chat contributes NOTHING to any Evermind \u2014 even though the panel shows the selected project as connected. Attach the chat to a project (or re-open it so the self-heal adopts the active project)."
    );
  } else if (d.selectedProjectId != null && d.selectedProjectId !== d.projectId) {
    out.push(
      `\u26A0\uFE0F Chat's project (#${d.projectId}) differs from the panel's selected project (#${d.selectedProjectId}). The Evermind panel reflects the SELECTED project; this chat feeds project #${d.projectId}. They are different models \u2014 compare the versions below.`
    );
  }
  if (ev && ev.version < 1) {
    out.push(
      `\u26A0\uFE0F The chat's project Evermind is UNSEEDED (v0). Until a base model is seeded (version \u2265 1) the gate returns "not-seeded" and no turn contributes. This is why a learn step can report v0.`
    );
  }
  if (ev && ev.version >= 1 && ev.mode !== "connected") {
    out.push(`\u26A0\uFE0F The chat's project Evermind is "${ev.mode}" (not connected) \u2014 read-only, so turns don't contribute.`);
  }
  if (d.lastLearn && d.lastLearn.learned && ev && ev.version >= 1 && d.lastLearn.version !== ev.version) {
    out.push(
      `\u26A0\uFE0F Last turn reported learn version v${d.lastLearn.version} but the chat's project head is v${ev.version}. A version mismatch means the learn step and the panel are resolving DIFFERENT projects/heads.`
    );
  }
  if ((d.agents?.length ?? 0) === 0) {
    out.push("\u2139\uFE0F No agents are invited into this chat (chats.list_agents is empty), so dispatched agents post nothing back here.");
  }
  return out;
}
function formatChatDiagnostics(d) {
  const lines = ["## Chat diagnostics"];
  if (d.surface) lines.push(`- Surface: ${d.surface}`);
  lines.push(`- Chat: ${d.chatTitle?.trim() ? `"${d.chatTitle.trim()}"` : "Untitled"}${d.chatId != null ? ` (#${d.chatId})` : ""}${d.chatVisibility ? ` \xB7 ${d.chatVisibility}` : ""}`);
  lines.push(`- Chat's project: ${fmtProject(d.projectId, d.projectName)}`);
  if (d.selectedProjectId != null && d.selectedProjectId !== d.projectId) {
    lines.push(`- Panel's selected project: #${d.selectedProjectId}`);
  }
  lines.push(`- Tenant: ${d.tenantId != null ? `#${d.tenantId}` : "unknown"} \xB7 User: ${d.userId ?? "unknown"}`);
  const ev = d.evermind;
  if (ev) {
    lines.push(
      `- Evermind (chat's project): v${ev.version} \xB7 ${ev.mode}${ev.inferenceEnabled != null ? ` \xB7 inference ${ev.inferenceEnabled ? "on" : "off"}` : ""} \xB7 teacher ${ev.teacherModel ? ev.teacherModel : "none"}${ev.contributions != null ? ` \xB7 Learned ${ev.contributions}` : ""}${ev.pending != null ? ` \xB7 Queued ${ev.pending}` : ""} \xB7 Last learned ${ev.lastLearnedAt ? ev.lastLearnedAt : "never"}`
    );
  } else {
    lines.push(`- Evermind (chat's project): not resolved (no project, or head unavailable)`);
  }
  if (d.lastLearn) {
    lines.push(
      `- Last turn learn gate: learned=${d.lastLearn.learned} \xB7 reported v${d.lastLearn.version}${d.lastLearn.reason ? ` \xB7 reason=${d.lastLearn.reason}` : ""}`
    );
  } else {
    lines.push("- Last turn learn gate: unknown (no assistant turn carried a learn outcome)");
  }
  const agents = d.agents ?? [];
  lines.push(`- Agents in chat (${agents.length})${agents.length ? ": " + agents.map((a) => `${a.agentRef} (${a.role})`).join(", ") : ""}`);
  const tickets = d.tickets ?? [];
  if (tickets.length) {
    lines.push(`- Linked tickets (${tickets.length}):`);
    for (const tk of tickets) {
      lines.push(`  - ${tk.kind} #${tk.ref}${tk.label ? ` "${tk.label}"` : ""}${tk.linkType || tk.status ? ` [${[tk.linkType, tk.status].filter(Boolean).join(", ")}]` : ""}`);
    }
  } else {
    lines.push("- Linked tickets (0)");
  }
  const signals = diagnosticsSignals(d);
  if (signals.length) {
    lines.push("", "### Signals");
    for (const s of signals) lines.push(`- ${s}`);
  }
  return lines;
}
export {
  ADDRESSED_TO_META_KEY,
  AUTHORED_BY_META_KEY,
  BrainActionsProvider,
  BrainContextProvider,
  BrainProvider,
  CODE_CHANGE_TOOLS,
  CONSOLIDATION_MARKER_PREFIX,
  CONSOLIDATION_META,
  DEFAULT_CHAT_TITLE,
  EVERMIND_LEARN_MIN_CHARS,
  NOT_STARTED_TASK_STATUSES,
  PROVENANCE_META_KEY,
  STEP_MESSAGE_ROLE,
  TICKET_RECORDING_TOOLS,
  accountUsedInTrace,
  activeMentionToken,
  attachEvermindLearn,
  buildBrainTriageReport,
  byoReasonHint,
  byoUnresolvedInTrace,
  byoUnresolvedSummary,
  chatWorkLinkingDirective,
  clearRunError,
  codeChangeFile,
  computeBrainDiagnostics,
  consolidationMarkerContent,
  consolidationMetadata,
  countReconciledMemories,
  deriveChatTitle,
  filterMentionCandidates,
  formatBrainDiagnostics,
  formatBrainProvenance,
  formatChatDiagnostics,
  formatEvermindLearnStep,
  formatEvermindMemoryBlock,
  getGlobalRunState,
  getRunSnapshot,
  getRunTrace,
  isCodeChangeTool,
  isConnectedAccountUnused,
  isConsolidationMarker,
  isDirectedToParticipant,
  isEvermindModel,
  isFailedToolResult,
  isRunning,
  isStepMessage,
  isTicketRecordingTool,
  lastConsolidationIndex,
  linkedTicketsToAdvance,
  mentionRecipient,
  modelsUsedInTrace,
  parseByoUnresolved,
  parseDirectedRecipient,
  parseMessageAuthor,
  parseMessageProvenance,
  prepareImageDataUrl,
  resolveRecipient,
  resolveRunConfirm,
  startRun as runBrainLoop,
  savePendingPrompt,
  scopeToConsolidation,
  startRun,
  stopRun,
  streamChatCompletion,
  subscribeRun,
  subscribeRunStore,
  takePendingPrompt,
  useBrainActions,
  useBrainChats,
  useBrainConfig,
  useBrainContext,
  useBrainConversation,
  useMcpExtensions,
  useOptionalBrainContext,
  useRegisterBrainActions,
  withDirectedMetadata,
  withProvenanceMetadata,
  workItemLinkFromCreate
};
//# sourceMappingURL=index.mjs.map