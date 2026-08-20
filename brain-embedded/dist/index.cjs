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
  ADDRESSED_TO_META_KEY: () => ADDRESSED_TO_META_KEY,
  API_VERSION_PROBE_TIMEOUT_MS: () => API_VERSION_PROBE_TIMEOUT_MS,
  API_VERSION_TTL_MS: () => API_VERSION_TTL_MS,
  AUTHORED_BY_META_KEY: () => AUTHORED_BY_META_KEY,
  BUILDERFORCE_PRODUCT_NAME: () => BUILDERFORCE_PRODUCT_NAME,
  BrainActionsProvider: () => BrainActionsProvider,
  BrainContextProvider: () => BrainContextProvider,
  BrainProvider: () => BrainProvider,
  BrainRequestError: () => BrainRequestError,
  CHAT_MODES: () => CHAT_MODES,
  CODE_CHANGE_TOOLS: () => CODE_CHANGE_TOOLS,
  CONSOLIDATION_MARKER_PREFIX: () => CONSOLIDATION_MARKER_PREFIX,
  CONSOLIDATION_META: () => CONSOLIDATION_META,
  DEFAULT_CHAT_TITLE: () => DEFAULT_CHAT_TITLE,
  DEFAULT_MODEL_CHOICE_LABELS: () => DEFAULT_MODEL_CHOICE_LABELS,
  DEFAULT_MODEL_IDENTITY: () => DEFAULT_MODEL_IDENTITY,
  DEFAULT_TOOL_LIMIT: () => DEFAULT_TOOL_LIMIT,
  EVERMIND_LEARN_MIN_CHARS: () => EVERMIND_LEARN_MIN_CHARS,
  MODEL_CATEGORIES: () => MODEL_CATEGORIES,
  NEW_CHAT_MODE: () => NEW_CHAT_MODE,
  NOT_STARTED_TASK_STATUSES: () => NOT_STARTED_TASK_STATUSES,
  PROJECT_EVERMIND_MODEL_PREFIX: () => PROJECT_EVERMIND_MODEL_PREFIX,
  PROVENANCE_META_KEY: () => PROVENANCE_META_KEY,
  RESTING_CHAT_MODE: () => RESTING_CHAT_MODE,
  STEP_MESSAGE_ROLE: () => STEP_MESSAGE_ROLE,
  TICKET_RECORDING_TOOLS: () => TICKET_RECORDING_TOOLS,
  TOOL_ROUTER_DESCRIBE: () => TOOL_ROUTER_DESCRIBE,
  TOOL_ROUTER_FIND: () => TOOL_ROUTER_FIND,
  TOOL_ROUTER_INVOKE: () => TOOL_ROUTER_INVOKE,
  XmlToolCallFilter: () => XmlToolCallFilter,
  accountUsedInTrace: () => accountUsedInTrace,
  activeMentionToken: () => activeMentionToken,
  activeModelKey: () => activeModelKey,
  allowanceState: () => allowanceState,
  announcesUntakenAction: () => announcesUntakenAction,
  attachEvermindLearn: () => attachEvermindLearn,
  brainRequestError: () => brainRequestError,
  buildBrainTriageReport: () => buildBrainTriageReport,
  buildModelItems: () => buildModelItems,
  byoReasonHint: () => byoReasonHint,
  byoUnresolvedInTrace: () => byoUnresolvedInTrace,
  byoUnresolvedSummary: () => byoUnresolvedSummary,
  byoVendorLabel: () => byoVendorLabel,
  catalogToolNamesMentionedIn: () => catalogToolNamesMentionedIn,
  chatConversationDirective: () => chatConversationDirective,
  chatErrorAction: () => chatErrorAction,
  chatModeDirective: () => chatModeDirective,
  chatWorkDirective: () => chatWorkDirective,
  chatWorkLinkingDirective: () => chatWorkLinkingDirective,
  claimsMissingToolData: () => claimsMissingToolData,
  classifyModelFunding: () => classifyModelFunding,
  clearRunError: () => clearRunError,
  codeChangeFile: () => codeChangeFile,
  computeBrainDiagnostics: () => computeBrainDiagnostics,
  consolidationMarkerContent: () => consolidationMarkerContent,
  consolidationMetadata: () => consolidationMetadata,
  countReconciledMemories: () => countReconciledMemories,
  deriveChatTitle: () => deriveChatTitle,
  describeTool: () => describeTool,
  detectAnnouncedButUnmadeToolCall: () => detectAnnouncedButUnmadeToolCall,
  detectUnbackedTicketClaim: () => detectUnbackedTicketClaim,
  detectUnbackedWriteClaim: () => detectUnbackedWriteClaim,
  displayModelName: () => displayModelName,
  effortProfile: () => effortProfile,
  extractXmlToolCalls: () => extractXmlToolCalls,
  fetchApiVersionVia: () => fetchApiVersionVia,
  fetchMcpToolEntries: () => fetchMcpToolEntries,
  filterMentionCandidates: () => filterMentionCandidates,
  filterModelItems: () => filterModelItems,
  findTools: () => findTools,
  formatBrainDiagnostics: () => formatBrainDiagnostics,
  formatBrainProvenance: () => formatBrainProvenance,
  formatChatDiagnostics: () => formatChatDiagnostics,
  formatEvermindLearnStep: () => formatEvermindLearnStep,
  formatEvermindMemoryBlock: () => formatEvermindMemoryBlock,
  gatherChatDiagnostics: () => gatherChatDiagnostics,
  getGlobalRunState: () => getGlobalRunState,
  getLastResolvedModel: () => getLastResolvedModel,
  getMcpToolStatus: () => getMcpToolStatus,
  getRunSnapshot: () => getRunSnapshot,
  getRunTrace: () => getRunTrace,
  handleRouterCall: () => handleRouterCall,
  isChatMode: () => isChatMode,
  isCodeChangeTool: () => isCodeChangeTool,
  isConnectedAccountUnused: () => isConnectedAccountUnused,
  isConsolidationMarker: () => isConsolidationMarker,
  isDirectedToParticipant: () => isDirectedToParticipant,
  isEffort: () => isEffort,
  isEvermindModel: () => isEvermindModel,
  isFailedToolResult: () => isFailedToolResult,
  isMalformedToolCall: () => isMalformedToolCall,
  isRouterTool: () => isRouterTool,
  isRunning: () => isRunning,
  isStepMessage: () => isStepMessage,
  isTicketRecordingTool: () => isTicketRecordingTool,
  isTruncatedTurn: () => isTruncatedTurn,
  isUserConfiguredModelRef: () => isUserConfiguredModelRef,
  lastConsolidationIndex: () => lastConsolidationIndex,
  linkedTicketsToAdvance: () => linkedTicketsToAdvance,
  mcpActionsFrom: () => mcpActionsFrom,
  mentionRecipient: () => mentionRecipient,
  modelCategoryLabel: () => modelCategoryLabel,
  modelFailoversInTrace: () => modelFailoversInTrace,
  modelInUse: () => modelInUse,
  modelsUsedInTrace: () => modelsUsedInTrace,
  narratedUnadvertisedInTrace: () => narratedUnadvertisedInTrace,
  nextFallbackModel: () => nextFallbackModel,
  normalizeChatMode: () => normalizeChatMode,
  parseByoUnresolved: () => parseByoUnresolved,
  parseDirectedRecipient: () => parseDirectedRecipient,
  parseMessageAuthor: () => parseMessageAuthor,
  parseMessageProvenance: () => parseMessageProvenance,
  parseStepMessage: () => parseStepMessage,
  perMillionUsd: () => perMillionUsd,
  premiumCostLabel: () => premiumCostLabel,
  prepareImageDataUrl: () => prepareImageDataUrl,
  productForPlan: () => productForPlan,
  productModelName: () => productModelName,
  ratedTurnContext: () => ratedTurnContext,
  ratedTurnTool: () => ratedTurnTool,
  reasoningForRun: () => reasoningForRun,
  resetApiVersionCache: () => resetApiVersionCache,
  resetBrainRunStore: () => resetBrainRunStore,
  resolveRecipient: () => resolveRecipient,
  resolveRunConfirm: () => resolveRunConfirm,
  revealsModelId: () => revealsModelId,
  routerToolSpecs: () => routerToolSpecs,
  routingQueryForTurn: () => routingQueryForTurn,
  runBrainLoop: () => startRun,
  savePendingPrompt: () => savePendingPrompt,
  scopeToConsolidation: () => scopeToConsolidation,
  selectToolsForTurn: () => selectToolsForTurn,
  setLastResolvedModel: () => setLastResolvedModel,
  setMcpToolStatus: () => setMcpToolStatus,
  stallRecoveriesInTrace: () => stallRecoveriesInTrace,
  stallUnrecoveredInTrace: () => stallUnrecoveredInTrace,
  startRun: () => startRun,
  stepSig: () => stepSig,
  stopRun: () => stopRun,
  streamChatCompletion: () => streamChatCompletion,
  subscribeRun: () => subscribeRun,
  subscribeRunStore: () => subscribeRunStore,
  subscribeToChatMessages: () => subscribeToChatMessages,
  takePendingPrompt: () => takePendingPrompt,
  toolExposureInTrace: () => toolExposureInTrace,
  toolNamesMentionedIn: () => toolNamesMentionedIn,
  toolSpecsFor: () => toolSpecsFor,
  traceWithPersistedSteps: () => traceWithPersistedSteps,
  turnInterruption: () => turnInterruption,
  turnOptimizationDirective: () => turnOptimizationDirective,
  useBrainActions: () => useBrainActions,
  useBrainChats: () => useBrainChats,
  useBrainConfig: () => useBrainConfig,
  useBrainContext: () => useBrainContext,
  useBrainConversation: () => useBrainConversation,
  useMcpExtensions: () => useMcpExtensions,
  useOptionalBrainContext: () => useOptionalBrainContext,
  useRegisterBrainActions: () => useRegisterBrainActions,
  withDirectedMetadata: () => withDirectedMetadata,
  withProvenanceMetadata: () => withProvenanceMetadata,
  workItemLinkFromCreate: () => workItemLinkFromCreate
});
module.exports = __toCommonJS(src_exports);

// src/config.tsx
var import_react = require("react");

// src/xmlToolCalls.ts
var DIALECTS = [
  { prefix: "<tool_call>", open: /<tool_call>/, close: "</tool_call>", namedInOpenTag: false },
  { prefix: "<function_call>", open: /<function_call>/, close: "</function_call>", namedInOpenTag: false },
  { prefix: "<tool_use>", open: /<tool_use>/, close: "</tool_use>", namedInOpenTag: false },
  { prefix: "<invoke", open: /<invoke\s+name\s*=\s*"([^"]*)"\s*>/, close: "</invoke>", namedInOpenTag: true },
  { prefix: "<function=", open: /<function\s*=\s*([^>]+)>/, close: "</function>", namedInOpenTag: true }
];
function partialTailPrefix(buf, tag) {
  const max = Math.min(buf.length, tag.length - 1);
  for (let L = max; L > 0; L--) {
    if (buf.slice(buf.length - L) === tag.slice(0, L)) return L;
  }
  return 0;
}
function holdLength(buf) {
  let hold = 0;
  for (const d of DIALECTS) {
    hold = Math.max(hold, partialTailPrefix(buf, d.prefix));
    if (d.namedInOpenTag) {
      const idx = buf.lastIndexOf(d.prefix);
      if (idx >= 0 && !buf.slice(idx).includes(">")) hold = Math.max(hold, buf.length - idx);
    }
  }
  return Math.min(hold, buf.length);
}
function findOpen(buf) {
  let best = null;
  for (const dialect of DIALECTS) {
    const m = dialect.open.exec(buf);
    if (!m) continue;
    if (best && m.index >= best.index) continue;
    best = { dialect, index: m.index, length: m[0].length, ...m[1] ? { name: m[1].trim() } : {} };
  }
  return best;
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
var ARG_KEY_VALUE = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
var PARAMETER_TAG = /<parameter\s+name\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\/parameter>/g;
function argsFromTags(body) {
  const args = {};
  let found = false;
  for (const re of [ARG_KEY_VALUE, PARAMETER_TAG]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body)) !== null) {
      const key = m[1].trim();
      if (!key) continue;
      args[key] = coerceArg(m[2]);
      found = true;
    }
  }
  return found ? args : null;
}
function parseNamedBody(name, body, seq) {
  if (!name) return null;
  const tagged = argsFromTags(body);
  if (tagged) return { id: `xmltc_${seq}`, name, args: JSON.stringify(tagged) };
  const jsonStart = body.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const obj = JSON.parse(body.slice(jsonStart));
      return { id: `xmltc_${seq}`, name, args: JSON.stringify(obj ?? {}) };
    } catch {
    }
  }
  return { id: `xmltc_${seq}`, name, args: "{}" };
}
function parseInner(inner, seq) {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  const firstArg = trimmed.search(/<arg_key>|<parameter\s/);
  if (firstArg >= 0) {
    const name = trimmed.slice(0, firstArg).trim();
    if (!name) return null;
    return { id: `xmltc_${seq}`, name, args: JSON.stringify(argsFromTags(trimmed) ?? {}) };
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
        const a = obj.arguments ?? obj.parameters ?? obj.input ?? {};
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
  inside = null;
  insideName;
  innerBuf = "";
  clean = "";
  calls = [];
  seq = 0;
  /** Close the call currently being accumulated and record it. */
  commit() {
    const parsed = this.inside?.namedInOpenTag ? parseNamedBody(this.insideName ?? "", this.innerBuf, this.seq++) : parseInner(this.innerBuf, this.seq++);
    if (parsed) this.calls.push(parsed);
    this.innerBuf = "";
    this.inside = null;
    this.insideName = void 0;
  }
  /** Feed a content delta; returns clean (markup-free) text to emit now. */
  push(delta) {
    this.buf += delta;
    let emit2 = "";
    for (; ; ) {
      if (!this.inside) {
        const open = findOpen(this.buf);
        if (open) {
          emit2 += this.buf.slice(0, open.index);
          this.buf = this.buf.slice(open.index + open.length);
          this.inside = open.dialect;
          this.insideName = open.name;
          this.innerBuf = "";
          continue;
        }
        const hold2 = holdLength(this.buf);
        emit2 += this.buf.slice(0, this.buf.length - hold2);
        this.buf = hold2 ? this.buf.slice(this.buf.length - hold2) : "";
        break;
      }
      const close = this.buf.indexOf(this.inside.close);
      if (close >= 0) {
        this.innerBuf += this.buf.slice(0, close);
        this.buf = this.buf.slice(close + this.inside.close.length);
        this.commit();
        continue;
      }
      const hold = partialTailPrefix(this.buf, this.inside.close);
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
      this.commit();
    } else {
      emit2 = this.buf;
    }
    this.buf = "";
    this.innerBuf = "";
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

// src/chatError.ts
var BrainRequestError = class extends Error {
  status;
  code;
  reason;
  unlock;
  requiredPlan;
  feature;
  constructor(message, init) {
    super(message);
    this.name = "BrainRequestError";
    this.status = init.status;
    this.code = init.code;
    this.reason = init.reason;
    this.unlock = init.unlock;
    this.requiredPlan = init.requiredPlan;
    this.feature = init.feature;
  }
};
function str(v) {
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function brainRequestError(status2, body, statusText) {
  const b = body ?? {};
  const message = str(b.error) || str(b.message) || statusText || `Request failed (${status2})`;
  return new BrainRequestError(message, {
    status: status2,
    code: str(b.code),
    reason: str(b.reason),
    unlock: str(b.unlock),
    requiredPlan: str(b.requiredPlan),
    feature: str(b.feature)
  });
}
var AUTH_PROSE = /invalid or expired token|unauthor/i;
var CARD_PROSE = /validated card|add a card|card on file/i;
var UPGRADE_PROSE = /requires? a paid plan|upgrade to (pro|teams)|plan (token )?limit|not included in your plan/i;
function chatErrorAction(err) {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (err instanceof BrainRequestError) {
    const base = { requiredPlan: err.requiredPlan, feature: err.feature };
    if (err.status === 401) return { kind: "auth", ...base };
    if (err.unlock === "validate_card" || err.reason === "card_required") {
      return { kind: "validate_card", ...base };
    }
    if (err.unlock === "upgrade" || err.reason === "plan_required" || err.status === 402) {
      return { kind: "upgrade", ...base };
    }
    if (err.status === 429 && /plan_.*limit/.test(err.code ?? "")) {
      return { kind: "upgrade", ...base };
    }
  }
  if (!message) return null;
  if (AUTH_PROSE.test(message)) return { kind: "auth" };
  if (CARD_PROSE.test(message)) return { kind: "validate_card" };
  if (UPGRADE_PROSE.test(message)) return { kind: "upgrade" };
  return null;
}

// src/streamChatCompletion.ts
async function defaultMapError(res) {
  const body = await res.json().catch(() => ({}));
  return brainRequestError(res.status, body, res.statusText);
}
async function streamChatCompletion(opts, handlers = {}) {
  const { transport } = opts;
  const token = transport.getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const body = {
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 4096,
    stream: true,
    // Ask the gateway to emit a trailing `usage` chunk (OpenAI stream_options).
    // Providers that ignore it simply omit usage — the parse below is tolerant.
    stream_options: { include_usage: true }
  };
  const model = opts.model ?? transport.defaultModel;
  if (model) body.model = model;
  if (model && opts.modelStrict) body.strict = true;
  if (opts.routingMode) body.routingMode = opts.routingMode;
  if (opts.excludeModels && opts.excludeModels.length > 0) body.excludeModels = opts.excludeModels;
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = opts.tool_choice ?? "auto";
  }
  if (opts.reasoning && opts.reasoning.level !== "off") {
    body.reasoning = { level: opts.reasoning.level };
  }
  if (opts.metadata) {
    const meta = Object.fromEntries(
      Object.entries(opts.metadata).filter(([, v]) => v !== void 0 && v !== null)
    );
    if (Object.keys(meta).length > 0) body.metadata = meta;
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
  let headerVendor = null;
  try {
    headerVendor = res.headers?.get?.("x-builderforce-vendor") || null;
  } catch {
    headerVendor = null;
  }
  const resolvedVendor = () => headerVendor ?? void 0;
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
    return { text, toolCalls: [...assemble(toolAcc), ...xmlCalls], finishReason, resolvedModel: resolvedModel(), resolvedVendor: resolvedVendor(), account: account(), byoUnresolved: byoUnresolved(), providerCap: providerCap(), usage };
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
        return { text: xml.cleanText(), toolCalls: allToolCalls(), finishReason, resolvedModel: resolvedModel(), resolvedVendor: resolvedVendor(), account: account(), byoUnresolved: byoUnresolved(), providerCap: providerCap(), usage };
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
  return { text: xml.cleanText(), toolCalls: allToolCalls(), finishReason, resolvedModel: resolvedModel(), resolvedVendor: resolvedVendor(), account: account(), byoUnresolved: byoUnresolved(), providerCap: providerCap(), usage };
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

// src/finishReason.ts
var TRUNCATED_REASONS = /* @__PURE__ */ new Set(["length", "max_tokens", "maxtokens", "model_length", "output_limit"]);
var MALFORMED_TOOL_CALL_REASONS = /* @__PURE__ */ new Set(["malformed_function_call", "malformed_tool_call", "invalid_tool_call"]);
var normalise = (finishReason) => (finishReason ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
function turnInterruption(finishReason) {
  const reason = normalise(finishReason);
  if (!reason) return null;
  if (TRUNCATED_REASONS.has(reason)) return "truncated";
  if (MALFORMED_TOOL_CALL_REASONS.has(reason)) return "malformed-tool-call";
  return null;
}
function isTruncatedTurn(finishReason) {
  return turnInterruption(finishReason) === "truncated";
}
function isMalformedToolCall(finishReason) {
  return turnInterruption(finishReason) === "malformed-tool-call";
}

// src/effort.ts
var EFFORT_PROFILES = {
  quick: {
    effort: "quick",
    maxTokens: 2048,
    reasoningLevel: "low",
    thinkingBudgetTokens: 2048,
    directive: "Effort: favour a fast, concise, direct answer. Keep exploration minimal unless the task truly requires more."
  },
  balanced: {
    effort: "balanced",
    maxTokens: 4096,
    reasoningLevel: "medium",
    thinkingBudgetTokens: 8192,
    directive: ""
  },
  thorough: {
    effort: "thorough",
    maxTokens: 16384,
    reasoningLevel: "high",
    thinkingBudgetTokens: 16384,
    directive: "Effort: apply maximum rigor. Be exhaustive, consider edge cases, verify your work, and do not stop until the task is fully complete."
  }
};
function effortProfile(effort) {
  return EFFORT_PROFILES[effort] ?? EFFORT_PROFILES.balanced;
}
function isEffort(value) {
  return value === "quick" || value === "balanced" || value === "thorough";
}
function reasoningForRun(o) {
  return o.thinking ? { level: effortProfile(o.effort).reasoningLevel } : void 0;
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
var import_react2 = require("react");

// src/toolSpecs.ts
function toolSpecsFor(actions) {
  return actions.map((action) => ({
    type: "function",
    function: {
      name: action.name,
      description: action.description,
      parameters: action.parameters
    }
  }));
}

// src/BrainActionsContext.tsx
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
    return toolSpecsFor([...registry.current.values()].map((e) => e.action));
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

// src/mcpToolStatus.ts
var status = { count: 0, error: null, loading: true };
function setMcpToolStatus(next) {
  status = next;
}
function getMcpToolStatus() {
  return status;
}

// src/lastResolvedModel.ts
var lastResolvedModel;
function setLastResolvedModel(model) {
  const trimmed = typeof model === "string" ? model.trim() : "";
  if (trimmed) lastResolvedModel = trimmed;
}
function getLastResolvedModel() {
  return lastResolvedModel;
}

// src/mcpCatalog.ts
var CREATE_DEDUPE_MS = 8e3;
var recentCreates = /* @__PURE__ */ new Map();
function nowMs() {
  return typeof Date !== "undefined" ? Date.now() : 0;
}
var CURRENT_MODEL_TOOL = "session.current_model";
function withObservedModel(tool, args) {
  if (tool !== CURRENT_MODEL_TOOL) return args;
  const observed = getLastResolvedModel();
  if (!observed) return args;
  const supplied = args ?? {};
  if (typeof supplied.model === "string" && supplied.model.trim()) return args;
  return { ...supplied, model: observed };
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
async function fetchMcpToolEntries(transport, skipExtensionIds = []) {
  const token = transport.getToken();
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${transport.baseUrl}/llm/v1/mcp/tools`, { headers });
  if (!res.ok) throw new Error(`tool catalog unavailable (HTTP ${res.status})`);
  const body = await res.json();
  const skip = new Set(skipExtensionIds);
  return (body.tools ?? []).filter((t) => !skip.has(t.extensionId));
}
function mcpActionsFrom(entries, transport, onToolResult) {
  return entries.map((entry) => ({
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
          body: JSON.stringify({ extensionId: entry.extensionId, tool: entry.tool, arguments: withObservedModel(entry.tool, args) })
        });
        const body = await res.json().catch(() => ({}));
        const out = !res.ok ? { error: body.error ?? `MCP call failed (${res.status})` } : body.result ?? body;
        onToolResult?.({
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
  }));
}

// src/useMcpExtensions.ts
function useMcpExtensions(options) {
  const { transport } = useBrainConfig();
  const [entries, setEntries] = (0, import_react3.useState)([]);
  const [loading, setLoading] = (0, import_react3.useState)(true);
  const [error, setError] = (0, import_react3.useState)(null);
  const skipKey = (options?.skipExtensionIds ?? []).join(",");
  const onToolResultRef = (0, import_react3.useRef)(options?.onToolResult);
  onToolResultRef.current = options?.onToolResult;
  (0, import_react3.useEffect)(() => {
    let cancelled = false;
    fetchMcpToolEntries(transport, skipKey ? skipKey.split(",") : []).then((tools) => {
      if (cancelled) return;
      setEntries(tools);
      setError(null);
    }).catch((e) => {
      if (cancelled) return;
      setEntries([]);
      setError(e instanceof Error ? e.message : "tool catalog fetch failed");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [transport, skipKey]);
  const actions = (0, import_react3.useMemo)(
    () => mcpActionsFrom(entries, transport, (info) => onToolResultRef.current?.(info)),
    [entries, transport]
  );
  useRegisterBrainActions(actions);
  (0, import_react3.useEffect)(() => {
    setMcpToolStatus({ count: actions.length, error, loading });
  }, [actions.length, error, loading]);
  return { loading, toolCount: actions.length, error };
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
      if (next.projectId === prev.projectId && next.viewingProjectId === prev.viewingProjectId && next.modality === prev.modality && next.extraSystem === prev.extraSystem && next.initialChatId === prev.initialChatId && next.initialPrompt === prev.initialPrompt && next.initialTicket === prev.initialTicket) {
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
  builtin_initiatives_create: "initiative",
  // Team ceremonies. A retro or an estimation session the Brain sets up FROM a
  // conversation is that conversation's outcome, so it links like any other item it
  // creates — without this the chat that arranged the ceremony kept no trace of it.
  builtin_retro_create: "retro",
  builtin_poker_create_session: "poker"
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
\u2022 When your investigation concludes that something needs to be DONE \u2014 a bug to fix, a missing capability, a follow-up, or a gap you identified \u2014 do not merely describe it. First use builtin_tasks_assignees to select the ticket's accountable Coordinator/Manager, then create the work item (builtin_tasks_create with exactly one assignee and taskType "task", "epic", or "gap"; or the matching builtin_*_create for an objective, spec, or roadmap item) AND link it with builtin_chats_link_ticket (chatId=${chatId}, linkType="created"). The ticket assignee COORDINATES delivery; do not assume that person/agent performs every specialist contribution.
\u2022 Every created ticket must be resource-scoped before you report success: inspect its template manifest with builtin_kanban_participants; infer all additional roles required by its description and acceptance criteria; add each with builtin_kanban_assess_resource; then call builtin_kanban_accountability and explicitly report any unstaffed resource gaps. For an epic or multi-role ticket, call builtin_kanban_materialize_work_items so each required resource has an assigned child work item. Call builtin_kanban_coordinate when work should begin now. Never treat 0 required roles / 0 sign-offs as complete.
\u2022 When your turn ADDS or CHANGES code, record it with builtin_tickets_from_delta (chatId=${chatId}, the current projectId, the files you touched, kind improvement|fix|bug, modality "ide"). If builtin_chats_list_tickets shows a ticket already tracking this work, pass its numeric ref as taskId so the delta attaches to it instead of creating a duplicate; otherwise the delta creates a linked ticket that completes when it ships.
\u2022 Keep the board honest about STATUS. The MOMENT you start actively working an existing linked task/epic/gap \u2014 investigating its fix, editing code for it, or driving it \u2014 move it out of the backlog with builtin_tasks_update (id=<the ticket's ref>, status="in_progress"). When the work is finished and shipped, advance it to "in_review" (or "done" if it needs no review). Never leave a ticket you are actively working sitting in backlog.
\u2022 Call builtin_chats_list_tickets (chatId=${chatId}) to see what is already linked \u2014 both to AVOID creating a duplicate and to know which linked tickets need their status advanced. Never end a turn having identified actionable work or changed code without it being a ticket linked to this chat whose status reflects the work you did.`;
}

// src/chatMode.ts
var CHAT_MODES = ["chat", "work"];
var NEW_CHAT_MODE = "work";
var RESTING_CHAT_MODE = "chat";
function isChatMode(value) {
  return typeof value === "string" && CHAT_MODES.includes(value);
}
function normalizeChatMode(value) {
  return isChatMode(value) ? value : RESTING_CHAT_MODE;
}
function chatConversationDirective() {
  return "MODE: CHAT. This conversation is a conversation. Your job is to understand the question and answer it.\n\u2022 Read, search, inspect and reason as much as the question needs \u2014 every read-only tool is available to you and using them is encouraged. Ground the answer in what you actually looked up.\n\u2022 Do NOT create, staff, re-status, or dispatch board work as a side effect of answering. Identifying that something ought to be done is part of a good answer; opening a ticket about it is not.\n\u2022 If the work plainly ought to be tracked, END the answer with one short line naming it and telling the user they can switch this conversation to Work mode to have it opened and run. Offer it once; do not repeat the offer on later turns.\n\u2022 The single exception: if the user explicitly asks you to create, assign, schedule or run something in THIS message, do it. An explicit instruction outranks the mode.";
}
function chatWorkDirective(chatId) {
  return `MODE: WORK. This conversation exists to get something DONE, not to describe it. Take the work all the way to a running agent.
${chatWorkLinkingDirective(chatId)}
\u2022 FINISH BY DISPATCHING. A ticket that no agent is running has not started. Every create/update tool returns an \`autoRun\` verdict \u2014 read it. When \`autoRun.dispatched\` is true, say which agent picked the work up. When it is false, do not stop there: pick a capable agent (builtin_cloud_agents_list_mine, or builtin_tasks_assignees for the accountable roster) and start the run yourself with builtin_chats_dispatch_agent (chatId=${chatId}, agentRef=<the agent>, taskId=<the ticket>).
\u2022 If dispatch is genuinely refused \u2014 no capable agent, an execution kill-switch, an exhausted run cap, a human gate on the lane \u2014 report the EXACT reason the tool returned and what would clear it. Never imply work has begun when nothing was dispatched, and never describe a dispatch you did not make.`;
}
function chatModeDirective(mode, chatId) {
  return mode === "work" ? chatWorkDirective(chatId) : chatConversationDirective();
}

// src/useBrainChats.ts
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
  const [chats, setChats] = (0, import_react5.useState)([]);
  const [loading, setLoading] = (0, import_react5.useState)(true);
  const [error, setError] = (0, import_react5.useState)("");
  const [internalActiveId, setInternalActiveId] = (0, import_react5.useState)(null);
  const assigningRef = (0, import_react5.useRef)(false);
  const chatsRef = (0, import_react5.useRef)(chats);
  chatsRef.current = chats;
  const autoTitledRef = (0, import_react5.useRef)(/* @__PURE__ */ new Set());
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
      const chat = await persistence.createChat({ title: opts?.title ?? "New chat", projectId, capability: opts?.capability ?? null, mode: opts?.mode ?? NEW_CHAT_MODE });
      setChats((prev) => [chat, ...prev]);
      setActiveChatId(chat.id);
      return chat;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create chat");
      return null;
    }
  }, [persistence, defaultProjectId, setActiveChatId]);
  const setCapability = (0, import_react5.useCallback)(async (id, capability) => {
    const prevValue = chatsRef.current.find((c) => c.id === id)?.capability ?? null;
    setChats((prev) => prev.map((c) => c.id === id ? { ...c, capability } : c));
    try {
      const updated = await persistence.updateChat(id, { capability });
      setChats((prev) => prev.map((c) => c.id === id ? { ...c, capability: updated.capability ?? null } : c));
    } catch (e) {
      setChats((prev) => prev.map((c) => c.id === id ? { ...c, capability: prevValue } : c));
      setError(e instanceof Error ? e.message : "Failed to set capability");
    }
  }, [persistence]);
  const setMode = (0, import_react5.useCallback)(async (id, mode) => {
    const prevValue = normalizeChatMode(chatsRef.current.find((c) => c.id === id)?.mode);
    setChats((prev) => prev.map((c) => c.id === id ? { ...c, mode } : c));
    try {
      const updated = await persistence.updateChat(id, { mode });
      setChats((prev) => prev.map((c) => c.id === id ? { ...c, mode: normalizeChatMode(updated.mode) } : c));
    } catch (e) {
      setChats((prev) => prev.map((c) => c.id === id ? { ...c, mode: prevValue } : c));
      setError(e instanceof Error ? e.message : "Failed to switch mode");
    }
  }, [persistence]);
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
  const autoTitle = (0, import_react5.useCallback)(async (id, firstUserText) => {
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
    setCapability,
    setMode,
    autoTitle,
    summarize,
    remove,
    assignToProject,
    reload,
    touch
  };
}

// src/useBrainConversation.ts
var import_react6 = require("react");

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

// ../packages/agent-stall/src/index.ts
var ANNOUNCE_SUBJECT = "\\b(?:i(?: will|'ll| am going to|'m going to| am about to| plan to|'d need to| would need to| will need to| need to)|let(?:'?s| me| us)|going to|about to|next,? i'?l?l?|now)";
var ANNOUNCE_FILLER = "(?:\\s+(?:now|then|first|next|quickly|briefly|just|also|actually|go ahead and|try to|attempt to))*";
var ANNOUNCE_VERB = "(?:call|use|invoke|run|execute|trigger|query|fetch|retrieve|request|look|search|scan|find|locate|examine|inspect|review|read|list|check|verify|confirm|get|grab|pull|load|open|gather|dig|explore|investigate|analy[sz]e|start|begin|take|do|see|walk|trace|map)";
var ANNOUNCE_GERUND = "(?:searching|fetching|retrieving|querying|loading|checking|looking|scanning|reading|listing|gathering|pulling|examining|inspecting|reviewing|analy[sz]ing)";
var TOOL_IDENT = "(?:builtin_[a-z0-9]+(?:_[a-z0-9]+)+|mcp__[a-z0-9_]+)";
function toolNamesMentionedIn(text) {
  return [...new Set(text.match(new RegExp(TOOL_IDENT, "gi")) ?? [])];
}
var PSEUDO_CALL = [
  // "call builtin_x", "run tool builtin_x", "invoke the function mcp__srv__x"
  `(?:call|run|invoke|execute)\\s+(?:the\\s+)?(?:tool\\s+|function\\s+)?${TOOL_IDENT}`,
  // "builtin_x({…})" / "builtin_x(" — the call written as code
  `${TOOL_IDENT}\\s*[({]`,
  // "builtin_x with chatId is 85" — the call written as an argument clause
  `${TOOL_IDENT}\\s+(?:with|args|arguments)\\b`
];
var ANNOUNCED_ACTION = new RegExp(
  [
    "calling (the|this|that|a|it|them|these) [\\w\\s-]*?(tool|function|api|now)",
    `${ANNOUNCE_SUBJECT}${ANNOUNCE_FILLER}\\s+${ANNOUNCE_VERB}\\b`,
    "(one|just a) (moment|second|sec)\\b",
    `${ANNOUNCE_GERUND} (it|that|this|these|those|the [\\w-]+|now|for)\\b`,
    "stand ?by\\b",
    ...PSEUDO_CALL
  ].join("|"),
  "i"
);
var TAIL_CHARS = 240;
function announcesUntakenAction(text) {
  const t = text.trim();
  if (!t) return false;
  return ANNOUNCED_ACTION.test(t.slice(-TAIL_CHARS));
}
var FILE_EXTENSION = "(?:ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml|sql|toml|lock|txt|env|html|css|py|go|rs|sh|png|svg|csv|xml)\\b";
var DOTTED_TOOL_IDENT = `\\b[a-z][a-z0-9_]{2,}\\.(?!${FILE_EXTENSION})[a-z][a-z0-9_]{2,}\\b`;
function catalogToolNamesMentionedIn(text) {
  return [...new Set(text.match(new RegExp(DOTTED_TOOL_IDENT, "gi")) ?? [])];
}
var UNCALLED_TOOL_CLAIM = new RegExp(
  [
    // "The tools required are X, Y and Z." / "The required tools are …"
    "\\b(?:required tools?\\b|tools? required\\b|tools? (?:i |we )?(?:need|require)\\b)",
    // "…tools have not returned results" / "…the tool has not returned anything yet"
    "\\btools?\\b[^.!?]{0,80}?\\b(?:have|has|had|were|was)(?:n'?t| not)\\s+(?:yet\\s+)?(?:return|returned|provided|available|run|called)",
    // "no tool results", "no results from the tools", "no tool outputs for project 11"
    "\\bno\\s+(?:new\\s+)?tools?\\s+(?:results?|outputs?|data|returns?)\\b",
    // "No other tools provide the needed data." — the same claim aimed at the CATALOG
    // rather than at the results: an inventory of what it would need, from a turn that
    // called none of it. Observed as the closing sentence of the measured replies.
    "\\bno\\s+other\\s+tools?\\b[^.!?]{0,40}?\\b(?:provide|provides|give|gives|return|returns|have|has|offer|offers)\\b",
    "\\bno\\s+results?\\s+(?:from|for)\\s+(?:the\\s+)?tools?\\b",
    // "tool outputs never provided" / "the tool results were never returned"
    "\\btools?\\s+(?:results?|outputs?)\\b[^.!?]{0,40}?\\b(?:never|not)\\s+(?:been\\s+)?(?:provided|returned|available)",
    // "requires the tool outputs" / "awaiting the tool results"
    "\\b(?:requires?|awaiting|waiting on|pending)\\s+(?:those\\s+|the\\s+)?tools?\\s+(?:results?|outputs?)",
    // The same claim with the TOOL NAMED instead of the word "tool" — "no results from
    // manager.digest", "missing builtin_manager_policy results". The name IS the
    // discriminator here: prose does not carry tool identifiers by accident.
    `\\bno\\s+(?:new\\s+)?(?:results?|data|outputs?|returns?)\\s+(?:from|for|on)\\s+(?:the\\s+)?(?:${TOOL_IDENT}|${DOTTED_TOOL_IDENT})`,
    `\\b(?:missing|awaiting|pending|without)\\s+(?:the\\s+|those\\s+)?(?:results?\\s+(?:from|of|for)\\s+)?(?:${TOOL_IDENT}|${DOTTED_TOOL_IDENT})`
  ].join("|"),
  "i"
);
function claimsMissingToolData(text) {
  const t = text.trim();
  if (!t) return false;
  return UNCALLED_TOOL_CLAIM.test(t);
}
var MAX_ANNOUNCEMENT_RECOVERIES = 3;
function stallRecoveryNudge(lastChance) {
  return (
    // Covers BOTH stall shapes: the promise ("I'll check…") and the missing-data claim
    // ("the required tools have not returned results"). The second wording matters —
    // a model told only "you said you would call a tool" when it never said any such
    // thing tends to repeat the same excuse rather than act.
    "Your last turn made zero tool calls. You either said you would call a tool and did not, reported that tool results were missing \u2014 no results exist because you never made the call \u2014 or returned nothing at all. Make the call NOW in this turn, then answer using its result. If no tool can give you that data, say plainly which data you are missing and answer with what you already have. Do not announce another call, and do not reply with an empty message." + (lastChance ? " This is your last chance to act: you have now stated an intention without acting several times in a row. Either emit a tool call in this turn, or give your complete final answer from what you already know \u2014 an answer that only describes what you are about to do will be shown to the user as-is." : "")
  );
}
function isEmptyTurn(input) {
  return input.toolCallCount === 0 && input.availableToolCount > 0 && input.text.trim() === "";
}
function isStalledTurn(input) {
  return input.toolCallCount === 0 && input.availableToolCount > 0 && (announcesUntakenAction(input.text) || claimsMissingToolData(input.text) || isEmptyTurn(input));
}
function shouldRecoverStalledTurn(input) {
  return isStalledTurn(input) && input.recoveriesUsed < MAX_ANNOUNCEMENT_RECOVERIES;
}
function isExhaustedStall(input) {
  return isStalledTurn(input) && input.recoveriesUsed >= MAX_ANNOUNCEMENT_RECOVERIES;
}
function whatItDid(emptyTurn) {
  return emptyTurn ? `returned an empty turn \u2014 no tool call and no words \u2014 ${MAX_ANNOUNCEMENT_RECOVERIES} turns in a row` : `described tool calls instead of making them, ${MAX_ANNOUNCEMENT_RECOVERIES} turns in a row`;
}
function modelFailoverNotice(from, to, emptyTurn = false) {
  const who = from && from !== "default" ? `\`${from}\`` : "The previous model";
  return `${who} ${whatItDid(emptyTurn)}, so it cannot complete this request. Retrying on \`${to}\`.`;
}
function stallExhaustedNotice(model, tried, emptyTurn = false) {
  const who = model && model !== "default" ? `The model \`${model}\`` : "The model";
  const others = (tried ?? []).filter((m) => m && m !== model);
  return `${who} ${whatItDid(emptyTurn)}, so nothing was actually run and ` + (emptyTurn ? "there is no answer above to show you." : "the answer above is only a description of intended actions.") + (others.length ? ` This run already failed over from ${others.map((m) => `\`${m}\``).join(", ")}, so the problem is unlikely to be any single model \u2014 check that the tool catalog loaded (see the "Tools available to the model" line in a copied diagnostics report).` : " This is a model limitation, not a configuration error \u2014 pick a different model for this chat and send the message again.");
}
function ids(list) {
  return (list ?? []).map((m) => m.id).filter((id) => !!id);
}
function nextFallbackModel(surface, tried) {
  if (!surface) return void 0;
  const used = new Set(tried.filter(Boolean));
  const byo = ids(surface.byo?.models);
  const byoSet = new Set(byo);
  const coding = (surface.codingModels ?? []).filter(Boolean);
  const pool = ids(surface.data);
  const tiers = [
    coding.filter((m) => byoSet.has(m)),
    coding,
    byo,
    pool
  ];
  for (const tier of tiers) {
    const hit = tier.find((m) => !used.has(m));
    if (hit) return hit;
  }
  return void 0;
}
var MAX_MODEL_FAILOVERS = 2;
function chooseStallFailover(input) {
  for (const m of [input.activeModel, input.resolvedModel]) {
    if (m && m !== "default" && !input.tried.includes(m)) input.tried.push(m);
  }
  if (input.failoversUsed >= MAX_MODEL_FAILOVERS) return void 0;
  const next = input.pick ? input.pick(input.tried) : nextFallbackModel(input.surface, input.tried);
  return next && !input.tried.includes(next) ? next : void 0;
}

// src/persistedSteps.ts
function stepSig(category, label, tsIso) {
  return `${category}|${label}|${tsIso ?? ""}`;
}
function parseStepMessage(metadata) {
  if (!metadata) return null;
  try {
    const m = JSON.parse(metadata);
    if (m.kind !== "step" || typeof m.category !== "string") return null;
    return {
      step: {
        category: m.category,
        label: typeof m.label === "string" ? m.label : m.category,
        args: m.args,
        result: m.result,
        isError: m.isError,
        durationMs: m.durationMs,
        resultBytes: m.resultBytes,
        truncated: m.truncated,
        usage: m.usage,
        finishReason: m.finishReason,
        textChars: m.textChars,
        ttftMs: m.ttftMs
      },
      tsIso: typeof m.ts === "string" ? m.ts : void 0
    };
  } catch {
    return null;
  }
}
function traceWithPersistedSteps(messages, trace) {
  const seen = /* @__PURE__ */ new Set();
  for (const ev of trace) seen.add(stepSig(ev.category, ev.label, ev.ts));
  const fromMessages = [];
  for (const message of messages) {
    if (!isStepMessage(message)) continue;
    const parsed = parseStepMessage(message.metadata);
    if (!parsed) continue;
    const sig = stepSig(parsed.step.category, parsed.step.label, parsed.tsIso);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const s = parsed.step;
    fromMessages.push({
      ts: parsed.tsIso ?? message.createdAt ?? "",
      recovered: true,
      category: s.category,
      label: s.label,
      args: s.args,
      result: s.result,
      ...s.isError ? { isError: true } : {},
      ...s.durationMs != null ? { durationMs: s.durationMs } : {},
      ...s.ttftMs != null ? { ttftMs: s.ttftMs } : {},
      ...s.resultBytes != null ? { resultBytes: s.resultBytes } : {},
      ...s.truncated ? { truncated: true } : {},
      ...s.usage ? { usage: s.usage } : {},
      ...s.finishReason !== void 0 ? { finishReason: s.finishReason } : {},
      ...s.textChars != null ? { textChars: s.textChars } : {}
    });
  }
  if (fromMessages.length === 0) return trace;
  return [...trace, ...fromMessages].sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
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
function detectAnnouncedButUnmadeToolCall(events, messages) {
  if (events.some((e) => e.category === "tool")) return false;
  return messages.some(
    (m) => m.role === "assistant" && typeof m.content === "string" && announcesUntakenAction(m.content)
  );
}
var LOOP_STEP = {
  recovery: "loop.recover_announced_tool_call",
  failover: "loop.model_failover",
  unrecovered: "loop.stall_unrecovered"
};
function stallRecoveriesInTrace(events) {
  return events.filter((e) => e.label === LOOP_STEP.recovery).length;
}
function modelFailoversInTrace(events) {
  return events.filter((e) => e.label === LOOP_STEP.failover).length;
}
function stallUnrecoveredInTrace(events) {
  return events.some((e) => e.label === LOOP_STEP.unrecovered);
}
function toolExposureInTrace(events) {
  let lastTurn = null;
  let min = null;
  let catalog = null;
  for (const ev of events) {
    if (ev.category !== "llm") continue;
    const a = ev.args;
    if (typeof a?.advertisedTools === "number") {
      lastTurn = a.advertisedTools;
      min = min == null ? a.advertisedTools : Math.min(min, a.advertisedTools);
    }
    if (typeof a?.catalogTools === "number") catalog = a.catalogTools;
  }
  return { lastTurn, min, catalog };
}
function narratedUnadvertisedInTrace(events) {
  const seen = [];
  for (const ev of events) {
    const raw = ev.args?.narratedUnadvertised;
    if (!Array.isArray(raw)) continue;
    for (const n of raw) {
      if (typeof n === "string" && n && !seen.includes(n)) seen.push(n);
    }
  }
  return seen;
}
function memoryAnswersInTrace(events) {
  const out = [];
  for (const ev of events) {
    if (ev.category !== "recall") continue;
    if (ev.label !== "evermind.answer" && ev.label !== "memory.answer") continue;
    const r = ev.result;
    if (r?.skippedLlm !== true) continue;
    out.push({
      source: r.source === "evermind" ? "evermind" : "qa-cache",
      ...typeof r.version === "number" ? { version: r.version } : {},
      ...typeof r.evermindProjectId === "number" ? { projectId: r.evermindProjectId } : {}
    });
  }
  return out;
}
function cap(s, n = 2e3) {
  const str2 = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return str2.length > n ? str2.slice(0, n) + `\u2026 (+${str2.length - n} chars)` : str2;
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
    case "unsupported-auth":
      return "it is stored as a subscription (OAuth) but this provider only supports an API key \u2014 re-connect it with an API key under Settings \u25B8 API Keys";
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
function computeBrainDiagnostics(events, requestedModel, messages = []) {
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
    const emptyText = typeof ev.textChars === "number" && ev.textChars === 0;
    const toolCallsThisTurn = ev.args?.toolCalls;
    const askedNoTools = typeof toolCallsThisTurn === "number" ? toolCallsThisTurn === 0 : true;
    if (turnInterruption(ev.finishReason) || emptyText && askedNoTools) emptyOrLengthFinishes += 1;
    const a = ev.args;
    const asked = typeof a?.requestedModel === "string" && a.requestedModel !== "default" ? a.requestedModel : req;
    const resolved = a?.model;
    if (asked && typeof resolved === "string" && resolved && resolved !== "default" && resolved !== asked) downgradeEvents += 1;
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
  const memoryAnswers = memoryAnswersInTrace(events);
  const recoveredToolEvents = toolEvents.filter((e) => e.recovered).length;
  const recoveredTurns = llm.filter((e) => e.recovered).length;
  const turnCoveragePartial = recoveredToolEvents > 0 && recoveredTurns === 0;
  const contextSignal = promptTokenPeak >= 24e3 || truncatedToolResults > 0 || downgradeEvents > 0 || largestToolResult != null && largestToolResult.bytes >= 2e4;
  const degradationSignal = evermindUsed.length > 0 && emptyOrLengthFinishes > 0 && (!tokensMeasured || promptTokenPeak < 24e3) && truncatedToolResults === 0;
  const didWork = toolEvents.length > 0 || completionTokenTotal > 0 || llm.length > 0;
  const announcedUnmadeToolCall = detectAnnouncedButUnmadeToolCall(events, messages);
  const stallRecoveries = stallRecoveriesInTrace(events);
  const modelFailovers = modelFailoversInTrace(events);
  const stallUnrecovered = stallUnrecoveredInTrace(events);
  const exposure = toolExposureInTrace(events);
  const narratedUnadvertisedTools = narratedUnadvertisedInTrace(events);
  const noToolsAdvertised = exposure.min === 0 && toolEvents.length === 0;
  const memoryOnlyRun = memoryAnswers.length > 0 && llm.length === 0;
  const healthy = errors.length === 0 && !loopExhausted && emptyOrLengthFinishes === 0 && !contextSignal && !announcedUnmadeToolCall && didWork;
  const likelyCause = memoryOnlyRun ? "memory-answered" : noToolsAdvertised ? "no-tools-advertised" : narratedUnadvertisedTools.length > 0 ? "tool-not-advertised" : announcedUnmadeToolCall ? "tool-calls-not-emitted" : contextSignal && !degradationSignal ? "context-exhaustion" : degradationSignal && !contextSignal ? "model-degradation" : healthy ? "healthy" : "inconclusive";
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
    announcedUnmadeToolCall,
    stallRecoveries,
    modelFailovers,
    stallUnrecovered,
    advertisedToolsLastTurn: exposure.lastTurn,
    advertisedToolsMin: exposure.min,
    catalogTools: exposure.catalog,
    narratedUnadvertisedTools,
    memoryAnswers,
    turnCoveragePartial,
    likelyCause
  };
}
function kb(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
function formatBrainDiagnostics(d) {
  const evermindAnswers = d.memoryAnswers?.filter((m) => m.source === "evermind") ?? [];
  const verdict = d.likelyCause === "memory-answered" ? `ANSWERED FROM MEMORY \u2014 no model ran this turn. The reply was served by the memory-first short-circuit (${(d.memoryAnswers ?? []).map((m) => m.source === "evermind" ? `the project Evermind SSM${m.projectId != null ? ` of project #${m.projectId}` : ""}${m.version != null ? ` v${m.version}` : ""}` : "the Q&A cache").join(", ")}), so zero turns, zero tokens and zero tool calls is EXPECTED, not a fault. ${evermindAnswers.length ? "The Evermind SSM cannot call tools and answers only from what it has learned, so it can neither fetch live data nor do work \u2014 if the reply was wrong, garbled or stale, that is the cause. Turn Memory off for this chat, or disable inference on that head." : "The reply is a replay of an earlier answer to the same question; ask a differently-worded question to reach the model."} Switching models changes nothing here.` : d.likelyCause === "no-tools-advertised" ? 'NO TOOLS ADVERTISED \u2014 at least one turn was handed ZERO tool definitions, so it could not have emitted a call whatever it wanted to do. This is a catalog/config failure on our side, not a model fault: the gateway MCP catalog (`/llm/v1/mcp/tools`) failed to load, or no actions were registered for this surface. See the "Tools available to the model" line in the Chat diagnostics block for the fetch error. Switching models will not help.' : d.likelyCause === "tool-not-advertised" ? `TOOL NOT ADVERTISED \u2014 a turn wrote out ${d.narratedUnadvertisedTools.map((n) => `\`${n}\``).join(", ")} as prose while that tool was NOT among the ones it was offered that turn. No model can emit a call for a function it was never given, so this is OUR per-turn tool selection dropping a tool the prompt asked for \u2014 not a model that "won't call tools". Fix the selection (pin the tool, or name it in the system prompt so it is force-included) rather than switching models.` : d.likelyCause === "tool-calls-not-emitted" ? 'TOOL CALLS NOT EMITTED \u2014 a turn NARRATED a tool call in prose ("I\'ll call the tool\u2026", a bare `builtin_\u2026` name) but the run recorded ZERO tool steps, so nothing executed and the answer never got its data. The tools WERE advertised and the agent loop only runs structured `tool_calls`, so this is a model/provider fault: the model is describing calls instead of emitting them. Try a different model.' : d.likelyCause === "context-exhaustion" ? "Likely CONTEXT EXHAUSTION (case A) \u2014 the transcript outgrew the model window." : d.likelyCause === "model-degradation" ? "Likely MODEL DEGRADATION (case B) \u2014 an Evermind/SSM turn returned empty while tokens stayed low." : d.likelyCause === "healthy" ? "No failure signal \u2014 no errors, no truncated or empty turns, and no context pressure. Nothing here needs triaging." : "Inconclusive \u2014 not enough signal to separate context exhaustion from model degradation.";
  const lines = ["--- Diagnostics ---", `Likely cause: ${verdict}`];
  const scope = d.turnCoveragePartial ? " (this session)" : "";
  lines.push(`Turns${scope}: ${d.turns} \xB7 Tool calls: ${d.toolCalls} \xB7 Errors: ${d.errors}${d.loopExhausted ? " \xB7 LOOP EXHAUSTED" : ""}`);
  if (d.tokensMeasured) {
    lines.push(
      `Tokens${scope}: prompt peak ${d.promptTokenPeak.toLocaleString()} \xB7 last-turn prompt ${d.lastPromptTokens.toLocaleString()} \xB7 completion total ${d.completionTokenTotal.toLocaleString()}`
    );
  } else {
    lines.push("Tokens: not reported by the gateway for this run.");
  }
  if (d.turnCoveragePartial) {
    lines.push(
      "Coverage: tool steps were recovered from this chat's durable history, but its earlier TURNS predate durable turn records \u2014 so the turn and token counts above describe only the current session, not the whole conversation. Send a new turn to capture a fully-measured run."
    );
  }
  lines.push(
    `Tool results: ${kb(d.toolResultBytes)} total${d.largestToolResult ? ` \xB7 largest ${d.largestToolResult.label} (${kb(d.largestToolResult.bytes)})` : ""}${d.truncatedToolResults ? ` \xB7 ${d.truncatedToolResults} truncated before the model saw them` : ""}`
  );
  if (d.advertisedToolsLastTurn != null) {
    const range = d.advertisedToolsMin != null && d.advertisedToolsMin !== d.advertisedToolsLastTurn ? `${d.advertisedToolsMin}\u2013${d.advertisedToolsLastTurn}` : `${d.advertisedToolsLastTurn}`;
    lines.push(
      `Tools advertised per turn: ${range}${d.catalogTools ? ` (of ${d.catalogTools} in the catalog)` : ""}${d.advertisedToolsMin === 0 ? " \xB7 \u26A0 a turn was offered NONE" : ""}`
    );
  } else {
    lines.push("Tools advertised per turn: not recorded (this run predates per-turn tool accounting).");
  }
  if (d.narratedUnadvertisedTools.length) {
    lines.push(`Narrated but never advertised: ${d.narratedUnadvertisedTools.join(", ")} \u2014 the model was told to call a tool it was not given.`);
  }
  if (d.stallRecoveries > 0 || d.modelFailovers > 0 || d.stallUnrecovered) {
    lines.push(
      `Stall handling: ${d.stallRecoveries} re-prompt(s) \xB7 ${d.modelFailovers} model failover(s)${d.stallUnrecovered ? " \xB7 GAVE UP (the stall survived every attempt)" : " \xB7 recovered"}`
    );
  }
  if (d.downgradeEvents > 0) lines.push(`Model downgrades: ${d.downgradeEvents} turn(s) answered by a different model than requested (gateway failover).`);
  if (d.emptyOrLengthFinishes > 0) lines.push(`Degenerate turns: ${d.emptyOrLengthFinishes} ended on \`length\` or returned empty text.`);
  if (d.evermindUsed.length) lines.push(`Evermind/SSM answered: ${d.evermindUsed.join(", ")}`);
  if (d.memoryAnswers?.length) {
    lines.push(
      `Answered from memory (LLM skipped): ${d.memoryAnswers.length} turn(s) \u2014 ` + d.memoryAnswers.map((m) => m.source === "evermind" ? `Evermind SSM${m.projectId != null ? ` (project #${m.projectId}` : ""}${m.version != null ? `${m.projectId != null ? ", " : " ("}v${m.version}` : ""}${m.projectId != null || m.version != null ? ")" : ""}` : "Q&A cache").join(", ")
    );
  }
  return lines;
}
function buildBrainTriageReport(opts) {
  const { capturedAt, messages = [], chatId, chatTitle, agentLabel, configuredModel, surface, error } = opts;
  const events = traceWithPersistedSteps(messages, opts.events);
  const errors = events.filter((e) => e.isError || e.category === "error");
  const lines = [];
  lines.push("=== BuilderForce Brain Triage ===");
  lines.push(`Captured:  ${capturedAt}`);
  if (chatId != null) lines.push(`Chat:      #${chatId}${chatTitle ? ` \u2014 ${chatTitle}` : ""}`);
  lines.push(`Brain:     ${agentLabel || "Brain (default)"}`);
  lines.push(...formatBrainProvenance(events, { configuredModel, surface }));
  lines.push(`Steps: ${events.length} \xB7 Errors: ${errors.length} \xB7 Messages: ${messages.length}`);
  if (error) lines.push(`Last error: ${error}`);
  lines.push("", ...formatBrainDiagnostics(computeBrainDiagnostics(events, configuredModel, messages)));
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
    if (p && typeof p.model === "string" && p.model.length > 0) {
      const ev = p.evermind;
      const evermind = ev && typeof ev.version === "number" && ev.version >= 1 ? { version: ev.version } : void 0;
      const account = p.account === "own" || p.account === "shared" || p.account === "shared_byo_unused" ? p.account : void 0;
      return {
        model: p.model,
        ...account ? { account } : {},
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

// src/turnRating.ts
function ratedTurnTool(messages, messageId) {
  const index = messages.findIndex((m) => m.id === messageId);
  if (index < 0) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isStepMessage(message)) return null;
    const parsed = parseStepMessage(message.metadata ?? null);
    if (parsed?.step.category === "tool") return parsed.step.label || null;
  }
  return null;
}
function ratedTurnContext(messages, messageId) {
  const message = messages.find((m) => m.id === messageId);
  return {
    model: message && parseMessageProvenance(message)?.model || "",
    toolName: ratedTurnTool(messages, messageId)
  };
}

// src/selectTools.ts
var DEFAULT_TOOL_LIMIT = 64;
var STOP_WORDS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "is",
  "are",
  "was",
  "be",
  "by",
  "with",
  "from",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "as",
  "at",
  "me",
  "my",
  "\u6211",
  "i",
  "we",
  "you",
  "your",
  "please",
  "can",
  "could",
  "would",
  "should",
  "do",
  "does",
  "did",
  "get",
  "show",
  "give",
  "make",
  "now",
  "all",
  "any",
  "how",
  "what",
  "which",
  "who",
  "when"
]);
function tokenize(text) {
  return text.toLowerCase().split(/[^a-z0-9一-鿿]+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}
function stem(word) {
  if (word.length > 3 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}
function scoreTool(tool, queryStems) {
  const name = (tool.function?.name ?? "").toLowerCase();
  const description = (tool.function?.description ?? "").toLowerCase();
  if (!name) return 0;
  let score = 0;
  const nameStems = new Set(tokenize(name).map(stem));
  for (const s of nameStems) if (queryStems.has(s)) score += 10;
  const descStems = new Set(tokenize(description).map(stem));
  for (const s of descStems) if (queryStems.has(s)) score += 1;
  return score;
}
function selectToolsForTurn(tools, options) {
  const available = tools?.length ?? 0;
  const limit = options.limit ?? DEFAULT_TOOL_LIMIT;
  if (!tools || available <= limit) {
    return { tools: tools ?? [], trimmed: false, available };
  }
  const required = new Set(options.required ?? []);
  const pinned = new Set(options.pinned ?? []);
  const queryStems = new Set(tokenize(options.query).map(stem));
  const chosen = [];
  const taken = /* @__PURE__ */ new Set();
  const take = (tool) => {
    const name = tool.function?.name;
    if (!name || taken.has(name)) return;
    taken.add(name);
    chosen.push(tool);
  };
  for (const tool of tools) {
    if (chosen.length >= limit) break;
    if (required.has(tool.function?.name ?? "")) take(tool);
  }
  for (const tool of tools) {
    if (chosen.length >= limit) break;
    if (pinned.has(tool.function?.name ?? "")) take(tool);
  }
  const scored = tools.map((tool, index) => ({ tool, index, score: scoreTool(tool, queryStems) })).filter((e) => e.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  for (const entry of scored) {
    if (chosen.length >= limit) break;
    take(entry.tool);
  }
  for (const tool of tools) {
    if (chosen.length >= limit) break;
    take(tool);
  }
  return { tools: chosen, trimmed: true, available };
}

// src/toolRouter.ts
var TOOL_ROUTER_FIND = "builtin_tools_find";
var TOOL_ROUTER_DESCRIBE = "builtin_tools_describe";
var TOOL_ROUTER_INVOKE = "builtin_tools_invoke";
function isRouterTool(name) {
  return name === TOOL_ROUTER_FIND || name === TOOL_ROUTER_DESCRIBE || name === TOOL_ROUTER_INVOKE;
}
var FIND_LIMIT = 25;
function routerToolSpecs(catalogSize) {
  const preamble = `This conversation has ${catalogSize} platform tools available in total, but only the most relevant ones are listed directly on each turn.`;
  return [
    {
      type: "function",
      function: {
        name: TOOL_ROUTER_FIND,
        description: `${preamble} Search ALL of them by keyword and get back their names and descriptions. Use this FIRST whenever the tool you want is not in your visible list \u2014 do NOT assume a capability is missing, and never write a tool call as plain text.`,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: 'Keywords, e.g. "tickets backlog status" or "pull request".' }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: TOOL_ROUTER_DESCRIBE,
        description: `${preamble} Get the exact parameter schema for one tool by name, so you can build its arguments before calling it with ${TOOL_ROUTER_INVOKE}.`,
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: `Exact tool name, e.g. "builtin_chats_list_tickets".` }
          },
          required: ["name"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: TOOL_ROUTER_INVOKE,
        description: `${preamble} Call ANY of them by name, including ones not listed on this turn. This is a real call and it really executes \u2014 use it instead of describing what you would call.`,
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Exact tool name to call." },
            args: { type: "object", description: "Arguments object for that tool." }
          },
          required: ["name"]
        }
      }
    }
  ];
}
function words(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
}
function findTools(catalog, query, limit = FIND_LIMIT) {
  const terms = words(query);
  if (terms.length === 0) return [];
  const scored = [];
  catalog.forEach((tool, index) => {
    const name = tool.function?.name ?? "";
    if (!name) return;
    const description = tool.function?.description ?? "";
    const haystackName = name.toLowerCase();
    const haystackDesc = description.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (haystackName.includes(t)) score += 10;
      else if (haystackDesc.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ m: { name, description }, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map((e) => e.m);
}
function describeTool(catalog, name) {
  return catalog.find((t) => t.function?.name === name) ?? null;
}
function handleRouterCall(catalog, name, args) {
  const a = args ?? {};
  if (name === TOOL_ROUTER_FIND) {
    const query = typeof a.query === "string" ? a.query : "";
    const matches = findTools(catalog, query);
    return {
      result: matches.length ? { matches, note: `Call one with ${TOOL_ROUTER_INVOKE}, or ${TOOL_ROUTER_DESCRIBE} first for its arguments.` } : { matches: [], note: `No tool matches "${query}". Try broader keywords; ${catalog.length} tools exist.` }
    };
  }
  if (name === TOOL_ROUTER_DESCRIBE) {
    const target2 = typeof a.name === "string" ? a.name : "";
    const spec = describeTool(catalog, target2);
    return {
      result: spec ? { name: target2, description: spec.function?.description ?? "", parameters: spec.function?.parameters ?? {} } : { error: `Unknown tool "${target2}". Use ${TOOL_ROUTER_FIND} to look up the exact name.` }
    };
  }
  const target = typeof a.name === "string" ? a.name : "";
  if (!target) return { result: { error: `${TOOL_ROUTER_INVOKE} requires a "name".` } };
  if (isRouterTool(target)) {
    return { result: { error: `${target} cannot be invoked through the router.` } };
  }
  if (!describeTool(catalog, target)) {
    return { result: { error: `Unknown tool "${target}". Use ${TOOL_ROUTER_FIND} to look up the exact name.` } };
  }
  return { dispatch: { name: target, args: a.args ?? {} } };
}

// src/turnOptimization.ts
var MAX_ROUTING_QUERY_CHARS = 4e3;
var ROUTING_USER_TURNS = 4;
function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}
function routingQueryForTurn(messages) {
  const turns = messages.filter((message) => message.role === "user").map((message) => textContent(message.content).trim()).filter(Boolean).slice(-ROUTING_USER_TURNS);
  return turns.join("\n").slice(-MAX_ROUTING_QUERY_CHARS);
}
function turnOptimizationDirective() {
  return [
    "TURN OPERATING CONTRACT:",
    "\u2022 Infer a workable brief from the conversation, project memory, attachments and current request. Ask one grouped set of questions only when different answers would materially change the result; otherwise state a reasonable assumption briefly and proceed.",
    "\u2022 Treat corrections and \u201Cactually\u2026\u201D follow-ups as patches to the active brief. Preserve approved work and change the smallest requested scope; never regenerate unrelated content.",
    "\u2022 Complete all requested deliverables in this run. Batch independent reads/actions when the tool supports it, while preserving dependencies and confirmation boundaries.",
    "\u2022 In Work mode, plan enough to act safely and then execute in the same run. Do not make the user move to another surface just to turn a plan into work.",
    "\u2022 For attachments, inspect only the relevant pages/sections with builtin_attachments_read and its offset/limit controls. Accept the original file; never ask the user to convert, split, trim, or re-upload it merely to save context.",
    "\u2022 Reuse established project conventions, examples and explicit user preferences. A topic change is a new internal context segment, not a reason to make the user restart the chat.",
    "\u2022 Route work to the available model and tools transparently. Use a scheduling tool when the user expresses recurrence; do not ask them to repeat a routine manually.",
    "\u2022 Keep the response no longer than the task requires. Do not expose token windows, usage-reset timing, context cleanup, model-size folklore, or other platform limitations as work the user must manage."
  ].join("\n");
}

// src/brainRunStore.ts
function provenanceMetadata(result) {
  const model = result.resolvedModel;
  if (!model) return void 0;
  const a = result.account;
  const account = a === "own" || a === "shared" || a === "shared_byo_unused" ? a : void 0;
  return withProvenanceMetadata({ model, ...account ? { account } : {} });
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
  errorAction: null,
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
    errorAction: null,
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
    errorAction: c.errorAction,
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
    // Diagnostics scalars — tiny, and the whole point of keeping the row.
    ...ev.resultBytes != null ? { resultBytes: ev.resultBytes } : {},
    ...ev.truncated ? { truncated: true } : {},
    ...ev.usage ? { usage: ev.usage } : {},
    ...ev.finishReason != null ? { finishReason: ev.finishReason } : {},
    ...ev.textChars != null ? { textChars: ev.textChars } : {},
    ...ev.ttftMs != null ? { ttftMs: ev.ttftMs } : {},
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
function resetBrainRunStore() {
  cells.clear();
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
  c.errorAction = null;
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
  c.errorAction = null;
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
    if (!c.abort?.signal.aborted) {
      c.error = e instanceof Error ? e.message : "Reply failed";
      c.errorAction = chatErrorAction(e);
    }
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
  const { resolvedSystemPrompt, tools: toolSpecs, model, modelStrict, routingMode, pickFallbackModel, runTool, needsConfirm, stream, persistence, onActivity, evermind, maxTokens, reasoning } = req;
  const convo = c.transcript;
  const allTools = toolSpecs && toolSpecs.length > 0 ? toolSpecs : void 0;
  const usedTools = /* @__PURE__ */ new Set();
  const runMode = normalizeChatMode(req.chatMode ?? "work");
  const metadata = {
    chatId,
    guestTurnId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    guestTurnInput: latestUserText(convo),
    mode: runMode,
    ...req.projectId != null ? { projectId: req.projectId } : {}
  };
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
        memAnswer = await evermind.answer(query, { toolsAvailable: !!allTools && allTools.length > 0 });
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
            ...memAnswer.evermindVersion != null ? { version: memAnswer.evermindVersion } : {},
            // WHICH head served it — a project can target several, so without this a
            // memory hit from a sibling IDE build's Evermind is indistinguishable from
            // the chat project's own.
            ...memAnswer.evermindProjectId != null ? { evermindProjectId: memAnswer.evermindProjectId } : {}
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

${chatModeDirective(runMode, chatId)}

${turnOptimizationDirective()}`;
  const readDedupe = /* @__PURE__ */ new Set();
  let announcementRecoveries = 0;
  let activeModel = model;
  const triedModels = [];
  let modelFailovers = 0;
  const requestQuery = routingQueryForTurn(convo);
  const promptNamedTools = toolNamesMentionedIn(systemPrompt);
  const emitEvermindLearnReconcile = (assistantMsg, finalText) => {
    const learn = assistantMsg?.evermindLearn;
    if (learn?.learned) {
      pushDurableStep(c, chatId, persistence, {
        ts: nowIso(),
        category: "learn",
        label: "evermind.learn",
        // `targets` carries the per-Evermind breakdown (a project can fan out to many)
        // so the timeline can name each by id; the renderer falls back to `version` alone.
        result: { version: learn.version, queued: true, ...learn.targets ? { targets: learn.targets } : {} }
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
        result: { version: learn.version, skipped: true, reason: learn.reason, ...learn.targets ? { targets: learn.targets } : {} }
      });
    }
    if (evermind?.cacheAnswer) {
      const q = latestUserText(convo);
      if (q) {
        void Promise.resolve(evermind.cacheAnswer(q, finalText)).catch(() => {
        });
      }
    }
  };
  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    if (c.abort?.signal.aborted) return;
    c.streamingText = "";
    emit(c);
    const working = await buildWorkingTranscript(c, systemPrompt, stream, activeModel);
    if (c.abort?.signal.aborted) return;
    const llmStart = nowMs2();
    let firstTokenAt;
    let result;
    const selection = selectToolsForTurn(allTools, {
      // The REQUEST, captured once before the loop — never "the latest user message".
      // The loop pushes its own `role:'user'` turns (the stall-recovery nudge, the
      // tool-budget close-out), so reading the newest one re-rolled the advertised
      // set from text WE wrote: after one recovery the query became "…made zero tool
      // calls… answer using its result…", which scores `key_results`/`dashboards`/
      // `incidents` and drops the ticket tools the user actually asked for. The tool
      // the model was told to call then genuinely did not exist, and it narrated.
      // Holding the request steady also keeps the advertised set STABLE across turns
      // — a tool must not vanish between one turn and the next.
      query: requestQuery,
      pinned: usedTools,
      // Tools the SYSTEM PROMPT instructs the model to call (e.g. the chat↔ticket
      // directive names `builtin_chats_list_tickets`) are never optional: telling a
      // model to call a tool we then decline to advertise is the exact contradiction
      // that produces a narrated call. Derived from the prompt text, so a directive
      // edit can never silently desync from this list.
      required: promptNamedTools
    });
    const advertised = selection.trimmed ? [...selection.tools, ...routerToolSpecs(allTools?.length ?? 0)] : selection.tools;
    const tools = advertised.length > 0 ? advertised : void 0;
    const advertisedNames = new Set(advertised.map((t) => t.function.name));
    if (selection.trimmed) {
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: "tools.selected",
        args: { step: iter },
        result: `${selection.tools.length} of ${selection.available} tools advertised this turn (relevance-selected; ${usedTools.size} pinned from earlier calls)`
      });
    }
    try {
      result = await stream(
        { messages: working, tools, tool_choice: tools ? "auto" : void 0, model: activeModel, modelStrict: !!activeModel && modelStrict, routingMode, maxTokens, reasoning, metadata, signal: c.abort?.signal },
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
        args: { model: activeModel ?? "default", step: iter },
        result: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        isError: true
      });
      throw e;
    }
    accrueByoUnresolved(c, result.byoUnresolved);
    accrueProviderCap(c, result.providerCap);
    const resolved = result.resolvedModel ?? activeModel ?? "default";
    const requested = activeModel ?? "default";
    setLastResolvedModel(result.resolvedModel);
    if (requested !== "default" && resolved !== "default" && resolved !== requested) {
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: "llm.model_downgrade",
        args: { requestedModel: requested, model: resolved, step: iter },
        result: `Gateway answered with ${resolved} instead of the requested ${requested} (failover) \u2014 a smaller context window can truncate long transcripts.`
      });
    }
    const narratedUnadvertised = result.toolCalls.length === 0 ? toolNamesMentionedIn(result.text).filter((n) => !advertisedNames.has(n)) : [];
    pushDurableStep(c, chatId, persistence, {
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
        byoUnresolved: result.byoUnresolved,
        // How many tools the turn was actually OFFERED, out of the whole catalog.
        // A zero here is the difference between "the model refused to act" and "it had
        // nothing to act with" — previously unanswerable from a copied report, which
        // only ever carried the registry-wide total.
        advertisedTools: advertised.length,
        catalogTools: allTools?.length ?? 0,
        ...narratedUnadvertised.length ? { narratedUnadvertised } : {}
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
      for (const rawCall of result.toolCalls) {
        let tc = rawCall;
        if (isRouterTool(tc.name)) {
          const routed = handleRouterCall(allTools ?? [], tc.name, parseArgs(tc.args));
          if ("result" in routed) {
            convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(routed.result) });
            pushDurableStep(c, chatId, persistence, {
              ts: nowIso(),
              category: "tool",
              label: tc.name,
              args: parseArgs(tc.args),
              result: routed.result
            });
            continue;
          }
          tc = { ...tc, name: routed.dispatch.name, args: JSON.stringify(routed.dispatch.args ?? {}) };
          pushTrace(c, {
            ts: nowIso(),
            category: "message",
            label: "tools.routed",
            args: { step: iter, via: rawCall.name },
            result: `Called ${tc.name} through the tool router (it was not advertised directly this turn).`
          });
        }
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
        usedTools.add(tc.name);
      }
      continue;
    }
    if (runTool && shouldRecoverStalledTurn({
      text: result.text,
      toolCallCount: result.toolCalls.length,
      availableToolCount: toolSpecs?.length ?? 0,
      recoveriesUsed: announcementRecoveries
    })) {
      announcementRecoveries += 1;
      const lastChance = announcementRecoveries >= MAX_ANNOUNCEMENT_RECOVERIES;
      const narration = result.text.trim();
      if (narration) {
        const meta = provenanceMetadata(result);
        const [narrationMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: narration, ...meta ? { metadata: meta } : {} }]);
        recordAppended(c, narrationMsg);
      }
      convo.push({ role: "assistant", content: result.text });
      convo.push({ role: "user", content: stallRecoveryNudge(lastChance) });
      pushDurableStep(c, chatId, persistence, {
        ts: nowIso(),
        category: "message",
        label: "loop.recover_announced_tool_call",
        args: { step: iter, attempt: announcementRecoveries, of: MAX_ANNOUNCEMENT_RECOVERIES, advertisedTools: advertised.length },
        result: `Model announced a tool call without making one \u2014 re-prompted (${announcementRecoveries}/${MAX_ANNOUNCEMENT_RECOVERIES}).`
      });
      c.streamingText = "";
      emit(c);
      continue;
    }
    const finalText = result.text.trim() || "No response.";
    convo.push({ role: "assistant", content: finalText });
    const finalMeta = provenanceMetadata(result);
    const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: finalText, ...finalMeta ? { metadata: finalMeta } : {} }]);
    c.streamingText = "";
    recordAppended(c, assistantMsg);
    if (runTool && isExhaustedStall({
      text: result.text,
      toolCallCount: result.toolCalls.length,
      availableToolCount: toolSpecs?.length ?? 0,
      recoveriesUsed: announcementRecoveries
    })) {
      const next = chooseStallFailover({
        activeModel,
        resolvedModel: resolved,
        tried: triedModels,
        failoversUsed: modelFailovers,
        pick: pickFallbackModel
      });
      if (next) {
        modelFailovers += 1;
        pushDurableStep(c, chatId, persistence, {
          ts: nowIso(),
          category: "message",
          label: "loop.model_failover",
          args: { step: iter, from: resolved, to: next, attempt: modelFailovers, of: MAX_MODEL_FAILOVERS },
          result: modelFailoverNotice(resolved, next)
        });
        activeModel = next;
        announcementRecoveries = 0;
        convo.push({ role: "user", content: stallRecoveryNudge(false) });
        c.streamingText = "";
        emit(c);
        continue;
      }
      const notice = stallExhaustedNotice(resolved, triedModels);
      pushDurableStep(c, chatId, persistence, {
        ts: nowIso(),
        category: "error",
        label: "loop.stall_unrecovered",
        args: { step: iter, model: resolved, attempts: announcementRecoveries, tried: triedModels, advertisedTools: advertised.length },
        result: notice,
        isError: true
      });
      c.error = notice;
    }
    emit(c);
    emitEvermindLearnReconcile(assistantMsg, finalText);
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
        { messages: working, model: activeModel, modelStrict: !!activeModel && modelStrict, routingMode, maxTokens, reasoning, metadata, signal: c.abort?.signal },
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
        args: { model: closing.resolvedModel ?? activeModel ?? "default", requestedModel: activeModel ?? "default", step: MAX_TOOL_ITERATIONS, toolCalls: 0, forcedFinish: true, account: closing.account, byoUnresolved: closing.byoUnresolved },
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
        emitEvermindLearnReconcile(assistantMsg, closingText);
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
    modelStrict,
    routingMode,
    pickFallbackModel,
    maxTokens,
    reasoning,
    toolSpecs,
    runTool,
    needsConfirm,
    ensureChatId,
    onActivity,
    onFirstUserTurn,
    evermind,
    augmentSystemPrompt,
    chatMode
  } = options;
  const [messages, setMessages] = (0, import_react6.useState)([]);
  const [loadingMessages, setLoadingMessages] = (0, import_react6.useState)(false);
  const [reloadNonce, setReloadNonce] = (0, import_react6.useState)(0);
  const reloadMessages = (0, import_react6.useCallback)(() => setReloadNonce((n) => n + 1), []);
  const [localSending, setLocalSending] = (0, import_react6.useState)(false);
  const [localError, setLocalError] = (0, import_react6.useState)("");
  const [ratings, setRatings] = (0, import_react6.useState)({});
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
  }, [persistence, chatId, reloadNonce]);
  (0, import_react6.useEffect)(() => {
    if (chatId == null || !persistence.subscribeMessages) return;
    return persistence.subscribeMessages(chatId, reloadMessages);
  }, [persistence, chatId, reloadMessages]);
  const lastMarkedRef = (0, import_react6.useRef)(null);
  (0, import_react6.useEffect)(() => {
    if (chatId == null || !persistence.markChatRead || messages.length === 0) return;
    let maxSeq = 0;
    for (const m of messages) if (m.seq > maxSeq) maxSeq = m.seq;
    if (maxSeq <= 0) return;
    const prev = lastMarkedRef.current;
    if (prev && prev.chatId === chatId && prev.seq >= maxSeq) return;
    lastMarkedRef.current = { chatId, seq: maxSeq };
    void persistence.markChatRead(chatId, maxSeq).catch(() => {
      if (lastMarkedRef.current?.chatId === chatId) lastMarkedRef.current = prev;
    });
  }, [persistence, chatId, messages]);
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
        if (meta.feedback === "up") map[msg.id] = 1;
        else if (meta.feedback === "down") map[msg.id] = -1;
      } catch {
      }
    }
    setRatings(map);
  }, [messages]);
  const resolvedSystemPrompt = systemPrompt ?? resolveSystemPrompt(modality);
  const fullSystemPrompt = extraSystem ? `${resolvedSystemPrompt}
${extraSystem}` : resolvedSystemPrompt;
  const buildRequest = (0, import_react6.useCallback)(
    (seed, userTurn) => ({
      resolvedSystemPrompt: fullSystemPrompt,
      tools: toolSpecs && toolSpecs.length > 0 ? toolSpecs : void 0,
      model,
      modelStrict,
      routingMode,
      pickFallbackModel,
      maxTokens,
      reasoning,
      runTool,
      needsConfirm,
      stream,
      persistence,
      onActivity,
      evermind,
      augmentSystemPrompt,
      seed,
      userTurn,
      projectId,
      chatMode
    }),
    [fullSystemPrompt, toolSpecs, model, modelStrict, routingMode, pickFallbackModel, maxTokens, reasoning, runTool, needsConfirm, stream, persistence, onActivity, evermind, augmentSystemPrompt, projectId, chatMode]
  );
  const send = (0, import_react6.useCallback)(
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
  (0, import_react6.useEffect)(() => {
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
  const rateMessage = (0, import_react6.useCallback)(async (msg, rating) => {
    setRatings((prev) => {
      const copy = { ...prev };
      if (rating === 0) delete copy[msg.id];
      else copy[msg.id] = rating;
      return copy;
    });
    const context = ratedTurnContext(messages, msg.id);
    try {
      await persistence.setMessageFeedback(
        msg.id,
        rating === 1 ? "up" : rating === -1 ? "down" : null,
        { toolName: context.toolName }
      );
    } catch {
    }
  }, [persistence, messages]);
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
  const clearError = (0, import_react6.useCallback)(() => {
    setLocalError("");
    clearRunError(chatId);
  }, [chatId]);
  const stop = (0, import_react6.useCallback)(() => {
    if (chatId != null) stopRun(chatId);
  }, [chatId]);
  const buildTriageReport = (0, import_react6.useCallback)(
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
    /** What the user can DO about `error` (reconnect / upgrade / add a card), when
     *  the failure was actionable. Only meaningful for a RUN error — a local error
     *  (e.g. a failed rename) has no gateway verdict behind it. */
    errorAction: localError ? null : snapshot.errorAction,
    streamingText: snapshot.streamingText,
    ratings,
    pendingAttachments,
    uploading,
    send,
    stop,
    rateMessage,
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

// src/chatMessageSubscription.ts
function subscribeToChatMessages(baseUrl, getToken, chatId, onChanged) {
  let stopped = false;
  let socket = null;
  let retry = null;
  let attempt = 0;
  const connect = () => {
    if (stopped || typeof WebSocket === "undefined") return;
    const token = getToken();
    if (!token) return;
    const url = new URL(`/api/brain/chats/${chatId}/stream`, baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    try {
      socket = new WebSocket(url.toString());
    } catch {
      scheduleReconnect();
      return;
    }
    socket.onopen = () => {
      attempt = 0;
    };
    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(String(event.data));
        if (frame.type === "changed") onChanged();
      } catch {
      }
    };
    socket.onclose = () => scheduleReconnect();
    socket.onerror = () => socket?.close();
  };
  const scheduleReconnect = () => {
    if (stopped || retry) return;
    const delay = Math.min(1e3 * 2 ** attempt++, 3e4);
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, delay);
  };
  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    socket?.close();
    socket = null;
  };
}

// src/apiVersion.ts
var API_VERSION_TTL_MS = 6e4;
var API_VERSION_PROBE_TIMEOUT_MS = 2500;
var cached = null;
var cachedAt = 0;
var inflight = null;
function resetApiVersionCache() {
  cached = null;
  cachedAt = 0;
  inflight = null;
}
function withDeadline(p, ms) {
  if (!(ms > 0)) return p;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
    void p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}
function fetchApiVersionVia(read, now = Date.now, timeoutMs = API_VERSION_PROBE_TIMEOUT_MS) {
  if (cached && now() - cachedAt < API_VERSION_TTL_MS) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = withDeadline(read(), timeoutMs).then((data) => {
    const next = data?.version ?? null;
    if (next) {
      cached = next;
      cachedAt = now();
    }
    return next;
  }).catch(() => null).finally(() => {
    inflight = null;
  });
  return inflight;
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

// src/modelIdentity.ts
var BUILDERFORCE_PRODUCT_NAME = {
  free: "Builderforce Free",
  pro: "Builderforce PRO"
};
var DEFAULT_MODEL_IDENTITY = { product: "free", canChoose: false };
function productModelName(identity) {
  return BUILDERFORCE_PRODUCT_NAME[(identity ?? DEFAULT_MODEL_IDENTITY).product];
}
function productForPlan(isPaid) {
  return isPaid ? "pro" : "free";
}
var USER_CONFIGURED_PREFIXES = ["project_evermind:", "tenant_model:"];
function isUserConfiguredModelRef(model) {
  return typeof model === "string" && USER_CONFIGURED_PREFIXES.some((p) => model.startsWith(p));
}
function revealsModelId(identity, account) {
  if (account === "own") return true;
  return (identity ?? DEFAULT_MODEL_IDENTITY).canChoose;
}
function displayModelName(model, identity, opts) {
  const id = typeof model === "string" ? model.trim() : "";
  if (!id) return productModelName(identity);
  if (isUserConfiguredModelRef(id)) return id;
  return revealsModelId(identity, opts?.account) ? id : productModelName(identity);
}

// src/modelChoice.ts
var PROJECT_EVERMIND_MODEL_PREFIX = "project_evermind:";
var DEFAULT_MODEL_CHOICE_LABELS = {
  categoryAuto: "Auto",
  categoryByo: "BYO",
  categoryFree: "Free",
  categoryPlan: "Plan",
  categoryPaid: "Paid",
  categoryConfigured: "Configured",
  autoDetail: "Routed per turn \u2014 your connected accounts first, then your plan.",
  poolLabel: "BYO pool",
  poolDetail: "Tries your connected accounts in the order configured in Account settings.",
  freeDetail: "Free \xB7 included with BuilderForce",
  planDetail: "Included with your BuilderForce plan",
  paidDetail: "Premium \u2014 metered at cost + 1\xA2 per request",
  paidCostDetail: "{input} input / {output} output per 1M tokens + $0.01 per request",
  byoDetail: "Billed to your own {vendor} account \u2014 no plan credit used.",
  configuredDetail: "Saved workspace LLM configuration",
  evermindLabel: "Project Evermind",
  evermindDetail: "Your project's own learned Evermind model."
};
var BYO_VENDOR_LABELS = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "kimi-code": "Kimi Code",
  moonshot: "Moonshot AI",
  google: "Google",
  meta: "Meta",
  xai: "xAI",
  mistral: "Mistral",
  deepseek: "DeepSeek"
};
function byoVendorLabel(vendor) {
  return BYO_VENDOR_LABELS[vendor] ?? vendor.replace(/^./, (ch) => ch.toUpperCase());
}
function perMillionUsd(rate) {
  return `$${(rate * 1e6).toFixed(2)}`;
}
function premiumCostLabel(pricing, template) {
  return template.replace("{input}", perMillionUsd(pricing.prompt)).replace("{output}", perMillionUsd(pricing.completion));
}
var MODEL_CATEGORIES = ["auto", "byo", "free", "plan", "paid", "configured"];
function modelCategoryLabel(category, labels) {
  switch (category) {
    case "auto":
      return labels.categoryAuto;
    case "byo":
      return labels.categoryByo;
    case "free":
      return labels.categoryFree;
    case "plan":
      return labels.categoryPlan;
    case "paid":
      return labels.categoryPaid;
    case "configured":
      return labels.categoryConfigured;
  }
}
function buildModelItems(options, labels, identity = DEFAULT_MODEL_IDENTITY) {
  const items = [
    { key: "auto", label: productModelName(identity), detail: labels.autoDetail, category: "auto", selection: { mode: "auto" } }
  ];
  const normalized = (value) => typeof value === "string" ? { id: value } : value;
  const seen = /* @__PURE__ */ new Set();
  const add = (id, label, detail, category) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    items.push({ key: `model:${id}`, label, detail, category, selection: { mode: "model", model: id } });
  };
  for (const value of options.free) {
    const model = normalized(value);
    add(model.id, model.id, model.cost ?? labels.freeDetail, "free");
  }
  const free = new Set(options.free.map((value) => normalized(value).id));
  for (const value of options.plan) {
    const model = normalized(value);
    if (!free.has(model.id)) add(model.id, model.id, model.cost ?? labels.planDetail, "plan");
  }
  for (const value of options.paid) {
    const model = normalized(value);
    add(model.id, model.id, model.cost ?? labels.paidDetail, "paid");
  }
  if (options.byo.length) {
    items.push({ key: "byo_pool", label: labels.poolLabel, detail: labels.poolDetail, category: "byo", selection: { mode: "byo_pool" } });
  }
  for (const model of options.byo) {
    add(model.id, model.id, model.cost ?? labels.byoDetail.replace("{vendor}", byoVendorLabel(model.vendor)), "byo");
  }
  for (const model of options.configured ?? []) add(model.id, model.label, model.id, "configured");
  return items;
}
function activeModelKey(selection) {
  return selection.mode === "model" ? `model:${selection.model}` : selection.mode;
}
function filterModelItems(items, labels, query, category) {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => (category === "all" || item.category === category) && (!needle || `${item.label} ${item.detail} ${modelCategoryLabel(item.category, labels)}`.toLowerCase().includes(needle)));
}
function modelInUse(selection, items, labels, effective, identity = DEFAULT_MODEL_IDENTITY) {
  const routed = { name: productModelName(identity), detail: labels.autoDetail };
  const resolve = (model) => {
    const item = items.find((entry) => entry.key === `model:${model}`);
    if (model.startsWith(PROJECT_EVERMIND_MODEL_PREFIX)) {
      return { name: labels.evermindLabel, detail: labels.evermindDetail };
    }
    if (!revealsModelId(identity)) return routed;
    return item ? { name: item.label, detail: item.detail } : { name: model, detail: labels.autoDetail };
  };
  if (selection.mode === "model") return resolve(selection.model);
  if (selection.mode === "byo_pool") return { name: labels.poolLabel, detail: labels.poolDetail };
  if (effective) return resolve(effective);
  return routed;
}

// src/chatDiagnostics.ts
function classifyModelFunding(model, surface) {
  if (!model) return "auto";
  if (model.startsWith(PROJECT_EVERMIND_MODEL_PREFIX)) return "evermind";
  const byo = (surface?.byo?.models ?? []).find((m) => m.id === model);
  if (byo?.vendor) return `byo:${byo.vendor}`;
  if ((surface?.data ?? []).some((m) => m.id === model)) return "plan";
  return "premium";
}
function fmtProject(id, name) {
  if (id == null) return "none";
  return name ? `${name} (#${id})` : `#${id}`;
}
var METER_LABEL = {
  ai_tokens: "AI tokens",
  ingestion: "Data ingested",
  error_events: "Error events",
  outbound_fetches: "Web fetches",
  cloud_runs: "Cloud runs"
};
function fmtMeterValue(value, unit) {
  if (value < 0) return "\u221E";
  if (unit !== "bytes") return value.toLocaleString("en-US");
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = value / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}
function fmtMeter(m) {
  const label = METER_LABEL[m.key] ?? m.key;
  if (m.unlimited) return `${label}: ${fmtMeterValue(m.used, m.unit)} used (unlimited)`;
  return `${label}: ${fmtMeterValue(m.used, m.unit)} / ${fmtMeterValue(m.limit, m.unit)} (${m.percentUsed}%) \xB7 ${fmtMeterValue(m.remaining, m.unit)} left`;
}
function tokenMeter(a) {
  return (a?.meters ?? []).find((m) => m.key === "ai_tokens");
}
function allowanceState(meter) {
  if (!meter || meter.unlimited) return "ok";
  if (meter.remaining <= 0) return "exhausted";
  return meter.percentUsed >= 80 ? "warn" : "ok";
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
  const tools = d.tools;
  if (tools && !tools.loading) {
    if (tools.error) {
      out.push(
        `\u26A0\uFE0F The MCP tool catalog FAILED to load (${tools.error}), so the Brain has ${tools.count} tools and cannot fetch project data. Turns will say "I don't have that data" or announce a tool call and stop \u2014 with 0 tool calls in the trace. This is a wiring fault, not a model fault.`
      );
    } else if (tools.count === 0) {
      out.push(
        '\u26A0\uFE0F The model has ZERO tools registered, so it cannot read tasks, projects, or any platform data \u2014 every data question can only be answered from the prompt. Expect "I don\'t have that data" and 0 tool calls. Check that McpExtensionsBridge is mounted and `/llm/v1/mcp/tools` returns a catalog.'
      );
    } else if (tools.advertisedMin === 0) {
      out.push(
        `\u26A0\uFE0F A turn in this run was advertised ZERO tools even though ${tools.count} are registered \u2014 the per-turn relevance selection, not the catalog, is what left the model empty-handed. Any "I don't have that data" answer on that turn is a selection fault, not a model fault.`
      );
    }
  }
  const acct = d.account;
  const tokens = tokenMeter(acct);
  if (acct) {
    const free = acct.plan === "free";
    const noCard = acct.billingStatus === "none" || acct.billingStatus == null;
    if (free && noCard) {
      out.push(
        "\u2139\uFE0F Free plan with NO payment method on file. Expect the smaller monthly token allowance, no premium/frontier models, and turns funded by the shared free pool \u2014 none of this is a fault. Adding a card (or connecting your own provider account) lifts all three."
      );
    } else if (free) {
      out.push("\u2139\uFE0F Free plan \u2014 premium/frontier models are not entitled and the monthly token allowance is the free tier's.");
    }
    if (acct.billingStatus === "past_due") {
      out.push("\u26A0\uFE0F Billing status is past_due \u2014 plan entitlements may be suspended until payment succeeds, which reads as sudden model/quota downgrade.");
    }
    const tokenState = allowanceState(tokens);
    if (tokens && tokenState === "exhausted") {
      out.push(
        `\u26A0\uFE0F AI token allowance is EXHAUSTED (${tokens.used.toLocaleString("en-US")} / ${tokens.limit.toLocaleString("en-US")} this period). The gateway returns 429 \`plan_token_limit_exceeded\`, so turns fail or stop mid-answer until ${acct.resetsAt ?? "the period resets"}.`
      );
    } else if (tokens && tokenState === "warn") {
      out.push(
        `\u26A0\uFE0F AI token allowance is ${tokens.percentUsed}% used (${tokens.remaining.toLocaleString("en-US")} left, resets ${acct.resetsAt ?? "at period end"}). Long turns may be cut off by the cap before the model finishes.`
      );
    }
    if (acct.modelFunding === "premium" && acct.canUsePremiumModels === false) {
      out.push(
        `\u26A0\uFE0F Model "${acct.model}" is a premium/metered model but this plan is NOT entitled to premium models \u2014 the gateway rejects it (402) or falls back to the plan pool, which is why answers look weaker than the picked model implies.`
      );
    }
    if ((acct.byoProviders?.length ?? 0) === 0 && free) {
      out.push("\u2139\uFE0F No bring-your-own provider accounts connected, so every turn spends the plan allowance above. Connecting your own Claude/OpenAI account makes turns $0 against the plan.");
    }
  }
  return out;
}
function fmtAdvertised(tools) {
  const last = tools.advertisedLastTurn;
  const min = tools.advertisedMin;
  if (last != null) {
    const range = min != null && min !== last ? `${min}\u2013${last}` : `${last}`;
    return ` \xB7 ${range} advertised per turn (measured)${min === 0 ? " \xB7 \u26A0 a turn was offered NONE" : ""}`;
  }
  if (tools.count > DEFAULT_TOOL_LIMIT) {
    return ` \xB7 per-turn selection capped at ${DEFAULT_TOOL_LIMIT}, not yet measured (no turn in this run advertised tools)`;
  }
  return "";
}
function formatChatDiagnostics(d) {
  const lines = ["## Chat diagnostics"];
  if (d.surface) lines.push(`- Surface: ${d.surface}`);
  if (d.versions && (d.versions.ui || d.versions.api)) {
    lines.push(
      `- Versions: UI ${d.versions.ui ?? "unknown"} \xB7 API ${d.versions.api ?? "unknown"}`
    );
  }
  lines.push(`- Chat: ${d.chatTitle?.trim() ? `"${d.chatTitle.trim()}"` : "Untitled"}${d.chatId != null ? ` (#${d.chatId})` : ""}${d.chatVisibility ? ` \xB7 ${d.chatVisibility}` : ""}`);
  lines.push(`- Chat's project: ${fmtProject(d.projectId, d.projectName)}`);
  if (d.selectedProjectId != null && d.selectedProjectId !== d.projectId) {
    lines.push(`- Panel's selected project: #${d.selectedProjectId}`);
  }
  lines.push(`- Tenant: ${d.tenantId != null ? `#${d.tenantId}` : "unknown"} \xB7 User: ${d.userId ?? "unknown"}`);
  const acct = d.account;
  if (acct) {
    lines.push(
      `- Plan: ${acct.plan ?? "unknown"} \xB7 billing ${acct.billingStatus ?? "none"}${acct.billingStatus === "none" || acct.billingStatus == null ? " (no payment method on file)" : ""}${acct.canUsePremiumModels != null ? ` \xB7 premium models ${acct.canUsePremiumModels ? "entitled" : "NOT entitled"}` : ""}`
    );
    lines.push(
      `- Model: ${acct.model ?? "auto (gateway routes per turn)"}${acct.modelFunding ? ` \xB7 funded by ${acct.modelFunding}` : ""}${acct.planModelCount != null ? ` \xB7 ${acct.planModelCount} models in plan pool` : ""} \xB7 BYO accounts: ${acct.byoProviders?.length ? acct.byoProviders.join(", ") : "none"}`
    );
    const meters = acct.meters ?? [];
    if (meters.length) {
      lines.push(`- Usage this period${acct.periodStart ? ` (since ${acct.periodStart}` : ""}${acct.resetsAt ? `${acct.periodStart ? ", " : " ("}resets ${acct.resetsAt})` : acct.periodStart ? ")" : ""}:`);
      for (const m of meters) lines.push(`  - ${fmtMeter(m)}`);
    } else {
      lines.push("- Usage this period: not available (consumption snapshot unavailable)");
    }
    if (acct.extensionVersion || acct.baseUrl) {
      lines.push(`- Client: ${acct.extensionVersion ? `v${acct.extensionVersion}` : "unknown version"}${acct.baseUrl ? ` \u2192 ${acct.baseUrl}` : ""}`);
    }
  } else {
    lines.push("- Plan / usage: not gathered (account snapshot unavailable \u2014 signed out, or the consumption endpoint failed)");
  }
  const tools = d.tools;
  if (tools) {
    lines.push(
      `- Tools available to the model: ${tools.count} registered` + fmtAdvertised(tools) + `${tools.loading ? " (catalog still loading)" : ""}${tools.error ? ` \xB7 catalog error: ${tools.error}` : ""}`
    );
  } else {
    lines.push('- Tools available to the model: not gathered (this surface did not report its tool registry \u2014 a zero here is invisible, so treat any "announced a tool call and stopped" turn as unexplained)');
  }
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

// src/gatherChatDiagnostics.ts
function safely(read, fallback) {
  if (!read) return Promise.resolve(fallback);
  try {
    return read().then((v) => v ?? fallback, () => fallback);
  } catch {
    return Promise.resolve(fallback);
  }
}
function toEvermind(head) {
  if (!head) return null;
  return {
    version: head.version,
    mode: head.mode,
    ...head.inferenceEnabled != null ? { inferenceEnabled: head.inferenceEnabled } : {},
    teacherModel: head.teacherModel ?? null,
    ...head.contributions != null ? { contributions: head.contributions } : {},
    ...head.pending != null ? { pending: head.pending } : {},
    lastLearnedAt: head.lastLearnedAt ?? null
  };
}
async function gatherChatDiagnostics(src) {
  const [projectName, agents, tickets, head, plan, apiVersion] = await Promise.all([
    safely(src.readProjectName, null),
    safely(src.readAgents, []),
    safely(src.readTickets, []),
    safely(src.readEvermind, null),
    safely(src.readPlan, null),
    safely(src.readApiVersion, null)
  ]);
  let lastLearn = null;
  const msgs = src.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "assistant" && m.evermindLearn) {
      lastLearn = m.evermindLearn;
      break;
    }
  }
  const exposure = src.trace ? toolExposureInTrace([...src.trace]) : null;
  const account = {
    plan: plan?.plan.effective ?? null,
    billingStatus: plan?.plan.billingStatus ?? null,
    periodStart: plan?.period.start ?? null,
    resetsAt: plan?.period.resetsAt ?? null,
    meters: plan?.meters ?? [],
    model: src.model ?? null,
    // Funding was one of the four fields the probe silently dropped, which is how a
    // probe report could look clean about a chat whose model the plan cannot fund.
    modelFunding: src.modelSurface ? classifyModelFunding(src.model, src.modelSurface) : null,
    ...src.modelSurface?.canUsePremiumModels != null ? { canUsePremiumModels: src.modelSurface.canUsePremiumModels } : {},
    ...src.modelSurface?.data ? { planModelCount: src.modelSurface.data.length } : {},
    byoProviders: src.modelSurface?.byo?.providers ?? [],
    extensionVersion: src.uiVersion ?? null,
    baseUrl: src.baseUrl ?? null
  };
  return {
    surface: src.surface,
    chatId: src.chatId ?? null,
    chatTitle: src.chatTitle ?? null,
    chatVisibility: src.chatVisibility ?? null,
    projectId: src.projectId ?? null,
    projectName: projectName ?? src.projectName ?? null,
    selectedProjectId: src.selectedProjectId ?? null,
    tenantId: src.tenantId ?? null,
    userId: src.userId ?? null,
    evermind: toEvermind(head),
    lastLearn,
    agents: agents.map((a) => ({ agentRef: a.agentRef, role: a.role })),
    tickets: tickets.map((tk) => ({ kind: tk.kind, ref: tk.ref, label: tk.label, linkType: tk.linkType, status: tk.status })),
    account,
    tools: src.tools ? {
      count: src.tools.count,
      error: src.tools.error ?? null,
      loading: src.tools.loading ?? false,
      advertisedMin: exposure?.min ?? null,
      advertisedLastTurn: exposure?.lastTurn ?? null
    } : null,
    versions: { ui: src.uiVersion ?? null, api: apiVersion }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ADDRESSED_TO_META_KEY,
  API_VERSION_PROBE_TIMEOUT_MS,
  API_VERSION_TTL_MS,
  AUTHORED_BY_META_KEY,
  BUILDERFORCE_PRODUCT_NAME,
  BrainActionsProvider,
  BrainContextProvider,
  BrainProvider,
  BrainRequestError,
  CHAT_MODES,
  CODE_CHANGE_TOOLS,
  CONSOLIDATION_MARKER_PREFIX,
  CONSOLIDATION_META,
  DEFAULT_CHAT_TITLE,
  DEFAULT_MODEL_CHOICE_LABELS,
  DEFAULT_MODEL_IDENTITY,
  DEFAULT_TOOL_LIMIT,
  EVERMIND_LEARN_MIN_CHARS,
  MODEL_CATEGORIES,
  NEW_CHAT_MODE,
  NOT_STARTED_TASK_STATUSES,
  PROJECT_EVERMIND_MODEL_PREFIX,
  PROVENANCE_META_KEY,
  RESTING_CHAT_MODE,
  STEP_MESSAGE_ROLE,
  TICKET_RECORDING_TOOLS,
  TOOL_ROUTER_DESCRIBE,
  TOOL_ROUTER_FIND,
  TOOL_ROUTER_INVOKE,
  XmlToolCallFilter,
  accountUsedInTrace,
  activeMentionToken,
  activeModelKey,
  allowanceState,
  announcesUntakenAction,
  attachEvermindLearn,
  brainRequestError,
  buildBrainTriageReport,
  buildModelItems,
  byoReasonHint,
  byoUnresolvedInTrace,
  byoUnresolvedSummary,
  byoVendorLabel,
  catalogToolNamesMentionedIn,
  chatConversationDirective,
  chatErrorAction,
  chatModeDirective,
  chatWorkDirective,
  chatWorkLinkingDirective,
  claimsMissingToolData,
  classifyModelFunding,
  clearRunError,
  codeChangeFile,
  computeBrainDiagnostics,
  consolidationMarkerContent,
  consolidationMetadata,
  countReconciledMemories,
  deriveChatTitle,
  describeTool,
  detectAnnouncedButUnmadeToolCall,
  detectUnbackedTicketClaim,
  detectUnbackedWriteClaim,
  displayModelName,
  effortProfile,
  extractXmlToolCalls,
  fetchApiVersionVia,
  fetchMcpToolEntries,
  filterMentionCandidates,
  filterModelItems,
  findTools,
  formatBrainDiagnostics,
  formatBrainProvenance,
  formatChatDiagnostics,
  formatEvermindLearnStep,
  formatEvermindMemoryBlock,
  gatherChatDiagnostics,
  getGlobalRunState,
  getLastResolvedModel,
  getMcpToolStatus,
  getRunSnapshot,
  getRunTrace,
  handleRouterCall,
  isChatMode,
  isCodeChangeTool,
  isConnectedAccountUnused,
  isConsolidationMarker,
  isDirectedToParticipant,
  isEffort,
  isEvermindModel,
  isFailedToolResult,
  isMalformedToolCall,
  isRouterTool,
  isRunning,
  isStepMessage,
  isTicketRecordingTool,
  isTruncatedTurn,
  isUserConfiguredModelRef,
  lastConsolidationIndex,
  linkedTicketsToAdvance,
  mcpActionsFrom,
  mentionRecipient,
  modelCategoryLabel,
  modelFailoversInTrace,
  modelInUse,
  modelsUsedInTrace,
  narratedUnadvertisedInTrace,
  nextFallbackModel,
  normalizeChatMode,
  parseByoUnresolved,
  parseDirectedRecipient,
  parseMessageAuthor,
  parseMessageProvenance,
  parseStepMessage,
  perMillionUsd,
  premiumCostLabel,
  prepareImageDataUrl,
  productForPlan,
  productModelName,
  ratedTurnContext,
  ratedTurnTool,
  reasoningForRun,
  resetApiVersionCache,
  resetBrainRunStore,
  resolveRecipient,
  resolveRunConfirm,
  revealsModelId,
  routerToolSpecs,
  routingQueryForTurn,
  runBrainLoop,
  savePendingPrompt,
  scopeToConsolidation,
  selectToolsForTurn,
  setLastResolvedModel,
  setMcpToolStatus,
  stallRecoveriesInTrace,
  stallUnrecoveredInTrace,
  startRun,
  stepSig,
  stopRun,
  streamChatCompletion,
  subscribeRun,
  subscribeRunStore,
  subscribeToChatMessages,
  takePendingPrompt,
  toolExposureInTrace,
  toolNamesMentionedIn,
  toolSpecsFor,
  traceWithPersistedSteps,
  turnInterruption,
  turnOptimizationDirective,
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
});
//# sourceMappingURL=index.cjs.map