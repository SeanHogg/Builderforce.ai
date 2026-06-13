// src/config.tsx
import { createContext, useContext, useMemo } from "react";

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
import { useEffect as useEffect2, useMemo as useMemo3, useState as useState2 } from "react";
function useMcpExtensions(options) {
  const { transport } = useBrainConfig();
  const [entries, setEntries] = useState2([]);
  const [loading, setLoading] = useState2(true);
  const skipKey = (options?.skipExtensionIds ?? []).join(",");
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
import { createContext as createContext3, useCallback as useCallback2, useContext as useContext3, useMemo as useMemo4, useState as useState3 } from "react";
import { jsx as jsx3 } from "react/jsx-runtime";
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
  const setContext = useCallback2((patch) => {
    setPageContext((prev) => {
      const next = { ...prev, ...patch };
      if (next.projectId === prev.projectId && next.viewingProjectId === prev.viewingProjectId && next.modality === prev.modality && next.extraSystem === prev.extraSystem && next.initialChatId === prev.initialChatId) {
        return prev;
      }
      return next;
    });
  }, []);
  const value = useMemo4(
    () => ({ ...pageContext, open, setOpen, setContext }),
    [pageContext, open, setContext]
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
import { useCallback as useCallback3, useEffect as useEffect3, useMemo as useMemo5, useRef as useRef2, useState as useState4 } from "react";
function useBrainChats(options = {}) {
  const { persistence } = useBrainConfig();
  const { filterProjectId, pinnedProjectId } = options;
  const [chats, setChats] = useState4([]);
  const [loading, setLoading] = useState4(true);
  const [error, setError] = useState4("");
  const [activeChatId, setActiveChatId] = useState4(null);
  const assigningRef = useRef2(false);
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
  useEffect3(() => {
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
  }, [persistence, chats]);
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
  }, [persistence, defaultProjectId]);
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
      setActiveChatId((cur) => cur === id ? null : cur);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [persistence]);
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
  }, [reload]);
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
    summarize,
    remove,
    assignToProject,
    reload,
    touch
  };
}

// src/useBrainConversation.ts
import { useCallback as useCallback4, useEffect as useEffect4, useMemo as useMemo6, useRef as useRef3, useState as useState5 } from "react";
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
  const [messages, setMessages] = useState5([]);
  const [loadingMessages, setLoadingMessages] = useState5(false);
  const [sending, setSending] = useState5(false);
  const [error, setError] = useState5("");
  const [streamingText, setStreamingText] = useState5("");
  const [copiedMessageId, setCopiedMessageId] = useState5(null);
  const [feedbackMap, setFeedbackMap] = useState5({});
  const [pendingAttachments, setPendingAttachments] = useState5([]);
  const [uploading, setUploading] = useState5(false);
  const autoRepliedChatIdRef = useRef3(null);
  const transcriptRef = useRef3(/* @__PURE__ */ new Map());
  useEffect4(() => {
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
  useEffect4(() => {
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
  const resolvedSystemPrompt = useMemo6(() => {
    const base = systemPrompt ?? resolveSystemPrompt(modality);
    return extraSystem ? `${base}
${extraSystem}` : base;
  }, [resolveSystemPrompt, systemPrompt, modality, extraSystem]);
  const startUserTurn = useCallback4((id, priorHistory, userContent) => {
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
  const runAgentLoop = useCallback4(
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
        const result = await stream(
          { messages: working, tools, tool_choice: tools ? "auto" : void 0, model },
          { onTextDelta: (d) => setStreamingText((s) => s + d) }
        );
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
              continue;
            }
            const out = await runTool(tc.name, args);
            convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out ?? null) });
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
      setError("The assistant kept calling tools without finishing. Try rephrasing.");
    },
    [persistence, stream, resolvedSystemPrompt, toolSpecs, runTool, confirmTool, onActivity, model]
  );
  const send = useCallback4(
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
  useEffect4(() => {
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
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [persistence]);
  const removeAttachment = useCallback4((key) => {
    setPendingAttachments((prev) => prev.filter((a) => a.key !== key));
  }, []);
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
    setError
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
export {
  BrainActionsProvider,
  BrainContextProvider,
  BrainProvider,
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
};
//# sourceMappingURL=index.mjs.map