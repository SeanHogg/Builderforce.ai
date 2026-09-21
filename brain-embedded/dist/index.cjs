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
  AGENT_POOL_PATHS: () => AGENT_POOL_PATHS,
  API_VERSION_PROBE_TIMEOUT_MS: () => API_VERSION_PROBE_TIMEOUT_MS,
  API_VERSION_TTL_MS: () => API_VERSION_TTL_MS,
  ASK_USER_TOOL: () => ASK_USER_TOOL,
  ASK_USER_TOOL_SPEC: () => ASK_USER_TOOL_SPEC,
  AUTHORED_BY_META_KEY: () => AUTHORED_BY_META_KEY,
  BACK_TO_BACK_AT: () => BACK_TO_BACK_AT,
  BASE_BRANCHES: () => BASE_BRANCHES,
  BRAIN_AGENT_ASSIGNMENTS_PATH: () => BRAIN_AGENT_ASSIGNMENTS_PATH,
  BUILDERFORCE_PRODUCT_NAME: () => BUILDERFORCE_PRODUCT_NAME,
  BrainActionsProvider: () => BrainActionsProvider,
  BrainContextProvider: () => BrainContextProvider,
  BrainProvider: () => BrainProvider,
  BrainRequestError: () => BrainRequestError,
  CHAT_DIAGNOSTICS_SCHEMA_VERSION: () => CHAT_DIAGNOSTICS_SCHEMA_VERSION,
  CHAT_MODES: () => CHAT_MODES,
  CHAT_MODE_ICON: () => CHAT_MODE_ICON,
  CODE_CHANGE_TOOLS: () => CODE_CHANGE_TOOLS,
  CONSOLIDATION_MARKER_PREFIX: () => CONSOLIDATION_MARKER_PREFIX,
  CONSOLIDATION_META: () => CONSOLIDATION_META,
  DEFAULT_AGENT_MODEL_SENTINEL: () => DEFAULT_AGENT_MODEL_SENTINEL,
  DEFAULT_CHAT_ACTIVITY_LABELS: () => DEFAULT_CHAT_ACTIVITY_LABELS,
  DEFAULT_CHAT_TITLE: () => DEFAULT_CHAT_TITLE,
  DEFAULT_MODEL_CHOICE_LABELS: () => DEFAULT_MODEL_CHOICE_LABELS,
  DEFAULT_MODEL_IDENTITY: () => DEFAULT_MODEL_IDENTITY,
  DEFAULT_PERSONA: () => DEFAULT_PERSONA,
  DEFAULT_TOOL_FAILURE_STREAK: () => DEFAULT_TOOL_FAILURE_STREAK,
  DEFAULT_TOOL_LIMIT: () => DEFAULT_TOOL_LIMIT,
  EVERMIND_LEARN_MIN_CHARS: () => EVERMIND_LEARN_MIN_CHARS,
  FAILURE_HARD_AT: () => FAILURE_HARD_AT,
  FAILURE_NUDGE_AT: () => FAILURE_NUDGE_AT,
  FailureTally: () => FailureTally,
  HISTORY_TOKEN_BUDGET: () => HISTORY_TOKEN_BUDGET,
  LOCAL_WORKSPACE_TOOLS: () => LOCAL_WORKSPACE_TOOLS,
  MAX_TOOL_RESULT_CHARS: () => MAX_TOOL_RESULT_CHARS,
  MODALITY_PERSONAS: () => MODALITY_PERSONAS,
  MODEL_CATEGORIES: () => MODEL_CATEGORIES,
  NEW_CHAT_MODE: () => NEW_CHAT_MODE,
  NOT_STARTED_TASK_STATUSES: () => NOT_STARTED_TASK_STATUSES,
  ON_DEVICE_ANSWER_THRESHOLD: () => ON_DEVICE_ANSWER_THRESHOLD,
  PERSONA_MODALITY_IDS: () => PERSONA_MODALITY_IDS,
  PMO_FOCUS_PARAM: () => PMO_FOCUS_PARAM,
  PROJECT_EVERMIND_MODEL_PREFIX: () => PROJECT_EVERMIND_MODEL_PREFIX,
  PROVENANCE_META_KEY: () => PROVENANCE_META_KEY,
  PromptInput: () => PromptInput,
  READ_FILE_RESULT_CHARS: () => READ_FILE_RESULT_CHARS,
  RESTING_CHAT_MODE: () => RESTING_CHAT_MODE,
  REVISIT_HARD_AT: () => REVISIT_HARD_AT,
  REVISIT_NUDGE_AT: () => REVISIT_NUDGE_AT,
  ReadCoverage: () => ReadCoverage,
  RepetitionLoopError: () => RepetitionLoopError,
  STEP_MESSAGE_ROLE: () => STEP_MESSAGE_ROLE,
  STOPPED_TURN_META_KEY: () => STOPPED_TURN_META_KEY,
  STOPPED_TURN_STEP: () => STOPPED_TURN_STEP,
  STREAM_IDLE_MS: () => STREAM_IDLE_MS,
  StreamIdleError: () => StreamIdleError,
  StreamInterruptedError: () => StreamInterruptedError,
  TICKET_RECORDING_TOOLS: () => TICKET_RECORDING_TOOLS,
  TOOL_ROUTER_DESCRIBE: () => TOOL_ROUTER_DESCRIBE,
  TOOL_ROUTER_FIND: () => TOOL_ROUTER_FIND,
  TOOL_ROUTER_INVOKE: () => TOOL_ROUTER_INVOKE,
  TransportError: () => TransportError,
  UNBACKED_TICKET_CLAIM_NOTICE: () => UNBACKED_TICKET_CLAIM_NOTICE,
  UNBACKED_WRITE_CLAIM_NOTICE: () => UNBACKED_WRITE_CLAIM_NOTICE,
  UNSCOPED_MUTATION_TOOLS: () => UNSCOPED_MUTATION_TOOLS,
  WEB_FETCH_TOOL_NAME: () => WEB_FETCH_TOOL_NAME,
  XmlToolCallFilter: () => XmlToolCallFilter,
  accountUsedInTrace: () => accountUsedInTrace,
  activeHashtagToken: () => activeHashtagToken,
  activeMentionToken: () => activeMentionToken,
  activeModelKey: () => activeModelKey,
  activeTicketToken: () => activeTicketToken,
  activityIcon: () => activityIcon,
  activityMessageCount: () => activityMessageCount,
  activityTarget: () => activityTarget,
  activityTone: () => activityTone,
  agentPersonaChoice: () => agentPersonaChoice,
  agentPersonaPrompt: () => agentPersonaPrompt,
  allowanceState: () => allowanceState,
  announcesUntakenAction: () => announcesUntakenAction,
  applyRemoteRun: () => applyRemoteRun,
  artifactRoutePath: () => artifactRoutePath,
  asProvenanceAccount: () => asProvenanceAccount,
  askUserAnchorId: () => askUserAnchorId,
  askUserBlock: () => askUserBlock,
  attachEvermindLearn: () => attachEvermindLearn,
  attemptedPublish: () => attemptedPublish,
  brainPersonaAgents: () => brainPersonaAgents,
  brainRequestError: () => brainRequestError,
  buildBrainTriageReport: () => buildBrainTriageReport,
  buildChatDiagnosticsReport: () => buildChatDiagnosticsReport,
  buildComposerDirectives: () => buildComposerDirectives,
  buildModelItems: () => buildModelItems,
  byoReasonHint: () => byoReasonHint,
  byoUnresolvedInTrace: () => byoUnresolvedInTrace,
  byoUnresolvedSummary: () => byoUnresolvedSummary,
  byoVendorLabel: () => byoVendorLabel,
  canChangeCodeHere: () => canChangeCodeHere,
  canShipHere: () => canShipHere,
  catalogToolNamesMentionedIn: () => catalogToolNamesMentionedIn,
  chatActivityText: () => chatActivityText,
  chatConversationDirective: () => chatConversationDirective,
  chatErrorAction: () => chatErrorAction,
  chatModeDirective: () => chatModeDirective,
  chatWorkDirective: () => chatWorkDirective,
  chatWorkLinkingDirective: () => chatWorkLinkingDirective,
  claimsMissingToolData: () => claimsMissingToolData,
  classifyModelFunding: () => classifyModelFunding,
  clearRunError: () => clearRunError,
  codeChangeFile: () => codeChangeFile,
  coerceAskUserPayload: () => coerceAskUserPayload,
  composeEvermindHooks: () => composeEvermindHooks,
  computeBrainDiagnostics: () => computeBrainDiagnostics,
  computeRunProgress: () => computeRunProgress,
  consolidationMarkerContent: () => consolidationMarkerContent,
  consolidationMetadata: () => consolidationMetadata,
  countReconciledMemories: () => countReconciledMemories,
  createBrainRestPersistence: () => createBrainRestPersistence,
  createComposingActivity: () => createComposingActivity,
  createPayloadBudget: () => createPayloadBudget,
  declinesShipping: () => declinesShipping,
  deriveChatTitle: () => deriveChatTitle,
  describeLiveStep: () => describeLiveStep,
  describeTool: () => describeTool,
  detectAnnouncedButUnmadeToolCall: () => detectAnnouncedButUnmadeToolCall,
  detectUnbackedTicketClaim: () => detectUnbackedTicketClaim,
  detectUnbackedWriteClaim: () => detectUnbackedWriteClaim,
  directedAgentRecipients: () => directedAgentRecipients,
  dirtyPathsOf: () => dirtyPathsOf,
  displayModelName: () => displayModelName,
  effortProfile: () => effortProfile,
  extractXmlToolCalls: () => extractXmlToolCalls,
  failureReason: () => failureReason,
  fetchApiVersionVia: () => fetchApiVersionVia,
  fetchMcpToolEntries: () => fetchMcpToolEntries,
  filterMentionCandidates: () => filterMentionCandidates,
  filterModelItems: () => filterModelItems,
  filterTicketCandidates: () => filterTicketCandidates,
  findTools: () => findTools,
  forgetResolvedModels: () => forgetResolvedModels,
  formatAssistantTranscriptHeading: () => formatAssistantTranscriptHeading,
  formatBrainDiagnostics: () => formatBrainDiagnostics,
  formatBrainProvenance: () => formatBrainProvenance,
  formatBytes: () => formatBytes,
  formatChatDiagnostics: () => formatChatDiagnostics,
  formatChatDiagnosticsReportJson: () => formatChatDiagnosticsReportJson,
  formatDispatchRefusals: () => formatDispatchRefusals,
  formatEvermindLearnStep: () => formatEvermindLearnStep,
  formatEvermindMemoryBlock: () => formatEvermindMemoryBlock,
  formatModelScorecard: () => formatModelScorecard,
  formatModelTurnLog: () => formatModelTurnLog,
  formatRunProgress: () => formatRunProgress,
  formatStaffingSummary: () => formatStaffingSummary,
  gatherChatDiagnostics: () => gatherChatDiagnostics,
  getGlobalRunState: () => getGlobalRunState,
  getLastResolvedModel: () => getLastResolvedModel,
  getMcpToolStatus: () => getMcpToolStatus,
  getRunDriver: () => getRunDriver,
  getRunSnapshot: () => getRunSnapshot,
  getRunTrace: () => getRunTrace,
  handleRouterCall: () => handleRouterCall,
  hasEditIntent: () => hasEditIntent,
  installRunDriver: () => installRunDriver,
  isActivityMessage: () => isActivityMessage,
  isChatMode: () => isChatMode,
  isCodeChangeTool: () => isCodeChangeTool,
  isCoderReask: () => isCoderReask,
  isConnectedAccountUnused: () => isConnectedAccountUnused,
  isConsolidationMarker: () => isConsolidationMarker,
  isDirectedToParticipant: () => isDirectedToParticipant,
  isDispatchTool: () => isDispatchTool,
  isEffort: () => isEffort,
  isEvermindModel: () => isEvermindModel,
  isFailedToolResult: () => isFailedToolResult,
  isLocalWorkspaceTool: () => isLocalWorkspaceTool,
  isMalformedToolCall: () => isMalformedToolCall,
  isMutationTool: () => isMutationTool,
  isRouterTool: () => isRouterTool,
  isRunning: () => isRunning,
  isStepMessage: () => isStepMessage,
  isStoppedTurn: () => isStoppedTurn,
  isTicketRecordingTool: () => isTicketRecordingTool,
  isTicketWriteTool: () => isTicketWriteTool,
  isTruncatedTurn: () => isTruncatedTurn,
  isUnscopedMutationTool: () => isUnscopedMutationTool,
  isUserConfiguredModelRef: () => isUserConfiguredModelRef,
  lastConsolidationIndex: () => lastConsolidationIndex,
  lastServedModel: () => lastServedModel,
  leftChangeUnshipped: () => leftChangeUnshipped,
  linkedTicketsToAdvance: () => linkedTicketsToAdvance,
  linkedTicketsToComplete: () => linkedTicketsToComplete,
  loadAgentPoolVia: () => loadAgentPoolVia,
  loadBrainPersonaAgentsVia: () => loadBrainPersonaAgentsVia,
  localStorageConfirmationPersistence: () => localStorageConfirmationPersistence,
  localToolsIn: () => localToolsIn,
  mcpActionsFrom: () => mcpActionsFrom,
  mentionRecipient: () => mentionRecipient,
  mergeRecoveredTrace: () => mergeRecoveredTrace,
  midRunNotice: () => midRunNotice,
  modalityPersonaChoice: () => modalityPersonaChoice,
  modelCategoryLabel: () => modelCategoryLabel,
  modelFailoversInTrace: () => modelFailoversInTrace,
  modelInUse: () => modelInUse,
  modelScorecard: () => modelScorecard,
  modelTurnLog: () => modelTurnLog,
  modelsUsedInTrace: () => modelsUsedInTrace,
  narratedUnadvertisedInTrace: () => narratedUnadvertisedInTrace,
  nextFallbackModel: () => nextFallbackModel,
  normalizeChatMode: () => normalizeChatMode,
  onDeviceMemoryHooks: () => onDeviceMemoryHooks,
  parseAskUser: () => parseAskUser,
  parseByoUnresolved: () => parseByoUnresolved,
  parseChatActivity: () => parseChatActivity,
  parseDirectedRecipients: () => parseDirectedRecipients,
  parseGitShortStatus: () => parseGitShortStatus,
  parseMessageAuthor: () => parseMessageAuthor,
  parseMessageProvenance: () => parseMessageProvenance,
  parsePmoFocus: () => parsePmoFocus,
  parseStepMessage: () => parseStepMessage,
  perMillionUsd: () => perMillionUsd,
  personaAgentOf: () => personaAgentOf,
  personaModalityOf: () => personaModalityOf,
  personaModel: () => personaModel,
  personaOverlay: () => personaOverlay,
  personaSystemPrompt: () => personaSystemPrompt,
  pmoFocusDomId: () => pmoFocusDomId,
  pmoFocusValue: () => pmoFocusValue,
  poolAgentsFrom: () => poolAgentsFrom,
  premiumCostLabel: () => premiumCostLabel,
  prepareImageDataUrl: () => prepareImageDataUrl,
  productForPlan: () => productForPlan,
  productModelName: () => productModelName,
  progressDuration: () => progressDuration,
  projectMemoryHooks: () => projectMemoryHooks,
  ratedTurnContext: () => ratedTurnContext,
  ratedTurnTool: () => ratedTurnTool,
  readWithIdleWatchdog: () => readWithIdleWatchdog,
  reasoningForRun: () => reasoningForRun,
  repeatedFailureAdvisory: () => repeatedFailureAdvisory,
  requestRunConfirm: () => requestRunConfirm,
  resetApiVersionCache: () => resetApiVersionCache,
  resetBrainRunStore: () => resetBrainRunStore,
  resolveRecipient: () => resolveRecipient,
  resolveRunConfirm: () => resolveRunConfirm,
  revealsModelId: () => revealsModelId,
  revisitAdvisory: () => revisitAdvisory,
  routerToolSpecs: () => routerToolSpecs,
  routingQueryForTurn: () => routingQueryForTurn,
  runBrainLoop: () => startRun,
  runProgressVerdict: () => runProgressVerdict,
  savePendingPrompt: () => savePendingPrompt,
  scopeToConsolidation: () => scopeToConsolidation,
  selectPendingAskUser: () => selectPendingAskUser,
  selectToolsForTurn: () => selectToolsForTurn,
  selfReviewShipDirective: () => selfReviewShipDirective,
  serializeAskUser: () => serializeAskUser,
  setLastResolvedModel: () => setLastResolvedModel,
  setMcpToolStatus: () => setMcpToolStatus,
  shippedToBaseBranch: () => shippedToBaseBranch,
  shortenTarget: () => shortenTarget,
  stableStringify: () => stableStringify,
  staffingSummaryInTrace: () => staffingSummaryInTrace,
  stallRecoveriesInTrace: () => stallRecoveriesInTrace,
  stallUnrecoveredInTrace: () => stallUnrecoveredInTrace,
  startRun: () => startRun,
  stepSig: () => stepSig,
  stopRun: () => stopRun,
  stoppedTurnMetadata: () => stoppedTurnMetadata,
  streamChatCompletion: () => streamChatCompletion,
  stripAskUser: () => stripAskUser,
  subscribeRun: () => subscribeRun,
  subscribeRunStore: () => subscribeRunStore,
  subscribeToChatMessages: () => subscribeToChatMessages,
  takePendingPrompt: () => takePendingPrompt,
  toolActivity: () => toolActivity,
  toolCallArgBytes: () => toolCallArgBytes,
  toolExposureInTrace: () => toolExposureInTrace,
  toolNamesMentionedIn: () => toolNamesMentionedIn,
  toolSpecsFor: () => toolSpecsFor,
  traceEventToPersistInput: () => traceEventToPersistInput,
  traceWithPersistedSteps: () => traceWithPersistedSteps,
  trimToolResult: () => trimToolResult,
  turnInterruption: () => turnInterruption,
  turnOptimizationDirective: () => turnOptimizationDirective,
  unshippedChangeNudge: () => unshippedChangeNudge,
  useBrainActions: () => useBrainActions,
  useBrainChats: () => useBrainChats,
  useBrainConfig: () => useBrainConfig,
  useBrainContext: () => useBrainContext,
  useBrainConversation: () => useBrainConversation,
  useMcpExtensions: () => useMcpExtensions,
  useOptionalBrainContext: () => useOptionalBrainContext,
  useRegisterBrainActions: () => useRegisterBrainActions,
  useToolConfirmationGate: () => useToolConfirmationGate,
  utf8ByteLength: () => utf8ByteLength,
  withAdvisory: () => withAdvisory,
  withDirectedMetadata: () => withDirectedMetadata,
  withObservedModel: () => withObservedModel,
  withProvenanceMetadata: () => withProvenanceMetadata,
  workFiledNotStaffedVerdict: () => workFiledNotStaffedVerdict,
  workItemLinkFromCreate: () => workItemLinkFromCreate
});
module.exports = __toCommonJS(src_exports);

// src/config.tsx
var import_react = require("react");

// src/xmlToolCalls.ts
var isSelfClosing = (dialect) => "closeAt" in dialect;
function skipSpace(text, i) {
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}
function objectEnd(text, i) {
  let depth = 0;
  let inString = false;
  for (let j = i; j < text.length; j += 1) {
    const c = text[j];
    if (inString) {
      if (c === "\\") j += 1;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}
var PARTIAL_MAP_KEY = /^(?:"\d*"?\s*:?\s*)?$/;
var MAP_KEY = /^"\d+"\s*:\s*/;
var MAP_TERMINATOR = /^\}?\s*\??\s*\|?>?/;
function callMapEnd(buf, final) {
  const unfinished = (at) => final ? { at, length: buf.length - at } : null;
  let i = skipSpace(buf, 0);
  if (buf[i] === "{") i = skipSpace(buf, i + 1);
  for (; ; ) {
    const entryStart = i;
    const rest2 = buf.slice(i);
    const key = MAP_KEY.exec(rest2);
    if (!key) return PARTIAL_MAP_KEY.test(rest2) ? unfinished(entryStart) : { at: i, length: 0 };
    i += key[0].length;
    if (i >= buf.length) return unfinished(entryStart);
    if (buf[i] !== "{") return { at: entryStart, length: 0 };
    const end = objectEnd(buf, i);
    if (end < 0) return unfinished(entryStart);
    i = skipSpace(buf, end);
    if (i >= buf.length) return unfinished(end);
    if (buf[i] !== ",") break;
    i = skipSpace(buf, i + 1);
  }
  const rest = buf.slice(i);
  const terminator = MAP_TERMINATOR.exec(rest)[0];
  if (!final && terminator.length === rest.length && !terminator.endsWith(">")) return null;
  return { at: i, length: terminator.length };
}
function parseCallMap(body, seq) {
  const entries = body.trim().replace(/^\{/, "").replace(/,\s*$/, "");
  let map;
  try {
    map = JSON.parse(`{${entries}}`);
  } catch {
    return [];
  }
  return Object.values(map).flatMap((raw, index) => {
    const entry = raw;
    if (!entry || typeof entry.name !== "string" || !entry.name) return [];
    const args = entry.arguments ?? {};
    return [{ id: `xmltc_${seq}_${index}`, name: entry.name, args: typeof args === "string" ? args : JSON.stringify(args) }];
  });
}
var DIALECTS = [
  { prefix: "<tool_call>", open: /<tool_call>/, close: "</tool_call>", namedInOpenTag: false },
  { prefix: "<function_call>", open: /<function_call>/, close: "</function_call>", namedInOpenTag: false },
  { prefix: "<tool_use>", open: /<tool_use>/, close: "</tool_use>", namedInOpenTag: false },
  { prefix: "<invoke", open: /<invoke\s+name\s*=\s*"([^"]*)"\s*>/, close: "</invoke>", namedInOpenTag: true },
  { prefix: "<function=", open: /<function\s*=\s*([^>]+)>/, close: "</function>", namedInOpenTag: true },
  // Grok's own dialect, written when it drops out of native function calling:
  // `<xai:function_call name="read_file"><parameter name="path">…</parameter></xai:function_call>`.
  // `<function_call>` above needs the bare tag, so nothing matched it: the calls never
  // ran, the markup reached the transcript as "narration", and Grok, seeing its own
  // calls with no results, concluded the tools were not returning. The name is optional
  // in the pattern so a body carrying `{"name":…}` JSON is lifted too.
  { prefix: "<xai:function_call", open: /<xai:function_call(?:\s+name\s*=\s*"([^"]*)")?\s*>/, close: "</xai:function_call>", namedInOpenTag: true },
  // Grok's numbered call map (chat #106, grok-4.6): `<|"0":{"name":…,"arguments":{…}}, "1":{…} ?>`,
  // with or without the outer braces and never with a closing tag. Four calls written
  // this way ran nothing, and the turn decayed into counting.
  { prefix: "<|", open: /<\|\s*(?=\{?\s*"\d+"\s*:\s*\{)/, closeAt: callMapEnd, parseBody: parseCallMap }
];
var CALL_MAP_OPEN_TAIL = /<\|\s*\{?\s*(?:"\d*"?\s*:?\s*)?$/;
var CONTROL_TOKEN = /<+\|[a-z][a-z0-9_]{0,31}\|>/gi;
var CONTROL_TOKEN_TAIL = /<+(?:\|[a-z0-9_]{0,32}\|?)?$/i;
function stripControlTokens(text) {
  return text.replace(CONTROL_TOKEN, "");
}
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
    if (!isSelfClosing(d) && d.namedInOpenTag) {
      const idx = buf.lastIndexOf(d.prefix);
      if (idx >= 0 && !buf.slice(idx).includes(">")) hold = Math.max(hold, buf.length - idx);
    }
  }
  for (const tailPattern of [CALL_MAP_OPEN_TAIL, CONTROL_TOKEN_TAIL]) {
    const tail = tailPattern.exec(buf);
    if (tail) hold = Math.max(hold, tail[0].length);
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
function callEnd(dialect, buf) {
  if (isSelfClosing(dialect)) return dialect.closeAt(buf, false);
  const at = buf.indexOf(dialect.close);
  return at >= 0 ? { at, length: dialect.close.length } : null;
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
var PARAMETER_TAG = /<(?:xai:)?parameter\s+name\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\/(?:xai:)?parameter>/g;
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
  const firstArg = trimmed.search(/<arg_key>|<(?:xai:)?parameter\s/);
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
var CALL_MARKUP = /<\/?(?:[\w-]+:)?(?:function_call|tool_call|tool_use|invoke)\b/i;
function hasCallMarkup(text) {
  return CALL_MARKUP.test(text);
}
var XmlToolCallFilter = class {
  buf = "";
  inside = null;
  insideName;
  innerBuf = "";
  clean = "";
  calls = [];
  seq = 0;
  /** Close the call currently being accumulated and record it. A dialect whose name
   *  is optional in the open tag falls back to reading the name from the body. */
  commit() {
    const dialect = this.inside;
    const seq = this.seq++;
    if (dialect && isSelfClosing(dialect)) {
      this.calls.push(...dialect.parseBody(this.innerBuf, seq));
    } else {
      const parsed = dialect?.namedInOpenTag && this.insideName !== void 0 ? parseNamedBody(this.insideName, this.innerBuf, seq) : parseInner(this.innerBuf, seq);
      if (parsed) this.calls.push(parsed);
    }
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
      const end = callEnd(this.inside, this.buf);
      if (end) {
        this.innerBuf += this.buf.slice(0, end.at);
        this.buf = this.buf.slice(end.at + end.length);
        this.commit();
        continue;
      }
      const hold = isSelfClosing(this.inside) ? this.buf.length : partialTailPrefix(this.buf, this.inside.close);
      this.innerBuf += this.buf.slice(0, this.buf.length - hold);
      this.buf = hold ? this.buf.slice(this.buf.length - hold) : "";
      break;
    }
    emit2 = stripControlTokens(emit2);
    this.clean += emit2;
    return emit2;
  }
  /** End of stream: flush held-back text and close any unterminated call. */
  flush() {
    let emit2 = "";
    if (this.inside && isSelfClosing(this.inside)) {
      const end = this.inside.closeAt(this.buf, true) ?? { at: this.buf.length, length: 0 };
      this.innerBuf += this.buf.slice(0, end.at);
      emit2 = stripControlTokens(this.buf.slice(end.at + end.length));
      this.commit();
    } else if (this.inside) {
      this.innerBuf += this.buf;
      this.commit();
    } else {
      emit2 = stripControlTokens(this.buf);
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

// ../packages/agent-loop/src/types.ts
var DEFAULT_TOOL_FAILURE_STREAK = 5;

// ../packages/agent-loop/src/parseToolCall.ts
function asToolArgs(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return null;
}
function parseToolArgs(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { args: {}, malformed: false };
  try {
    const bag = asToolArgs(JSON.parse(text));
    return bag ? { args: bag, malformed: false } : { args: {}, malformed: true };
  } catch {
    return { args: {}, malformed: true };
  }
}
function parseToolCall(raw) {
  const { args, malformed } = parseToolArgs(raw.arguments);
  return { id: raw.id, name: raw.name, args, raw, malformed };
}

// ../packages/agent-loop/src/repetitionLoop.ts
var COUNT_MIN_RUN = 50;
var COUNT_MAX_DIGITS = 6;
var isDigit = (code) => code >= 48 && code <= 57;
var isCountSeparator = (code) => code === 32 || code === 9 || code === 10 || code === 13 || code === 44;
function tailCountingRun(text) {
  let pos = text.length;
  let expected = null;
  let count = 0;
  let start = pos;
  for (; ; ) {
    let end = pos;
    while (end > 0 && isCountSeparator(text.charCodeAt(end - 1))) end -= 1;
    let begin = end;
    while (begin > 0 && end - begin <= COUNT_MAX_DIGITS && isDigit(text.charCodeAt(begin - 1))) begin -= 1;
    if (begin === end || end - begin > COUNT_MAX_DIGITS) break;
    if (begin > 0 && !isCountSeparator(text.charCodeAt(begin - 1))) break;
    const value = Number(text.slice(begin, end));
    if (expected !== null && value !== expected) break;
    count += 1;
    start = begin;
    pos = begin;
    expected = value - 1;
  }
  if (count < COUNT_MIN_RUN) return null;
  return { block: text.slice(start).trim(), copies: count, kept: text.slice(0, start).trimEnd() };
}
var LOOP_MIN_COPIES = 3;
var LOOP_MIN_BLOCK_CHARS = 40;
var LOOP_LONG_BLOCK_CHARS = 240;
var LOOP_LONG_MIN_COPIES = 2;
var LOOP_MAX_BLOCK_CHARS = 4e3;
var minCopiesFor = (chars) => chars >= LOOP_LONG_BLOCK_CHARS ? LOOP_LONG_MIN_COPIES : LOOP_MIN_COPIES;
var LOOP_MIN_BLOCK_WORDS = 5;
function inOpenCodeFence(text) {
  let fences = 0;
  for (let i = text.indexOf("```"); i !== -1; i = text.indexOf("```", i + 3)) fences += 1;
  return fences % 2 === 1;
}
function readsAsProse(block) {
  let words2 = 0;
  for (const word of block.split(/\s+/)) {
    if (/\p{L}/u.test(word)) words2 += 1;
    if (words2 >= LOOP_MIN_BLOCK_WORDS) return true;
  }
  return false;
}
function tailHasPeriod(text, p, span) {
  const end = text.length;
  for (let i = end - 1; i >= end - span + p; i -= 1) {
    if (text.charCodeAt(i) !== text.charCodeAt(i - p)) return false;
  }
  return true;
}
function detectRepetitionLoop(text) {
  const counting = tailCountingRun(text);
  if (counting) return inOpenCodeFence(text) ? null : counting;
  const length = text.length;
  if (length < LOOP_MIN_COPIES * LOOP_MIN_BLOCK_CHARS) return null;
  const maxBlock = Math.min(LOOP_MAX_BLOCK_CHARS, Math.floor(length / LOOP_LONG_MIN_COPIES));
  for (let p = LOOP_MIN_BLOCK_CHARS; p <= maxBlock; p += 1) {
    const copies = minCopiesFor(p);
    if (copies * p > length || !tailHasPeriod(text, p, copies * p)) continue;
    let start = length - copies * p;
    while (start > 0 && text.charCodeAt(start - 1) === text.charCodeAt(start - 1 + p)) start -= 1;
    const block = text.slice(start, start + p);
    if (!readsAsProse(block)) continue;
    if (inOpenCodeFence(text)) return null;
    return { block, copies: Math.floor((length - start) / p), kept: text.slice(0, start + p) };
  }
  return null;
}

// ../packages/agent-loop/src/loop.ts
var Ctx = class {
  constructor(messages, signal) {
    this.messages = messages;
    this.signal = signal;
  }
  messages;
  signal;
  step = 0;
  stepInCall = 0;
  output = "";
  failureStreak = 0;
};
async function runAgentLoop(args) {
  const { codec, ports, budget, signal } = args;
  const hooks = args.hooks ?? {};
  const ctx = new Ctx(args.messages, signal);
  const startStep = Math.max(0, budget.startStep ?? 0);
  const maxThisCall = budget.maxSteps ?? Number.POSITIVE_INFINITY;
  const stepCap = () => budget.stepCap ?? Number.POSITIVE_INFINITY;
  const failureStreakCap = budget.failureStreakCap ?? DEFAULT_TOOL_FAILURE_STREAK;
  ctx.step = startStep;
  ctx.output = args.initialOutput ?? "";
  let ok = true;
  let finished = false;
  let cancelled = false;
  let failuresTripped = false;
  let awaitingInput;
  const isCancelled = async () => Boolean(signal?.aborted) || Boolean(await hooks.isCancelled?.(ctx));
  for (; ctx.step < stepCap() && !finished && ctx.stepInCall < maxThisCall; ctx.step++, ctx.stepInCall++) {
    if (await isCancelled()) {
      cancelled = true;
      break;
    }
    const before = await hooks.beforeTurn?.(ctx);
    if (before?.action === "stop") {
      ok = before.ok ?? false;
      if (before.output !== void 0) ctx.output = before.output;
      finished = before.finished ?? true;
      break;
    }
    let turnResult;
    try {
      turnResult = await ports.complete(ctx);
    } catch (err) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      throw err;
    }
    if ("skip" in turnResult) continue;
    if ("failed" in turnResult) {
      ok = false;
      ctx.output = turnResult.failed;
      finished = true;
      break;
    }
    let turn = turnResult;
    const looped = turn.content ? detectRepetitionLoop(turn.content) : null;
    if (looped) {
      turn = { ...turn, content: looped.kept };
      await hooks.onRepetitionLoop?.(ctx, looped);
    }
    if (turn.content) ctx.output = turn.content;
    await hooks.afterTurn?.(ctx, turn);
    if (turn.toolCalls.length === 0) {
      const decision = await hooks.onNoToolCalls?.(ctx, turn) ?? { action: "finish" };
      if (decision.action === "continue") continue;
      if (decision.action === "stop") {
        ok = decision.ok ?? false;
        if (decision.output !== void 0) ctx.output = decision.output;
        finished = decision.finished ?? true;
        break;
      }
      if (decision.output !== void 0) ctx.output = decision.output;
      finished = true;
      break;
    }
    const calls = turn.toolCalls.map(parseToolCall);
    const gate = await hooks.beforeToolCalls?.(ctx, turn, calls);
    if (gate?.action === "stop") {
      ok = gate.ok ?? true;
      if (gate.output !== void 0) ctx.output = gate.output;
      finished = gate.finished ?? true;
      break;
    }
    ctx.messages.push(codec.assistant(turn));
    for (let i = 0; i < calls.length; i++) {
      let call = calls[i];
      let result;
      const pre = await hooks.beforeDispatch?.(call, ctx);
      if (pre && "result" in pre) result = pre.result;
      else if (pre && "rewrite" in pre) call = pre.rewrite;
      if (!result) result = await ports.dispatch(call, ctx);
      if (result.control?.kind === "finish") {
        const block = await hooks.onFinish?.(ctx, result.control.summary, call);
        if (block) {
          result = { data: { ok: false, error: block }, isError: true };
        } else {
          finished = true;
          if (result.control.summary) ctx.output = result.control.summary;
        }
      } else if (result.control?.kind === "ask_human") {
        await hooks.onAskHuman?.(ctx, result.control, call);
        awaitingInput = { approvalId: result.control.approvalId, question: result.control.question, callId: call.id };
      }
      if (!result.control) ctx.failureStreak = result.isError ? ctx.failureStreak + 1 : 0;
      const row = codec.tool(call, result);
      ctx.messages.push(row);
      const post = await hooks.afterDispatch?.(call, result, row, ctx);
      if (post?.skipRemaining) {
        const skipped = { data: post.skipRemaining.data, isError: post.skipRemaining.isError ?? true };
        for (const rest of calls.slice(i + 1)) ctx.messages.push(codec.tool(rest, skipped));
        break;
      }
    }
    const after = await hooks.afterToolCalls?.(ctx, finished);
    if (after && after.finished !== void 0) finished = after.finished;
    if (awaitingInput) break;
    if (!finished && ctx.failureStreak >= failureStreakCap) {
      ctx.step++;
      ctx.stepInCall++;
      failuresTripped = true;
      break;
    }
  }
  const exhausted = !finished && !cancelled && !awaitingInput && (failuresTripped || ctx.step >= stepCap());
  return {
    ok,
    output: ctx.output,
    finished,
    cancelled,
    step: ctx.step,
    exhausted,
    ...exhausted ? { exhaustedBy: failuresTripped ? "failures" : "steps" } : {},
    failureStreak: ctx.failureStreak,
    ...awaitingInput ? { awaitingInput } : {}
  };
}

// ../packages/agent-loop/src/openaiCodec.ts
function toOpenAiToolCall(call) {
  return { id: call.id, type: "function", function: { name: call.name, arguments: call.arguments?.trim() ? call.arguments : "{}" } };
}
var defaultToolRowSerializer = (result) => JSON.stringify(result.data ?? null);
function openAiChatCodec(serialize = defaultToolRowSerializer) {
  return {
    assistant(turn) {
      const row = {
        role: "assistant",
        content: turn.content ?? "",
        tool_calls: turn.toolCalls.map(toOpenAiToolCall)
      };
      return row;
    },
    tool(call, result) {
      const row = { role: "tool", tool_call_id: call.id, content: serialize(result, call) };
      return row;
    }
  };
}

// ../packages/agent-loop/src/reasoning.ts
var REASONING_TAG = "think(?:ing)?|thought|antthinking|scratchpad|reasoning";
var QUICK_TAG_RE = new RegExp(`<\\s*/?\\s*(?:${REASONING_TAG}|final)\\b`, "i");
var FINAL_TAG_RE = /<\s*\/?\s*final\b[^<>]*>/gi;
var REASONING_TAG_RE = new RegExp(`<\\s*(/?)\\s*(?:${REASONING_TAG})\\b[^<>]*>`, "gi");
function findCodeRegions(text) {
  const regions = [];
  const fencedRe = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2(?:\n|$)|$)/g;
  for (const match of text.matchAll(fencedRe)) {
    const lead = match[1] ?? "";
    const start = (match.index ?? 0) + lead.length;
    regions.push({ start, end: start + match[0].length - lead.length });
  }
  const inlineRe = /`+[^`]+`+/g;
  for (const match of text.matchAll(inlineRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const insideFenced = regions.some((r) => start >= r.start && end <= r.end);
    if (!insideFenced) regions.push({ start, end });
  }
  regions.sort((a, b) => a.start - b.start);
  return regions;
}
function isInsideCode(pos, regions) {
  return regions.some((r) => pos >= r.start && pos < r.end);
}
function scanReasoning(text) {
  const regions = findCodeRegions(text);
  const spans = [];
  let kind = "answer";
  let start = 0;
  let contentStart = 0;
  REASONING_TAG_RE.lastIndex = 0;
  for (const match of text.matchAll(REASONING_TAG_RE)) {
    const idx = match.index ?? 0;
    if (isInsideCode(idx, regions)) continue;
    const isClose = match[1] === "/";
    if (kind === "thought" && !isClose) continue;
    const after = idx + match[0].length;
    spans.push({ kind, start, contentStart, contentEnd: idx, end: isClose ? after : idx, unterminated: false });
    kind = isClose ? "answer" : "thought";
    start = isClose ? after : idx;
    contentStart = after;
  }
  spans.push({
    kind,
    start,
    contentStart,
    contentEnd: text.length,
    end: text.length,
    unterminated: kind === "thought"
  });
  return spans;
}
function splitReasoningSegments(text) {
  if (!text) return [];
  if (!QUICK_TAG_RE.test(text)) return [{ kind: "answer", content: text }];
  const cleaned = unwrapFinalTags(text);
  const segments = segmentsOf(cleaned, scanReasoning(cleaned));
  if (segments.length === 0) return [{ kind: "answer", content: text }];
  return stitchSplitSentence(promoteSwallowedAnswer(segments));
}
var EMPTY_TOOL_CALL_WRAPPER = /<([a-z][\w-]*:tool_call)\b[^<>]*>\s*<\/\1>/gi;
function segmentsOf(text, spans) {
  const out = [];
  for (const span of spans) {
    const raw = text.slice(span.contentStart, span.contentEnd);
    const content = (span.kind === "thought" ? raw.replace(EMPTY_TOOL_CALL_WRAPPER, "") : raw).trim();
    if (content) out.push({ kind: span.kind, content });
  }
  return out;
}
function unwrapFinalTags(text) {
  FINAL_TAG_RE.lastIndex = 0;
  if (!FINAL_TAG_RE.test(text)) {
    FINAL_TAG_RE.lastIndex = 0;
    return text;
  }
  FINAL_TAG_RE.lastIndex = 0;
  const regions = findCodeRegions(text);
  const cuts = [];
  for (const match of text.matchAll(FINAL_TAG_RE)) {
    const start = match.index ?? 0;
    if (!isInsideCode(start, regions)) cuts.push({ start, length: match[0].length });
  }
  let out = text;
  for (let i = cuts.length - 1; i >= 0; i--) {
    const cut = cuts[i];
    out = out.slice(0, cut.start) + out.slice(cut.start + cut.length);
  }
  return out;
}
var MAX_FRAGMENT_CHARS = 40;
var REPLY_OPENER = /^[A-Z0-9#*\-_>`[|("']/;
function isFragment(text) {
  return text.length > 0 && text.length <= MAX_FRAGMENT_CHARS && !REPLY_OPENER.test(text);
}
function promoteSwallowedAnswer(segments) {
  const answers = segments.filter((s) => s.kind === "answer");
  if (answers.length === 0) return segments;
  const answerText = answers.map((s) => s.content).join(" ").trim();
  if (!isFragment(answerText)) return segments;
  const thoughts = segments.filter((s) => s.kind === "thought");
  const richest = thoughts.reduce(
    (best, s) => !best || s.content.length > best.content.length ? s : best,
    null
  );
  if (!richest || richest.content.length <= answerText.length) return segments;
  const promoted = [{ kind: "answer", content: `${richest.content} ${answerText}`.trim() }];
  for (const s of thoughts) if (s !== richest) promoted.unshift(s);
  return promoted;
}
var UNFINISHED_TAIL = /[\p{L}\p{N},]$/u;
var LOWERCASE_OPENER = /^\p{Ll}/u;
function lastSentenceStart(text) {
  let cut = text.lastIndexOf("\n") + 1;
  for (const match of text.matchAll(/[.!?](?=\s)/g)) {
    const after = (match.index ?? 0) + 1;
    if (after > cut) cut = after;
  }
  return cut;
}
function stitchSplitSentence(segments) {
  const out = [...segments];
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (prev.kind !== "thought" || cur.kind !== "answer") continue;
    if (cur.content.length <= MAX_FRAGMENT_CHARS) continue;
    if (!LOWERCASE_OPENER.test(cur.content) || !UNFINISHED_TAIL.test(prev.content)) continue;
    const cut = lastSentenceStart(prev.content);
    const head = prev.content.slice(0, cut).trim();
    out[i] = { kind: "answer", content: `${prev.content.slice(cut).trim()} ${cur.content}` };
    if (head) {
      out[i - 1] = { kind: "thought", content: head };
    } else {
      out.splice(i - 1, 1);
      i -= 1;
    }
  }
  return out;
}
function answerTextOf(content) {
  return splitReasoningSegments(content).filter((s) => s.kind === "answer").map((s) => s.content).join("\n\n").trim();
}
function thoughtTextOf(content) {
  return splitReasoningSegments(content).filter((s) => s.kind === "thought").map((s) => s.content).join("\n\n").trim();
}
function replayTextOf(content) {
  return answerTextOf(content) || thoughtTextOf(content);
}
function detailsText(details) {
  if (!Array.isArray(details)) return "";
  return details.map((d) => {
    const item = d;
    return item && (item.type === void 0 || item.type === "reasoning.text") && typeof item.text === "string" ? item.text : "";
  }).filter(Boolean).join("\n");
}
function splitVendorReasoning(message) {
  const rawContent = typeof message?.content === "string" ? message.content : "";
  const inlineThought = thoughtTextOf(rawContent);
  const content = inlineThought ? answerTextOf(rawContent) : rawContent;
  const structured = [
    typeof message?.reasoning_content === "string" ? message.reasoning_content : "",
    typeof message?.reasoning === "string" ? message.reasoning : "",
    detailsText(message?.reasoning_details)
  ].map((s) => s.trim()).filter(Boolean);
  const reasoning = [...structured, ...inlineThought ? [inlineThought] : []].join("\n\n").trim();
  return { content, reasoning };
}
function canonicalReasoningText(content, reasoning) {
  const answer = (content ?? "").trim();
  const thought = (reasoning ?? "").trim();
  if (!thought) return answer;
  return answer ? `<think>${thought}</think>

${answer}` : `<think>${thought}</think>`;
}

// ../packages/agent-loop/src/index.ts
var ASK_USER_TOOL = "ask_user";
var ASK_USER_TOOL_SPEC = {
  type: "function",
  function: {
    name: ASK_USER_TOOL,
    description: "Ask the user to choose between options when you genuinely cannot proceed without their decision (e.g. who owns this, which approach, create under X or Y). Prefer this over asking in prose \u2014 the UI renders your options as clickable buttons and the choice returns as the user's next message. Do NOT use it for questions you can answer yourself from the code or context.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The single, specific question to ask." },
        options: {
          type: "array",
          description: "2\u20136 distinct, mutually-exclusive choices (unless multiSelect).",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short choice text (1\u20135 words)." },
              description: { type: "string", description: "Optional one-line explanation of this choice." }
            },
            required: ["label"]
          }
        },
        multiSelect: { type: "boolean", description: "Allow choosing more than one option. Default false." }
      },
      required: ["question", "options"]
    }
  }
};
var ASK_USER_FENCE = /```ask-user\s*\n([\s\S]*?)\n```/i;
function coerceAskUserPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const question = typeof o.question === "string" ? o.question.trim() : "";
  const optionsIn = Array.isArray(o.options) ? o.options : [];
  const options = optionsIn.map((it) => {
    if (typeof it === "string") return it.trim() ? { label: it.trim() } : null;
    if (it && typeof it === "object") {
      const rec = it;
      const label = typeof rec.label === "string" ? rec.label.trim() : "";
      const description = typeof rec.description === "string" ? rec.description.trim() : void 0;
      return label ? { label, ...description ? { description } : {} } : null;
    }
    return null;
  }).filter((x) => !!x);
  if (!question || options.length < 2) return null;
  return { question, options, multiSelect: o.multiSelect === true };
}
function serializeAskUser(payload) {
  return ["```ask-user", JSON.stringify(payload), "```"].join("\n");
}
function askUserBlock(args) {
  const payload = coerceAskUserPayload(args);
  return payload ? serializeAskUser(payload) : null;
}
function parseAskUser(text) {
  if (!text || !text.includes("ask-user")) return null;
  const body = text.match(ASK_USER_FENCE)?.[1];
  if (!body) return null;
  try {
    return coerceAskUserPayload(JSON.parse(body));
  } catch {
    return null;
  }
}
function stripAskUser(text) {
  if (!text) return text;
  return text.replace(ASK_USER_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}
function askUserAnchorId(messageId) {
  return `bf-ask-${messageId}`;
}
function selectPendingAskUser(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === "user") return null;
    if (msg.role !== "assistant") continue;
    const payload = parseAskUser(msg.content);
    if (payload) return { payload, messageId: msg.id };
  }
  return null;
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

// src/streamIdleWatchdog.ts
var STREAM_IDLE_MS = 24e4;
var StreamIdleError = class extends Error {
  /** The silence that was exceeded, so the caller can say it in its own message. */
  idleMs;
  constructor(idleMs) {
    super(`the stream produced no bytes for ${Math.round(idleMs / 1e3)}s`);
    this.name = "StreamIdleError";
    this.idleMs = idleMs;
  }
};
async function readWithIdleWatchdog(reader, opts = {}) {
  const idleMs = opts.idleMs ?? STREAM_IDLE_MS;
  const read = reader.read();
  if (!Number.isFinite(idleMs) || idleMs <= 0) return read;
  read.catch(() => void 0);
  let timer;
  const idle = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new StreamIdleError(idleMs);
      opts.onIdle?.(idleMs);
      reject(error);
      try {
        const cancelled = reader.cancel(error);
        if (cancelled && typeof cancelled.catch === "function") {
          cancelled.catch(() => void 0);
        }
      } catch {
      }
    }, idleMs);
  });
  try {
    return await Promise.race([read, idle]);
  } finally {
    if (timer !== void 0) clearTimeout(timer);
  }
}

// src/streamChatCompletion.ts
var UPSTREAM_EVIDENCE_FIELD = "x_builderforce_upstream";
function readUpstreamEvidence(frame) {
  const raw = frame?.[UPSTREAM_EVIDENCE_FIELD];
  if (!raw || typeof raw.functionCalls !== "number") return void 0;
  return {
    items: raw.items && typeof raw.items === "object" ? raw.items : {},
    functionCalls: raw.functionCalls,
    recovered: typeof raw.recovered === "number" ? raw.recovered : 0
  };
}
var StreamInterruptedError = class extends Error {
  model;
  constructor(message, model) {
    super(message);
    this.name = "StreamInterruptedError";
    this.model = model;
  }
};
var TransportError = class extends Error {
  model;
  constructor(message, model = void 0) {
    super(message);
    this.name = "TransportError";
    this.model = model;
  }
};
var LOOP_QUOTE_CHARS = 90;
var RepetitionLoopError = class extends StreamInterruptedError {
  kept;
  block;
  copies;
  // Structural, not `RepetitionLoop` by name: this class is published, and its
  // declaration must not reach into the source-only loop package for a type.
  constructor(loop, model) {
    const quote = loop.block.trim();
    const shown = quote.length > LOOP_QUOTE_CHARS ? `${quote.slice(0, LOOP_QUOTE_CHARS - 1).trimEnd()}\u2026` : quote;
    super(`the model got stuck repeating itself (${loop.copies}\xD7 "${shown}")`, model);
    this.name = "RepetitionLoopError";
    this.kept = loop.kept;
    this.block = loop.block;
    this.copies = loop.copies;
  }
};
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
  if (opts.role) body.role = opts.role;
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
  let res;
  try {
    res = await doFetch(`${transport.baseUrl}/llm/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts.signal
    });
  } catch (e) {
    if (e instanceof TypeError) {
      throw new TransportError(`fetch failed: ${e.message}`);
    }
    throw e;
  }
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
  let modelAnnounced = false;
  const announceModel = () => {
    const known = resolvedModel();
    if (modelAnnounced || !known) return;
    modelAnnounced = true;
    handlers.onModel?.(known, account());
  };
  announceModel();
  let usage;
  const readUsage = (u) => {
    if (!u || typeof u !== "object") return;
    const o = u;
    const num = (x) => typeof x === "number" && Number.isFinite(x) ? x : void 0;
    const next = { prompt: num(o.prompt_tokens), completion: num(o.completion_tokens), total: num(o.total_tokens) };
    if (next.prompt != null || next.completion != null || next.total != null) usage = next;
  };
  let upstream;
  const toolAcc = /* @__PURE__ */ new Map();
  const xml = new XmlToolCallFilter();
  let finishReason = null;
  let shown = "";
  const allToolCalls = () => [...assemble(toolAcc), ...xml.toolCalls()];
  const reader = res.body?.getReader();
  if (!reader) {
    const data = await res.json().catch(() => null);
    if (typeof data?.model === "string" && data.model) streamModel = data.model;
    announceModel();
    readUsage(data?.usage);
    upstream = readUpstreamEvidence(data);
    const choice = data?.choices?.[0];
    const { text, toolCalls: xmlCalls } = extractXmlToolCalls(choice?.message?.content ?? "");
    const loop = detectRepetitionLoop(text);
    if (loop) throw new RepetitionLoopError(loop, resolvedModel());
    if (text) handlers.onTextDelta?.(text);
    (choice?.message?.tool_calls ?? []).forEach((tc, i) => {
      const idx = tc.index ?? i;
      toolAcc.set(idx, { id: tc.id ?? "", name: tc.function?.name ?? "", args: tc.function?.arguments ?? "" });
    });
    finishReason = choice?.finish_reason ?? null;
    handlers.onDone?.(finishReason);
    return { text, toolCalls: [...assemble(toolAcc), ...xmlCalls], finishReason, resolvedModel: resolvedModel(), resolvedVendor: resolvedVendor(), account: account(), byoUnresolved: byoUnresolved(), providerCap: providerCap(), usage, upstream };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    let chunkRead;
    try {
      chunkRead = await readWithIdleWatchdog(reader, { idleMs: opts.idleTimeoutMs ?? STREAM_IDLE_MS });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (e instanceof StreamIdleError) {
        throw new StreamInterruptedError(`the stream went silent for ${Math.round(e.idleMs / 1e3)}s`, resolvedModel());
      }
      throw new StreamInterruptedError(`the stream dropped mid-answer: ${e instanceof Error ? e.message : String(e)}`, resolvedModel());
    }
    const { done, value } = chunkRead;
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
        return { text: xml.cleanText(), toolCalls: allToolCalls(), finishReason, resolvedModel: resolvedModel(), resolvedVendor: resolvedVendor(), account: account(), byoUnresolved: byoUnresolved(), providerCap: providerCap(), usage, upstream };
      }
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      if (parsed.error) {
        const message = typeof parsed.error === "string" ? parsed.error : parsed.error.message ?? "unknown error";
        reader.cancel().catch(() => void 0);
        throw new StreamInterruptedError(`the model failed mid-answer: ${message}`, resolvedModel());
      }
      if (!streamModel && typeof parsed.model === "string" && parsed.model) streamModel = parsed.model;
      announceModel();
      if (parsed.usage) readUsage(parsed.usage);
      upstream = readUpstreamEvidence(parsed) ?? upstream;
      const choice = parsed.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const contentDelta = (typeof choice?.delta?.content === "string" ? choice.delta.content : null) || parsed.response || parsed.text || parsed.delta || "";
      if (contentDelta) {
        const visible = xml.push(contentDelta);
        if (visible) {
          shown += visible;
          const loop = detectRepetitionLoop(shown);
          if (loop) {
            reader.cancel().catch(() => void 0);
            throw new RepetitionLoopError(loop, resolvedModel());
          }
          handlers.onTextDelta?.(visible);
        }
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
  return { text: xml.cleanText(), toolCalls: allToolCalls(), finishReason, resolvedModel: resolvedModel(), resolvedVendor: resolvedVendor(), account: account(), byoUnresolved: byoUnresolved(), providerCap: providerCap(), usage, upstream };
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

// src/composerDirectives.ts
var WEB_FETCH_TOOL_NAME = "builtin_web_fetch";
function buildComposerDirectives(o) {
  const parts = [];
  const { directive } = effortProfile(o.effort);
  if (directive) parts.push(directive);
  if (o.web) {
    parts.push(
      `You may browse the web: when a question needs current or external information, call the \`${WEB_FETCH_TOOL_NAME}\` tool to read the relevant URL(s) rather than relying on memory, and cite the sources you use.`
    );
  }
  return parts.join("\n\n");
}

// src/useToolConfirmationGate.ts
var import_react2 = require("react");
function useToolConfirmationGate(options) {
  const { isMutating, persistence, defaultOn = false } = options;
  const [autoApprove, setAutoApproveState] = (0, import_react2.useState)(defaultOn);
  const autoApproveRef = (0, import_react2.useRef)(defaultOn);
  const persistenceRef = (0, import_react2.useRef)(persistence);
  persistenceRef.current = persistence;
  (0, import_react2.useEffect)(() => {
    const stored = persistenceRef.current?.read();
    const initial = stored ?? defaultOn;
    autoApproveRef.current = initial;
    setAutoApproveState(initial);
  }, [defaultOn]);
  const setAutoApprove = (0, import_react2.useCallback)((on) => {
    autoApproveRef.current = on;
    setAutoApproveState(on);
    persistenceRef.current?.write(on);
  }, []);
  const needsConfirm = (0, import_react2.useCallback)(
    (req) => isMutating(req.name, req.args) && !autoApproveRef.current,
    [isMutating]
  );
  return { autoApprove, setAutoApprove, needsConfirm };
}
function localStorageConfirmationPersistence(key) {
  return {
    read() {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? void 0 : raw !== "0";
      } catch {
        return void 0;
      }
    },
    write(on) {
      try {
        localStorage.setItem(key, on ? "1" : "0");
      } catch {
      }
    }
  };
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
function projectMemoryHooks(projectId, request, chatId) {
  const json = { "Content-Type": "application/json" };
  return {
    recall: (query) => request(`/api/projects/${projectId}/evermind/recall`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ query, ...chatId != null ? { chatId } : {} })
    }).catch(() => null),
    answer: (query, opts) => request(
      `/api/projects/${projectId}/answer?query=${encodeURIComponent(query)}&tools=${opts.toolsAvailable ? "1" : "0"}`
    ).then((r) => r?.answer ?? null).catch(() => null),
    cacheAnswer: (query, answer) => {
      void request(`/api/projects/${projectId}/answer`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ question: query, answer })
      }).catch(() => {
      });
    }
  };
}
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
  const lines = items.map((it) => ({ it, text: it.text.replace(/\s+/g, " ").trim() })).filter(({ text }) => text.length > 0).map(({ it, text }, i) => `${i + 1}. ${it.tier ? `${TIER_LABEL[it.tier]} ` : ""}${text}`);
  if (lines.length === 0) return "";
  return [
    "[Evermind Memory \u2014 recalled from this project's self-learning model]",
    // Recall always fills its budget from the whole project, so a NEW chat is handed
    // eight other conversations' replies. Framed as "relevant … treat as grounding",
    // chat #105 (grok-4.6) took them as its own agenda: asked to wire Room chat bubbles,
    // it announced "closing out linked work" and "the roster collapse code" — another
    // chat's task — for three turns and never touched the request.
    "Prior learnings matched to this request automatically. The match is by similarity, so any of them may be unrelated: use one only where it bears on what the user asked in THIS conversation, and ignore the rest.",
    `Memories marked ${TIER_LABEL.project} come from other conversations and runs \u2014 never resume, close out, or act on their work here.`,
    "If one is outdated or wrong, correct it in your answer (this project learns write-through \u2014 your reply updates its memory).",
    ...lines
  ].join("\n");
}
var TIER_LABEL = {
  chat: "(this conversation)",
  project: "(elsewhere in the project)"
};
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

// src/onDeviceMemory.ts
var ON_DEVICE_ANSWER_THRESHOLD = 0.985;
function onDeviceMemoryHooks(load) {
  const store = async () => {
    try {
      return await load();
    } catch {
      return null;
    }
  };
  return {
    answer: async (query) => {
      const cache = await store();
      if (!cache) return null;
      try {
        const hit = await cache.lookup(query);
        if (!hit || hit.score < ON_DEVICE_ANSWER_THRESHOLD || !hit.response.trim()) return null;
        return { text: hit.response, source: "qa-cache" };
      } catch {
        return null;
      }
    },
    cacheAnswer: async (query, answer) => {
      const cache = await store();
      if (!cache) return;
      try {
        await cache.store(query, answer);
      } catch {
      }
    }
  };
}
function composeEvermindHooks(...layers) {
  const present = layers.filter((l) => !!l);
  const recall = present.find((l) => l.recall)?.recall;
  const answering = present.filter((l) => l.answer);
  const caching = present.filter((l) => l.cacheAnswer);
  if (!recall && answering.length === 0 && caching.length === 0) return void 0;
  return {
    recall: recall ?? (async () => null),
    ...answering.length ? {
      answer: async (query, opts) => {
        for (const layer of answering) {
          const hit = await layer.answer?.(query, opts);
          if (hit) return hit;
        }
        return null;
      }
    } : {},
    ...caching.length ? {
      cacheAnswer: (query, answer) => {
        for (const layer of caching) {
          try {
            void Promise.resolve(layer.cacheAnswer?.(query, answer)).catch(() => {
            });
          } catch {
          }
        }
      }
    } : {}
  };
}

// src/BrainActionsContext.tsx
var import_react3 = require("react");

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
var BrainActionsContext = (0, import_react3.createContext)(null);
var BrainRegistrarContext = (0, import_react3.createContext)(null);
function BrainActionsProvider({ children }) {
  const registry = (0, import_react3.useRef)(/* @__PURE__ */ new Map());
  const [version, setVersion] = (0, import_react3.useState)(0);
  const bump = (0, import_react3.useCallback)(() => setVersion((v) => v + 1), []);
  const register = (0, import_react3.useCallback)((actions) => {
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
  const runTool = (0, import_react3.useCallback)(async (name, args) => {
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
  const isMutating = (0, import_react3.useCallback)((name, args) => {
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
  const toolSpecs = (0, import_react3.useMemo)(() => {
    return toolSpecsFor([...registry.current.values()].map((e) => e.action));
  }, [version]);
  const value = (0, import_react3.useMemo)(
    () => ({ toolSpecs, runTool, isMutating, register }),
    [toolSpecs, runTool, isMutating, register]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(BrainRegistrarContext.Provider, { value: register, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(BrainActionsContext.Provider, { value, children }) });
}
function useBrainActions() {
  const ctx = (0, import_react3.useContext)(BrainActionsContext);
  if (!ctx) {
    throw new Error("useBrainActions must be used within a BrainActionsProvider");
  }
  return ctx;
}
function declarationSignature(actions) {
  try {
    return JSON.stringify(
      actions.map((a) => [a.name, a.description, a.parameters, typeof a.mutates === "function" ? "fn" : a.mutates ?? false])
    );
  } catch {
    return actions.map((a) => a.name).join(",");
  }
}
function liveAction(name, latest) {
  const current = () => latest.current.find((a) => a.name === name);
  return {
    name,
    get description() {
      return current()?.description ?? "";
    },
    get parameters() {
      return current()?.parameters ?? { type: "object", properties: {} };
    },
    get mutates() {
      return current()?.mutates;
    },
    run: (args) => {
      const action = current();
      if (!action) return { error: `Unknown tool: ${name}` };
      return action.run(args);
    }
  };
}
function useRegisterBrainActions(actions) {
  const register = (0, import_react3.useContext)(BrainRegistrarContext);
  const latest = (0, import_react3.useRef)(actions);
  (0, import_react3.useEffect)(() => {
    latest.current = actions;
  }, [actions]);
  const signature = declarationSignature(actions);
  const names = actions.map((a) => a.name).join(",");
  (0, import_react3.useEffect)(() => {
    if (!register || names === "") return;
    return register(names.split(",").map((name) => liveAction(name, latest)));
  }, [register, signature]);
}

// src/useMcpExtensions.ts
var import_react4 = require("react");

// src/mcpToolStatus.ts
var status = { count: 0, error: null, loading: true };
function setMcpToolStatus(next) {
  status = next;
}
function getMcpToolStatus() {
  return status;
}

// src/stableStringify.ts
function stableStringify(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const o = value;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

// src/mcpCatalog.ts
var CREATE_DEDUPE_MS = 8e3;
var recentCreates = /* @__PURE__ */ new Map();
function nowMs() {
  return typeof Date !== "undefined" ? Date.now() : 0;
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
          body: JSON.stringify({ extensionId: entry.extensionId, tool: entry.tool, arguments: args })
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
  const { transport: modelTransport } = useBrainConfig();
  const transport = options?.transport ?? modelTransport;
  const [entries, setEntries] = (0, import_react4.useState)([]);
  const [loading, setLoading] = (0, import_react4.useState)(true);
  const [error, setError] = (0, import_react4.useState)(null);
  const skipKey = (options?.skipExtensionIds ?? []).join(",");
  const onToolResultRef = (0, import_react4.useRef)(options?.onToolResult);
  onToolResultRef.current = options?.onToolResult;
  (0, import_react4.useEffect)(() => {
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
  const actions = (0, import_react4.useMemo)(
    () => mcpActionsFrom(entries, transport, (info) => onToolResultRef.current?.(info)),
    [entries, transport]
  );
  useRegisterBrainActions(actions);
  (0, import_react4.useEffect)(() => {
    setMcpToolStatus({ count: actions.length, error, loading });
  }, [actions.length, error, loading]);
  return { loading, toolCount: actions.length, error };
}

// src/BrainContext.tsx
var import_react5 = require("react");
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
var BrainContext = (0, import_react5.createContext)(null);
function BrainContextProvider({ children }) {
  const [open, setOpen] = (0, import_react5.useState)(false);
  const [pageContext, setPageContext] = (0, import_react5.useState)(DEFAULT_CONTEXT);
  const [activeChatId, setActiveChatId] = (0, import_react5.useState)(null);
  (0, import_react5.useEffect)(() => {
    if (readSession(OPEN_KEY) === "1") setOpen(true);
    const savedChat = readSession(CHAT_KEY);
    if (savedChat != null) {
      const n = Number(savedChat);
      if (Number.isFinite(n)) setActiveChatId(n);
    }
  }, []);
  (0, import_react5.useEffect)(() => {
    writeSession(OPEN_KEY, open ? "1" : "0");
  }, [open]);
  (0, import_react5.useEffect)(() => {
    writeSession(CHAT_KEY, activeChatId == null ? null : String(activeChatId));
  }, [activeChatId]);
  const setContext = (0, import_react5.useCallback)((patch) => {
    setPageContext((prev) => {
      const next = { ...prev, ...patch };
      if (next.projectId === prev.projectId && next.viewingProjectId === prev.viewingProjectId && next.modality === prev.modality && next.extraSystem === prev.extraSystem && next.initialChatId === prev.initialChatId && next.initialPrompt === prev.initialPrompt && next.initialTicket === prev.initialTicket) {
        return prev;
      }
      return next;
    });
  }, []);
  const value = (0, import_react5.useMemo)(
    () => ({ ...pageContext, open, setOpen, setContext, activeChatId, setActiveChatId }),
    [pageContext, open, setContext, activeChatId]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(BrainContext.Provider, { value, children });
}
function useBrainContext() {
  const ctx = (0, import_react5.useContext)(BrainContext);
  if (!ctx) throw new Error("useBrainContext must be used within a BrainContextProvider");
  return ctx;
}
function useOptionalBrainContext() {
  return (0, import_react5.useContext)(BrainContext);
}

// src/useBrainChats.ts
var import_react6 = require("react");

// src/chatWorkLinking.ts
var TICKET_RECORDING_TOOLS = /* @__PURE__ */ new Set([
  "builtin_tickets_from_delta",
  "builtin_chats_link_ticket",
  "builtin_reviews_record"
]);
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
  return selectLinkedTasks(listResult, NOT_STARTED_TASK_STATUSES);
}
function selectLinkedTasks(listResult, statuses) {
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
    if (typeof row.status !== "string" || !statuses.has(row.status.toLowerCase())) continue;
    out.push({ kind: row.kind, ref });
  }
  return out;
}
var SHIPPABLE_TASK_STATUSES = /* @__PURE__ */ new Set(["in_review"]);
function linkedTicketsToComplete(listResult) {
  return selectLinkedTasks(listResult, SHIPPABLE_TASK_STATUSES);
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
\u2022 Keep the board honest about STATUS. The MOMENT you start actively working an existing linked task/epic/gap \u2014 investigating its fix, editing code for it, or driving it \u2014 move it out of the backlog with builtin_tasks_update (id=<the ticket's ref>, status="in_progress"). When the work is finished: if this session can commit and push (it has git_commit and git_push), YOU are the reviewer \u2014 self-review, ship it, and move it to "done" (see the SHIP YOUR OWN CHANGE contract); otherwise advance it to "in_review" for someone who can (or "done" if it needs no review). Never leave a ticket you are actively working sitting in backlog.
\u2022 Call builtin_chats_list_tickets (chatId=${chatId}) to see what is already linked \u2014 both to AVOID creating a duplicate and to know which linked tickets need their status advanced. Never end a turn having identified actionable work or changed code without it being a ticket linked to this chat whose status reflects the work you did.`;
}

// src/chatMode.ts
var CHAT_MODES = ["chat", "work"];
var NEW_CHAT_MODE = "work";
var RESTING_CHAT_MODE = "chat";
var CHAT_MODE_ICON = {
  chat: "\u{1F4AC}",
  work: "\u26A1"
};
function isChatMode(value) {
  return typeof value === "string" && CHAT_MODES.includes(value);
}
function normalizeChatMode(value) {
  return isChatMode(value) ? value : RESTING_CHAT_MODE;
}
function chatConversationDirective() {
  return "MODE: CHAT. This conversation is a conversation. Your job is to understand the question and answer it.\n\u2022 Read, search, inspect and reason as much as the question needs \u2014 every read-only tool is available to you and using them is encouraged. Ground the answer in what you actually looked up.\n\u2022 Do NOT create, staff, re-status, or dispatch board work as a side effect of answering. Identifying that something ought to be done is part of a good answer; opening a ticket about it is not.\n\u2022 If the work plainly ought to be tracked, END the answer with one short line naming it and telling the user they can switch this conversation to Work mode to have it opened and run. Offer it once; do not repeat the offer on later turns.\n\u2022 The single exception: if the user explicitly asks you to create, assign, schedule or run something in THIS message, do it. An explicit instruction outranks the mode.";
}
function chatWorkDirective(chatId, opts) {
  const throughThem = opts?.canDelegate ? " When you do a slice of the work here instead of dispatching it, do it THROUGH one of them: spawn_agent with as_agent=<that agent's name> so the slice is done in that agent's persona, and say which agent did what. Work that names no agent is work nobody owns." : "";
  const doItHere = opts?.canEditHere ? `\u2022 DO IT HERE WHEN YOU CAN. This session has the workspace file tools, so anything you could change yourself in a handful of tool calls \u2014 a bug fix, a small refactor, a CSS or copy change, anything you have already located in the code \u2014 you MAKE, now. Dispatching a cloud agent for work you are already holding costs a whole run to do less than you can, and leaves the user waiting for it. Then record the change against this chat. Dispatch is for work this session genuinely cannot do: a long-horizon or repetitive batch, or work that must run somewhere you are not.
` : "";
  return `MODE: WORK. This conversation exists to get something DONE, not to describe it. Take the work all the way to a finished change or a running agent.
${chatWorkLinkingDirective(chatId)}
` + doItHere + `\u2022 FINISH BY DISPATCHING what you did not do yourself. A ticket that no agent is running has not started. Every create/update tool returns an \`autoRun\` verdict \u2014 read it. When \`autoRun.dispatched\` is true, say which agent picked the work up. When it is false, do not stop there: pick a capable agent (builtin_cloud_agents_list_mine, or builtin_tasks_assignees for the accountable roster) and start the run yourself with builtin_chats_dispatch_agent (chatId=${chatId}, agentRef=<the agent>, taskId=<the ticket>). A dispatched agent joins this chat and can be steered mid-run with builtin_executions_post_message.
\u2022 STAFF WITH THE TEAM. The workspace's agents (builtin_chats_list_agents for those already in this chat, builtin_cloud_agents_list_mine for all of them) are the people this work belongs to. When you file tickets, assign and dispatch the agent whose role fits each one \u2014 never leave a ticket with no agent on it.${throughThem}
\u2022 If dispatch is genuinely refused \u2014 no capable agent, an execution kill-switch, an exhausted run cap, a human gate on the lane, a lifecycle-managed stage with no bound role \u2014 the refusal names the reason and what would clear it. Report THAT reason, do not retry the same dispatch hoping for a different answer, and if the work is something you could do here, do it instead. Never imply work has begun when nothing was dispatched, and never describe a dispatch you did not make.`;
}
function chatModeDirective(mode, chatId, opts) {
  return mode === "work" ? chatWorkDirective(chatId, opts) : chatConversationDirective();
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
  const [chats, setChats] = (0, import_react6.useState)([]);
  const [loading, setLoading] = (0, import_react6.useState)(true);
  const [error, setError] = (0, import_react6.useState)("");
  const [internalActiveId, setInternalActiveId] = (0, import_react6.useState)(null);
  const assigningRef = (0, import_react6.useRef)(false);
  const chatsRef = (0, import_react6.useRef)(chats);
  chatsRef.current = chats;
  const autoTitledRef = (0, import_react6.useRef)(/* @__PURE__ */ new Set());
  const isControlled = controlledActiveId !== void 0;
  const activeChatId = isControlled ? controlledActiveId ?? null : internalActiveId;
  const activeIdRef = (0, import_react6.useRef)(activeChatId);
  activeIdRef.current = activeChatId;
  const setActiveChatId = (0, import_react6.useCallback)(
    (id) => {
      if (isControlled) onActiveChatChange?.(id);
      else setInternalActiveId(id);
    },
    [isControlled, onActiveChatChange]
  );
  const defaultProjectId = (0, import_react6.useCallback)(() => {
    if (pinnedProjectId != null) return pinnedProjectId;
    return filterProjectId && filterProjectId !== "none" ? Number(filterProjectId) : null;
  }, [pinnedProjectId, filterProjectId]);
  const reload = (0, import_react6.useCallback)(async () => {
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
  (0, import_react6.useEffect)(() => {
    reload();
  }, [reload]);
  const select = (0, import_react6.useCallback)(async (id) => {
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
  const create = (0, import_react6.useCallback)(async (opts) => {
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
  const setCapability = (0, import_react6.useCallback)(async (id, capability) => {
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
  const setMode = (0, import_react6.useCallback)(async (id, mode) => {
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
  const rename = (0, import_react6.useCallback)(async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const updated = await persistence.updateChat(id, { title: trimmed });
      setChats((prev) => prev.map((c) => c.id === id ? { ...c, title: updated.title } : c));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    }
  }, [persistence]);
  const autoTitle = (0, import_react6.useCallback)(async (id, firstUserText) => {
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
  const summarize = (0, import_react6.useCallback)(async (id) => {
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
  const remove = (0, import_react6.useCallback)(async (id) => {
    try {
      await persistence.deleteChat(id);
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (activeIdRef.current === id) setActiveChatId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }, [persistence, setActiveChatId]);
  const assignToProject = (0, import_react6.useCallback)(async (id, projectId) => {
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
  const touch = (0, import_react6.useCallback)(async (id) => {
    await reload();
    setActiveChatId(id);
  }, [reload, setActiveChatId]);
  const activeChat = (0, import_react6.useMemo)(
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
var import_react7 = require("react");

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

// src/provenance.ts
var PROVENANCE_META_KEY = "provenance";
function asProvenanceAccount(value) {
  return value === "own" || value === "shared" || value === "shared_byo_unused" ? value : void 0;
}
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
      const account = asProvenanceAccount(p.account);
      const requestedModel = typeof p.requestedModel === "string" && p.requestedModel && p.requestedModel !== p.model ? p.requestedModel : void 0;
      return {
        model: p.model,
        ...account ? { account } : {},
        ...typeof p.vendor === "string" ? { vendor: p.vendor } : {},
        ...evermind ? { evermind } : {},
        ...requestedModel ? { requestedModel } : {}
      };
    }
  } catch {
  }
  return null;
}
function lastServedModel(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const prov = parseMessageProvenance(messages[i]);
    if (prov) return prov.model;
  }
  return void 0;
}
function withProvenanceMetadata(provenance, base) {
  const meta = { ...base ?? {} };
  if (provenance) meta[PROVENANCE_META_KEY] = provenance;
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : void 0;
}
function formatAssistantTranscriptHeading(assistantName, message) {
  const prov = parseMessageProvenance(message);
  if (!prov?.model) return `## ${assistantName}`;
  if (prov.requestedModel) return `## ${assistantName} \xB7 ${prov.model} (requested ${prov.requestedModel})`;
  return `## ${assistantName} \xB7 ${prov.model}`;
}

// src/stoppedTurn.ts
var STOPPED_TURN_META_KEY = "stoppedByUser";
var STOPPED_TURN_STEP = "agent.stopped";
function stoppedTurnMetadata(source) {
  const account = asProvenanceAccount(source.account);
  const provenance = source.model ? { model: source.model, ...account ? { account } : {} } : null;
  return withProvenanceMetadata(provenance, { [STOPPED_TURN_META_KEY]: true }) ?? "{}";
}
function isStoppedTurn(msg) {
  if (!msg.metadata) return false;
  try {
    return JSON.parse(msg.metadata)?.[STOPPED_TURN_META_KEY] === true;
  } catch {
    return false;
  }
}

// src/mergeTranscript.ts
function mergeTranscript(base, extra) {
  if (extra.length === 0) return base;
  const have = new Set(base.map((m) => m.id));
  const fresh = extra.filter((m) => !have.has(m.id));
  if (fresh.length === 0) return base;
  return [...base, ...fresh].sort((a, b) => a.seq - b.seq);
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

// src/persistedSteps.ts
function traceEventToPersistInput(ev) {
  return {
    kind: ev.category,
    label: ev.label,
    args: ev.args,
    result: ev.result,
    isError: ev.isError,
    durationMs: ev.durationMs,
    ttftMs: ev.ttftMs,
    ts: ev.ts
  };
}
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
function mergeRecoveredTrace(recovered, live) {
  if (recovered.length === 0) return live;
  if (live.length === 0) return recovered;
  const liveSigs = new Set(live.map((e) => stepSig(e.category, e.label, e.ts)));
  const kept = recovered.filter((e) => !liveSigs.has(stepSig(e.category, e.label, e.ts)));
  return kept.length === 0 ? live : [...kept, ...live];
}

// src/priorResearch.ts
var ENTRY_RESULT_CHARS = 1200;
var ENTRY_ARGS_CHARS = 200;
var DIGEST_CHARS = 12e3;
var MAX_ENTRIES = 40;
var HEADER = [
  "## Already done earlier in this chat",
  "Earlier turns of this conversation already ran the tool calls below (newest first, each result trimmed). Their results are NOT in the transcript above \u2014 this list is the record of them.",
  "Build on it. Do not repeat a call listed here to rediscover what it already answered; re-run one only when you need a part of its result that is not shown, or when the target may have changed since (for example, a file this chat has edited)."
].join("\n");
function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}
function resultText(result) {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result) ?? "";
  } catch {
    return String(result);
  }
}
function priorResearchDigest(history) {
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  let size = HEADER.length;
  for (let i = history.length - 1; i >= 0 && entries.length < MAX_ENTRIES; i -= 1) {
    const message = history[i];
    if (!isStepMessage(message)) continue;
    const parsed = parseStepMessage(message.metadata);
    if (!parsed || parsed.step.category !== "tool") continue;
    const { label, args, result, isError } = parsed.step;
    const fullArgs = args == null ? "" : stableStringify(args);
    const key = `${label}|${fullArgs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = `- ${label}(${clip(fullArgs, ENTRY_ARGS_CHARS)})${isError ? " \u2014 FAILED" : ""}
  \u2192 ${clip(resultText(result), ENTRY_RESULT_CHARS)}`;
    if (size + entry.length + 1 > DIGEST_CHARS) break;
    entries.push(entry);
    size += entry.length + 1;
  }
  return entries.length > 0 ? [HEADER, ...entries].join("\n") : null;
}

// src/directedMessage.ts
var ADDRESSED_TO_META_KEY = "addressedTo";
var AUTHORED_BY_META_KEY = "authoredBy";
function asRecipient(value) {
  const a = value;
  if (a && typeof a.ref === "string" && typeof a.name === "string" && (a.kind === "agent" || a.kind === "human")) {
    return { kind: a.kind, ref: a.ref, name: a.name };
  }
  return null;
}
function parseMessageAuthor(msg) {
  if (!msg.metadata) return null;
  try {
    return asRecipient(JSON.parse(msg.metadata).authoredBy);
  } catch {
  }
  return null;
}
function withDirectedMetadata(recipient, base) {
  const meta = { ...base ?? {} };
  const list = recipient == null ? [] : "kind" in recipient ? [recipient] : recipient;
  if (list.length === 1) meta[ADDRESSED_TO_META_KEY] = list[0];
  else if (list.length > 1) meta[ADDRESSED_TO_META_KEY] = { kind: "group", members: [...list] };
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : void 0;
}
function parseDirectedRecipients(msg) {
  if (!msg.metadata) return [];
  try {
    const a = JSON.parse(msg.metadata).addressedTo;
    if (!a || typeof a !== "object") return [];
    if (a.kind !== "group") {
      const one = asRecipient(a);
      return one ? [one] : [];
    }
    if (Array.isArray(a.members)) {
      return a.members.map(asRecipient).filter((r) => r !== null);
    }
    if (Array.isArray(a.refs)) {
      return a.refs.filter((ref) => typeof ref === "string" && ref.length > 0).map((ref) => ({ kind: "agent", ref, name: ref }));
    }
  } catch {
  }
  return [];
}
function isDirectedToParticipant(msg) {
  return parseDirectedRecipients(msg).length > 0;
}
function directedAgentRecipients(recipient) {
  if (recipient == null) return [];
  const one = recipient;
  const list = Array.isArray(recipient) ? recipient : one.kind === "group" ? one.members ?? [] : [one];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const r of list) {
    if (!r || typeof r.ref !== "string" || !r.ref || r.kind === "human") continue;
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    out.push({ kind: "agent", ref: r.ref, name: typeof r.name === "string" && r.name ? r.name : r.ref });
  }
  return out;
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
var activeHashtagToken = activeTicketToken;
function activeTicketToken(text, caret) {
  const hash = text.lastIndexOf("#", Math.max(0, caret - 1));
  if (hash < 0 || hash >= caret) return null;
  if (hash > 0 && !/\s/.test(text[hash - 1])) return null;
  const query = text.slice(hash + 1, caret);
  if (/[\s#]/.test(query)) return null;
  return { query, start: hash, end: caret };
}
function filterTicketCandidates(tickets, query) {
  const q = query.trim().toLowerCase();
  if (!q) return tickets;
  return tickets.map((t) => {
    const titleIdx = t.title.toLowerCase().indexOf(q);
    const keyIdx = t.key?.toLowerCase().indexOf(q) ?? -1;
    const idx = titleIdx >= 0 ? titleIdx : keyIdx;
    return { t, idx };
  }).filter((s) => s.idx >= 0).sort((a, b) => a.idx - b.idx || a.t.title.localeCompare(b.t.title)).map((s) => s.t);
}

// ../packages/agent-stall/src/requestIntent.ts
var CHANGE_VERB = /\b(add|change|fix|update|reduce|increase|remove|delete|rename|refactor|implement|create|build|make|move|set|wire|migrate|replace|adjust|enable|disable|improve|write|edit|apply|correct|resolve|shrink|expand|hide|show|bump|revert|restore|install|upgrade|downgrade|rewrite|extract|split|merge)\b/i;
var QUESTION_SHAPE = /^\s*(what|why|how|where|when|which|who|is|are|was|were|does|do|did|can|could|should|would|will|explain|describe|summar|tell me|show me|list|compare|review|analyse|analyze)\b|\?\s*$/i;
function asksForChange(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  const head = t.slice(0, 600);
  if (QUESTION_SHAPE.test(head)) return false;
  return CHANGE_VERB.test(head);
}
var NOTHING_DONE = /\b(nothing (has been|was|is) (changed|modified|applied|edited|written|saved)|no (changes?|edits?) (have been|were|was) (made|applied|written|saved)|(not|never) (yet )?(been )?(applied|written|saved|committed)|has not been (changed|applied|modified)|before (applying|making) the edit)\b/i;
var DEFERRED_PROMISE = /\b(re-?run me|run me again|ask me again|in a follow-?up|next run|on the next turn|say the word|let me know and I'?ll|I'?ll (then )?(apply|make|write|implement|create|edit|fix|update|do|proceed|carry)|I will (then )?(apply|make|write|implement|create|edit|fix|update|proceed))\b/i;
var BUDGET_EXHAUSTED = /\b(tool-?call budget|step budget|iteration (cap|limit|budget)|ran out of (tool calls|steps|budget)|hit (the|my) (tool|step|budget))\b/i;
function promisesUnfinishedWork(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  return NOTHING_DONE.test(t) || DEFERRED_PROMISE.test(t) || BUDGET_EXHAUSTED.test(t);
}
var CONTINUATION = /^\s*(?:ok(?:ay)?[,\s]*)?(?:please\s+)?(?:now\s+)?(?:just\s+)?(?:go\s+ahead|carry\s+on|keep\s+going|make\s+it\s+so|do\s+it|do\s+that|do\s+so|fix\s+it|fix\s+that|apply\s+it|apply\s+that|apply|fix|go|proceed|continue|yes|yep|yeah|y|sure|confirm(?:ed)?|approved?|ship\s+it|send\s+it|run\s+it|do\s+the\s+fix|make\s+the\s+change)\s*[.!]*\s*$/i;
var MAX_CONTINUATION_CHARS = 40;
function isContinuationDirective(text) {
  const t = (text ?? "").trim();
  if (!t || t.length > MAX_CONTINUATION_CHARS) return false;
  return CONTINUATION.test(t);
}
var CURRENT_STATE = /^\s*(?:(?:so|ok(?:ay)?|and|hey)[,\s]+)?(?:(?:what(?:'s| is) )?(?:the )?(?:current |latest )?(?:status|progress|update|updates|news|eta|state of (?:play|things))\b|any (?:updates?|news|progress)\b|where (?:are|do) (?:we|things|you) (?:stand|at)\b|where are we\b|how(?:'s| is) it going\b|how far along\b|is it (?:done|finished|ready|working|fixed)\b|are (?:we|you) done\b|what(?:'s| is) (?:left|next|remaining|the latest|happening)\b|still working\b)/i;
function asksAboutCurrentState(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  return CURRENT_STATE.test(t.slice(0, 200));
}
function memoryReplayable(question, context = {}) {
  const q = (question ?? "").trim();
  if (!q || context.followUp === true) return false;
  return !asksForChange(q) && !asksAboutCurrentState(q) && !isContinuationDirective(q);
}
function continuationDirective() {
  return `The user's last message is a bare directive ("fix", "do it", "go ahead") with no subject of its own. It refers to the proposal in YOUR immediately preceding message, which described work you had not yet carried out. Carry out that exact proposal now, using the tools, starting from the files and the change it already named \u2014 do NOT ask the user what to fix, and do NOT re-derive the analysis you have already done and can read above. If the earlier proposal named a specific file and edit, apply that edit. Report what you changed when it is done.`;
}

// ../packages/agent-stall/src/handoff.ts
var EXECUTION_TOOLS = /* @__PURE__ */ new Set([
  "run_command",
  "run_shell_command",
  "execute_command",
  "bash",
  "shell",
  "terminal",
  "git_commit",
  "git_push",
  "git_sync_latest",
  "open_pull_request",
  // The SERVER addressed-agent reply has no shell of its own — its shell lives in the
  // agent's runtime, and this tool is the door to it. Its own system prompt already
  // says "NEVER reply that you lack a git or file tool"; without this entry the gate
  // that enforces that sentence could never fire on the one surface it was written for.
  "builtin_chats_execute_as_agent"
]);
function canExecuteCommands(toolNames) {
  return (toolNames ?? []).some((n) => EXECUTION_TOOLS.has(n.toLowerCase()));
}
var RUNNER = "(?:npm|pnpm|yarn|npx|bun|deno|node|git|make|cargo|go|dotnet|mvn|gradle|python3?|pip3?|poetry|uv|ruby|rake|bundle|composer|php|docker(?:\\s+compose)?|kubectl|helm|terraform|wrangler|vercel|netlify|vite|webpack|tsc|tsgo|eslint|prettier|pytest|jest|vitest|playwright|cypress|bash|sh|zsh|pwsh|powershell|curl|wget|sed|awk|rsync|vsce)\\b";
var SCRIPT_NOUN = "(?:build|tests?|test suite|type-?check(?:ing)?|typecheck|lint(?:er|ing)?|guards?|checks?|install|dev server|migrations?|deploy(?:ment)?|codegen|bundle|vsix|package|commit|push|pull request|pr\\b|branch|lockfile|extension host)";
var CMD_MARK = "\u2983cmd\u2984";
var ID_MARK = "\u2983id\u2984";
var OUT_OF_REACH = /\b(credential|password|api ?key|secret|auth token|\.env\b|environment variable|2fa|mfa|sign ?in|log ?in|browser|incognito|restart vs ?code|reload the window|reinstall the extension|github ui|web ui|dashboard|billing|payment|admin console|approve|permission|by hand|manually)\b/i;
var TAIL_CHARS = 900;
var WINDOW_BEFORE = 80;
var WINDOW_AFTER = 220;
function normalise2(text) {
  const mark = (body) => new RegExp(RUNNER, "i").test(body) ? ` ${CMD_MARK} ` : ` ${ID_MARK} `;
  return text.replace(/```[\s\S]*?(?:```|$)/g, (m) => mark(m)).replace(/`[^`\n]+`/g, (m) => mark(m));
}
var HANDOFF_VERB = "(?:re-?run|run|execute|apply|install|re-?install|rebuild|build|compile|commit|push|deploy|publish|restart|relaunch|launch|start|test|verify|lint|type-?check|typecheck|migrate|regenerate|package|bump|trigger|kick off)";
var HANDS_OFF = new RegExp(
  [
    // "you can run", "you'll need to run", "you should now commit", "you must rebuild"
    `\\byou(?:'ll|'d|'ve| will| would| should| must| may| might| can| could| still| then| now)?(?:\\s+(?:then|now|also|just|still|next|first|finally|want to|need to|have to|be able to))*\\s+${HANDOFF_VERB}\\b`,
    // "please run the guards"
    `\\bplease\\s+(?:now\\s+|then\\s+)?${HANDOFF_VERB}\\b`,
    // "once you've run the build", "after you push"
    `\\b(?:once|after|when|before)\\s+you(?:'ve| have| had)?\\s+${HANDOFF_VERB}\\b`,
    // "run the following", "apply these changes", "execute this command"
    `\\b${HANDOFF_VERB}\\s+(?:the\\s+following|these|this)\\b`,
    // "to verify, run …" / "to apply the fix you need to run …"
    `\\bto\\s+(?:apply|verify|confirm|finish|complete|deploy|ship|land|pick up|see)\\b[^.\\n]{0,60}?,?\\s*(?:you\\s+(?:can|should|must|will|need to|have to)\\s+)?${HANDOFF_VERB}\\b`,
    // A steps list: "1. Run the type-check", "- Commit the change", "Then push to main"
    `(?:^|\\n)[ \\t]*(?:\\d+[.)]|[-*+]|#{1,6}|>)?[ \\t]*(?:then|now|next|finally|first)?[,:]?[ \\t]*${HANDOFF_VERB}\\b`,
    // The same imperative mid-paragraph: "I applied the fix. Now run the type-check."
    // The adverb is REQUIRED here, unlike the line-leading form above — without it a
    // plain sentence that happens to open with one of these words ("Build output is
    // clean now.") would read as an instruction.
    `[.!?]\\s+(?:then|now|next|finally|first)[,:]?\\s+${HANDOFF_VERB}\\b`
  ].join("|"),
  "gi"
);
var COMMAND_NEARBY = new RegExp(`${CMD_MARK}|${RUNNER}|\\b${SCRIPT_NOUN}`, "i");
function handsWorkToUser(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  const scanned = normalise2(t.slice(-TAIL_CHARS));
  HANDS_OFF.lastIndex = 0;
  for (let m = HANDS_OFF.exec(scanned); m; m = HANDS_OFF.exec(scanned)) {
    const window2 = scanned.slice(
      Math.max(0, m.index - WINDOW_BEFORE),
      m.index + m[0].length + WINDOW_AFTER
    );
    if (!COMMAND_NEARBY.test(window2)) continue;
    if (OUT_OF_REACH.test(window2)) continue;
    HANDS_OFF.lastIndex = 0;
    return true;
  }
  return false;
}
function delegatesExecutableWork(text, ctx) {
  if (!canExecuteCommands(ctx.availableToolNames)) return false;
  if (!asksForChange(ctx.requestText)) return false;
  return handsWorkToUser(text);
}
function handoffRecoveryNudge(lastChance) {
  return "Your last turn ended by telling the USER to run commands. You are the one holding the tools \u2014 `run_command` for shell steps, the git tools to commit and push \u2014 so those steps are yours, not theirs. Carry them out NOW in this turn: run the commands you just listed, read their output, and fix anything that fails before you answer. Verification you hand to the user is verification nobody does. Only leave a step to the user when you genuinely cannot do it here \u2014 it needs a credential, a browser, or a decision that is theirs \u2014 and then say which step and why." + (lastChance ? " This is your last chance to act: your answer after this turn is shown to the user as-is, so either run the commands now or state plainly, at the top of your reply, that the change is UNVERIFIED and exactly which steps were never run." : "");
}

// ../packages/agent-stall/src/index.ts
var ANNOUNCE_SUBJECT = "\\b(?:i(?: will|'ll| am going to|'m going to| am about to| plan to|'d need to| would need to| will need to| need to)|let(?:'?s| me| us)|going to|about to|next,? i'?l?l?|now)";
var ANNOUNCE_FILLER = "(?:\\s+(?:now|then|first|next|quickly|briefly|just|also|actually|go ahead and|try to|attempt to))*";
var ANNOUNCE_VERB = "(?:call|use|invoke|run|execute|trigger|query|fetch|retrieve|request|look|search|scan|find|locate|examine|inspect|review|read|list|check|verify|confirm|get|grab|pull|load|open|gather|dig|explore|investigate|analy[sz]e|start|begin|take|do|act|see|walk|trace|map)";
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
    // A sentence that OPENS on a gerund and signs off with "now": "Pulling linked tickets
    // and the roster code now." The object-led form above wants the/this/now straight
    // after the verb, so a bare noun phrase slipped through. Measured on VS Code chat #105
    // (`xai-oauth/grok-4.6`): turns 1-2 were caught and re-prompted, turn 3 said exactly
    // this, scored as a complete answer, and the run ended with a recovery still unspent.
    `(?:^|[.!?\\n]\\s*)${ANNOUNCE_GERUND}\\b[^.!?\\n]{0,80}\\bnow\\b`,
    "stand ?by\\b",
    ...PSEUDO_CALL
  ].join("|"),
  "i"
);
var TAIL_CHARS2 = 240;
function announcesUntakenAction(text) {
  const t = text.trim();
  if (!t) return false;
  return ANNOUNCED_ACTION.test(t.slice(-TAIL_CHARS2));
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
function stallRecoveryNudge(lastChance, shape) {
  if (shape === "handed-off") return handoffRecoveryNudge(lastChance);
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
function stallShape(input) {
  if (input.toolCallCount !== 0 || input.availableToolCount <= 0) return null;
  if (isEmptyTurn(input)) return "empty";
  if (delegatesExecutableWork(input.text, input)) return "handed-off";
  if (announcesUntakenAction(input.text)) return "announced";
  if (claimsMissingToolData(input.text)) return "missing-data";
  return null;
}
function isStalledTurn(input) {
  return stallShape(input) !== null;
}
function shouldRecoverStalledTurn(input) {
  return isStalledTurn(input) && input.recoveriesUsed < MAX_ANNOUNCEMENT_RECOVERIES;
}
function isExhaustedStall(input) {
  return isStalledTurn(input) && input.recoveriesUsed >= MAX_ANNOUNCEMENT_RECOVERIES;
}
function resolveShape(arg) {
  if (arg === true) return "empty";
  if (typeof arg === "string") return arg;
  return "announced";
}
function whatItDid(shape) {
  const rounds = `${MAX_ANNOUNCEMENT_RECOVERIES} turns in a row`;
  switch (shape) {
    case "empty":
      return `returned an empty turn \u2014 no tool call and no words \u2014 ${rounds}`;
    case "handed-off":
      return `handed the remaining work back to you as commands to run yourself, ${rounds}, rather than running them with the tools it holds`;
    case "missing-data":
      return `reported that tool results were missing without ever calling a tool, ${rounds}`;
    default:
      return `described tool calls instead of making them, ${rounds}`;
  }
}
function whatYouGot(shape) {
  switch (shape) {
    case "empty":
      return "there is no answer above to show you.";
    case "handed-off":
      return "the steps above are still yours to run \u2014 treat the change as UNVERIFIED.";
    default:
      return "the answer above is only a description of intended actions.";
  }
}
function modelFailoverNotice(from, to, shape = false) {
  const who = from && from !== "default" ? `\`${from}\`` : "The previous model";
  return `${who} ${whatItDid(resolveShape(shape))}, so it cannot complete this request. Retrying on \`${to}\`.`;
}
function stallExhaustedNotice(model, tried, shape = false) {
  const who = model && model !== "default" ? `The model \`${model}\`` : "The model";
  const kind = resolveShape(shape);
  const others = (tried ?? []).filter((m) => m && m !== model);
  return `${who} ${whatItDid(kind)}, so nothing was actually run and ` + whatYouGot(kind) + (others.length ? ` This run already failed over from ${others.map((m) => `\`${m}\``).join(", ")}, so the problem is unlikely to be any single model \u2014 check that the tool catalog loaded (see the "Tools available to the model" line in a copied diagnostics report).` : kind === "handed-off" ? " Nothing upstream failed here \u2014 the model reached the right answer and declined to carry it out, which is an agency limitation. Run the steps it listed, or retry on a model from the coding pool, which is selected for exactly this." : " Before switching models, check your runtime or gateway log for this turn: a request REJECTED upstream \u2014 a prompt over the context limit, an exhausted quota \u2014 produces exactly these symptoms, and no other model will fix it. If the log is clean, this is a model limitation and a different model is the answer.");
}
function stallRecoveryToolChoice(input) {
  return input.availableToolCount > 0 ? "required" : void 0;
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
    byo,
    coding,
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

// src/localWorkspaceTools.ts
var LOCAL_WORKSPACE_TOOLS = /* @__PURE__ */ new Set([
  "read_file",
  "list_files",
  "search_code",
  // Code navigation over the definition index. Pinned for the reason the file tools are,
  // and more acutely: "where is the auth middleware?" shares no stem with "find_symbol",
  // so relevance drops the one call that answers it and the run falls back to searching
  // and paging through files — the pattern these two tools exist to replace.
  "find_symbol",
  "file_outline",
  "write_file",
  "edit_file",
  "delete_file",
  "run_command",
  // The git tools, read and publish alike. They belong here for exactly the reason the
  // file tools do: "commit the change and push to main" is not one domain among many a
  // query can be relevant to, it is the surface doing its job. The turn that produced
  // this set is the proof — `run_command` shared no stem with that request, missed the
  // relevance cut, and the agent spent the run unable to find the tool its own persona
  // had just told it to use. `git_status` before a commit, and `open_pull_request`
  // after one, are dropped by the same mechanism on a turn phrased "ship this".
  "git_status",
  "git_diff",
  "git_history",
  "git_sync_latest",
  "git_undo",
  "git_redo",
  "git_commit",
  "git_push",
  "open_pull_request",
  // Cleanup after a merge is the LAST step of shipping and the one most easily trimmed:
  // by the time the agent reaches it, the turn's text is about the change, not about
  // branches, so "cleanup" shares no stem with anything the user said. Unpinned, the
  // agent falls back to hand-rolled `run_command` git — which is exactly how
  // `git push origin --delete <branch>` → `remote ref does not exist` happened.
  "git_cleanup_merged",
  // Delegation to a sub-agent. It belongs here for the same reason and fails the same
  // way: a turn phrased "where does the auth middleware live?" shares no stem with
  // "delegate", so relevance drops the one tool that would answer it cheaply, and the
  // agent burns the turns delegation exists to save. Nothing is pinned that the host
  // did not advertise — the web Brain offers no `spawn_agent`, so this is inert there.
  "spawn_agent"
]);
var CODE_CHANGE_TOOLS = /* @__PURE__ */ new Set([
  "write_file",
  "edit_file",
  "delete_file"
]);
var UNSCOPED_MUTATION_TOOLS = /* @__PURE__ */ new Set([
  "run_command",
  "git_sync_latest",
  "git_undo",
  "git_redo",
  // Cleanup checks out the base branch and fast-forwards it, so every file in the
  // checkout can differ from what a read before it returned — the same reason the
  // three above are here.
  "git_cleanup_merged"
]);
var PROJECT_MEMORY_TOOLS = /* @__PURE__ */ new Set(["recall_facts", "remember_fact"]);
function isLocalWorkspaceTool(name) {
  return LOCAL_WORKSPACE_TOOLS.has(name);
}
function isProjectMemoryTool(name) {
  return PROJECT_MEMORY_TOOLS.has(name);
}
function isCodeChangeTool(name) {
  return CODE_CHANGE_TOOLS.has(name);
}
function isUnscopedMutationTool(name) {
  return UNSCOPED_MUTATION_TOOLS.has(name);
}
function canChangeCodeHere(toolNames) {
  return toolNames.some(isCodeChangeTool);
}
function canShipHere(toolNames) {
  return toolNames.includes("git_commit") && toolNames.includes("git_push");
}
function localToolsIn(toolNames) {
  return toolNames.filter(isLocalWorkspaceTool);
}
function memoryToolsIn(toolNames) {
  return toolNames.filter(isProjectMemoryTool);
}

// src/runActivity.ts
var TARGET_KEYS = ["path", "file", "filePath", "command", "cmd", "glob", "query", "q", "search", "url", "name", "title", "id"];
var MAX_DETAIL = 72;
function shortenTarget(value, max = MAX_DETAIL) {
  const v = value.replace(/\s+/g, " ").trim();
  if (v.length <= max) return v;
  if (v.includes("/") || v.includes("\\")) return `\u2026${v.slice(v.length - (max - 1))}`;
  return `${v.slice(0, max - 1)}\u2026`;
}
function activityTarget(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return void 0;
  const record = args;
  for (const key of TARGET_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return shortenTarget(value);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return void 0;
}
var QUESTION_KEYS = ["query", "q", "search", "pattern", "glob"];
var VISIT_QUESTION_SEPARATOR = " \u220B ";
function visitTarget(args) {
  const scope = activityTarget(args);
  if (!scope) return void 0;
  const record = args;
  for (const key of QUESTION_KEYS) {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const question = shortenTarget(value);
    return question === scope ? scope : `${scope}${VISIT_QUESTION_SEPARATOR}${question}`;
  }
  return scope;
}
function toolActivity(label, args, step, startedAt) {
  const detail = activityTarget(args);
  return { phase: "tool", label, startedAt, step, ...detail ? { detail } : {} };
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  return bytes < 1024 ? `${Math.round(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
function elapsedText(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 6e4) return `${Math.round(ms / 1e3)}s`;
  return `${Math.floor(ms / 6e4)}m ${Math.round(ms % 6e4 / 1e3)}s`;
}
function describeLiveStep(step, capturedAtMs) {
  const elapsed = elapsedText(Number.isFinite(capturedAtMs) ? capturedAtMs - step.startedAt : 0);
  const what = step.phase === "tool" ? `running \`${step.label}\`${step.detail ? ` on ${step.detail}` : ""}` : step.phase === "awaiting" ? `PAUSED waiting for the user to approve \`${step.label}\` \u2014 nothing advances until they answer` : step.phase === "composing" ? `composing a \`${step.label || "tool"}\` call${step.bytes != null ? ` \u2014 ${formatBytes(step.bytes)} of arguments so far` : ""}` : step.phase === "thinking" ? "waiting on the model (no token received yet)" : step.phase === "writing" ? "streaming the reply" : step.phase === "finishing" ? "doing post-run work (ticket capture / status reconciliation)" : "starting up";
  return `${what} (${elapsed} so far${step.step > 0 ? `, loop step ${step.step}` : ""})`;
}
function midRunNotice(activity, capturedAtMs) {
  const doing = activity ? ` At capture it was ${describeLiveStep(activity, capturedAtMs)}.` : " No in-flight step was recorded at capture.";
  return `\u26A0 CAPTURED MID-RUN \u2014 the agent was STILL EXECUTING when this report was taken.${doing} Anything below that reads as "it never did X" may simply be work it had not reached yet; re-copy once the run settles to get a verdict on a finished run.`;
}

// src/runProgress.ts
var BACK_TO_BACK_AT = 3;
var MUTATION_TOOL = /(^|_)(write|edit|save|create|update|delete|apply|patch|publish|send|dispatch|run_command|assign|link|move|set)(_|$)/i;
function isMutationTool(name) {
  return isCodeChangeTool(name) || MUTATION_TOOL.test(name);
}
function hasEditIntent(messages) {
  return messages.some((m) => m.role === "user" && asksForChange(m.content));
}
function callSignature(ev) {
  let args = "";
  try {
    args = stableStringify(ev.args ?? null);
  } catch {
    args = String(ev.args ?? "");
  }
  return `${ev.label}(${args})`;
}
function targetSignature(ev) {
  const target = visitTarget(ev.args);
  return target ? `${ev.label}:${target}` : null;
}
var IDLE_GAP_MS = 12e4;
function computeRunProgress(events, messages = []) {
  const tools = events.filter((e) => e.category === "tool");
  const seenCalls = /* @__PURE__ */ new Set();
  let duplicateCalls = 0;
  const targetCounts = /* @__PURE__ */ new Map();
  let targetedCalls = 0;
  let mutationsAttempted = 0;
  let mutationsSucceeded = 0;
  let streaks = 0;
  let longestStreak = null;
  let current = null;
  for (const ev of tools) {
    const sig = callSignature(ev);
    if (seenCalls.has(sig)) duplicateCalls += 1;
    else seenCalls.add(sig);
    const failed = Boolean(ev.isError) || isFailedToolResult(ev.result);
    if (current && current.sig === sig) {
      current.streak.count += 1;
      if (failed) current.streak.failed += 1;
      if (current.streak.count === 2) streaks += 1;
      if (!longestStreak || current.streak.count > longestStreak.count) longestStreak = current.streak;
    } else {
      current = { sig, streak: { label: ev.label, count: 1, failed: failed ? 1 : 0 } };
    }
    const target = targetSignature(ev);
    if (target) {
      targetedCalls += 1;
      targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
    }
    if (isMutationTool(ev.label)) {
      mutationsAttempted += 1;
      if (!ev.isError && !isFailedToolResult(ev.result)) mutationsSucceeded += 1;
    }
  }
  const repeatedTargets = [...targetCounts.entries()].filter(([, count]) => count > 1).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  const distinctTargets = targetCounts.size;
  const revisits = repeatedTargets.reduce((sum, t) => sum + (t.count - 1), 0);
  const revisitRatio = targetedCalls > 0 ? revisits / targetedCalls : 0;
  let modelMs = 0;
  let toolMs = 0;
  let slowestStep = null;
  const timed = [];
  for (const ev of events) {
    const ms = typeof ev.durationMs === "number" && Number.isFinite(ev.durationMs) ? ev.durationMs : 0;
    const t = Date.parse(ev.ts);
    if (Number.isFinite(t)) timed.push({ t, ms });
    if (ev.category === "llm") modelMs += ms;
    else if (ev.category === "tool") toolMs += ms;
    if (ms > 0 && (!slowestStep || ms > slowestStep.ms)) slowestStep = { label: ev.label, ms };
  }
  timed.sort((a, b) => a.t - b.t);
  let idleMs = 0;
  for (let i = 1; i < timed.length; i++) {
    const uncovered = timed[i].t - timed[i - 1].t - timed[i].ms;
    if (uncovered > IDLE_GAP_MS) idleMs += uncovered;
  }
  const wallClockMs = timed.length > 1 ? timed[timed.length - 1].t - timed[0].t : 0;
  const editIntent = hasEditIntent(messages);
  const didWork = tools.length > 0;
  const noEffect = editIntent && didWork && mutationsSucceeded === 0;
  const stuckOnCall = longestStreak !== null && longestStreak.count >= BACK_TO_BACK_AT;
  const spinning = targetedCalls >= 6 && revisitRatio >= 0.4 || stuckOnCall;
  return {
    duplicateCalls,
    longestStreak,
    streaks,
    stuckOnCall,
    repeatedTargets,
    distinctTargets,
    targetedCalls,
    revisitRatio,
    mutationsAttempted,
    mutationsSucceeded,
    editIntent,
    noEffect,
    spinning,
    wallClockMs,
    idleMs,
    modelMs,
    toolMs,
    slowestStep
  };
}
function progressDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1e3) return `${ms}ms`;
  if (ms < 6e4) return `${(ms / 1e3).toFixed(ms < 1e4 ? 1 : 0)}s`;
  const m = Math.floor(ms / 6e4);
  const s = Math.round(ms % 6e4 / 1e3);
  return s ? `${m}m ${s}s` : `${m}m`;
}
var MAX_NAMED_TARGETS = 4;
function formatStreak(s) {
  const outcome = s.failed === 0 ? "" : s.failed === s.count ? ` (all ${s.count} failed)` : ` (${s.failed} of ${s.count} failed)`;
  return `\`${s.label}\` \xD7${s.count} BACK-TO-BACK${outcome}`;
}
function formatRunProgress(p) {
  const lines = [];
  const reach = p.targetedCalls > 0 ? `${p.distinctTargets} distinct target(s) over ${p.targetedCalls} targeted call(s)` : "no targeted calls";
  lines.push(
    `Progress: ${reach}${p.repeatedTargets.length ? ` \xB7 ${Math.round(p.revisitRatio * 100)}% of calls revisited ground already covered` : " \xB7 no repeats"}${p.duplicateCalls ? ` \xB7 ${p.duplicateCalls} EXACT duplicate call(s)` : ""}${p.longestStreak ? ` \xB7 ${formatStreak(p.longestStreak)}${p.streaks > 1 ? ` (${p.streaks} such streaks)` : ""}` : ""}`
  );
  if (p.repeatedTargets.length) {
    const named = p.repeatedTargets.slice(0, MAX_NAMED_TARGETS).map((t) => `${t.label} \xD7${t.count}`).join(" \xB7 ");
    const rest = p.repeatedTargets.length - MAX_NAMED_TARGETS;
    lines.push(`Revisited: ${named}${rest > 0 ? ` (+${rest} more)` : ""}`);
  }
  if (p.editIntent) {
    lines.push(
      `Effect: the request asked for a CHANGE \xB7 ${p.mutationsAttempted} mutating call(s) attempted, ${p.mutationsSucceeded} succeeded${p.noEffect ? " \xB7 \u26A0 NOTHING WAS CHANGED" : ""}`
    );
  } else if (p.mutationsAttempted > 0) {
    lines.push(`Effect: ${p.mutationsAttempted} mutating call(s) attempted, ${p.mutationsSucceeded} succeeded.`);
  }
  if (p.wallClockMs > 0) {
    const active = Math.max(0, p.wallClockMs - p.idleMs);
    lines.push(
      `Time: ${progressDuration(active)} wall clock \xB7 ${progressDuration(p.modelMs)} in the model \xB7 ${progressDuration(p.toolMs)} in tools${p.slowestStep ? ` \xB7 slowest ${p.slowestStep.label} (${progressDuration(p.slowestStep.ms)})` : ""}${p.idleMs > 0 ? ` \xB7 ${progressDuration(p.idleMs)} waiting on the user between turns, excluded (span ${progressDuration(p.wallClockMs)})` : ""}`
    );
  }
  return lines;
}
function runProgressVerdict(p) {
  if (!p.spinning && !p.noEffect) return null;
  const worst = p.repeatedTargets[0];
  const streak = p.stuckOnCall && p.longestStreak ? `it made the same call ${p.longestStreak.count} times in a row \u2014 ${formatStreak(p.longestStreak)} \u2014 with nothing else attempted between them${p.longestStreak.failed === p.longestStreak.count ? ", re-asking a question it had already been answered the same way each time" : ""}` : null;
  const revisit = p.repeatedTargets.length ? `${Math.round(p.revisitRatio * 100)}% of its targeted calls revisited a target it had already read${worst ? `, worst \`${worst.label}\` \xD7${worst.count}` : ""}` : null;
  const loop = p.spinning ? `NO PROGRESS \u2014 ${streak ? `${streak}${revisit ? `; ${revisit}` : ""}` : `the run kept going back over ground it had already covered: ${revisit}`}${p.duplicateCalls ? `, and ${p.duplicateCalls} call(s) repeated earlier arguments EXACTLY` : ""}. ` : "NO EFFECT \u2014 ";
  const effect = p.noEffect ? `The request asked for a change and the run finished with ZERO successful mutating calls${p.mutationsAttempted ? ` (${p.mutationsAttempted} attempted, all failed)` : " \u2014 it never attempted one"}, so nothing was actually modified. ` : "";
  const remedy = p.spinning ? `This is a LOOP, not context pressure and not a model that "won't call tools" \u2014 the numbers on those signals are a consequence of the repetition, not its cause. ${streak && p.longestStreak && p.longestStreak.failed > 0 ? "A call repeated back-to-back after FAILING is the model ignoring the error it was given: the failure text usually names the exact change to make (a `repo`, a path, a missing argument). Check that the tool result reached the model un-truncated, and that the repeated-failure advisory fired; if it did and the model still repeated the call, the model is not reading tool results \u2014 switch models for this run." : streak ? "A call repeated back-to-back after SUCCEEDING is the model not retaining the answer it already has: the result was truncated, or too large to keep in the transcript. Check the truncated-results count above, and shrink or page that result rather than the transcript." : "Look at the repeated targets above: the agent is not retaining what it already read (the result was truncated, or the read was too narrow to answer the question). Widen the read, or cache the file in the transcript, rather than shrinking context or switching models."}` : 'Check the "Answered from memory" line first \u2014 a turn served from the Q&A cache or an Evermind head does NO work by construction, so a run made largely of those has no mutating call to find. Otherwise check whether the agent was ever offered a mutating tool this run (see the tools-advertised line) before concluding the model refused to act.';
  return `${loop}${effect}${remedy}`;
}

// src/modelScorecard.ts
var SILENT_TURNS_AT = 3;
function modelOf(ev) {
  const m = ev.args?.model;
  return typeof m === "string" && m && m !== "default" ? m : null;
}
function modelScorecard(events) {
  const byModel = /* @__PURE__ */ new Map();
  const row = (model) => {
    let score2 = byModel.get(model);
    if (!score2) {
      score2 = {
        model,
        turns: 0,
        toolCalls: 0,
        textOnlyTurns: 0,
        unliftedMarkupTurns: 0,
        failures: 0,
        stopped: 0,
        upstreamReportedTurns: 0,
        upstreamFunctionCalls: 0,
        upstreamRecovered: 0,
        adapterLossTurns: 0
      };
      byModel.set(model, score2);
    }
    return score2;
  };
  for (const ev of events) {
    if (ev.label === STOPPED_TURN_STEP) {
      const model2 = modelOf(ev);
      if (model2) row(model2).stopped += 1;
      continue;
    }
    if (ev.label !== "llm.complete") continue;
    const model = modelOf(ev);
    if (!model) continue;
    if (ev.category === "error") {
      row(model).failures += 1;
      continue;
    }
    if (ev.category !== "llm") continue;
    const score2 = row(model);
    const args = ev.args;
    const calls = typeof args?.toolCalls === "number" ? args.toolCalls : 0;
    score2.turns += 1;
    score2.toolCalls += calls;
    if (calls === 0 && (ev.textChars ?? 0) > 0) score2.textOnlyTurns += 1;
    if (args?.unliftedCallMarkup === true) score2.unliftedMarkupTurns += 1;
    if (typeof args?.upstreamFunctionCalls === "number") {
      score2.upstreamReportedTurns += 1;
      score2.upstreamFunctionCalls += args.upstreamFunctionCalls;
      if (typeof args.upstreamRecovered === "number") score2.upstreamRecovered += args.upstreamRecovered;
      if (args.upstreamFunctionCalls > calls) score2.adapterLossTurns += 1;
    }
  }
  return [...byModel.values()];
}
function silentModelFlag(s) {
  const base = " \xB7 \u26A0 made NO tool calls while another model in this run did";
  if (s.upstreamReportedTurns > 0 && s.upstreamFunctionCalls === 0) {
    return `${base}. Its raw responses carried 0 structured function calls on the ${s.upstreamReportedTurns} turn(s) its vendor reported, so the MODEL did not call \u2014 nothing was lost on the way.`;
  }
  return `${base}: this model is not emitting structured calls on its route.`;
}
function formatModelScorecard(scores) {
  const markup = scores.some((s) => s.unliftedMarkupTurns > 0);
  const stopped = scores.some((s) => s.stopped > 0);
  const lost = scores.some((s) => s.adapterLossTurns > 0);
  if (scores.length < 2 && !markup && !stopped && !lost) return [];
  const anyActed = scores.some((s) => s.toolCalls > 0);
  const lines = ["Per model:"];
  for (const s of scores) {
    const parts = [`${s.turns} turn(s)`, `${s.toolCalls} tool call(s)`];
    if (s.textOnlyTurns) parts.push(`${s.textOnlyTurns} text-only`);
    if (s.upstreamReportedTurns) {
      parts.push(`raw response: ${s.upstreamFunctionCalls} structured call(s) over ${s.upstreamReportedTurns} reported turn(s)`);
    }
    if (s.upstreamRecovered) parts.push(`${s.upstreamRecovered} rebuilt from the final frame`);
    if (s.failures) parts.push(`${s.failures} failed`);
    if (s.stopped) parts.push(`${s.stopped} stopped by the user mid-stream`);
    const flag = s.unliftedMarkupTurns ? ` \xB7 \u26A0 ${s.unliftedMarkupTurns} turn(s) wrote a tool call as MARKUP that no parser lifted, so the call never ran. The model tried to act; this is a parser gap, not a refusal.` : s.adapterLossTurns ? ` \xB7 \u26A0 on ${s.adapterLossTurns} turn(s) the vendor returned structured tool calls that never reached the loop: the calls were lost in translation, so this is an adapter defect, not the model.` : scores.length > 1 && anyActed && s.toolCalls === 0 && s.turns >= SILENT_TURNS_AT ? silentModelFlag(s) : "";
    lines.push(`  \u2022 ${s.model}: ${parts.join(" \xB7 ")}${flag}`);
  }
  return lines;
}
function modelTurnLog(events) {
  const turns = [];
  for (const ev of events) {
    if (ev.label !== "llm.complete") continue;
    const model = modelOf(ev);
    if (!model) continue;
    const args = ev.args;
    const requested = typeof args?.requestedModel === "string" && args.requestedModel && args.requestedModel !== "default" && args.requestedModel !== model ? args.requestedModel : void 0;
    if (ev.category === "error") {
      turns.push({
        index: turns.length + 1,
        model,
        ...requested ? { requestedModel: requested } : {},
        toolCalls: 0,
        textOnly: false,
        failed: true,
        ...typeof ev.durationMs === "number" ? { durationMs: ev.durationMs } : {}
      });
      continue;
    }
    if (ev.category !== "llm") continue;
    const calls = typeof args?.toolCalls === "number" ? args.toolCalls : 0;
    const turn = {
      index: turns.length + 1,
      model,
      ...requested ? { requestedModel: requested } : {},
      toolCalls: calls,
      textOnly: calls === 0 && (ev.textChars ?? 0) > 0,
      // What the turn SPENT its time producing. Absent on traces that predate the
      // accounting, so an old chat's log renders exactly as it used to.
      ...typeof args?.argBytes === "number" && args.argBytes > 0 ? { argBytes: args.argBytes } : {},
      ...typeof ev.usage?.completion === "number" && ev.usage.completion > 0 ? { completionTokens: ev.usage.completion } : {},
      ...typeof ev.durationMs === "number" ? { durationMs: ev.durationMs } : {},
      ...args?.unliftedCallMarkup === true ? { unliftedCallMarkup: true } : {}
    };
    if (typeof args?.upstreamFunctionCalls === "number") {
      turn.upstreamFunctionCalls = args.upstreamFunctionCalls;
      if (typeof args.upstreamRecovered === "number") turn.upstreamRecovered = args.upstreamRecovered;
    }
    turns.push(turn);
  }
  return turns;
}
function formatOneTurn(t) {
  const model = t.requestedModel ? `${t.model} (requested ${t.requestedModel})` : t.model;
  const parts = [];
  if (t.failed) {
    parts.push("FAILED");
  } else {
    parts.push(`${t.toolCalls} tool call(s)`);
    if (t.textOnly) parts.push("text-only");
  }
  if (typeof t.upstreamFunctionCalls === "number") {
    parts.push(`raw response: ${t.upstreamFunctionCalls} structured call(s)`);
  }
  if (t.upstreamRecovered) parts.push(`${t.upstreamRecovered} rebuilt from the final frame`);
  if (t.unliftedCallMarkup) parts.push("\u26A0 unlifted call markup");
  if (t.argBytes) parts.push(`${formatBytes(t.argBytes)} of arguments`);
  if (t.completionTokens) parts.push(`${t.completionTokens.toLocaleString("en-US")} completion tok`);
  if (typeof t.durationMs === "number") parts.push(`${t.durationMs}ms`);
  return `  ${t.index}. ${model} \xB7 ${parts.join(" \xB7 ")}`;
}
function formatModelTurnLog(turns) {
  if (!turns.length) return [];
  return ["Turn log:", ...turns.map(formatOneTurn)];
}

// src/staffingSummary.ts
var DISPATCH_TOOL = /chats[._](dispatch_agent|execute_as_agent)|kanban[._](coordinate|materialize_work_items|assess_resource|assign_participant)|executions[._]submit|run[._-]?now/i;
function isDispatchTool(label) {
  return DISPATCH_TOOL.test(label);
}
var MAX_REFUSAL_CHARS = 180;
function resultObject(result) {
  if (result && typeof result === "object") return result;
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
function didDispatch(ev) {
  if (ev.isError || isFailedToolResult(ev.result)) return false;
  const r = resultObject(ev.result);
  if (!r) return true;
  const autoRun = r.autoRun && typeof r.autoRun === "object" ? r.autoRun : null;
  if (autoRun && typeof autoRun.dispatched === "boolean") return autoRun.dispatched;
  if (typeof r.dispatched === "boolean") return r.dispatched;
  return true;
}
function refusalMessage(ev) {
  const r = resultObject(ev.result);
  const raw = r && typeof r.error === "string" && r.error || r && typeof r.detail === "string" && r.detail || (r && r.autoRun && typeof r.autoRun === "object" && typeof r.autoRun.detail === "string" ? String(r.autoRun.detail) : "") || (typeof ev.result === "string" ? ev.result : "") || (r ? JSON.stringify(r) : "") || "no reason given";
  const flat = String(raw).replace(/\s+/g, " ").trim();
  return flat.length > MAX_REFUSAL_CHARS ? `${flat.slice(0, MAX_REFUSAL_CHARS)}\u2026` : flat || "no reason given";
}
function asAgentOf(args) {
  const a = args && typeof args === "object" ? args : null;
  const v = a?.as_agent;
  return typeof v === "string" ? v.trim() : "";
}
function staffingSummaryInTrace(events) {
  let ticketsCreated = 0;
  let dispatchAttempts = 0;
  let dispatched = 0;
  const dispatchRefusals = [];
  const personaSubagents = [];
  for (const ev of events) {
    if (ev.category !== "tool") continue;
    if (isTicketWriteTool(ev.label) && !ev.isError && !isFailedToolResult(ev.result)) ticketsCreated += 1;
    if (isDispatchTool(ev.label)) {
      dispatchAttempts += 1;
      if (didDispatch(ev)) dispatched += 1;
      else dispatchRefusals.push({ label: ev.label, message: refusalMessage(ev) });
    }
    if (ev.label === "spawn_agent") {
      const agent = asAgentOf(ev.args);
      if (!agent) continue;
      const args = ev.args;
      const result = resultObject(ev.result);
      const label = typeof args?.label === "string" && args.label.trim() || typeof result?.label === "string" && result.label.trim() || (typeof args?.task === "string" ? args.task.trim().slice(0, 60) : "") || "delegated work";
      personaSubagents.push({
        agent,
        label,
        ok: !ev.isError && !isFailedToolResult(ev.result) && result?.ok !== false
      });
    }
  }
  const verdict = dispatched > 0 || personaSubagents.some((p) => p.ok) ? "staffed" : dispatchRefusals.length > 0 ? "staffing-refused" : ticketsCreated > 0 ? "filed-not-staffed" : "no-work-filed";
  return { ticketsCreated, dispatchAttempts, dispatched, dispatchRefusals, personaSubagents, verdict };
}
function formatDispatchRefusals(refusals) {
  const counts = /* @__PURE__ */ new Map();
  for (const r of refusals) counts.set(r.message, (counts.get(r.message) ?? 0) + 1);
  return [...counts.entries()].map(([msg, n]) => n > 1 ? `${msg} \xD7${n}` : msg).join("; ");
}
function workFiledNotStaffedVerdict(s) {
  const refused = s.dispatchRefusals.length ? ` (${s.dispatchRefusals.length} refused: ${formatDispatchRefusals(s.dispatchRefusals)})` : "";
  return `Likely WORK FILED BUT NOT STAFFED \u2014 ${s.ticketsCreated} ticket(s) created, ${s.dispatched} dispatched${refused}. Nobody is running the work.`;
}
function formatStaffingSummary(s) {
  if (s.verdict === "no-work-filed" && s.dispatchAttempts === 0 && s.personaSubagents.length === 0) return [];
  const refused = s.dispatchRefusals.length ? ` (${s.dispatchRefusals.length} refused: ${formatDispatchRefusals(s.dispatchRefusals)})` : "";
  const tail = s.verdict === "filed-not-staffed" ? " \u2014 the work was filed but nobody is running it" : s.verdict === "staffing-refused" ? " \u2014 every attempt to staff the work was refused, so nobody is running it" : "";
  const lines = [
    `Staffing: ${s.ticketsCreated} ticket(s) filed \xB7 ${s.dispatched} dispatched${refused} \xB7 ${s.personaSubagents.length} persona sub-agent(s)${tail}`
  ];
  if (s.personaSubagents.length) {
    lines.push(
      `Persona sub-agents: ${s.personaSubagents.map((p) => `${p.agent} \u2014 ${p.label}${p.ok ? "" : " (no answer)"}`).join("; ")}`
    );
  }
  return lines;
}

// src/readOnlyShell.ts
var READ_ONLY_PROGRAMS = /* @__PURE__ */ new Set([
  "cat",
  "head",
  "tail",
  "wc",
  "ls",
  "dir",
  "pwd",
  "echo",
  "printf",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "tree",
  "stat",
  "file",
  "du",
  "df",
  "which",
  "where",
  "type",
  "sort",
  "uniq",
  "cut",
  "tr",
  "jq",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "date",
  "true",
  "false",
  "test",
  "[",
  "diff",
  "cmp",
  "comm",
  "nl",
  "column",
  "less",
  "more",
  "sed",
  "cd",
  "read",
  "whoami",
  "hostname",
  "uname",
  "node",
  "npm",
  "pnpm",
  "yarn",
  "python",
  "python3"
]);
var INFO_ONLY_PROGRAMS = /* @__PURE__ */ new Set(["node", "npm", "pnpm", "yarn", "python", "python3"]);
var INFO_FLAGS = /* @__PURE__ */ new Set(["--version", "-v", "-V", "version", "--help", "-h"]);
var READ_ONLY_GIT = /* @__PURE__ */ new Set([
  "status",
  "log",
  "show",
  "diff",
  "rev-list",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "ls-remote",
  "cat-file",
  "merge-base",
  "for-each-ref",
  "describe",
  "blame",
  "shortlog",
  "grep",
  "name-rev",
  "count-objects",
  "whatchanged",
  "cherry",
  "show-ref",
  "show-branch",
  "range-diff",
  "var",
  "check-ignore",
  "check-attr"
]);
var CONSTRUCT_WORDS = /* @__PURE__ */ new Set(["then", "else", "fi", "do", "done", "esac", "{", "}", "(", ")"]);
function splitSegments(command) {
  const out = [];
  let current = "";
  let quote = null;
  let depth = 0;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "$" && command[i + 1] === "(") {
      depth += 1;
      current += "$(";
      i += 1;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === "&" && (command[i - 1] === ">" || command[i - 1] === "<" || command[i + 1] === ">")) {
      current += ch;
      continue;
    }
    if (depth === 0 && (ch === ";" || ch === "\n" || ch === "|" || ch === "&")) {
      if ((ch === "&" || ch === "|") && command[i + 1] === ch) i += 1;
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (quote || depth !== 0) return null;
  if (current.trim()) out.push(current.trim());
  return out;
}
function substitutions(segment) {
  const out = [];
  let i = segment.indexOf("$(");
  while (i >= 0) {
    let depth = 1;
    let j = i + 2;
    for (; j < segment.length && depth > 0; j += 1) {
      if (segment[j] === "(") depth += 1;
      else if (segment[j] === ")") depth -= 1;
    }
    out.push(segment.slice(i + 2, j - 1));
    i = segment.indexOf("$(", j);
  }
  return out;
}
function tokens(segment) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m = re.exec(segment);
  while (m) {
    out.push(m[1] ?? m[2] ?? m[3]);
    m = re.exec(segment);
  }
  return out;
}
function writesViaRedirect(segment) {
  const unquoted = segment.replace(/"[^"]*"|'[^']*'/g, '""');
  const re = /(\d*)>>?\s*(&\d+|\S+)?/g;
  let m = re.exec(unquoted);
  while (m) {
    const target = m[2] ?? "";
    if (!/^(&\d+|\/dev\/null|nul|NUL|\$null)$/.test(target)) return true;
    m = re.exec(unquoted);
  }
  return false;
}
function gitIsReadOnly(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    i += args[i] === "-C" || args[i] === "-c" ? 2 : 1;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub) return true;
  if (READ_ONLY_GIT.has(sub)) return true;
  const flags = new Set(rest.filter((a) => a.startsWith("-")));
  const positional = rest.filter((a) => !a.startsWith("-"));
  switch (sub) {
    case "branch": {
      const writes = ["-d", "-D", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy", "-f", "--force", "-u", "--set-upstream-to", "--unset-upstream", "--edit-description"];
      if (writes.some((f) => flags.has(f) || [...flags].some((x) => x.startsWith(`${f}=`)))) return false;
      if (flags.has("--list") || flags.has("-l")) return true;
      const valued = /* @__PURE__ */ new Set(["--format", "--sort", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at"]);
      for (let k = 0; k < rest.length; k += 1) {
        if (rest[k].startsWith("-")) {
          if (valued.has(rest[k])) k += 1;
          continue;
        }
        return false;
      }
      return true;
    }
    case "tag":
      return positional.length === 0 || flags.has("-l") || flags.has("--list");
    case "remote":
      return positional.length === 0 || ["show", "get-url"].includes(positional[0]);
    case "stash":
    case "notes":
    case "worktree":
      return ["list", "show"].includes(positional[0] ?? "");
    case "reflog":
      return positional.length === 0 || positional[0] === "show";
    case "config":
      return ["--get", "--get-all", "--get-regexp", "--list", "-l"].some((f) => flags.has(f));
    case "symbolic-ref":
      return positional.length <= 1 && !flags.has("-d") && !flags.has("--delete");
    default:
      return false;
  }
}
function segmentIsReadOnly(segment, depth) {
  if (depth > 4) return false;
  for (const body of substitutions(segment)) {
    if (!commandIsReadOnly(body, depth + 1)) return false;
  }
  const flat = segment.replace(/\$\((?:[^()]|\([^()]*\))*\)/g, "X");
  if (writesViaRedirect(flat)) return false;
  let words2 = tokens(flat);
  while (words2.length && (CONSTRUCT_WORDS.has(words2[0]) || /^[A-Za-z_]\w*=/.test(words2[0]) || words2[0] === "if" || words2[0] === "while" || words2[0] === "until" || words2[0] === "!")) {
    words2 = words2.slice(1);
  }
  if (words2.length === 0) return true;
  const [program, ...args] = words2;
  if (program === "for" || program === "case") return true;
  if (program === "git") return gitIsReadOnly(args);
  if (!READ_ONLY_PROGRAMS.has(program)) return false;
  if (INFO_ONLY_PROGRAMS.has(program)) return args.length > 0 && args.every((a) => INFO_FLAGS.has(a));
  if (program === "sed") return !args.some((a) => a === "-i" || a.startsWith("-i") || a === "--in-place" || a.startsWith("--in-place="));
  if (program === "find") return !args.some((a) => ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fls"].includes(a));
  if (program === "sort") return !args.some((a) => a === "-o" || a.startsWith("--output"));
  return true;
}
function commandIsReadOnly(command, depth) {
  if (/`/.test(command)) return false;
  const segments = splitSegments(command);
  if (!segments || segments.length === 0) return false;
  return segments.every((s) => segmentIsReadOnly(s, depth));
}
function isReadOnlyShellCommand(command) {
  const trimmed = command.trim();
  if (!trimmed) return false;
  return commandIsReadOnly(trimmed, 0);
}

// src/readCoverage.ts
var PATH_ARG_KEYS = /* @__PURE__ */ new Set(["path", "scope", "repo", "file", "filePath", "dir"]);
function normalizePathArg(value) {
  const p = value.split("\\").join("/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  return p === "." ? "" : p;
}
function canonicalReadArgs(tool, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    if (value == null) continue;
    if (typeof value === "string") {
      const trimmed = PATH_ARG_KEYS.has(key) ? normalizePathArg(value.trim()) : value.trim();
      if (trimmed) out[key] = trimmed;
      continue;
    }
    out[key] = value;
  }
  if (tool === "read_file" && (out.offset === 1 || out.offset === 0)) delete out.offset;
  return out;
}
var TREE_WIDE_READ_TOOLS = /* @__PURE__ */ new Set(["search_code", "find_symbol", "list_files"]);
function visitedScopeIs(visited, target) {
  return visited === target || (visited?.startsWith(`${target}${VISIT_QUESTION_SEPARATOR}`) ?? false);
}
function isReadOnlyShellCall(tool, args) {
  if (tool !== "run_command" || !args || typeof args !== "object") return false;
  const record = args;
  const command = typeof record.command === "string" ? record.command : typeof record.cmd === "string" ? record.cmd : "";
  return isReadOnlyShellCommand(command);
}
function resultObject2(result) {
  if (result && typeof result === "object" && !Array.isArray(result)) return result;
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
function isUnderDir(p, dir) {
  if (!dir) return true;
  const path = normalizePathArg(p);
  return path === dir || path.startsWith(`${dir}/`);
}
var READ_WINDOW_DEFAULT = 2e3;
function asPositiveInt(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
function requestedReadWindow(args) {
  const start = asPositiveInt(args.offset, 1);
  const limit = asPositiveInt(args.limit, READ_WINDOW_DEFAULT);
  return { start, end: start + limit - 1 };
}
function servedReadWindow(result) {
  const data = resultObject2(result);
  if (!data || data.ok === false) return null;
  const start = asPositiveInt(data.offset, 1);
  const content = typeof data.content === "string" ? data.content : "";
  const returned = content === "" ? 0 : content.split("\n").length;
  if (returned <= 0) return null;
  let end = start + returned - 1;
  if (data.truncated !== true && typeof data.totalLines === "number" && data.totalLines >= start) {
    end = Math.max(end, Math.floor(data.totalLines));
  }
  return { start, end };
}
function spanContains(outer, inner) {
  return inner.start >= outer.start && inner.end <= outer.end;
}
function clipRequestedToEof(want, covering) {
  const data = resultObject2(covering);
  if (!data || data.truncated === true || typeof data.totalLines !== "number" || data.totalLines < 1) return want;
  return { start: want.start, end: Math.min(want.end, Math.floor(data.totalLines)) };
}
var REVISIT_NUDGE_AT = 3;
var REVISIT_HARD_AT = 5;
var MAX_REMEMBERED_ARGS = 8;
var ReadCoverage = class _ReadCoverage {
  visits = /* @__PURE__ */ new Map();
  /** Successful reads by `${tool}:${canonical args}` — the exact-repeat guard. */
  exact = /* @__PURE__ */ new Map();
  static exactKey(tool, args) {
    return `${tool}:${stableStringify(canonicalReadArgs(tool, args))}`;
  }
  /**
   * Has this exact read — same tool, same arguments in any key order — already
   * SUCCEEDED this run, with nothing since that could have changed its answer? The run
   * loop answers such a call with a stub instead of re-running it.
   */
  isRepeat(tool, args) {
    return this.exact.has(_ReadCoverage.exactKey(tool, args));
  }
  /**
   * Keep what a SUCCESSFUL read returned, with the transcript message that carried it,
   * so an exact repeat can be replayed once that message has left the working context.
   * A no-op for a read that was never recorded (a failure has nothing to replay).
   */
  cacheResult(tool, args, cached2) {
    const read = this.exact.get(_ReadCoverage.exactKey(tool, args));
    if (read) read.cached = cached2;
  }
  /** The cached result of an exact earlier read, or null when none is held. */
  cachedResult(tool, args) {
    return this.exact.get(_ReadCoverage.exactKey(tool, args))?.cached ?? null;
  }
  /**
   * Record a SUCCESSFUL read. Arms the exact-repeat guard for it, and returns the
   * resulting target visit — or null when the call names no target (nothing to be
   * circling around; the exact guard still applies).
   */
  record(tool, args) {
    const target = visitTarget(args) ?? null;
    this.exact.set(_ReadCoverage.exactKey(tool, args), { tool, args: canonicalReadArgs(tool, args), target });
    if (!target) return null;
    const key = `${tool}:${target}`;
    const existing = this.visits.get(key);
    let argText;
    try {
      argText = JSON.stringify(args ?? {});
    } catch {
      argText = String(args ?? "");
    }
    if (!existing) {
      const fresh = { count: 1, priorArgs: [argText], mayHaveChanged: false };
      this.visits.set(key, fresh);
      return { ...fresh };
    }
    existing.count += 1;
    if (!existing.priorArgs.includes(argText) && existing.priorArgs.length < MAX_REMEMBERED_ARGS) {
      existing.priorArgs.push(argText);
    }
    const visit = { ...existing };
    existing.mayHaveChanged = false;
    return visit;
  }
  /**
   * A non-read call has run. Forget exactly the reads it could have changed — no more,
   * no less — for BOTH guards:
   *
   * - A tool whose blast radius is unknown (`run_command`, a base-branch merge, an
   *   undo) forgets every cached ANSWER: the honest answer to "what did that touch?" is
   *   "anything", so no exact repeat may be stubbed out afterwards. It does NOT forget
   *   the visit TALLY, and that distinction is the whole difference between a guard that
   *   works and one that is inert. The tally counts the MODEL's behaviour — how many
   *   times it has gone back to one target, with every one of those results still sitting
   *   in the transcript above it — and a build running in between changes none of that.
   *   Clearing it wholesale is what made the advisory unreachable in any run that
   *   verifies its work: read, read, `run_command` (typecheck), read, read, `run_command`
   *   … never reaches three, so the nudge at 3 and the hard stop at 5 never fired, and a
   *   run spent 46% of its calls re-reading ground it had already covered with the loop
   *   guard silent throughout. Instead each target is marked {@link ReadVisit.mayHaveChanged}
   *   so the NEXT read of it is excused — a re-read after a build is the right move — and
   *   the one after that is not.
   * - A file write/edit/delete forgets its own target, across every tool that reads it —
   *   `read_file` and `search_code` on one path are the same stale picture. A re-read of
   *   what was just changed is genuinely new information; nagging about it would punish
   *   exactly the right behaviour. It forgets NOTHING about other files: clearing the
   *   whole tally on every non-read call is what once let one CSS file be read 14 times
   *   with the advisory firing on neither it nor its component.
   * - The remaining local tools (`git_status`, `git_diff`, `git_commit`, …) change nothing
   *   a read observes, so they forget nothing.
   * - Anything else is a platform or MCP call. It may have changed what a PLATFORM read
   *   returns (a ticket update changes the ticket list), so target-less platform reads
   *   are forgotten; file reads are not, because a ticket write does not edit source.
   */
  invalidate(tool, args) {
    if (isUnscopedMutationTool(tool) && !isReadOnlyShellCall(tool, args)) {
      this.exact.clear();
      for (const visit of this.visits.values()) visit.mayHaveChanged = true;
      return;
    }
    if (isCodeChangeTool(tool)) {
      const target = activityTarget(args);
      if (!target) return;
      for (const key of [...this.visits.keys()]) {
        if (visitedScopeIs(key.slice(key.indexOf(":") + 1), target)) this.visits.delete(key);
      }
      for (const [key, read] of [...this.exact.entries()]) {
        if (visitedScopeIs(read.target, target) || TREE_WIDE_READ_TOOLS.has(read.tool)) this.exact.delete(key);
      }
      return;
    }
    if (isLocalWorkspaceTool(tool)) return;
    for (const [key, read] of [...this.exact.entries()]) {
      if (!isLocalWorkspaceTool(read.tool)) this.exact.delete(key);
    }
  }
  /**
   * Answer a `read_file` whose window is already inside an earlier successful window
   * of the SAME file. Chat #109's fourteen overlapping reads of one service file were
   * different exact-repeat keys (offset 1050, then 1080, then 1105) so the stub never
   * ran; the circling advisory fired and was ignored; the bytes still filled the
   * window. This is that stub for overlapping windows.
   *
   * A jump to lines the earlier read did not return, and a page that extends past a
   * truncated window, return null — those still need the disk. An edit of the file
   * forgets the covering cache via {@link invalidate}.
   */
  coveredRead(tool, args) {
    if (tool !== "read_file") return null;
    const wanted = canonicalReadArgs(tool, args);
    const path = typeof wanted.path === "string" ? wanted.path : "";
    if (!path) return null;
    const want = requestedReadWindow(wanted);
    for (const read of this.exact.values()) {
      if (read.tool !== "read_file" || !read.cached) continue;
      const earlierPath = typeof read.args.path === "string" ? read.args.path : "";
      if (earlierPath !== path) continue;
      const got = servedReadWindow(read.cached.result);
      if (!got) continue;
      const clipped = clipRequestedToEof(want, read.cached.result);
      if (clipped.start > clipped.end) continue;
      if (!spanContains(got, clipped)) continue;
      return {
        start: clipped.start,
        end: clipped.end,
        cached: read.cached,
        note: `Lines ${clipped.start}\u2013${clipped.end} of this file were already returned by an earlier read_file (lines ${got.start}\u2013${got.end}). Reuse that result; if you need later lines, page forward with offset ${got.end + 1}. Do not re-open a window you already have.`
      };
    }
    return null;
  }
  /**
   * Answer a `search_code` from a WIDER search already held: the same query (and the same
   * other arguments) run earlier over an ancestor directory — or the whole tree — whose
   * result was complete (not truncated). Filtering those matches to the narrower `path`
   * is exactly what re-running the search would return, without running it.
   *
   * Measured on a ticket-review run: one directory searched nine times and one file six,
   * mostly re-asking a question an earlier, broader search had already answered.
   *
   * A derived 0 is never returned. Chat #111: a directory search for `addressedTo`
   * under `Builderforce.ai/clients` came back `total:0 truncated:false` even though
   * `VsCodeChatSurface.tsx` contains the term; the file-scoped retry was then answered
   * from that parent ("the term does not appear") and the run concluded composers never
   * pass `addressedTo`. A 0 from a parent is the most expensive lie this guard can tell —
   * the tool's own copy treats `truncated:false` as proof of absence — so the narrower
   * search must actually run. File-scope uses a different backend (`searchOneFile`) and
   * is the recovery path. Null when no complete covering result with matches is held.
   */
  derivedSearch(tool, args) {
    if (tool !== "search_code") return null;
    const wanted = canonicalReadArgs(tool, args);
    const scope = typeof wanted.path === "string" ? wanted.path : "";
    if (!scope) return null;
    const { path: _scope, ...rest } = wanted;
    const others = stableStringify(rest);
    for (const read of this.exact.values()) {
      if (read.tool !== "search_code" || !read.cached) continue;
      const { path: earlierPath, ...earlierRest } = read.args;
      const earlier = typeof earlierPath === "string" ? earlierPath : "";
      if (earlier === scope || !isUnderDir(scope, earlier)) continue;
      if (stableStringify(earlierRest) !== others) continue;
      const result = resultObject2(read.cached.result);
      if (!result || result.ok !== true || result.truncated === true || !Array.isArray(result.matches)) continue;
      const matches = result.matches.filter(
        (m) => typeof m.path === "string" && isUnderDir(m.path, scope)
      );
      if (matches.length === 0) continue;
      return {
        ok: true,
        query: wanted.query,
        total: matches.length,
        truncated: false,
        matches,
        note: `Answered from this run's earlier complete search for the same query${earlier ? ` under "${earlier}"` : " over the whole tree"}, filtered to "${scope}" \u2014 not re-run. ${matches.length === 0 ? "The term does not appear under this path." : ""}`.trim()
      };
    }
    return null;
  }
};
function revisitAdvisory(tool, target, visit) {
  if (visit.count < REVISIT_NUDGE_AT) return null;
  if (visit.mayHaveChanged) return null;
  const shape = visit.priorArgs.length > 1 ? ` The argument sets you have already used on it: ${visit.priorArgs.map((a) => `\`${a}\``).join(", ")}.` : "";
  if (visit.count >= REVISIT_HARD_AT) {
    return `STOP RE-READING. This is call ${visit.count} of \`${tool}\` against ${target} in this run, and the previous ${visit.count - 1} results are all still above you in this conversation.${shape} Re-reading it again will return content you already have and will not move the task forward \u2014 this pattern is how a run exhausts its tool budget without producing a single change. Do ONE of these now: (a) if you still need more of the file, continue from the \`offset\` the last result's note gave you and page forward in order \u2014 never re-open a window you already have; (b) otherwise stop reading and make the edit, or state plainly what is blocking you. Do not issue another partial read of this target.`;
  }
  return `You have now read ${target} ${visit.count} times in this run with \`${tool}\`, and every earlier result is still above you in this conversation.${shape} If you are looking for something you have not found, another window over the same lines is unlikely to surface it \u2014 page forward from the \`offset\` the last result's note gave you, or search for the specific symbol with search_code. If you already have what you need, act on it rather than re-reading.`;
}
function withAdvisory(result, advisory) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const existing = result.note;
    const note = typeof existing === "string" && existing ? `${existing}

${advisory}` : advisory;
    return { ...result, note };
  }
  return { result, note: advisory };
}

// src/toolResultBudget.ts
var MAX_TOOL_RESULT_CHARS = 6e3;
var READ_FILE_RESULT_CHARS = 16e3;
var READ_FILE_TOOL = "read_file";
function isReadFileResult(out) {
  return !!out && typeof out === "object" && !Array.isArray(out) && out.ok !== false && typeof out.content === "string";
}
function withNote(result, advisory) {
  return advisory ? withAdvisory(result, advisory) : result;
}
function trimReadFile(out, advisory) {
  const lines = out.content.split("\n");
  const offset = typeof out.offset === "number" && out.offset > 0 ? Math.floor(out.offset) : 1;
  const totalLines = typeof out.totalLines === "number" && out.totalLines > 0 ? Math.floor(out.totalLines) : offset + lines.length - 1;
  const alreadyPartial = out.truncated === true;
  const build = (kept, note) => {
    const lastLine = offset + kept.length - 1;
    return withNote(
      { ...out, content: kept.join("\n"), offset, totalLines, truncated: lastLine < totalLines || alreadyPartial, note },
      advisory
    );
  };
  const fits = (value) => JSON.stringify(value).length <= READ_FILE_RESULT_CHARS;
  const whole = withNote({ ...out }, advisory);
  if (fits(whole)) return { value: whole, truncated: false };
  const continuation = (lastLine) => `Showing lines ${offset}\u2013${lastLine} of ${totalLines}. This surface returns at most ~${READ_FILE_RESULT_CHARS.toLocaleString()} chars per read, so a large file arrives in several windows \u2014 call read_file again with offset ${lastLine + 1} to continue from exactly where this one stopped. Do not re-request lines you already have.`;
  let lo = 1;
  let hi = lines.length;
  let best = 0;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    if (fits(build(lines.slice(0, mid), continuation(offset + mid - 1)))) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best === 0) {
    const head = lines[0].slice(0, Math.max(0, READ_FILE_RESULT_CHARS - 600));
    const note = `Line ${offset} of ${totalLines} is longer than the ~${READ_FILE_RESULT_CHARS.toLocaleString()}-char read budget; the first ${head.length.toLocaleString()} of its ${lines[0].length.toLocaleString()} chars are shown. Paging by offset cannot reach the rest of this line \u2014 use search_code for the specific symbol instead.`;
    return { value: withNote({ ...out, content: head, offset, totalLines, truncated: true, note }, advisory), truncated: true };
  }
  return { value: build(lines.slice(0, best), continuation(offset + best - 1)), truncated: true };
}
function trimToolResult(tool, out, opts = {}) {
  const bytes = JSON.stringify(out ?? null).length;
  if (tool === READ_FILE_TOOL && isReadFileResult(out)) {
    const trimmed = trimReadFile(out, opts.advisory);
    return { content: JSON.stringify(trimmed.value), bytes, truncated: trimmed.truncated };
  }
  const advised = opts.advisory ? withAdvisory(out ?? null, opts.advisory) : out ?? null;
  const full = JSON.stringify(advised);
  if (full.length <= MAX_TOOL_RESULT_CHARS) return { content: full, bytes, truncated: false };
  const itemNote = Array.isArray(out) ? ` The full result had ${out.length} items; re-call this tool with a narrower filter (e.g. status, projectId, or limit) to see specific ones.` : " The full result was large; re-call with a narrower query if you need the elided fields.";
  const head = JSON.stringify(out ?? null).slice(0, MAX_TOOL_RESULT_CHARS);
  const marker = `\u2026[truncated ${bytes - MAX_TOOL_RESULT_CHARS} of ${bytes} chars to protect the context window.${itemNote}]`;
  const content = `${head}
${marker}${opts.advisory ? `
${opts.advisory}` : ""}`;
  return { content, bytes, truncated: true };
}

// src/workingTranscript.ts
var HISTORY_WINDOW = 80;
var HISTORY_TOKEN_BUDGET = 64e3;
var COMPACT_TAIL_TOKEN_BUDGET = 4e4;
function estimateTokens(chars) {
  return Math.ceil(chars / 4);
}
function messageTokens(m) {
  let chars = typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length;
  if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  return estimateTokens(chars) + 4;
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
function stillInWorkingContext(state, anchor) {
  const convo = state.transcript;
  const idx = convo.indexOf(anchor);
  if (idx < 0) return false;
  if (state.compactMemo) return idx >= verbatimStart(convo, state.compactMemo.coveredEnd);
  return windowed(convo).includes(convo[idx]);
}
var COMPACT_TAIL_TURNS = 8;
var COMPACT_TAIL_MAX_MESSAGES = HISTORY_WINDOW / 2;
function verbatimStart(convo, from) {
  let start = Math.max(0, Math.min(from, convo.length));
  while (start < convo.length && convo[start].role === "tool") start += 1;
  return start;
}
function compactTailStartForBudget(convo, budgetTokens) {
  let start = convo.length;
  let tokens2 = 0;
  while (start > 0) {
    const kept = convo.length - start;
    if (kept >= COMPACT_TAIL_MAX_MESSAGES) break;
    const next = messageTokens(convo[start - 1]);
    if (kept >= COMPACT_TAIL_TURNS && tokens2 + next > budgetTokens) break;
    tokens2 += next;
    start -= 1;
  }
  return verbatimStart(convo, start);
}
function pinnedDirectiveIndex(convo, tailStart) {
  const lastUser = convo.map((m) => m.role).lastIndexOf("user");
  return lastUser >= 0 && lastUser < tailStart ? lastUser : -1;
}
function assembleCompacted(systemPrompt, convo, note, coveredEnd) {
  const tailStart = verbatimStart(convo, coveredEnd);
  const out = [{ role: "system", content: systemPrompt }];
  out.push({ role: "assistant", content: note });
  const directiveIdx = pinnedDirectiveIndex(convo, tailStart);
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
          content: "You compress an in-progress AI agent transcript into a concise MEMORY the agent keeps working from. Capture: the CURRENT outstanding instruction from the user (the most recent user message is authoritative \u2014 earlier requests it supersedes are history, not the active task), concrete facts/answers discovered, tool results that matter (ids, paths, values), decisions made, and what still remains to do. Keep every file path, symbol name and line number the remaining work depends on, with the specific facts learned from each file \u2014 the agent no longer sees those results, so what you leave out it must read again. Be information-dense; drop pleasantries. No preamble."
        },
        { role: "user", content: renderForSummary(msgs) }
      ],
      model,
      // A compaction note is a UTILITY completion: a bounded answer with no thinking.
      // Left unset, it inherited the run's full output ceiling and, on a thinking-
      // capable model, the run's reasoning depth — the most expensive way to write a
      // paragraph the user never sees. Bounded at ~2.5k tokens: the note is the agent's
      // only record of every file it folds (paths, symbols, line numbers), and 1.2k was
      // too little to carry them — the run re-read whatever the note had to leave out.
      maxTokens: 2500,
      reasoning: { level: "off" },
      signal
    });
    const out = (res.text ?? "").trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
function tokensOf(msgs) {
  return msgs.reduce((sum, m) => sum + messageTokens(m), 0);
}
function fitsVerbatim(msgs, extraTokens = 0) {
  return msgs.length <= HISTORY_WINDOW && extraTokens + tokensOf(msgs) <= HISTORY_TOKEN_BUDGET;
}
async function buildWorkingTranscript(state, systemPrompt, summarize, onFolded) {
  const convo = state.transcript;
  if (fitsVerbatim(convo)) {
    state.compactMemo = null;
    return [{ role: "system", content: systemPrompt }, ...windowed(convo)];
  }
  const memo = state.compactMemo && state.compactMemo.coveredEnd <= convo.length ? state.compactMemo : null;
  if (memo && fitsVerbatim(convo.slice(verbatimStart(convo, memo.coveredEnd)), estimateTokens(memo.note.length))) {
    return assembleCompacted(systemPrompt, convo, memo.note, memo.coveredEnd);
  }
  const from = memo?.coveredEnd ?? 0;
  const to = Math.max(from, compactTailStartForBudget(convo, COMPACT_TAIL_TOKEN_BUDGET));
  const fold = memo ? [{ role: "assistant", content: memo.note }, ...convo.slice(from, to)] : convo.slice(from, to);
  const summary = to > from ? await summarize(fold) : null;
  if (summary == null) {
    return memo ? assembleCompacted(systemPrompt, convo, memo.note, memo.coveredEnd) : [{ role: "system", content: systemPrompt }, ...windowed(convo)];
  }
  const note = `Compressed memory of the first ${to} message(s) of this conversation:
${summary}`;
  state.compactMemo = { note, coveredEnd: to };
  onFolded(to - from);
  return assembleCompacted(systemPrompt, convo, note, to);
}

// src/brainTriage.ts
var CONTEXT_PROMPT_PEAK = Math.round(HISTORY_TOKEN_BUDGET * 1.5);
var LARGE_LOSSY_RESULT_BYTES = 2e4;
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
function isFileWriteTool(label) {
  return isCodeChangeTool(label) || FILE_WRITE_TOOL.test(label);
}
var UNBACKED_WRITE_CLAIM_NOTICE = "\u26A0 UNBACKED WRITE CLAIM \u2014 an assistant turn claimed it saved/updated a file, but no file-write tool (write_file / edit_file / attachments.write / project_files.save) succeeded in this run. The file was NOT modified.";
var UNBACKED_TICKET_CLAIM_NOTICE = "\u26A0 UNBACKED TICKET CLAIM \u2014 an assistant turn claimed it created/filed/linked a ticket or gap, but no create/link tool (tasks.create / chats.link_ticket / tickets.from_delta) succeeded in this run. Nothing was filed or linked to the chat.";
var FILE_SAVE_CLAIM = /\b(saved|updated|wrote|written|edited|persisted|added)\b[^.!?\n]*\b(file|attachment|roadmap|document|upload|\.md|\.csv|\.txt|\.json)\b/i;
var TICKET_WRITE_TOOL = /(tasks|objectives|key_results|initiatives|portfolios|specs|roadmap)[._]create|chats[._]link_ticket|tickets[._]from_delta/i;
var TICKET_CLAIM = /\b(created|filed|opened|logged|added|linked|tracked)\b[^.!?\n]*\b(ticket|task|gap|epic|issue|objective|bug|card|board)\b/i;
function isTicketWriteTool(label) {
  return TICKET_WRITE_TOOL.test(label);
}
function detectUnbackedWriteClaim(events, messages) {
  const wroteOk = events.some(
    (e) => e.category === "tool" && isFileWriteTool(e.label) && !e.isError && !isFailedToolResult(e.result)
  );
  if (wroteOk) return false;
  return messages.some((m) => m.role === "assistant" && typeof m.content === "string" && FILE_SAVE_CLAIM.test(m.content));
}
function detectUnbackedTicketClaim(events, messages) {
  const filedOk = events.some(
    (e) => e.category === "tool" && isTicketWriteTool(e.label) && !e.isError && !isFailedToolResult(e.result)
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
function stallRecoveredInTrace(events) {
  let lastRecovery = -1;
  events.forEach((e, i) => {
    if (e.label === LOOP_STEP.recovery) lastRecovery = i;
  });
  return lastRecovery >= 0 && events.slice(lastRecovery + 1).some((e) => e.category === "tool");
}
function streamRetriesInTrace(events) {
  return events.filter((e) => e.label === "llm.stream_interrupted").map((e) => {
    const model = e.args?.model;
    return typeof model === "string" && model ? model : "unknown model";
  });
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
  const str3 = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return str3.length > n ? str3.slice(0, n) + `\u2026 (+${str3.length - n} chars)` : str3;
}
function isEvermindModel(model) {
  return /(^|\/)evermind\b|^project_evermind:|^tenant_model:/i.test(model);
}
function modelsUsedInTrace(events) {
  const seen = [];
  for (const ev of events) {
    if (ev.category !== "llm" && ev.category !== "error" && ev.label !== STOPPED_TURN_STEP) continue;
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
var MAX_REPORTED_ERRORS = 5;
var MAX_ERROR_CHARS = 240;
function errorMessageOf(e) {
  const r = e.result;
  let text;
  if (typeof r === "string") text = r;
  else if (r && typeof r === "object") {
    const o = r;
    text = typeof o.error === "string" && o.error ? o.error : typeof o.output === "string" && o.output ? o.output : JSON.stringify(r);
  } else text = String(r ?? "(no message)");
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_ERROR_CHARS ? `${flat.slice(0, MAX_ERROR_CHARS)}\u2026` : flat || "(no message)";
}
function byteLen(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length;
}
function computeBrainDiagnostics(events, requestedModel, messages = [], ctx = {}) {
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
  let pagedReadWindows = 0;
  let largestLossyResultBytes = 0;
  let largestToolResult = null;
  for (const ev of toolEvents) {
    const bytes = typeof ev.resultBytes === "number" ? ev.resultBytes : byteLen(ev.result);
    toolResultBytes += bytes;
    const paged = ev.label === READ_FILE_TOOL;
    if (ev.truncated) {
      if (paged) pagedReadWindows += 1;
      else truncatedToolResults += 1;
    }
    if (!paged && bytes > largestLossyResultBytes) largestLossyResultBytes = bytes;
    if (!largestToolResult || bytes > largestToolResult.bytes) largestToolResult = { label: ev.label, bytes };
  }
  const errorSteps = errors.slice(-MAX_REPORTED_ERRORS).reverse().map((e) => {
    const model = e.args?.model;
    return { label: e.label, message: errorMessageOf(e), ...typeof model === "string" && model !== "default" ? { model } : {} };
  });
  const modelsUsed = modelsUsedInTrace(events);
  const modelScores = modelScorecard(events);
  const modelTurns = modelTurnLog(events);
  const evermindUsed = modelsUsed.filter(isEvermindModel);
  const memoryAnswers = memoryAnswersInTrace(events);
  const recoveredToolEvents = toolEvents.filter((e) => e.recovered).length;
  const recoveredTurns = llm.filter((e) => e.recovered).length;
  const turnCoveragePartial = recoveredToolEvents > 0 && recoveredTurns === 0;
  const contextPressure = promptTokenPeak >= CONTEXT_PROMPT_PEAK || truncatedToolResults > 0 || downgradeEvents > 0 || largestLossyResultBytes >= LARGE_LOSSY_RESULT_BYTES;
  const contextConsequence = emptyOrLengthFinishes > 0 || downgradeEvents > 0 || loopExhausted || errors.some((e) => e.label === "llm.complete");
  const contextSignal = contextPressure && contextConsequence;
  const contextPressureOnly = contextPressure && !contextConsequence;
  const degradationSignal = evermindUsed.length > 0 && emptyOrLengthFinishes > 0 && (!tokensMeasured || promptTokenPeak < CONTEXT_PROMPT_PEAK) && truncatedToolResults === 0;
  const didWork = toolEvents.length > 0 || completionTokenTotal > 0 || llm.length > 0;
  const announcedUnmadeToolCall = detectAnnouncedButUnmadeToolCall(events, messages);
  const stallRecoveries = stallRecoveriesInTrace(events);
  const modelFailovers = modelFailoversInTrace(events);
  const stallUnrecovered = stallUnrecoveredInTrace(events);
  const stallRecovered = stallRecoveredInTrace(events);
  const streamRetries = streamRetriesInTrace(events);
  const exposure = toolExposureInTrace(events);
  const narratedUnadvertisedTools = narratedUnadvertisedInTrace(events);
  const noToolsAdvertised = exposure.min === 0 && toolEvents.length === 0;
  const memoryOnlyRun = memoryAnswers.length > 0 && llm.length === 0;
  const progress = computeRunProgress(events, messages);
  const noProgress = progress.spinning || progress.noEffect && !ctx.running;
  const staffing = staffingSummaryInTrace(events);
  const workFiledNotStaffed = staffing.verdict === "filed-not-staffed" || staffing.verdict === "staffing-refused";
  const healthy = errors.length === 0 && !loopExhausted && emptyOrLengthFinishes === 0 && !contextSignal && !announcedUnmadeToolCall && !noProgress && didWork;
  const likelyCause = memoryOnlyRun ? "memory-answered" : noToolsAdvertised ? "no-tools-advertised" : narratedUnadvertisedTools.length > 0 ? "tool-not-advertised" : announcedUnmadeToolCall ? "tool-calls-not-emitted" : noProgress ? "no-progress" : contextSignal && !degradationSignal ? "context-exhaustion" : degradationSignal && !contextSignal ? "model-degradation" : workFiledNotStaffed ? "work-filed-not-staffed" : healthy ? "healthy" : "inconclusive";
  return {
    turns: llm.length,
    toolCalls: toolEvents.length,
    errors: errors.length,
    errorSteps,
    loopExhausted,
    tokensMeasured,
    promptTokenPeak,
    completionTokenTotal,
    lastPromptTokens,
    toolResultBytes,
    truncatedToolResults,
    pagedReadWindows,
    largestToolResult,
    modelsUsed,
    modelScores,
    modelTurns,
    evermindUsed,
    downgradeEvents,
    emptyOrLengthFinishes,
    announcedUnmadeToolCall,
    stallRecoveries,
    modelFailovers,
    stallUnrecovered,
    stallRecovered,
    streamRetries,
    advertisedToolsLastTurn: exposure.lastTurn,
    advertisedToolsMin: exposure.min,
    catalogTools: exposure.catalog,
    narratedUnadvertisedTools,
    memoryAnswers,
    turnCoveragePartial,
    progress,
    contextPressureOnly,
    staffing,
    likelyCause
  };
}
var kb = formatBytes;
function contextEvidence(d) {
  const parts = [];
  if (d.promptTokenPeak >= CONTEXT_PROMPT_PEAK) parts.push(`the prompt peaked at ${d.promptTokenPeak.toLocaleString("en-US")} tokens`);
  if (d.truncatedToolResults > 0) parts.push(`${d.truncatedToolResults} tool result(s) were trimmed to the ${toolResultBudgetText()} tool-result budget (by design)`);
  if (d.downgradeEvents > 0) parts.push(`${d.downgradeEvents} turn(s) were served by a smaller model than asked`);
  if (parts.length === 0 && d.largestToolResult) parts.push(`one ${d.largestToolResult.label} result was ${kb(d.largestToolResult.bytes)}`);
  return parts.length ? parts.join("; ") : "context pressure without a single dominant signal";
}
function toolResultBudgetText() {
  return `${Math.round(MAX_TOOL_RESULT_CHARS / 1e3)} KB`;
}
function contextPressureLine(d) {
  if (!d.contextPressureOnly) return null;
  const parts = [];
  if (d.tokensMeasured && d.promptTokenPeak > 0) parts.push(`prompt peaked at ${d.promptTokenPeak.toLocaleString("en-US")} tokens`);
  if (d.truncatedToolResults > 0) parts.push(`${d.truncatedToolResults} tool result(s) trimmed to the ${toolResultBudgetText()} budget by design`);
  if (!parts.length && d.largestToolResult) parts.push(`one ${d.largestToolResult.label} result was ${kb(d.largestToolResult.bytes)}`);
  return `Context: pressure noted (${parts.join("; ")}) \u2014 no turn was cut short by it. The working transcript is held to a ${HISTORY_TOKEN_BUDGET.toLocaleString("en-US")}-token budget on purpose, so a prompt above that figure is the design working, not a fault.`;
}
function formatBrainDiagnostics(d) {
  const evermindAnswers = d.memoryAnswers?.filter((m) => m.source === "evermind") ?? [];
  const verdict = d.likelyCause === "memory-answered" ? `ANSWERED FROM MEMORY \u2014 no model ran this turn. The reply was served by the memory-first short-circuit (${(d.memoryAnswers ?? []).map((m) => m.source === "evermind" ? `the project Evermind SSM${m.projectId != null ? ` of project #${m.projectId}` : ""}${m.version != null ? ` v${m.version}` : ""}` : "the Q&A cache").join(", ")}), so zero turns, zero tokens and zero tool calls is EXPECTED, not a fault. ${evermindAnswers.length ? "The Evermind SSM cannot call tools and answers only from what it has learned, so it can neither fetch live data nor do work \u2014 if the reply was wrong, garbled or stale, that is the cause. Turn Memory off for this chat, or disable inference on that head." : "The reply is a replay of an earlier answer to the same question; ask a differently-worded question to reach the model."} Switching models changes nothing here.` : d.likelyCause === "no-tools-advertised" ? 'NO TOOLS ADVERTISED \u2014 at least one turn was handed ZERO tool definitions, so it could not have emitted a call whatever it wanted to do. This is a catalog/config failure on our side, not a model fault: the gateway MCP catalog (`/llm/v1/mcp/tools`) failed to load, or no actions were registered for this surface. See the "Tools available to the model" line in the Chat diagnostics block for the fetch error. Switching models will not help.' : d.likelyCause === "tool-not-advertised" ? `TOOL NOT ADVERTISED \u2014 a turn wrote out ${d.narratedUnadvertisedTools.map((n) => `\`${n}\``).join(", ")} as prose while that tool was NOT among the ones it was offered that turn. No model can emit a call for a function it was never given, so this is OUR per-turn tool selection dropping a tool the prompt asked for \u2014 not a model that "won't call tools". Fix the selection (pin the tool, or name it in the system prompt so it is force-included) rather than switching models.` : d.likelyCause === "tool-calls-not-emitted" ? 'TOOL CALLS NOT EMITTED \u2014 a turn NARRATED a tool call in prose ("I\'ll call the tool\u2026", a bare `builtin_\u2026` name) but the run recorded ZERO tool steps, so nothing executed and the answer never got its data. The tools WERE advertised and the agent loop only runs structured `tool_calls`, so this is a model/provider fault: the model is describing calls instead of emitting them. Try a different model.' : d.likelyCause === "no-progress" ? (d.progress && runProgressVerdict(d.progress)) ?? "NO PROGRESS \u2014 the run repeated work without advancing." : d.likelyCause === "context-exhaustion" ? `Likely CONTEXT EXHAUSTION (case A) \u2014 ${contextEvidence(d)}.` : d.likelyCause === "model-degradation" ? "Likely MODEL DEGRADATION (case B) \u2014 an Evermind/SSM turn returned empty while tokens stayed low." : d.likelyCause === "work-filed-not-staffed" ? workFiledNotStaffedVerdict(d.staffing) : d.likelyCause === "healthy" ? "No failure signal \u2014 no errors, no truncated or empty turns, and no context pressure. Nothing here needs triaging." : "Inconclusive \u2014 not enough signal to separate context exhaustion from model degradation.";
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
    `Tool results: ${kb(d.toolResultBytes)} total${d.largestToolResult ? ` \xB7 largest ${d.largestToolResult.label} (${kb(d.largestToolResult.bytes)})` : ""}${d.truncatedToolResults ? ` \xB7 ${d.truncatedToolResults} trimmed to the ${toolResultBudgetText()} per-result budget (by design)` : ""}${d.pagedReadWindows ? ` \xB7 ${d.pagedReadWindows} read_file window(s) paged (continued by offset, not lost)` : ""}`
  );
  const pressure = contextPressureLine(d);
  if (pressure) lines.push(pressure);
  lines.push(...d.progress ? formatRunProgress(d.progress) : []);
  lines.push(...d.staffing ? formatStaffingSummary(d.staffing) : []);
  if (d.errorSteps?.length) {
    for (const e of d.errorSteps) lines.push(`Failed step: ${e.label}${e.model ? ` on ${e.model}` : ""} \u2014 ${e.message}`);
    if (d.errors > d.errorSteps.length) lines.push(`(+${d.errors - d.errorSteps.length} earlier failure(s) not listed)`);
  }
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
      `Stall handling: ${d.stallRecoveries} re-prompt(s) \xB7 ${d.modelFailovers} model failover(s)${d.stallUnrecovered ? " \xB7 GAVE UP (the stall survived every attempt)" : d.stallRecovered ? " \xB7 recovered" : " \xB7 NOT recovered (no tool ran after the last re-prompt \u2014 the run ended on a turn the stall detector accepted as an answer)"}`
    );
  }
  if (d.streamRetries?.length) {
    lines.push(`Stream retries: ${d.streamRetries.length} \u2014 ${d.streamRetries.join(", ")} broke mid-turn and the turn was retried on another model (one retry per turn).`);
  }
  lines.push(...formatModelScorecard(d.modelScores ?? []));
  lines.push(...formatModelTurnLog(d.modelTurns ?? []));
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
  const { capturedAt, messages = [], chatId, chatTitle, agentLabel, configuredModel, surface, error, running, activity } = opts;
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
  if (running) lines.push(midRunNotice(activity, Date.parse(capturedAt)));
  lines.push("", ...formatBrainDiagnostics(computeBrainDiagnostics(events, configuredModel, messages, { running })));
  if (detectUnbackedWriteClaim(events, messages)) lines.push("", UNBACKED_WRITE_CLAIM_NOTICE);
  if (detectUnbackedTicketClaim(events, messages)) lines.push("", UNBACKED_TICKET_CLAIM_NOTICE);
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
      const who = m.role.toUpperCase();
      const model = m.role === "assistant" ? parseMessageProvenance(m)?.model : void 0;
      const stamp = model ? ` \xB7 ${model}` : "";
      lines.push(`[${m.createdAt ?? ""}] ${who}${stamp}: ${cap(m.content, 1500)}`);
    }
  }
  return lines.join("\n");
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

// src/runDriver.ts
var installed = null;
function installRunDriver(driver) {
  installed = driver;
}
function getRunDriver() {
  return installed;
}

// src/toolVocabulary.ts
var EQUIVALENCE_CLASSES = [
  // The work item itself. `ticket` is the product's word and `task` is the catalog's;
  // this one class is what makes every `tasks.*` tool reachable from a ticket question.
  ["task", "ticket", "issue", "story", "backlog", "todo"],
  // The board and its geography.
  ["kanban", "board", "lane", "swimlane", "column", "card"],
  // Source control.
  ["repo", "repository", "codebase", "git"],
  ["branch", "commit", "merge", "rebase"],
  ["pr", "pull", "pullrequest"],
  // People. `member` is the catalog's word; the rest are what users type.
  ["member", "teammate", "colleague", "people", "person", "staff"],
  // Conversations.
  ["chat", "conversation", "thread"],
  // Delivery planning. `epic` stays OUT of the objective class on purpose — see the
  // header: objectives/OKRs and epics are different entities with different tools.
  ["epic", "feature"],
  ["objective", "okr", "keyresult"],
  // Runs.
  ["execution", "run", "dispatch"]
];
var SYNONYMS = (() => {
  const map = /* @__PURE__ */ new Map();
  for (const group2 of EQUIVALENCE_CLASSES) {
    for (const term of group2) {
      const existing = map.get(term) ?? [];
      for (const other of group2) if (!existing.includes(other)) existing.push(other);
      map.set(term, existing);
    }
  }
  return map;
})();
function synonymsFor(stem2) {
  return SYNONYMS.get(stem2) ?? [];
}
function expandWithSynonyms(stems) {
  const expanded = /* @__PURE__ */ new Set();
  for (const stem2 of stems) {
    for (const synonym of synonymsFor(stem2)) {
      if (!stems.has(synonym)) expanded.add(synonym);
    }
  }
  return expanded;
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
var NAME_HIT = 10;
var NAME_SYNONYM_HIT = 7;
var DESCRIPTION_HIT = 1;
function scoreTool(tool, queryStems, synonymStems) {
  const name = (tool.function?.name ?? "").toLowerCase();
  const description = (tool.function?.description ?? "").toLowerCase();
  if (!name) return 0;
  let score2 = 0;
  const nameStems = new Set(tokenize(name).map(stem));
  for (const s of nameStems) {
    if (queryStems.has(s)) score2 += NAME_HIT;
    else if (synonymStems.has(s)) score2 += NAME_SYNONYM_HIT;
  }
  const descStems = new Set(tokenize(description).map(stem));
  for (const s of descStems) {
    if (queryStems.has(s) || synonymStems.has(s)) score2 += DESCRIPTION_HIT;
  }
  return score2;
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
  const synonymStems = expandWithSynonyms(queryStems);
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
  const scored = tools.map((tool, index) => ({ tool, index, score: scoreTool(tool, queryStems, synonymStems) })).filter((e) => e.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  for (const entry of scored) {
    if (chosen.length >= limit) break;
    take(entry.tool);
  }
  for (const tool of tools) {
    if (chosen.length >= limit) break;
    take(tool);
  }
  const position = new Map(tools.map((t, i) => [t, i]));
  chosen.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
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
    let score2 = 0;
    for (const t of terms) {
      if (haystackName.includes(t)) score2 += 10;
      else if (haystackDesc.includes(t)) score2 += 1;
    }
    if (score2 > 0) scored.push({ m: { name, description }, score: score2, index });
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
  return { dispatch: { name: target, args: asToolArgs(a.args) ?? {} } };
}

// src/lastResolvedModel.ts
var MAX_CHATS = 64;
var byChat = /* @__PURE__ */ new Map();
function setLastResolvedModel(chatId, model) {
  const trimmed = typeof model === "string" ? model.trim() : "";
  if (!trimmed) return;
  byChat.delete(chatId);
  byChat.set(chatId, trimmed);
  if (byChat.size > MAX_CHATS) {
    const oldest = byChat.keys().next();
    if (!oldest.done) byChat.delete(oldest.value);
  }
}
function getLastResolvedModel(chatId) {
  return byChat.get(chatId);
}
function forgetResolvedModels() {
  byChat.clear();
}
var CURRENT_MODEL_TOOLS = /* @__PURE__ */ new Set(["session.current_model", "builtin_session_current_model"]);
function withObservedModel(chatId, tool, args) {
  if (!CURRENT_MODEL_TOOLS.has(tool)) return args;
  const observed = getLastResolvedModel(chatId);
  if (!observed) return args;
  const supplied = args ?? {};
  if (typeof supplied.model === "string" && supplied.model.trim()) return args;
  return { ...supplied, model: observed };
}

// src/runOutcomeReport.ts
function runOutcomeId(chatId, startedAtMs) {
  return `ide:${chatId}:${startedAtMs}`;
}
function codeRunOutcome(args) {
  if (args.aborted || !args.codeChanged || !args.codeModel || !args.runId) return null;
  return {
    clientRunId: args.runId,
    model: args.codeModel,
    role: "code",
    source: "ide",
    terminalStatus: args.failed ? "failed" : "completed",
    merged: args.shipped,
    steps: args.trace.filter((e) => e.label === "llm.complete" && !e.isError).length,
    ...args.projectId != null ? { projectId: args.projectId } : {}
  };
}

// src/shipVerification.ts
var BASE_BRANCHES = /* @__PURE__ */ new Set(["main", "master"]);
function parseGitShortStatus(output) {
  if (!output) return null;
  const header = output.split("\n").map((l) => l.trim()).find((l) => l.startsWith("##"));
  if (!header) return null;
  const body = header.slice(2).trim();
  if (!body || body.startsWith("HEAD (no branch)")) return { branch: null, upstream: null, ahead: 0, behind: 0 };
  const ahead = /\bahead (\d+)/.exec(body);
  const behind = /\bbehind (\d+)/.exec(body);
  const names = body.replace(/\s*\[.*$/, "").trim();
  const [branch, upstream] = names.split("...");
  return {
    branch: branch?.trim() || null,
    upstream: upstream?.trim() || null,
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0
  };
}
function gitCommandPattern(verbs) {
  return new RegExp(`\\bgit\\s+(?:-[Cc]\\s+\\S+\\s+|-\\S+\\s+|--\\S+(?:=\\S+)?\\s+)*(?:${verbs})\\b`, "i");
}
var GIT_PUSH = gitCommandPattern("push");
var GIT_STATUS_CMD = gitCommandPattern("status");
function commandOf(ev) {
  const a = ev.args;
  if (typeof a?.command === "string") return a.command;
  if (typeof a?.cmd === "string") return a.cmd;
  return "";
}
function outputOf(ev) {
  const r = ev.result;
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    const o = r;
    if (typeof o.output === "string") return o.output;
    if (typeof o.stdout === "string") return o.stdout;
  }
  return "";
}
function succeeded(ev) {
  return !ev.isError && !isFailedToolResult(ev.result);
}
function isPush(ev) {
  return ev.label === "git_push" || GIT_PUSH.test(commandOf(ev));
}
function dirtyPathsOf(output) {
  const out = [];
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.length < 4 || line.startsWith("##")) continue;
    let path = line.slice(3);
    const arrow = path.indexOf(" -> ");
    if (arrow >= 0) path = path.slice(arrow + 4);
    path = path.trim().replace(/^"(.*)"$/, "$1");
    if (path) out.push(path);
  }
  return out;
}
function touchedStillDirty(touched, dirty) {
  const norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const d = dirty.map(norm);
  return touched.map(norm).some((t) => d.some((p) => t === p || t.endsWith(`/${p}`)));
}
function shippedToBaseBranch(events, opts) {
  const steps = events.filter((e) => e.category === "tool");
  let pushedAt = -1;
  for (let i = 0; i < steps.length; i += 1) {
    if (succeeded(steps[i]) && isPush(steps[i])) pushedAt = i;
  }
  if (pushedAt < 0) return false;
  const touched = opts?.touchedFiles ?? [];
  for (let i = pushedAt; i < steps.length; i += 1) {
    const ev = steps[i];
    if (!succeeded(ev)) continue;
    const isStatus = i === pushedAt || ev.label === "git_status" || GIT_STATUS_CMD.test(commandOf(ev));
    if (!isStatus) continue;
    const output = outputOf(ev);
    const status2 = parseGitShortStatus(output);
    if (!status2) continue;
    if (!(status2.branch && BASE_BRANCHES.has(status2.branch) && status2.upstream && status2.ahead === 0)) continue;
    if (touched.length > 0 && touchedStillDirty(touched, dirtyPathsOf(output))) continue;
    return true;
  }
  return false;
}

// src/selfReviewShip.ts
function selfReviewShipDirective(chatId) {
  return 'SHIP YOUR OWN CHANGE \u2014 in this session YOU are its reviewer. This is a local editor session: no other agent or reviewer can ever reach a change you leave in the working tree, so a ticket you leave "in_review" sits at 75% on the board forever. When your turn changes code, finish it in this order:\n1. VERIFY \u2014 run the type-check / tests / build that cover what you touched (`run_command`) and fix whatever fails.\n2. SELF-REVIEW \u2014 read your own diff with `git_diff` against what the ticket and the user asked for: bugs, leftover debug code, edits unrelated to the task, missing tests or localisation. If you find a problem, FIX it and review again. Then record the pass with builtin_reviews_record (taskId = the ticket tracking this change \u2014 builtin_chats_list_tickets with chatId=' + chatId + ' lists it; verdict "complete"; a one-paragraph summary of what you checked).\n3. SHIP \u2014 `git_commit` with allowBaseBranch:true and exactly the `paths` you changed (never a catch-all: the tree may hold the human\'s own work), then `git_push` with allowBaseBranch:true. Both are shown to the human for approval \u2014 that approval is their review of your review, so do not ask for it in prose as well.\n4. CLOSE \u2014 the push reports the branch it landed on. Once it lands on the base branch with nothing left to push, the in_review ticket this chat opened for the change moves to done automatically. Move any OTHER linked ticket this change fully delivers to done yourself with builtin_tasks_update. Report the commit hash and the push result.\nExceptions, and only these: if the user asked for a pull request or a ticket branch, commit on a `branch` and `open_pull_request` instead (the ticket then closes when that PR merges); if the user said not to commit or push, leave the change uncommitted and say so. If a commit or push is refused or fails, report the exact error \u2014 never claim a change shipped when it did not.';
}
var PUBLISH_TOOLS = /* @__PURE__ */ new Set(["git_commit", "git_push", "open_pull_request"]);
var RAW_PUBLISH = gitCommandPattern("commit|push");
function attemptedPublish(events) {
  return events.some(
    (e) => e.category === "tool" && (PUBLISH_TOOLS.has(e.label) || RAW_PUBLISH.test(commandOf(e)))
  );
}
var DECLINES_SHIPPING = /\b(?:don'?t|do not|never|without)\s+(?:commit|push|ship|merg)\w*|\b(?:no|skip)\s+(?:commit|push)\w*|\b(?:leave|keep)\s+(?:it|them|this|the\s+(?:change|changes|edits?))\s+(?:uncommitted|unstaged|local(?:ly)?)\b/i;
function declinesShipping(text) {
  return DECLINES_SHIPPING.test(text ?? "");
}
function leftChangeUnshipped(input) {
  return input.codeChanged && canShipHere(input.toolNames) && asksForChange(input.requestText) && !declinesShipping(input.requestText) && !attemptedPublish(input.events);
}
function unshippedChangeNudge() {
  return 'You changed code in this run and ended the turn without shipping it. In this local session you are the reviewer \u2014 no one else can pick the change up, so leaving it uncommitted parks its ticket in review forever. Finish it now: verify it (`run_command` for the type-check / tests that cover it), self-review your diff with `git_diff` and record builtin_reviews_record (verdict "complete") on the ticket tracking it, then `git_commit` (allowBaseBranch:true, exactly the paths you changed) and `git_push` (allowBaseBranch:true). If the user asked for a pull request, commit on a `branch` and `open_pull_request` instead. If you genuinely cannot ship \u2014 the change is unfinished, or verification fails and you cannot fix it \u2014 say so plainly at the TOP of your answer and name exactly what is left.';
}

// src/composingActivity.ts
function utf8ByteLength(text) {
  if (!text) return 0;
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
  }
  return bytes;
}
function toolCallArgBytes(calls) {
  let total = 0;
  for (const c of calls) total += utf8ByteLength(c.args ?? "");
  return total;
}
function createComposingActivity(sink, opts) {
  const now = opts.now ?? Date.now;
  let names = /* @__PURE__ */ new Map();
  let bytes = 0;
  let startedAt = null;
  let published;
  const publish = (label, immediate) => {
    sink.set({
      phase: "composing",
      startedAt,
      step: opts.step,
      bytes,
      ...label ? { label } : {}
    });
    published = label;
    if (immediate) sink.repaint();
    else sink.coalescedRepaint();
  };
  return {
    onDelta(index, partial) {
      if (partial.name) names.set(index, partial.name);
      bytes += utf8ByteLength(partial.argsFragment ?? "");
      const label = names.get(index) ?? published;
      if (startedAt === null) {
        startedAt = now();
        publish(label, true);
        return;
      }
      publish(label, !published && !!label);
    },
    bytes() {
      return bytes;
    },
    reset() {
      names = /* @__PURE__ */ new Map();
      bytes = 0;
      startedAt = null;
      published = void 0;
    }
  };
}

// src/repeatedFailure.ts
var FAILURE_NUDGE_AT = 2;
var FAILURE_HARD_AT = 3;
var FailureTally = class _FailureTally {
  failures = /* @__PURE__ */ new Map();
  static key(tool, args) {
    return `${tool}:${stableStringify(args ?? {})}`;
  }
  /** Record a FAILED call. Returns how many times this exact call has now failed,
   *  including this one. */
  record(tool, args) {
    const key = _FailureTally.key(tool, args);
    const attempts = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, attempts);
    return attempts;
  }
  /** This exact call SUCCEEDED. Its earlier failures were transient after all, so they
   *  are no longer evidence of anything — a later failure starts counting from one. */
  clear(tool, args) {
    this.failures.delete(_FailureTally.key(tool, args));
  }
};
function failureReason(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return void 0;
  const error = result.error;
  return typeof error === "string" && error.trim() ? error.trim().slice(0, 400) : void 0;
}
function repeatedFailureAdvisory(tool, attempts, reason) {
  if (attempts < FAILURE_NUDGE_AT) return null;
  const got = reason ? ` Both times it answered: "${reason}".` : "";
  if (attempts >= FAILURE_HARD_AT) {
    const said = reason ? ` It has answered "${reason}" every time.` : "";
    return `STOP CALLING \`${tool}\` WITH THESE ARGUMENTS. This is failure ${attempts} of the identical call in this run.${said} The arguments are the problem, not the timing \u2014 repeating them will fail again and will spend the rest of this run's tool budget. Do ONE of these now: (a) re-read the error above and change the argument it names (a failing tool usually says exactly what to pass instead \u2014 a scope, a path, an id \u2014 so pass it); (b) reach the same goal with a different tool; (c) stop and tell the user plainly what is blocking you and what you need from them. Do not issue this call again.`;
  }
  return `\`${tool}\` has now failed ${attempts} times in this run with these exact arguments.${got} Another identical attempt will not behave differently \u2014 this is not a flake. Read the error above and change what it names (most failures state the argument to pass instead), use a different tool to reach the same goal, or say plainly what is blocking you. Do not simply repeat the call.`;
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

// ../packages/agent-tools/src/modelRoles.ts
var MODEL_ROLES = ["plan", "code", "verify", "explore", "chat", "utility"];
var MODEL_ROLE_DESCRIPTIONS = {
  plan: "Deciding an approach or breaking work down \u2014 no code written yet.",
  code: "Writing or editing code. Default when the delegated work is itself an edit.",
  verify: "Checking work already done \u2014 reading test/build output, reviewing a diff.",
  explore: "Read-only investigation \u2014 locating, searching, summarising. Default when `read_only` is left true.",
  chat: "A conversational answer with no task-shaped work behind it.",
  utility: "Small, mechanical, low-stakes work \u2014 formatting, extraction, a lookup."
};
var ROLE_SET = new Set(MODEL_ROLES);
function isModelRole(value) {
  return typeof value === "string" && ROLE_SET.has(value);
}
function delegationRole(raw, readOnly) {
  return isModelRole(raw) ? raw : readOnly ? "explore" : "code";
}

// ../packages/agent-tools/src/tool.ts
function defineTool(def) {
  return {
    name: def.name,
    requires: def.requires ?? [],
    schema: {
      type: "function",
      function: { name: def.name, description: def.description, parameters: def.parameters }
    },
    execute: def.execute
  };
}

// ../packages/agent-tools/src/toolAliases.ts
var TOOL_NAME_ALIASES = {
  list_dir: "list_files",
  listdir: "list_files",
  list_directory: "list_files",
  list_directories: "list_files",
  ls_dir: "list_files",
  // Shell / terminal
  bash: "run_command",
  shell: "run_command",
  run_terminal_cmd: "run_command",
  execute_command: "run_command",
  run_shell_command: "run_command",
  // Search
  grep: "search_code",
  codebase_search: "search_code",
  search_files: "search_code",
  find_files: "list_files",
  glob_file_search: "list_files",
  // Edit / write
  str_replace: "edit_file",
  search_replace: "edit_file",
  apply_patch: "edit_file",
  write_to_file: "write_file",
  create_file: "write_file",
  delete: "delete_file"
};
function resolveToolAlias(name) {
  const key = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[key] ?? name;
}

// ../packages/agent-tools/src/git-tools.ts
function safeGitArg(v) {
  return typeof v === "string" && /^[\w./@-]+$/.test(v) ? v : null;
}
function safeRepoArg(repo) {
  const arg = safeGitArg(repo);
  return arg && !arg.split(/[\\/]/).includes("..") && !arg.startsWith("/") ? arg : null;
}
function repoScopedScript(script, repo) {
  const dir = safeRepoArg(repo);
  return dir ? `cd "${dir}" || exit 1
${script}` : script;
}
function notARepoResult(action) {
  return {
    data: {
      ok: false,
      action,
      error: `not a git repository at the workspace root \u2014 this usually means the open folder CONTAINS the repositories rather than being one (several checkouts side by side). Do not conclude git is unavailable: call \`list_files\` to see the top-level directories, then re-run this tool with \`repo\` set to the one holding the code you are working on (e.g. { "repo": "my-project" }). If none of them is a checkout, say so plainly \u2014 file edits still work, only the git tools need a repository.`
    }
  };
}
var RESOLVE_BASE = `BASE="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"; [ -n "$BASE" ] || BASE=main`;
function buildGitCommand(action, opts) {
  const path = safeGitArg(opts?.path);
  const pathArg = path ? ` -- "${path}"` : "";
  const repo = safeRepoArg(opts?.repo);
  const scoped = (cmd) => repo ? `cd "${repo}" && ${cmd}` : cmd;
  const scopedScript = (lines) => repoScopedScript(lines.join("\n"), opts?.repo);
  switch (action) {
    case "status":
      return scoped("git status --short --branch");
    case "diff":
      return scoped(`git --no-pager diff${pathArg}`);
    case "history": {
      const limit = Number.isFinite(opts?.limit) && opts.limit > 0 ? Math.min(Math.floor(opts.limit), 200) : 30;
      return scoped(`git --no-pager log --oneline -n ${limit}${pathArg}`);
    }
    case "sync_latest": {
      const base = safeGitArg(opts?.baseBranch);
      const resolveBase = base ? `BASE="${base}"` : RESOLVE_BASE;
      return scopedScript([
        "set -e",
        resolveBase,
        'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
        'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
        'git fetch origin "$BASE"',
        'git merge --no-edit "origin/$BASE" || { git merge --abort; echo MERGE_CONFLICT; exit 3; }',
        'echo "Synced with origin/$BASE"'
      ]);
    }
    case "undo":
      return scopedScript([
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        "git reset --hard HEAD~1",
        'echo "Undid the last commit (use git_redo to reapply)"'
      ]);
    case "redo":
      return scopedScript([
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        'git reset --hard "HEAD@{1}"',
        'echo "Reapplied the last undone change"'
      ]);
  }
}
function gitToolResult(action, r) {
  const out = (r.stdout ?? "").trim();
  if (r.exitCode === 3 || /MERGE_CONFLICT/.test(out)) {
    return { data: { ok: false, action, error: "merge conflict \u2014 the base branch has changes that conflict with your branch; the merge was aborted (working tree is clean). Resolve by editing the conflicting files, or ask a human.", output: out } };
  }
  if (r.exitCode === 4 || /\bDIRTY\b/.test(out)) {
    return { data: { ok: false, action, error: "you have uncommitted changes \u2014 commit or discard them before git_" + action + " (it refuses to discard uncommitted work)." } };
  }
  return { data: { ok: r.ok, action, output: out.slice(0, 2e4), ...r.error ? { error: r.error } : {} } };
}
var NOT_A_REPO = /not a git repository/i;
function isNotARepo(r) {
  return NOT_A_REPO.test(`${r.stdout ?? ""} ${r.error ?? ""}`);
}
async function runGitTool(action, opts, ctx) {
  const r = await ctx.caps.shell.run(buildGitCommand(action, opts));
  if (isNotARepo(r) && !opts.repo) return notARepoResult(action);
  const result = gitToolResult(action, r);
  if (opts.repo && result.data.ok) {
    result.data.repo = opts.repo;
  }
  return result;
}
var REPO_PARAM = {
  type: "string",
  description: 'Optional subdirectory holding the repository, when the open folder CONTAINS checkouts rather than being one (e.g. "my-project"). Omit when the workspace root is itself the repo.'
};
var gitStatusTool = defineTool({
  name: "git_status",
  description: "Show the current branch and any uncommitted changes (git status). Use it to see what you have modified before committing, syncing, or finishing. If the open folder contains several checkouts rather than being one repo, pass `repo` to name the one you mean.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("status", { repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitDiffTool = defineTool({
  name: "git_diff",
  description: "Show the uncommitted diff of your working tree (optionally for one path). Use it to review exactly what you changed before finishing.",
  parameters: { type: "object", properties: { path: { type: "string", description: "Optional repo-relative file/dir to scope the diff to." }, repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("diff", { path: typeof args.path === "string" ? args.path : void 0, repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitHistoryTool = defineTool({
  name: "git_history",
  description: "Show recent commit history (git log --oneline), optionally scoped to a path. Use it to understand how a file evolved before changing it.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional repo-relative file/dir to scope history to." },
      limit: { type: "number", description: "Max commits to return (default 30, max 200)." },
      repo: REPO_PARAM
    }
  },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("history", { path: typeof args.path === "string" ? args.path : void 0, limit: typeof args.limit === "number" ? args.limit : void 0, repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitSyncLatestTool = defineTool({
  name: "git_sync_latest",
  description: "Fetch the latest base branch (e.g. main) and merge it into your working branch so you are NOT building on stale code. Run this FIRST, before editing \u2014 a branch created earlier can be far behind main, so its build fails against old dependencies and its pull request would revert newer work. On a merge conflict it safely aborts and tells you which to resolve.",
  parameters: { type: "object", properties: { baseBranch: { type: "string", description: "Base branch to sync from. Defaults to the remote's default branch (usually main)." }, repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("sync_latest", { baseBranch: typeof args.baseBranch === "string" ? args.baseBranch : void 0, repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitUndoTool = defineTool({
  name: "git_undo",
  description: "Undo your most recent commit (keeps the change recoverable \u2014 use git_redo to reapply). Refuses if you have uncommitted changes, so it can never discard unsaved work. Use it to back out a change that was wrong.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("undo", { repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
var gitRedoTool = defineTool({
  name: "git_redo",
  description: "Reapply the change you most recently undid with git_undo (reflog redo). Refuses if you have uncommitted changes.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("redo", { repo: typeof args.repo === "string" ? args.repo : void 0 }, ctx)
});
function shellQuote(v) {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}
function commitPathCandidates(path, repo) {
  const out = [path];
  const dir = safeRepoArg(repo);
  if (dir) {
    const prefix = `${dir.replace(/\/+$/, "")}/`;
    if (path.startsWith(prefix)) out.push(path.slice(prefix.length));
    const leaf = dir.split("/").filter(Boolean).pop();
    if (leaf && path.startsWith(`${leaf}/`)) out.push(path.slice(leaf.length + 1));
  }
  return [...new Set(out)].filter((p) => p.trim() !== "");
}
function buildCommitCommand(opts) {
  const branch = safeGitArg(opts.branch);
  const resolveLines = opts.paths.map((p, i) => {
    const candidates = commitPathCandidates(p, opts.repo).map(shellQuote).join(" ");
    return `P${i}="$(pick ${candidates})" || MISSING="$MISSING ${shellQuote(p).slice(1, -1)}"`;
  });
  const paths = opts.paths.map((_, i) => `"$P${i}"`).join(" ");
  return [
    "set -e",
    RESOLVE_BASE,
    'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
    'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    // A ticket branch was named: switch to it, creating it if new. Otherwise the base
    // branch is refused — unless the caller DECLARED it, the same declared act `git_push`
    // takes. Without that declaration "commit and push to main" had no reachable path at
    // all: push accepted `allowBaseBranch`, but the commit before it could never land on
    // main, so an explicit human instruction ended in a refusal every time.
    ...branch ? [`git rev-parse --verify --quiet "${branch}" >/dev/null && git checkout "${branch}" || git checkout -b "${branch}"`] : opts.allowBaseBranch ? [] : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }'],
    // A path is "there" if it is on disk OR tracked by git — the second arm is what
    // lets a DELETION be committed, since the file is gone by definition.
    'pick() { for c in "$@"; do if [ -e "$c" ] || git ls-files --error-unmatch -- "$c" >/dev/null 2>&1; then printf %s "$c"; return 0; fi; done; return 1; }',
    'MISSING=""',
    ...resolveLines,
    '[ -z "$MISSING" ] || { echo "MISSING_PATHS:$MISSING"; exit 8; }',
    `git add -- ${paths}`,
    // Nothing staged is a fact, not a failure — say which rather than exiting 1 with
    // git's own "nothing to commit" that reads like a broken tool.
    "git diff --cached --quiet && { echo NOTHING_STAGED; exit 6; }",
    `git commit -m ${shellQuote(opts.message)}`,
    'echo "Committed on $(git rev-parse --abbrev-ref HEAD): $(git rev-parse --short HEAD)"'
  ].join("\n");
}
function buildPushCommand(opts) {
  return [
    "set -e",
    RESOLVE_BASE,
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    ...opts.allowBaseBranch ? [] : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }'],
    // `-u` so a brand-new ticket branch gets its upstream on the first push.
    'git push -u origin "$CUR"',
    'echo "Pushed $CUR to origin"',
    // Report where the push LANDED — the branch header (`## main...origin/main`, with any
    // `[ahead N]` still owed) plus whatever is still uncommitted. That is the evidence a
    // host needs to call the change shipped, so the push verifies itself rather than
    // depending on the agent remembering a separate status call. Never fails the push.
    "git status --short --branch 2>/dev/null || true"
  ].join("\n");
}
function buildPullRequestCommand(opts) {
  const base = safeGitArg(opts.base);
  const reviewers = (opts.reviewers ?? []).map((r) => safeGitArg(r)).filter((r) => !!r);
  return [
    "set -e",
    "command -v gh >/dev/null 2>&1 || { echo NO_GH_CLI; exit 7; }",
    ...base ? [`BASE="${base}"`] : [RESOLVE_BASE],
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    '[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }',
    // Push first when the branch has no upstream — `gh pr create` fails on an unpushed
    // head, and "open a PR" plainly means the branch has to exist on the remote.
    'git rev-parse --abbrev-ref "@{upstream}" >/dev/null 2>&1 || git push -u origin "$CUR"',
    `gh pr create --base "$BASE" --head "$CUR" --title ${shellQuote(opts.title)} --body ${shellQuote(opts.body)}` + reviewers.map((r) => ` --reviewer "${r}"`).join("")
  ].join("\n");
}
function buildCleanupCommand(opts) {
  const branch = safeGitArg(opts.branch);
  const base = safeGitArg(opts.baseBranch);
  return [
    "set -e",
    ...base ? [`BASE="${base}"`] : [RESOLVE_BASE],
    ...branch ? [`TARGET="${branch}"`] : ['TARGET="$(git rev-parse --abbrev-ref HEAD)"'],
    '[ "$TARGET" != "$BASE" ] || { echo NOTHING_TO_CLEAN; exit 9; }',
    '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
    'git rev-parse --verify --quiet "$TARGET" >/dev/null || { echo NO_SUCH_BRANCH; exit 11; }',
    // Was this branch ever pushed? Read BEFORE the prune, which is what removes the
    // evidence — a branch that had an upstream and no longer exists on the remote was
    // merged and deleted by the host, however it was merged.
    'HAD_UPSTREAM=0; git rev-parse --verify --quiet "refs/remotes/origin/$TARGET" >/dev/null && HAD_UPSTREAM=1',
    "git fetch --prune origin",
    'REMOTE_EXISTS=0; git ls-remote --exit-code --heads origin "$TARGET" >/dev/null 2>&1 && REMOTE_EXISTS=1',
    // Get onto the base branch and bring it up to date — the state the user expects to
    // be left in. `--ff-only` so a divergent local base is reported, never merged.
    'git checkout "$BASE"',
    'git merge --ff-only "origin/$BASE" >/dev/null 2>&1 || echo "note: local $BASE has diverged from origin/$BASE and was left alone"',
    'MERGED=0; git branch --merged "origin/$BASE" | sed "s/^[* ] *//" | grep -qx "$TARGET" && MERGED=1',
    // Squash-merged: the commits are in the base under a new hash, so `--merged` says
    // no, but the host deleted the remote branch when the PR landed.
    '[ "$MERGED" = 1 ] || { [ "$HAD_UPSTREAM" = 1 ] && [ "$REMOTE_EXISTS" = 0 ] && MERGED=1; } || true',
    ...opts.force ? ["MERGED=1"] : [],
    '[ "$MERGED" = 1 ] || { echo NOT_MERGED; exit 10; }',
    // `-D`, not `-d`: the merged-ness check above is STRICTER than git's own (it also
    // accepts the squash-merge case git cannot see), so `-d` would refuse exactly the
    // branches this tool exists to remove. Nothing reaches this line unmerged.
    'git branch -D "$TARGET"',
    // The remote branch is usually ALREADY gone (the host deletes it on merge). That is
    // the goal state, not an error, so it is only pushed when it is actually there.
    '[ "$REMOTE_EXISTS" = 0 ] || git push origin --delete "$TARGET"',
    "git remote prune origin >/dev/null 2>&1 || true",
    'echo "Cleaned up $TARGET \u2014 on $BASE (updated), branch deleted locally and on origin"'
  ].join("\n");
}
function publishToolResult(action, r) {
  const out = (r.stdout ?? "").trim();
  const fail = (error) => ({ data: { ok: false, action, error, output: out } });
  if (r.exitCode === 5 || /\bON_BASE_BRANCH\b/.test(out)) {
    return fail(
      action === "push" ? "you are on the BASE branch (main/master) and `allowBaseBranch` was not set \u2014 pushing here bypasses pull-request review. Open a pull request instead (git_commit with a `branch`, then open_pull_request). If the human has explicitly asked you to push the base branch, or your session instructions make you the reviewer of your own change and you have self-reviewed it, re-call with allowBaseBranch:true; they will be prompted to approve it." : "you are on the BASE branch (main/master) and `allowBaseBranch` was not set \u2014 committing here bypasses pull-request review. Pass `branch` to git_commit to work on a ticket branch (it is created for you), then open_pull_request. If the human has explicitly asked you to commit to the base branch directly, or your session instructions make you the reviewer of your own change and you have self-reviewed it, re-call with allowBaseBranch:true; they will be prompted to approve it."
    );
  }
  if (r.exitCode === 6 || /\bNOTHING_STAGED\b/.test(out)) {
    return fail("none of the named paths have uncommitted changes \u2014 nothing was committed. Run git_status to see what actually differs; do not report a commit that did not happen.");
  }
  const missing = /MISSING_PATHS:([^\n]*)/.exec(out);
  if (r.exitCode === 8 || missing) {
    const named = (missing?.[1] ?? "").trim();
    return fail(
      `these paths do not exist in the repository, so nothing was committed:${named ? ` ${named}` : ""}. \`paths\` are relative to the REPOSITORY root \u2014 when you pass \`repo\`, that means relative to the repo directory, NOT to the workspace root your file tools use. Run git_status (with the same \`repo\`) and copy the paths it prints.`
    );
  }
  if (r.exitCode === 9 || /\bNOTHING_TO_CLEAN\b/.test(out)) {
    return fail("you are already on the base branch and no ticket branch was named \u2014 there is nothing to clean up. Pass `branch` to name the merged branch to delete.");
  }
  if (r.exitCode === 10 || /\bNOT_MERGED\b/.test(out)) {
    return fail(
      "that branch's commits are NOT in the base branch, so it was left alone \u2014 deleting it would destroy unmerged work. If the pull request was SQUASH-merged (the commits are in main under a new hash and the remote branch still exists), re-call with force:true to delete it anyway."
    );
  }
  if (r.exitCode === 11 || /\bNO_SUCH_BRANCH\b/.test(out)) {
    return fail("no local branch by that name \u2014 it has already been deleted. Nothing to do.");
  }
  if (r.exitCode === 4 || /\bDIRTY\b/.test(out)) {
    return fail("you have uncommitted changes \u2014 commit or discard them before cleaning up (this refuses to discard uncommitted work).");
  }
  if (r.exitCode === 7 || /\bNO_GH_CLI\b/.test(out)) {
    return fail("the GitHub CLI (`gh`) is not installed or not on PATH, so a pull request cannot be opened from here. The branch is committed and pushed; tell the human to open the PR, and give them the branch name.");
  }
  return { data: { ok: r.ok, action, output: out.slice(0, 2e4), ...r.error ? { error: r.error } : {} } };
}
async function runPublishTool(action, command, repo, ctx) {
  const scoped = repoScopedScript(command, repo);
  const r = await ctx.caps.shell.run(scoped);
  if (isNotARepo(r) && !repo) return notARepoResult(action);
  const result = publishToolResult(action, r);
  if (repo && result.data.ok) result.data.repo = repo;
  return result;
}
var gitCommitTool = defineTool({
  name: "git_commit",
  description: "Commit the files you changed. You must list the exact `paths` to commit \u2014 the working tree is shared with the human using it, so committing everything would sweep up their unrelated in-flight work; run git_status/git_diff first if you are unsure what you touched. The DEFAULT route is a TICKET BRANCH: pass `branch` to name it (created for you if it does not exist), then use open_pull_request so the work is reviewed. Without `branch`, a commit is refused while you are on the base branch (main/master) \u2014 unless the human has EXPLICITLY asked you to commit to main directly, or your session instructions make you the reviewer of your own change (a local editor session, after you have verified and self-reviewed it); then pass allowBaseBranch:true (the human is prompted to approve it) and follow with git_push allowBaseBranch:true.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message. One line saying what changed and why." },
      paths: { type: "array", items: { type: "string" }, description: "Repo-relative paths to commit. Exactly the files YOU changed \u2014 never a catch-all." },
      branch: { type: "string", description: 'Ticket branch to commit on, created if new (e.g. "ticket/2394-mobile-board-height"). The default route; required when on the base branch unless allowBaseBranch is set.' },
      allowBaseBranch: { type: "boolean", description: "Set ONLY when the human explicitly asked to commit to the base branch (main/master) directly. Default false, which refuses on the base branch and tells you to use a ticket branch." },
      repo: REPO_PARAM
    },
    required: ["message", "paths"]
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) return Promise.resolve({ data: { ok: false, action: "commit", error: "message is required" } });
    const paths = Array.isArray(args.paths) ? args.paths.filter((p) => typeof p === "string" && p.trim() !== "") : [];
    if (paths.length === 0) {
      return Promise.resolve({ data: { ok: false, action: "commit", error: "paths is required \u2014 list the exact files you changed. Run git_status to see them. Do not pass '.' or '-A': the working tree may hold changes that are not yours." } });
    }
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    return runPublishTool(
      "commit",
      buildCommitCommand({ message, paths, branch: typeof args.branch === "string" ? args.branch : void 0, allowBaseBranch: args.allowBaseBranch === true, repo }),
      repo,
      ctx
    );
  }
});
var gitPushTool = defineTool({
  name: "git_push",
  description: "Push the current branch to origin (setting its upstream on the first push), then report where it landed (`git status --short --branch`). Pushing the BASE branch (main/master) is refused unless you pass allowBaseBranch \u2014 that path skips pull-request review, so only set it when the human has explicitly asked for it, or when your session instructions make you the reviewer of your own change (a local editor session, after verifying and self-reviewing it); the human is prompted to approve it either way. Otherwise the route is a ticket branch: git_commit with a `branch`, git_push, then open_pull_request.",
  parameters: {
    type: "object",
    properties: {
      allowBaseBranch: { type: "boolean", description: "Set ONLY when the human explicitly asked to push the base branch directly. Default false, which refuses and tells you to open a pull request." },
      repo: REPO_PARAM
    }
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    return runPublishTool("push", buildPushCommand({ allowBaseBranch: args.allowBaseBranch === true, repo }), repo, ctx);
  }
});
var openPullRequestTool = defineTool({
  name: "open_pull_request",
  description: "Open a pull request for the current ticket branch against the base branch, pushing it first if it has no upstream yet. This is how a change gets REVIEWED \u2014 prefer it over pushing the base branch, and say so when someone asks you to push directly. Pass `reviewers` to request review from specific people or teams. Returns the pull request URL; report that URL rather than claiming the work is shipped, because it is not until the PR is merged.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Pull request title \u2014 what this change does, in one line." },
      body: { type: "string", description: "Pull request description: what changed, why, and how a reviewer can verify it." },
      base: { type: "string", description: "Base branch to target. Defaults to the remote's default branch (usually main)." },
      reviewers: { type: "array", items: { type: "string" }, description: "GitHub usernames or org/team slugs to request review from." },
      repo: REPO_PARAM
    },
    required: ["title", "body"]
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const body = typeof args.body === "string" ? args.body : "";
    if (!title) return Promise.resolve({ data: { ok: false, action: "pull_request", error: "title is required" } });
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    const reviewers = Array.isArray(args.reviewers) ? args.reviewers.filter((r) => typeof r === "string") : void 0;
    return runPublishTool(
      "pull_request",
      buildPullRequestCommand({ title, body, base: typeof args.base === "string" ? args.base : void 0, reviewers, repo }),
      repo,
      ctx
    );
  }
});
var gitCleanupMergedTool = defineTool({
  name: "git_cleanup_merged",
  description: "Clean up after work that has LANDED: switch to the base branch, fast-forward it to origin, and delete the merged ticket branch locally and on origin. Call it once the pull request is merged (or once you have pushed the base branch directly) so the checkout is not left sitting on a dead branch with a stale base \u2014 do not hand-roll this with run_command. It is IDEMPOTENT: a remote branch the host already deleted on merge is the expected state, not an error. It REFUSES to delete a branch whose commits are not in the base branch, and refuses to run on a dirty working tree, so it can never destroy unmerged or uncommitted work. If the pull request was SQUASH-merged and the remote branch still exists, git cannot see the merge \u2014 re-call with force:true.",
  parameters: {
    type: "object",
    properties: {
      branch: { type: "string", description: "The merged branch to delete. Defaults to the branch you are currently on." },
      baseBranch: { type: "string", description: "Branch to return to and update. Defaults to the remote's default branch (usually main)." },
      force: { type: "boolean", description: "Delete the branch even though git cannot see its commits in the base branch. ONLY for a squash-merged pull request you have confirmed is merged." },
      repo: REPO_PARAM
    }
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const repo = typeof args.repo === "string" ? args.repo : void 0;
    return runPublishTool(
      "cleanup",
      buildCleanupCommand({
        branch: typeof args.branch === "string" ? args.branch : void 0,
        baseBranch: typeof args.baseBranch === "string" ? args.baseBranch : void 0,
        force: args.force === true,
        repo
      }),
      repo,
      ctx
    );
  }
});
var GIT_TOOLS = [
  gitStatusTool,
  gitDiffTool,
  gitHistoryTool,
  gitSyncLatestTool,
  gitUndoTool,
  gitRedoTool,
  gitCommitTool,
  gitPushTool,
  openPullRequestTool,
  gitCleanupMergedTool
];

// ../packages/agent-tools/src/symbols.ts
var SYMBOL_KINDS = [
  "function",
  "method",
  "class",
  "interface",
  "type",
  "enum",
  "const",
  "struct",
  "trait",
  "module",
  "table",
  "heading"
];
var MAX_SYMBOLS_PER_FILE = 400;
var LANGUAGE_BY_EXT = {
  ts: "js",
  tsx: "js",
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  mts: "js",
  cts: "js",
  py: "python",
  go: "go",
  rs: "rust",
  java: "oo",
  kt: "oo",
  kts: "oo",
  cs: "oo",
  swift: "oo",
  php: "oo",
  scala: "oo",
  rb: "ruby",
  sql: "sql",
  md: "markdown",
  mdx: "markdown"
};
function extensionOf(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}
function languageOf(path) {
  return LANGUAGE_BY_EXT[extensionOf(path.replace(/\\/g, "/"))];
}
function group(m, n) {
  return m[n] ?? "";
}
function eachLine(lines, out, visit) {
  for (let i = 0; i < lines.length && out.length < MAX_SYMBOLS_PER_FILE; i += 1) {
    visit(lines[i] ?? "", i + 1);
  }
}
var ID = "[A-Za-z_$][\\w$]*";
var JS_RULES = [
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(${ID})`), kind: "function" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+(${ID})`), kind: "class" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?interface\\s+(${ID})`), kind: "interface" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?type\\s+(${ID})\\s*[<=]`), kind: "type" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:const\\s+)?enum\\s+(${ID})`), kind: "enum" },
  { re: new RegExp(`^(\\s*export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+(${ID})`), kind: "const" }
];
var JS_METHOD = new RegExp(
  `^(?:\\t|  |    )(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set)\\s+)*\\*?\\s*(${ID})\\s*(?:<[^>]*>)?\\s*\\(.*\\)?[^;]*\\{\\s*$`
);
var JS_KEYWORDS = /* @__PURE__ */ new Set(["if", "for", "while", "switch", "catch", "return", "function", "with", "do", "else", "try"]);
function extractJs(lines, out) {
  let inClass = false;
  eachLine(lines, out, (line, lineNo) => {
    if (/^\}/.test(line)) inClass = false;
    for (const rule of JS_RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const exported = !!m[1];
      if (!exported && /^\s/.test(line)) continue;
      out.push({ name: group(m, 2), kind: rule.kind, line: lineNo, exported });
      if (rule.kind === "class") inClass = true;
      return;
    }
    if (!inClass) return;
    const method = JS_METHOD.exec(line);
    const name = method ? group(method, 1) : "";
    if (name && !JS_KEYWORDS.has(name)) out.push({ name, kind: "method", line: lineNo, exported: false });
  });
}
function extractPython(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const m = /^(\s*)(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(line);
    if (!m) return;
    const indent = group(m, 1);
    if (indent.length > 4 && !indent.startsWith("	")) return;
    const name = group(m, 3);
    const kind = group(m, 2) === "class" ? "class" : indent.length > 0 ? "method" : "function";
    out.push({ name, kind, line: lineNo, exported: !name.startsWith("_") });
  });
}
function extractGo(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const fn = /^func\s+(\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(line);
    if (fn) {
      const name2 = group(fn, 2);
      out.push({ name: name2, kind: fn[1] ? "method" : "function", line: lineNo, exported: /^[A-Z]/.test(name2) });
      return;
    }
    const ty = /^type\s+([A-Za-z_]\w*)\s+(struct|interface)?/.exec(line);
    if (!ty) return;
    const name = group(ty, 1);
    const word = group(ty, 2);
    const kind = word === "struct" ? "struct" : word === "interface" ? "interface" : "type";
    out.push({ name, kind, line: lineNo, exported: /^[A-Z]/.test(name) });
  });
}
function extractRust(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const m = /^(\s*)(pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*(fn|struct|enum|trait|mod|type)\s+([A-Za-z_]\w*)/.exec(line);
    if (!m) return;
    const word = group(m, 3);
    const kind = word === "fn" ? group(m, 1).length > 0 ? "method" : "function" : word === "mod" ? "module" : word;
    out.push({ name: group(m, 4), kind, line: lineNo, exported: !!m[2] });
  });
}
var OO_TYPE = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|export|inline|value)\s+)*(class|interface|enum|record|object|struct|protocol|trait)\s+([A-Za-z_]\w*)/;
var OO_FUNC = /^\s*(?:(?:public|private|protected|internal|static|final|override|open|suspend|inline|abstract)\s+)*(?:fun|func|function)\s+([A-Za-z_]\w*)/;
function extractOo(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const exported = !/\bprivate\b/.test(line);
    const ty = OO_TYPE.exec(line);
    if (ty) {
      const word = group(ty, 1);
      const kind = word === "interface" || word === "protocol" ? "interface" : word === "enum" ? "enum" : word === "struct" ? "struct" : word === "trait" ? "trait" : "class";
      out.push({ name: group(ty, 2), kind, line: lineNo, exported });
      return;
    }
    const fn = OO_FUNC.exec(line);
    if (fn) out.push({ name: group(fn, 1), kind: /^\s/.test(line) ? "method" : "function", line: lineNo, exported });
  });
}
function extractRuby(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const ty = /^\s*(class|module)\s+([A-Z]\w*(?:::\w+)*)/.exec(line);
    if (ty) {
      out.push({ name: group(ty, 2), kind: group(ty, 1) === "module" ? "module" : "class", line: lineNo, exported: true });
      return;
    }
    const fn = /^(\s*)def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/.exec(line);
    if (fn) out.push({ name: group(fn, 2), kind: group(fn, 1).length > 0 ? "method" : "function", line: lineNo, exported: true });
  });
}
var SQL_CREATE = /^\s*create\s+(?:or\s+replace\s+)?(?:unique\s+)?(table|view|materialized\s+view|function|procedure|index|type|trigger)\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w."]+)/i;
function extractSql(lines, out) {
  eachLine(lines, out, (line, lineNo) => {
    const m = SQL_CREATE.exec(line);
    if (!m) return;
    const word = group(m, 1).toLowerCase();
    const kind = word === "function" || word === "procedure" || word === "trigger" ? "function" : word === "index" || word === "type" ? "type" : "table";
    out.push({ name: group(m, 2).replace(/"/g, ""), kind, line: lineNo, exported: true });
  });
}
function extractMarkdown(lines, out) {
  let fenced = false;
  eachLine(lines, out, (line, lineNo) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ name: `${group(m, 1)} ${group(m, 2).slice(0, 120)}`, kind: "heading", line: lineNo, exported: true });
  });
}
var EXTRACTORS = {
  js: extractJs,
  python: extractPython,
  go: extractGo,
  rust: extractRust,
  oo: extractOo,
  ruby: extractRuby,
  sql: extractSql,
  markdown: extractMarkdown
};
function extractSymbols(path, content) {
  const language = languageOf(path);
  if (!language) return [];
  const out = [];
  EXTRACTORS[language](content.split(/\r?\n/), out);
  return out;
}
function formatSymbol(symbol) {
  return `L${symbol.line} ${symbol.kind} ${symbol.name}${symbol.exported && symbol.kind !== "heading" ? " (export)" : ""}`;
}

// ../packages/agent-tools/src/symbol-tools.ts
var FIND_DEFAULT_LIMIT = 20;
var FIND_MAX_LIMIT = 50;
var OUTLINE_MAX_ENTRIES = 150;
function asKind(v) {
  return typeof v === "string" && SYMBOL_KINDS.includes(v) ? v : void 0;
}
var findSymbolTool = defineTool({
  name: "find_symbol",
  description: "Find where a function, class, method, type, constant, SQL table or Markdown heading is DEFINED, from the workspace's symbol index \u2014 one instant call instead of search_code plus reading files to tell the definition from its call sites. Pass `query` as the symbol name or part of it (case-insensitive; exact matches rank first). Each match is `path:line kind name`; then read_file with `offset` a few lines above that line and a small `limit`. Narrow with `path` (a subdirectory) or `kind`. For USAGES, string literals or config values (not definitions), use search_code instead.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: 'Symbol name or a distinctive part of it, e.g. "buildGitCommand" or "GitCommand".' },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict to, e.g. "api/src".' },
      kind: { type: "string", enum: [...SYMBOL_KINDS], description: "Optional: only this kind of definition." },
      limit: { type: "number", description: `Max matches (default ${FIND_DEFAULT_LIMIT}, max ${FIND_MAX_LIMIT}).` }
    },
    required: ["query"]
  },
  requires: ["repo.symbols"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { data: { ok: false, error: "query is required" } };
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : void 0;
    const kind = asKind(args.kind);
    const requested = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.floor(args.limit) : FIND_DEFAULT_LIMIT;
    const limit = Math.min(FIND_MAX_LIMIT, Math.max(1, requested));
    const r = await ctx.caps.symbols.find(query, { scope, kind, limit });
    if (!r.ok) return { data: r };
    const data = {
      ok: true,
      query,
      total: r.total ?? 0,
      truncated: r.truncated === true,
      matches: (r.matches ?? []).map((m) => `${m.path}:${m.line} ${m.kind} ${m.name}${m.exported && m.kind !== "heading" ? " (export)" : ""}`),
      indexedFiles: r.indexedFiles
    };
    if ((r.total ?? 0) === 0) {
      data.note = r.partialIndex ? `No definition named like "${query}" in the indexed files \u2014 but the index is PARTIAL (file cap reached), so this is not proof it does not exist. Try search_code${scope ? "" : " with a `path`"}.` : `No definition named like "${query}"${scope ? ` under "${scope}"` : ""}. It may be defined in a form the index does not recognise (a re-export, an object property, a generated file) \u2014 use search_code for the exact text.`;
    } else if (r.truncated) {
      data.note = `Showing ${r.matches?.length ?? 0} of ${r.total} matches \u2014 pass a longer \`query\`, a \`path\` or a \`kind\` to narrow.`;
    }
    return { data };
  }
});
var fileOutlineTool = defineTool({
  name: "file_outline",
  description: "List what a file DEFINES \u2014 functions, classes, methods, types, constants, or a Markdown file's headings \u2014 each with its line number, without reading the file's contents. Call this BEFORE paging through a large file: find the symbol you need, then read_file with `offset` at its line and a small `limit`, instead of reading 2,000-line windows until you reach it. Pass `kind` to list only one kind of definition.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative file path, e.g. "api/src/service.ts".' },
      kind: { type: "string", enum: [...SYMBOL_KINDS], description: "Optional: only this kind of definition." }
    },
    required: ["path"]
  },
  requires: ["repo.read", "repo.symbols"],
  async execute(args, ctx) {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) return { data: { ok: false, error: "path is required" } };
    const kind = asKind(args.kind);
    const file = await ctx.caps.repoRead.readFile(path);
    if (!file.ok) return { data: file };
    const content = file.content ?? "";
    const all = extractSymbols(path, content).filter((s) => !kind || s.kind === kind);
    const shown = all.slice(0, OUTLINE_MAX_ENTRIES);
    const data = {
      ok: true,
      path: file.path ?? path,
      totalLines: content.split("\n").length,
      total: all.length,
      symbols: shown.map(formatSymbol)
    };
    if (all.length === 0) {
      data.note = kind ? `No ${kind} definitions found in ${path}.` : `No definitions recognised in ${path} (unsupported language, or a data/config file) \u2014 read_file it directly.`;
    } else if (all.length > shown.length) {
      const lastLine = shown.at(-1)?.line ?? 0;
      data.note = `Showing the first ${shown.length} of ${all.length} definitions (through line ${lastLine}). Pass \`kind\` to list one kind, or find_symbol for a specific name.`;
    }
    return { data };
  }
});
var SYMBOL_TOOLS = [findSymbolTool, fileOutlineTool];

// ../packages/agent-tools/src/core-tools.ts
var listFilesTool = defineTool({
  name: "list_files",
  description: "List repo files (recursively) on the ticket branch so you can discover the existing codebase before editing. Optionally pass `path` to scope to a subdirectory. To FIND A FILE BY NAME, pass `glob` \u2014 e.g. `ROADMAP.md` (matches that filename at any depth, case-insensitive) or `src/**/*.test.ts`. Use `glob` instead of concluding a file is missing: a large repo's unfiltered listing is summarized to directories, but a `glob` always returns the matching files in full.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Optional repo-relative subdirectory to scope to, e.g. "src/components".' },
      glob: { type: "string", description: 'Optional filename/glob filter, e.g. "ROADMAP.md", "*.md", or "src/**/*.ts". Case-insensitive; a name with no "/" matches the basename at any depth.' }
    }
  },
  requires: ["repo.read"],
  async execute(args, ctx) {
    const sub = typeof args.path === "string" ? args.path : void 0;
    const glob = typeof args.glob === "string" && args.glob.trim() ? args.glob.trim() : void 0;
    const r = await ctx.caps.repoRead.listFiles(sub, glob);
    if (glob && r.ok && (r.paths?.length ?? 0) === 0) {
      return {
        data: {
          ...r,
          note: `No file matches glob "${glob}". Try a broader pattern (e.g. "*${glob.replace(/[*?/]/g, "")}*"), or list_files without a glob to see the tree. 0 matches means no such file exists \u2014 do not claim one is missing without trying a broader glob first.`
        }
      };
    }
    return { data: r };
  }
});
var searchCodeTool = defineTool({
  name: "search_code",
  description: 'Search the repo for a string/symbol in one call \u2014 use this FIRST to find where something is referenced instead of reading files one by one. Returns matching file paths with line fragments. Pass `query` as an EXACT substring/regex (a symbol, import path, or config key), NOT a natural-language phrase \u2014 a multi-word phrase rarely appears verbatim on one line and will match nothing. On a large monorepo, scope the search with `path` (a subdirectory) to search just that subtree. 0 results with `truncated:false` means the term does not appear (so "remove all references to X" then means there is nothing to remove \u2014 say so, do not invent a change); 0 results with `truncated:true` means the search was cut short before scanning everything \u2014 narrow it with `path` or a more specific `query` and try again, do NOT conclude the term is absent. Then read_file the matches you intend to edit.',
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Exact text or symbol to find, e.g. a model id, function name, import path, or config key. NOT a natural-language phrase." },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict the search to, e.g. "packages/brain-ui". Use this to avoid truncation on a big repo.' }
    },
    required: ["query"]
  },
  requires: ["repo.search"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : void 0;
    const r = await ctx.caps.repoRead.searchCode(query, scope);
    if (r.ok && r.total === 0) {
      const note = r.truncated ? `Search was truncated before scanning the whole${scope ? " subtree" : " repo"} \u2014 this is NOT proof the term is absent. Re-run scoped to a subdirectory via \`path\`${scope ? " (a narrower one)" : ""}, or use a more specific \`query\`.` : `No matches${scope ? ` under "${scope}"` : ""} \u2014 the term is not referenced${scope ? " there (try without `path` to search the whole repo)" : ""}. If the task was to remove/replace it, there is nothing to change; say so instead of inventing an edit.`;
      return { data: { ...r, note } };
    }
    return { data: r };
  }
});
var READ_DEFAULT_LINE_LIMIT = 2e3;
function windowFileContent(content, opts) {
  const lines = content.split("\n");
  const totalLines = lines.length;
  const start = opts?.offset && opts.offset > 1 ? Math.min(Math.floor(opts.offset), totalLines + 1) : 1;
  const limit = opts?.limit && opts.limit > 0 ? Math.floor(opts.limit) : READ_DEFAULT_LINE_LIMIT;
  const slice = lines.slice(start - 1, start - 1 + limit);
  const end = start - 1 + slice.length;
  return { content: slice.join("\n"), truncated: end < totalLines, totalLines, offset: start, returnedLines: slice.length };
}
var readFileTool = defineTool({
  name: "read_file",
  description: "Read a repo file on the ticket branch. Returns up to " + READ_DEFAULT_LINE_LIMIT + " lines at a time: a large file comes back as a paginated line window (never a hard failure), and the result's `truncated`/`totalLines` tell you when more remains \u2014 read the next chunk by calling again with `offset`. Always read a file before editing it so you preserve existing code and only change what is needed.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      offset: { type: "number", description: "1-based line to start reading from (for paging through a large file). Default 1." },
      limit: { type: "number", description: `Max lines to return. Default ${READ_DEFAULT_LINE_LIMIT}. Read the next window with offset = previous offset + returned lines.` }
    },
    required: ["path"]
  },
  requires: ["repo.read"],
  async execute(args, ctx) {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) return { data: { ok: false, error: "path is required" } };
    const offset = typeof args.offset === "number" && args.offset > 0 ? Math.floor(args.offset) : void 0;
    const limit = typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : void 0;
    const r = await ctx.caps.repoRead.readFile(path);
    if (!r.ok) return { data: r };
    const win = windowFileContent(r.content ?? "", { offset, limit });
    const data = {
      ok: true,
      path: r.path ?? path,
      content: win.content,
      truncated: win.truncated || r.truncated === true,
      totalLines: win.totalLines,
      offset: win.offset
    };
    if (win.truncated) {
      const lastLine = win.offset + win.returnedLines - 1;
      data.note = `Showing lines ${win.offset}\u2013${lastLine} of ${win.totalLines}. To continue, call read_file again with offset ${lastLine + 1}.`;
    }
    return { data };
  }
});
var writeFileTool = defineTool({
  name: "write_file",
  description: 'Create or update a file, writing its complete contents. How the write lands depends on the surface: in an editor/on-prem workspace it edits the file in place; in a cloud/review run it is staged on the ticket branch as a reviewable pending change. Do NOT narrate a specific mechanism (e.g. "opened a PR") \u2014 just state what the file now contains. Use once per deliverable file. Provide the FULL file content.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      content: { type: "string", description: "Complete file content (no placeholders)." },
      summary: { type: "string", description: "One-line description of the change." }
    },
    required: ["path", "content"]
  },
  requires: ["repo.write"],
  async execute(args, ctx) {
    const path = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : "";
    const summary = typeof args.summary === "string" ? args.summary : void 0;
    if (!path || !content) return { data: { ok: false, error: "path and content are both required" } };
    const r = await ctx.caps.repoWrite.writeFile(path, content, summary);
    return { data: r.ok ? { ok: true, branch: r.branch, commitUrl: r.commitUrl } : { ok: false, error: r.error } };
  }
});
var deleteFileTool = defineTool({
  name: "delete_file",
  description: 'Remove a file from the ticket branch so it does NOT ship in the pull request. Use this to clean up dead code: a stub/placeholder, an unreferenced file, or a file a PRIOR pass on this branch created that should not be part of the final change. The "Files already on this branch" list in your context shows what a prior pass left \u2014 reconcile against it. Verify the file is genuinely unused (search_code for its exports) before deleting. Deleting a file not on the branch is a no-op (reported back), not an error.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path to remove, e.g. "src/utils/email.ts".' },
      reason: { type: "string", description: 'One-line why this file should not ship (e.g. "stub superseded by existing email infra").' }
    },
    required: ["path"]
  },
  requires: ["repo.delete"],
  async execute(args, ctx) {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) return { data: { ok: false, error: "path is required" } };
    const reason = typeof args.reason === "string" ? args.reason : void 0;
    const r = await ctx.caps.repoWrite.deleteFile(path, reason);
    if (r.ok && r.deleted === false) return { data: { ok: true, deleted: false, note: r.note } };
    return { data: r.ok ? { ok: true, deleted: true, branch: r.branch, commitUrl: r.commitUrl } : { ok: false, error: r.error } };
  }
});
var editFileTool = defineTool({
  name: "edit_file",
  description: "Make a surgical in-place edit to an existing file on the ticket branch: replace an exact snippet with new text, without rewriting the whole file. Read the file first so `old_string` matches EXACTLY (including indentation). `old_string` must be unique in the file unless you set `replace_all`. Prefer this over write_file for small changes to large files.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      old_string: { type: "string", description: "The exact text to replace (must match the file byte-for-byte)." },
      new_string: { type: "string", description: "The replacement text." },
      replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring a unique match. Default false." }
    },
    required: ["path", "old_string", "new_string"]
  },
  requires: ["repo.edit"],
  async execute(args, ctx) {
    const path = typeof args.path === "string" ? args.path : "";
    const oldString = typeof args.old_string === "string" ? args.old_string : "";
    const newString = typeof args.new_string === "string" ? args.new_string : "";
    const replaceAll = args.replace_all === true;
    if (!path || !oldString) return { data: { ok: false, error: "path and old_string are required" } };
    const r = await ctx.caps.repoWrite.editFile(path, oldString, newString, replaceAll);
    return {
      data: r.ok ? { ok: true, branch: r.branch, commitUrl: r.commitUrl, replaced: r.replaced } : { ok: false, error: r.error }
    };
  }
});
var memoryRecallTool = defineTool({
  name: "memory_recall",
  description: "Recall durable facts from cross-run memory that are relevant to a query \u2014 decisions, fixes, project conventions, user preferences you (or another run) stored earlier. Call this FIRST when a task touches an area you may have worked before, instead of re-reading large files or history. Returns the most relevant stored entries (key + content); 0 results means nothing relevant is stored yet.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What you want to remember about, e.g. a subsystem, decision, or convention." },
      limit: { type: "number", description: "Max entries to return (default 5)." }
    },
    required: ["query"]
  },
  requires: ["memory"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : void 0;
    const r = await ctx.caps.memory.recall(query, limit);
    return { data: r };
  }
});
var memoryRememberTool = defineTool({
  name: "memory_remember",
  description: "Store ONE durable fact in cross-run memory so a future run can recall it instead of re-deriving it \u2014 a decision, a non-obvious fix, a project constraint, or a user preference. Keep content to one tight line. Use a stable, descriptive key (e.g. 'release-checklist', 'auth-flow'); reusing a key overwrites it. Do NOT store things the repo/git already records or facts that only matter to the current turn.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Stable, descriptive identifier for the fact, e.g. 'deploy-command'." },
      content: { type: "string", description: "The fact, as one concise line." },
      tags: { type: "array", items: { type: "string" }, description: "Optional tags for grouping/filtering." },
      importance: { type: "number", description: "0\u20131; higher surfaces earlier. Default 0.5." },
      scope: {
        type: "string",
        enum: ["tenant", "project", "ticket"],
        description: "How widely this fact should be visible. 'ticket' = only this ticket's runs; 'project' (default) = every run on this project; 'tenant' = the whole workspace. Prefer the NARROWEST scope that is still true \u2014 a project convention is 'project', not 'tenant'."
      },
      ttl_days: {
        type: "number",
        description: "Forget automatically after this many days. Use it for anything time-bound (a release date, a temporary workaround, an in-flight migration). Omit only for facts that stay true indefinitely."
      }
    },
    required: ["key", "content"]
  },
  requires: ["memory"],
  async execute(args, ctx) {
    const key = typeof args.key === "string" ? args.key : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!key.trim() || !content.trim()) return { data: { ok: false, error: "key and content are required" } };
    const tags = Array.isArray(args.tags) ? args.tags.filter((t) => typeof t === "string") : void 0;
    const importance = typeof args.importance === "number" && Number.isFinite(args.importance) ? args.importance : void 0;
    const scope = MEMORY_SCOPES.includes(args.scope) ? args.scope : void 0;
    const ttlDays = typeof args.ttl_days === "number" && Number.isFinite(args.ttl_days) && args.ttl_days > 0 ? args.ttl_days : void 0;
    const r = await ctx.caps.memory.remember(key, content, { tags, importance, scope, ttlDays });
    return { data: r };
  }
});
var MEMORY_SCOPES = ["tenant", "project", "ticket"];
var memoryForgetTool = defineTool({
  name: "memory_forget",
  description: "Delete one stored fact from cross-run memory by its key. Use when a fact you (or an earlier run) stored has become WRONG \u2014 a decision was reversed, a workaround was removed, a convention changed. Correcting a fact is memory_remember with the same key; this is for facts that should no longer exist at all.",
  parameters: {
    type: "object",
    properties: { key: { type: "string", description: "The key of the fact to delete." } },
    required: ["key"]
  },
  requires: ["memory", "memory.forget"],
  async execute(args, ctx) {
    const key = typeof args.key === "string" ? args.key : "";
    if (!key.trim()) return { data: { ok: false, error: "key is required" } };
    const r = await ctx.caps.memory.forget(key);
    return { data: r };
  }
});
var claimResourceTool = defineTool({
  name: "claim_resource",
  description: "Reserve a shared resource before you work on it, so a peer agent working the same ticket does not change it underneath you. Pass a file path ('src/app.ts'), a directory ('src/api/'), or 'repo' for the whole tree. Returns granted:false with the current holder when someone else has it \u2014 then work on something else, or leave a workspace_note explaining what you need. Writes to a path held by another agent are refused whether or not you claim first.",
  parameters: {
    type: "object",
    properties: {
      resource: { type: "string", description: "What to reserve: a repo-relative file path, a directory, or 'repo'." },
      mode: {
        type: "string",
        enum: ["exclusive", "shared"],
        description: "'exclusive' (default) to write it; 'shared' to signal you are reading it and block others' exclusive claims."
      },
      reason: { type: "string", description: "One line on why you need it \u2014 shown to the peer agent that gets refused." }
    },
    required: ["resource"]
  },
  requires: ["coordinate"],
  async execute(args, ctx) {
    const resource = typeof args.resource === "string" ? args.resource : "";
    if (!resource.trim()) return { data: { ok: false, error: "resource is required" } };
    const mode = args.mode === "shared" || args.mode === "exclusive" ? args.mode : void 0;
    const reason = typeof args.reason === "string" ? args.reason : void 0;
    const r = await ctx.caps.coordination.claim(resource, { mode, reason });
    return { data: r };
  }
});
var releaseResourceTool = defineTool({
  name: "release_resource",
  description: "Release a resource you claimed, so a peer agent can take it. Do this as soon as you are finished with it rather than holding it to the end of the run. Every lease this run holds is released automatically when the run ends, so this is an optimisation, not a requirement.",
  parameters: {
    type: "object",
    properties: { resource: { type: "string", description: "The resource string you claimed." } },
    required: ["resource"]
  },
  requires: ["coordinate"],
  async execute(args, ctx) {
    const resource = typeof args.resource === "string" ? args.resource : "";
    if (!resource.trim()) return { data: { ok: false, error: "resource is required" } };
    const r = await ctx.caps.coordination.release(resource);
    return { data: r };
  }
});
var workspaceNoteTool = defineTool({
  name: "workspace_note",
  description: "Publish a short note on the shared workspace for this ticket, readable by every agent working it (now or later in the ticket's lifecycle). Use it to declare intent ('I own the DB migration'), hand off a finding, or record a decision a peer must not contradict. Reusing a key overwrites that note. This is WORKING state for the current ticket \u2014 durable cross-ticket knowledge belongs in memory_remember.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Short stable identifier, e.g. 'owns-migration' or 'api-contract'." },
      content: { type: "string", description: "The note, in one or two lines." }
    },
    required: ["key", "content"]
  },
  requires: ["coordinate"],
  async execute(args, ctx) {
    const key = typeof args.key === "string" ? args.key : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!key.trim() || !content.trim()) return { data: { ok: false, error: "key and content are required" } };
    const r = await ctx.caps.coordination.postNote(key, content);
    return { data: r };
  }
});
var workspaceReadTool = defineTool({
  name: "workspace_read",
  description: "Read the shared workspace for this ticket \u2014 notes posted by peer agents plus the resources they currently hold. Call this EARLY when a ticket may be staffed by more than one agent, so you plan around what others already own instead of colliding with them.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Optional filter; omit to read everything." },
      limit: { type: "number", description: "Max notes to return (default 20)." }
    }
  },
  requires: ["coordinate"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" && args.query.trim() ? args.query : void 0;
    const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : void 0;
    const [notes, leases] = await Promise.all([
      ctx.caps.coordination.readNotes(query, limit),
      ctx.caps.coordination.listClaims()
    ]);
    if (!notes.ok) return { data: notes };
    return { data: { ok: true, notes: notes.notes ?? [], heldResources: leases.ok ? leases.leases ?? [] : [] } };
  }
});
var webFetchTool = defineTool({
  name: "web_fetch",
  description: "Fetch a single URL and return its readable text content (HTML is reduced to text/markdown). Use to read documentation, an API spec, an issue, or any page you have an exact URL for. Returns the status and the (possibly truncated) content.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The absolute http(s) URL to fetch." }
    },
    required: ["url"]
  },
  requires: ["web"],
  async execute(args, ctx) {
    const url = typeof args.url === "string" ? args.url : "";
    if (!url.trim()) return { data: { ok: false, error: "url is required" } };
    const r = await ctx.caps.web.fetch(url);
    return { data: r };
  }
});
var webSearchTool = defineTool({
  name: "web_search",
  description: 'Search the public web for a query and return ranked results (title, url, snippet) plus `coverage` and `attribution`. Use to discover sources/docs when you don\'t have an exact URL; then web_fetch the most relevant result. `coverage: "owned_index"` means this workspace\'s own previously-crawled corpus answered directly; `"web"` or `"encyclopedic"` means a vendor answered and the found pages are being indexed for next time. When `coverage` is "encyclopedic" the index behind this workspace is narrower than a general web engine \u2014 report what you actually found and say what you could not find, rather than filling the gap from memory.',
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." }
    },
    required: ["query"]
  },
  requires: ["web.search"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    if (!ctx.caps.web?.search) return { data: { ok: false, error: "web search is not available on this surface" } };
    const r = await ctx.caps.web.search(query);
    return { data: r };
  }
});
var runChecksTool = defineTool({
  name: "run_checks",
  description: "Statically validate the files you have written: it parses committed JSON/YAML and runs the platform's shell-free changed-source quality policies, returning structured path/line/rule diagnostics to fix BEFORE finishing. The same validation runs automatically at finish, so it cannot be skipped. IMPORTANT: this serverless executor has NO shell, so it does NOT run the full build, project-wide type-check, lint, or tests \u2014 those run in CI on the pull request (the source of truth). Never claim those checks passed.",
  parameters: { type: "object", properties: {} },
  requires: ["static-check"],
  async execute(_args, ctx) {
    const r = await ctx.caps.staticCheck.verify();
    return { data: r };
  }
});
var runCommandTool = defineTool({
  name: "run_command",
  description: "Run a shell command in the checked-out repository (real shell). Use it to install dependencies and run the build, type-check, lint, and tests. Returns combined stdout/stderr and the exit code. Verify your changes this way BEFORE calling finish.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: 'The shell command to run, e.g. "npm install" or "npm test".' }
    },
    required: ["command"]
  },
  requires: ["shell"],
  async execute(args, ctx) {
    const command = typeof args.command === "string" ? args.command : "";
    if (!command.trim()) return { data: { ok: false, error: "command is required" } };
    const r = await ctx.caps.shell.run(command);
    return { data: r };
  }
});
var askHumanTool = defineTool({
  name: "ask_human",
  description: `Pause and ask a human for input when you are genuinely BLOCKED \u2014 a requirement is ambiguous, you cannot find an expected file/system after searching, a decision needs product/business judgement, or you would otherwise have to guess. The run pauses (no further token spend) and the question goes to the team's human-requests queue with a notification; when someone answers, you resume automatically with their answer and continue. Prefer this over guessing or finishing with a "could not proceed" summary \u2014 a blocked task that asks gets unblocked; one that gives up silently does not. Do NOT use it for things you can determine yourself with list_files/search_code/read_file.`,
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The specific question for the human. Be concrete and self-contained \u2014 they may not have the full task context." },
      context: { type: "string", description: "Optional: what you have tried / why you are blocked, so the human can answer well." }
    },
    required: ["question"]
  },
  requires: ["human"],
  async execute(args, ctx) {
    const question = typeof args.question === "string" ? args.question.trim() : "";
    const context = typeof args.context === "string" ? args.context : void 0;
    if (!question) return { data: { ok: false, error: "question is required to ask a human" } };
    const r = await ctx.caps.human.ask(question, context);
    if (r.paused) {
      return {
        control: { kind: "ask_human", approvalId: r.approvalId, question },
        data: { ok: true, paused: true, note: r.note ?? "Question sent to a human. The run is paused until it is answered; you will resume with the answer." }
      };
    }
    return { data: { ok: true, paused: false, answer: r.answer ?? null, note: r.note } };
  }
});
var updatePrdTool = defineTool({
  name: "update_prd",
  description: `Record a change on THIS TICKET'S PRD \u2014 the shared spec you were given in your context and that every other agent on this ticket reads. Use mode "append" (the default, and the safe one) to add a dated, signed note: a decision you made, a constraint you discovered, an assumption you had to take, or work you deliberately left out of scope. Use mode "section" ONLY to correct a section that is actually WRONG \u2014 it replaces that section's whole body, so pass the full replacement text, not a fragment; name the section by its exact heading (e.g. "Acceptance criteria", "Implementation Notes"). If the heading does not exist the call fails and returns the headings that do \u2014 retry with one of those, or append instead. This is not a substitute for doing the work: keep it to what a later run genuinely needs to know.`,
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["append", "section"],
        description: `"append" adds a dated, attributed note at the end (nothing already written is lost). "section" REPLACES the named section's body \u2014 only for correcting something wrong.`
      },
      section: {
        type: "string",
        description: 'Required when mode is "section": the exact heading to replace, without the leading "##" (e.g. "Acceptance criteria").'
      },
      content: {
        type: "string",
        description: `The markdown to record. For mode "append", the note. For mode "section", the section's COMPLETE new body.`
      }
    },
    required: ["mode", "content"]
  },
  requires: ["prd.write"],
  async execute(args, ctx) {
    const mode = args.mode === "section" ? "section" : "append";
    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (!content) return { data: { ok: false, error: "content is required" } };
    if (mode === "section") {
      const heading = typeof args.section === "string" ? args.section.trim() : "";
      if (!heading) {
        return {
          data: {
            ok: false,
            error: 'section is required when mode is "section" \u2014 pass the exact heading to replace, or use mode "append" to add a note instead.'
          }
        };
      }
      const edited = await ctx.caps.prd.editSection(heading, content);
      return { data: edited };
    }
    const appended = await ctx.caps.prd.append(content);
    return { data: appended };
  }
});
var finishTool = defineTool({
  name: "finish",
  description: 'Call ONLY when the task is fully complete \u2014 every deliverable file written with real, working content (no stubs/placeholders) and every task/PRD requirement implemented. Your changes open a pull request for human review, so a partial scaffold is not "done". Provide a concise summary of what was delivered. Do NOT assert that a build/type-check/lint/test passed \u2014 you cannot run those here (CI on the PR verifies). If you are blocked rather than done, call ask_human instead of finishing with a "could not proceed" summary.',
  parameters: {
    type: "object",
    properties: { summary: { type: "string", description: "What was delivered." } },
    required: ["summary"]
  },
  // No capability: every surface can finish. The engine applies the honesty +
  // anti-stub finish gates around this control signal (loop policy, not a tool).
  async execute(args) {
    const summary = typeof args.summary === "string" ? args.summary.trim() : "";
    return { control: { kind: "finish", summary }, data: { ok: true } };
  }
});
var CORE_TOOLS = [
  listFilesTool,
  searchCodeTool,
  readFileTool,
  ...SYMBOL_TOOLS,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  runChecksTool,
  runCommandTool,
  ...GIT_TOOLS,
  webFetchTool,
  webSearchTool,
  memoryRecallTool,
  memoryRememberTool,
  memoryForgetTool,
  claimResourceTool,
  releaseResourceTool,
  workspaceNoteTool,
  workspaceReadTool,
  askHumanTool,
  updatePrdTool,
  finishTool
];

// ../packages/agent-tools/src/skill-tools.ts
var skillProposeTool = defineTool({
  name: "skill_propose",
  description: "Propose a reusable SKILL \u2014 a procedure a future agent can follow \u2014 drafted from work you just completed and verified. Use it when you worked out a repeatable way to do something non-obvious in this codebase (a migration + guard + test sequence, a release path, a debugging route) and a future run would otherwise rediscover it. Do NOT propose a skill for a one-off fix, for something the repo already documents, or for a procedure you did not actually complete. The draft goes to a human for review; it does not take effect until approved.",
  parameters: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: "Stable kebab-case id, e.g. 'add-a-schema-column'. Re-using one revises your existing draft."
      },
      name: { type: "string", description: "Short human title, e.g. 'Add a schema column end to end'." },
      description: {
        type: "string",
        description: "One line saying WHEN to use this skill \u2014 a future agent matches on this, so name the situation, not the steps."
      },
      body: {
        type: "string",
        description: "The procedure as Markdown: ordered steps, exact commands, and how to tell it worked."
      },
      evidence: {
        type: "string",
        description: "What proves this procedure works \u2014 the graded proof, the merged PR, the passing check."
      }
    },
    required: ["slug", "name", "description", "body"]
  },
  requires: ["skill.author"],
  async execute(args, ctx) {
    const str3 = (v) => typeof v === "string" ? v.trim() : "";
    const slug = str3(args.slug);
    const name = str3(args.name);
    const description = str3(args.description);
    const body = str3(args.body);
    if (!slug || !name || !description || !body) {
      return { data: { ok: false, error: "slug, name, description and body are all required" } };
    }
    const evidence = str3(args.evidence);
    const r = await ctx.caps.skillAuthor.propose({
      slug,
      name,
      description,
      body,
      ...evidence ? { evidence } : {}
    });
    return { data: r };
  }
});
var skillListTool = defineTool({
  name: "skill_list",
  description: "List the skills this workspace already has \u2014 approved ones you can follow, and drafts awaiting review. Call it before proposing, so you revise an existing draft instead of adding a near-duplicate.",
  parameters: { type: "object", properties: {} },
  requires: ["skill.author"],
  async execute(_args, ctx) {
    const r = await ctx.caps.skillAuthor.list();
    return { data: r };
  }
});

// ../packages/agent-tools/src/subagent-tools.ts
var ROLE_ENUM_DESCRIPTION = MODEL_ROLES.map((role) => `${role} \u2014 ${MODEL_ROLE_DESCRIPTIONS[role]}`).join(" \xB7 ");
var spawnAgentTool = defineTool({
  name: "spawn_agent",
  description: "Delegate a self-contained sub-task to a child agent that works in its OWN context and reports back a single answer. Use it when finding something out would take many turns you do not want to carry \u2014 locating where a behaviour lives across an unfamiliar tree, checking whether a pattern is used anywhere else, summarising a large file you only need one fact from. The child sees NOTHING of this conversation, so `task` must state everything it needs to know, and it answers in prose \u2014 it cannot hand you files or tool output. Do NOT delegate work you can do in a turn or two, and do NOT delegate the actual writing of the deliverable: you are accountable for what ships.",
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "A few words naming the delegation, e.g. 'locate the auth middleware'. Shown on the run timeline."
      },
      task: {
        type: "string",
        description: "The child's complete brief: what to find out or do, where to look, and exactly what to report back. Assume it knows nothing about the ticket beyond what you write here."
      },
      read_only: {
        type: "boolean",
        description: "Default true \u2014 the child may read, search and reason but not modify the working tree. Pass false ONLY when the delegated work is itself an edit you want it to make."
      },
      role: {
        type: "string",
        enum: [...MODEL_ROLES],
        description: `What kind of call the child's turns are \u2014 lets the surface pick a model suited to the work rather than reusing yours. Defaults to 'explore' when read_only, else 'code'. ${ROLE_ENUM_DESCRIPTION}`
      },
      as_agent: {
        type: "string",
        description: "Run the child AS one of the workspace's agents \u2014 its id or name (e.g. 'Ada'). The child adopts that agent's role, bio, skills and personality so the delegated slice is done in that agent's voice and expertise. Prefer an agent already in this chat (builtin_chats_list_agents) or from builtin_cloud_agents_list_mine."
      }
    },
    required: ["label", "task"]
  },
  requires: ["orchestrate"],
  async execute(args, ctx) {
    const str3 = (v) => typeof v === "string" ? v.trim() : "";
    const label = str3(args.label);
    const task = str3(args.task);
    if (!task) return { data: { ok: false, error: "task is required \u2014 the child sees none of your conversation" } };
    const readOnly = args.read_only !== false;
    const role = delegationRole(args.role, readOnly);
    const asAgent = str3(args.as_agent);
    const r = await ctx.caps.orchestration.spawn({
      label: label || task.slice(0, 60),
      task,
      readOnly,
      role,
      ...asAgent ? { asAgent } : {}
    });
    return { data: r, ...r.ok ? {} : { isError: true } };
  }
});

// src/brainRunStore.ts
function provenanceMetadata(result, requested) {
  const model = result.resolvedModel;
  if (!model) return void 0;
  const account = asProvenanceAccount(result.account);
  const asked = requested && requested !== "default" && requested !== model ? requested : void 0;
  return withProvenanceMetadata({
    model,
    ...account ? { account } : {},
    ...asked ? { requestedModel: asked } : {}
  });
}
var DEDUP_READ_TOOLS = /* @__PURE__ */ new Set(["read_file", "search_code", "list_files", "find_symbol", "file_outline"]);
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
  activity: null,
  byoUnresolved: [],
  providerCap: []
};
function makeCell() {
  return {
    transcript: [],
    priorResearch: null,
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
    emitTimer: null,
    abort: null,
    activity: null,
    byoUnresolved: [],
    providerCap: [],
    codeChanged: false,
    codeModel: null,
    runId: "",
    ticketRecorded: false,
    touchedFiles: [],
    deltaTicketId: null,
    deltaRecordedFiles: [],
    runTraceFrom: 0,
    compactMemo: null,
    liveTurn: null,
    stoppedTurn: null,
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
var STREAM_EMIT_MS = 32;
function emitStreaming(c) {
  if (c.emitTimer) return;
  c.emitTimer = setTimeout(() => {
    c.emitTimer = null;
    emit(c);
  }, STREAM_EMIT_MS);
}
function emit(c) {
  if (c.emitTimer) {
    clearTimeout(c.emitTimer);
    c.emitTimer = null;
  }
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
    activity: c.activity,
    byoUnresolved: c.byoUnresolved,
    providerCap: c.providerCap
  };
  for (const l of c.listeners) l();
  for (const l of storeListeners) l();
}
function setActivity(c, activity) {
  c.activity = activity;
  emit(c);
}
function pushTrace(c, ev) {
  c.trace.push(ev);
  if (c.trace.length > MAX_TRACE_EVENTS) {
    const dropped = c.trace.length - MAX_TRACE_EVENTS;
    c.trace.splice(0, dropped);
    c.runTraceFrom = Math.max(0, c.runTraceFrom - dropped);
  }
  emit(c);
}
function runTrace(c) {
  return c.trace.slice(c.runTraceFrom);
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
function recordRunFailure(c, chatId, persistence, label, message) {
  pushDurableStep(c, chatId, persistence, {
    ts: nowIso(),
    category: "error",
    label,
    result: message,
    isError: true
  });
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
function attachDeltaToRunTicket(toolName, args, deltaTicketId) {
  if (toolName !== "builtin_tickets_from_delta" || deltaTicketId == null) return;
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const bag = args;
  if (bag.taskId == null) bag.taskId = deltaTicketId;
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
function isFollowUpTurn(convo) {
  let users = 0;
  for (const m of convo) {
    if (m.role === "assistant") return true;
    if (m.role === "user") users += 1;
  }
  return users > 1;
}
function lastAssistantText(convo) {
  for (let i = convo.length - 1; i >= 0; i -= 1) {
    const m = convo[i];
    if (m.role === "assistant") return typeof m.content === "string" ? m.content.trim() : "";
  }
  return "";
}
function resetBrainRunStore() {
  cells.clear();
  forgetResolvedModels();
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
  const driver = getRunDriver();
  if (driver) return driver.stop(chatId);
  const c = cells.get(chatId);
  if (!c || !c.running) return;
  const stopped = stoppedTurnOf(c);
  c.stoppedTurn = stopped;
  c.abort?.abort();
  if (c.confirmResolver) {
    const resolve = c.confirmResolver;
    c.confirmResolver = null;
    c.pendingConfirm = null;
    resolve(false);
  }
  c.streamingText = "";
  c.activity = null;
  pushTrace(c, stopped.event);
}
function stoppedTurnOf(c) {
  const live = c.liveTurn;
  const text = live ? c.streamingText : "";
  const model = live?.model;
  const result = !live ? "Stopped by user." : model ? `Stopped by user while ${model} was streaming (${text.length} chars kept).` : `Stopped by user before the gateway named the model (${text.length} chars kept).`;
  return {
    text,
    source: { ...live },
    event: {
      ts: nowIso(),
      category: "message",
      label: STOPPED_TURN_STEP,
      ...model ? { args: { model } } : {},
      ...live ? { textChars: text.length } : {},
      result
    }
  };
}
async function keepStoppedTurn(chatId, c, persistence) {
  const stopped = c.stoppedTurn;
  c.stoppedTurn = null;
  if (!stopped) return;
  persistStep(chatId, persistence, stopped.event);
  const text = canonicalTurnText(stopped.text);
  if (!text) return;
  const [msg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: text, metadata: stoppedTurnMetadata(stopped.source) }]);
  if (msg) recordAppended(c, msg);
}
async function asLiveTurn(c, complete) {
  c.liveTurn = {};
  try {
    return await complete();
  } finally {
    c.liveTurn = null;
  }
}
function liveTurnModel(c) {
  return (model, account) => {
    if (c.liveTurn) c.liveTurn = { model, account };
  };
}
function clearRunError(chatId) {
  if (chatId == null) return;
  const driver = getRunDriver();
  if (driver) return driver.clearError(chatId);
  const c = cells.get(chatId);
  if (!c || !c.error) return;
  c.error = "";
  c.errorAction = null;
  emit(c);
}
function requestRunConfirm(chatId, req, opts) {
  if (getRunDriver()) return Promise.resolve(false);
  const c = getCell(chatId);
  return new Promise((resolve) => {
    c.pendingConfirm = { name: req.name, args: req.args };
    c.confirmResolver = resolve;
    c.activity = {
      ...toolActivity(req.name, req.args, opts?.step ?? c.activity?.step ?? 0, Date.now()),
      phase: "awaiting"
    };
    emit(c);
  });
}
function resolveRunConfirm(chatId, ok) {
  const driver = getRunDriver();
  if (driver) return driver.confirm(chatId, ok);
  const c = cells.get(chatId);
  if (!c || !c.confirmResolver) return;
  const resolve = c.confirmResolver;
  c.confirmResolver = null;
  c.pendingConfirm = null;
  emit(c);
  resolve(ok);
}
function applyRemoteRun(chatId, snapshot) {
  const c = getCell(chatId);
  if (c.abort) return;
  c.running = snapshot.running;
  c.streamingText = snapshot.streamingText;
  c.error = snapshot.error;
  c.errorAction = snapshot.errorAction;
  c.pendingConfirm = snapshot.pendingConfirm;
  c.messagesEpoch = snapshot.messagesEpoch;
  c.appended = snapshot.appended;
  c.trace = snapshot.trace;
  c.runTraceFrom = 0;
  c.activity = snapshot.activity;
  c.byoUnresolved = snapshot.byoUnresolved;
  c.providerCap = snapshot.providerCap;
  emit(c);
}
async function startRun(chatId, req) {
  const driver = getRunDriver();
  if (driver) return driver.start(chatId, req);
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
  c.deltaTicketId = null;
  c.deltaRecordedFiles = [];
  c.runTraceFrom = c.trace.length;
  c.codeModel = null;
  c.liveTurn = null;
  c.stoppedTurn = null;
  c.runId = runOutcomeId(chatId, Date.now());
  c.abort = new AbortController();
  c.activity = { phase: "starting", startedAt: Date.now(), step: 0 };
  if (req.seed && c.transcript.length === 0) {
    c.transcript = req.seed.slice();
    c.priorResearch = req.priorResearch ?? null;
  }
  if (req.userTurn !== void 0) c.transcript.push({ role: "user", content: req.userTurn });
  emit(c);
  try {
    await runLoop(chatId, c, req);
  } catch (e) {
    if (!c.abort?.signal.aborted) {
      c.error = e instanceof Error ? e.message : "Reply failed";
      c.errorAction = chatErrorAction(e);
      recordRunFailure(c, chatId, req.persistence, "agent.run", c.error);
    }
  } finally {
    const aborted = c.abort?.signal.aborted ?? false;
    c.running = false;
    c.streamingText = "";
    c.abort = null;
    if (aborted) await keepStoppedTurn(chatId, c, req.persistence).catch(() => {
    });
    if (!aborted && c.codeChanged && req.projectId != null && req.runTool) {
      c.activity = { phase: "finishing", startedAt: Date.now(), step: 0 };
      emit(c);
    }
    if (!aborted && c.codeChanged && req.projectId != null && req.runTool && (!c.ticketRecorded || c.deltaTicketId != null)) {
      await recordCodeChangeTicket(chatId, c, req, "settle").catch(() => {
      });
    }
    if (!aborted && c.codeChanged && req.projectId != null && req.runTool) {
      await advanceLinkedTickets(chatId, c, req).catch(() => {
      });
    }
    const shipped = !aborted && c.codeChanged && shippedToBaseBranch(runTrace(c), { touchedFiles: c.touchedFiles });
    if (shipped && req.projectId != null && req.runTool) {
      await completeShippedTickets(chatId, c, req).catch(() => {
      });
    }
    const outcome = req.reportOutcome && codeRunOutcome({
      runId: c.runId,
      codeModel: c.codeModel,
      codeChanged: c.codeChanged,
      aborted,
      failed: c.error !== "",
      shipped,
      trace: runTrace(c),
      projectId: req.projectId
    });
    if (outcome) void req.reportOutcome(outcome).catch(() => void 0);
    c.activity = null;
    emit(c);
  }
}
async function recordCodeChangeTicket(chatId, c, req, phase) {
  if (!req.runTool || req.projectId == null) return;
  const known = new Set(c.deltaRecordedFiles);
  const files = c.touchedFiles.filter((f) => !known.has(f)).slice(0, 50);
  if (phase === "settle" && c.deltaTicketId != null && files.length === 0) return;
  const attachTo = c.deltaTicketId;
  const summary = files.length ? `Code change (${files.length} file${files.length === 1 ? "" : "s"}) from Brain chat #${chatId}` : `Code change from Brain chat #${chatId}`;
  const toolStart = nowMs2();
  const args = {
    projectId: req.projectId,
    summary,
    detail: attachTo != null ? "Auto-captured: further files changed by the same chat, attached to the ticket this run opened." : "Auto-captured: this chat changed code without recording a ticket, so the platform minted one to keep the work visible on the board and linked to the conversation.",
    files,
    kind: "improvement",
    modality: "ide",
    chatId,
    ...attachTo != null ? { taskId: attachTo } : {}
  };
  let out;
  try {
    out = await req.runTool("builtin_tickets_from_delta", args);
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!isFailedToolResult(out)) {
    c.deltaRecordedFiles = [...c.deltaRecordedFiles, ...files];
    const id = out?.id;
    if (c.deltaTicketId == null && typeof id === "number") c.deltaTicketId = id;
    c.ticketRecorded = true;
  }
  pushDurableStep(c, chatId, req.persistence, {
    ts: nowIso(),
    category: "tool",
    label: "builtin_tickets_from_delta",
    durationMs: nowMs2() - toolStart,
    args: { ...args, auto: true, phase },
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
async function completeShippedTickets(chatId, c, req) {
  if (!req.runTool) return;
  let listed;
  try {
    listed = await req.runTool("builtin_chats_list_tickets", { chatId });
  } catch {
    return;
  }
  for (const t of linkedTicketsToComplete(listed)) {
    const id = Number(t.ref);
    if (!Number.isInteger(id)) continue;
    const toolStart = nowMs2();
    let out;
    try {
      out = await req.runTool("builtin_tasks_update", { id, status: "done" });
    } catch (e) {
      out = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    pushDurableStep(c, chatId, req.persistence, {
      ts: nowIso(),
      category: "tool",
      label: "builtin_tasks_update",
      durationMs: nowMs2() - toolStart,
      // The REASON rides on the step: a ticket that closed itself must say what
      // closed it, or the board's history reads as an unexplained status change.
      args: { id, status: "done", auto: true, reason: "shipped-to-base-branch" },
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
function canonicalTurnText(text) {
  const { content, reasoning } = splitVendorReasoning({ content: text });
  return canonicalReasoningText(content, reasoning);
}
async function runLoop(chatId, c, req) {
  const { resolvedSystemPrompt, tools: toolSpecs, model, modelStrict, routingMode, pickFallbackModel, runTool, needsConfirm, stream, persistence, onActivity, evermind, maxTokens, reasoning } = req;
  const convo = c.transcript;
  const canAskUser = !!runTool && (toolSpecs?.length ?? 0) > 0;
  const catalog = canAskUser ? [...toolSpecs ?? [], ASK_USER_TOOL_SPEC] : toolSpecs;
  const allTools = catalog && catalog.length > 0 ? catalog : void 0;
  const usedTools = /* @__PURE__ */ new Set();
  const brokenModels = /* @__PURE__ */ new Set();
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
  const memoryReplay = memoryReplayable(latestUserText(convo), { followUp: isFollowUpTurn(convo) });
  if (evermind?.answer && memoryReplay && !c.abort?.signal.aborted) {
    const query = latestUserText(convo);
    if (query) {
      let memAnswer = null;
      try {
        memAnswer = await evermind.answer(query, { toolsAvailable: !!allTools && allTools.length > 0 });
      } catch {
        memAnswer = null;
      }
      const finalText = canonicalTurnText(memAnswer?.text ?? "");
      if (finalText) {
        convo.push({ role: "assistant", content: replayTextOf(finalText) });
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
  const catalogToolNames = (req.tools ?? []).map((t) => t.function.name);
  const canEditHere = canChangeCodeHere(catalogToolNames);
  systemPrompt = `${systemPrompt}

${chatModeDirective(runMode, chatId, { canEditHere, canDelegate: catalogToolNames.includes("spawn_agent") })}

${turnOptimizationDirective()}`;
  const canShip = canShipHere(catalogToolNames);
  if (canShip) systemPrompt = `${systemPrompt}

${selfReviewShipDirective(chatId)}`;
  if (c.priorResearch) systemPrompt = `${systemPrompt}

${c.priorResearch}`;
  const userRequest = latestUserText(convo);
  if (isContinuationDirective(userRequest) && promisesUnfinishedWork(lastAssistantText(convo))) {
    systemPrompt = `${systemPrompt}

${continuationDirective()}`;
    pushTrace(c, {
      ts: nowIso(),
      category: "message",
      label: "turn.continuation_resolved",
      result: "The user's bare directive was resolved against the previous turn's unfinished proposal, so the run carries that proposal out instead of asking what to fix."
    });
  }
  const readCoverage = new ReadCoverage();
  const failures = new FailureTally();
  const failureAdvisoryFor = (name, args, out, step) => {
    const attempts = failures.record(name, args);
    const advisory = repeatedFailureAdvisory(name, attempts, failureReason(out));
    if (advisory) {
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: "tools.repeat_failure_guard",
        args: { step, tool: name, attempts },
        result: advisory
      });
    }
    return advisory;
  };
  let forceToolChoice;
  let announcementRecoveries = 0;
  let phase = c.codeChanged ? "code" : "plan";
  let shipRecoveryUsed = false;
  let activeModel = model;
  const triedModels = [];
  let modelFailovers = 0;
  const requestQuery = routingQueryForTurn(convo);
  const alwaysAdvertised = [
    ...toolNamesMentionedIn(systemPrompt),
    ...localToolsIn(catalogToolNames),
    // The project-memory pair (recall before re-reading; remember what was learned) is
    // the cheapest tool in the catalog and the first one relevance would drop.
    ...memoryToolsIn(catalogToolNames),
    // Asking the user is never off-topic: it is how the run stops when it cannot
    // proceed, so relevance against the request must not be what decides whether the
    // agent is allowed to ask. Its one schema is also the cheapest in the catalog.
    ...canAskUser ? [ASK_USER_TOOL] : []
  ];
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
    if (evermind?.cacheAnswer && memoryReplay) {
      const q = latestUserText(convo);
      if (q) {
        void Promise.resolve(evermind.cacheAnswer(q, finalText)).catch(() => {
        });
      }
    }
  };
  const metaOf = (turn) => turn.meta;
  const codec = openAiChatCodec((r) => typeof r.data === "string" ? r.data : JSON.stringify(r.data));
  let pendingReplay = null;
  let pendingRun = null;
  const settleReply = async (rawText, result, requested) => {
    const text = canonicalTurnText(rawText);
    convo.push({ role: "assistant", content: replayTextOf(text) });
    const meta = provenanceMetadata(result, requested);
    const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: text, ...meta ? { metadata: meta } : {} }]);
    c.streamingText = "";
    recordAppended(c, assistantMsg);
    return assistantMsg;
  };
  const hooks = {
    beforeToolCalls: async (_ctx, turn, calls) => {
      const { result, requested } = metaOf(turn);
      const askCall = calls.find((tc) => tc.name === ASK_USER_TOOL);
      if (askCall) {
        let block = null;
        try {
          block = askCall.malformed ? null : askUserBlock(askCall.args);
        } catch {
          block = null;
        }
        const lead = result.text.trim();
        const reply = block ? lead ? `${lead}

${block}` : block : lead;
        if (reply) {
          const assistantMsg = await settleReply(reply, result, requested);
          emit(c);
          emitEvermindLearnReconcile(assistantMsg, reply);
          onActivity?.(chatId);
          return { action: "stop", ok: true, output: reply };
        }
      }
      const narration = canonicalTurnText(result.text);
      if (narration) {
        const meta = provenanceMetadata(result, requested);
        const [narrationMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: narration, ...meta ? { metadata: meta } : {} }]);
        recordAppended(c, narrationMsg);
      }
      c.streamingText = "";
      emit(c);
      return void 0;
    },
    beforeDispatch: async (rawCall, ctx) => {
      const iter = ctx.step;
      pendingReplay = null;
      pendingRun = null;
      let call = rawCall;
      {
        const aliased = resolveToolAlias(call.name);
        if (aliased !== call.name) call = { ...call, name: aliased };
      }
      if (isRouterTool(call.name)) {
        const routed = handleRouterCall(allTools ?? [], call.name, call.args);
        if ("result" in routed) {
          pushDurableStep(c, chatId, persistence, {
            ts: nowIso(),
            category: "tool",
            label: call.name,
            args: call.args,
            result: routed.result
          });
          return { result: { data: routed.result } };
        }
        const routedArgs = routed.dispatch.args ?? {};
        call = { ...call, name: routed.dispatch.name, args: routedArgs, raw: { ...call.raw, name: routed.dispatch.name, arguments: JSON.stringify(routedArgs) } };
        pushTrace(c, {
          ts: nowIso(),
          category: "message",
          label: "tools.routed",
          args: { step: iter, via: rawCall.name },
          result: `Called ${call.name} through the tool router (it was not advertised directly this turn).`
        });
      }
      if (call.name === ASK_USER_TOOL) {
        return { result: { data: { error: "ask_user needs { question, options:[{label}] } with 2+ options. Retry or answer in prose." } } };
      }
      const args = call.args;
      attachDeltaToRunTicket(call.name, args, c.deltaTicketId);
      if (needsConfirm && needsConfirm({ name: call.name, args })) {
        const ok = await requestRunConfirm(chatId, { name: call.name, args }, { step: iter });
        if (!ok) {
          const declined = { cancelled: true, reason: "User declined this action." };
          pushDurableStep(c, chatId, persistence, { ts: nowIso(), category: "tool", label: call.name, args, result: declined });
          return { result: { data: declined } };
        }
      }
      if (isDedupableRead(call.name)) {
        if (readCoverage.isRepeat(call.name, args)) {
          const cached2 = readCoverage.cachedResult(call.name, args);
          if (cached2 && !stillInWorkingContext(c, cached2.anchor)) {
            const replayNote = `Replayed from this run's read cache: this exact ${call.name} call succeeded earlier in the run, but its result was compressed out of the working context, so here it is again \u2014 served from memory, not re-read. Act on it now; do not request it again.`;
            const visit = readCoverage.record(call.name, args);
            const target = visit ? visitTarget(args) : void 0;
            const revisit = visit && target ? revisitAdvisory(call.name, target, visit) : null;
            const replayed = trimToolResult(call.name, cached2.result ?? null, { advisory: revisit ? `${replayNote}

${revisit}` : replayNote });
            pendingReplay = { name: call.name, args, result: cached2.result };
            pushTrace(c, {
              ts: nowIso(),
              category: "tool",
              label: call.name,
              args,
              result: { replayed: true, note: replayNote },
              resultBytes: replayed.bytes,
              truncated: replayed.truncated
            });
            return { result: { data: replayed.content } };
          }
          const stub = {
            note: `Duplicate ${call.name} call \u2014 identical arguments to an earlier call this turn, whose result is already in the conversation above. Reuse that result instead of re-reading; do not repeat it (this saves context and avoids looping).`
          };
          pushTrace(c, { ts: nowIso(), category: "tool", label: call.name, args, result: stub });
          return { result: { data: stub } };
        }
        const covered = readCoverage.coveredRead(call.name, args);
        if (covered) {
          const visit = readCoverage.record(call.name, args);
          const target = visit ? visitTarget(args) : void 0;
          const revisit = visit && target ? revisitAdvisory(call.name, target, visit) : null;
          const note = revisit ? `${covered.note}

${revisit}` : covered.note;
          if (covered.cached && !stillInWorkingContext(c, covered.cached.anchor)) {
            const replayed = trimToolResult(call.name, covered.cached.result ?? null, { advisory: note });
            pendingReplay = { name: call.name, args, result: covered.cached.result };
            pushTrace(c, {
              ts: nowIso(),
              category: "tool",
              label: call.name,
              args,
              result: { covered: true, replayed: true, note },
              resultBytes: replayed.bytes,
              truncated: replayed.truncated
            });
            return { result: { data: replayed.content } };
          }
          const stub = { note };
          pushTrace(c, { ts: nowIso(), category: "tool", label: call.name, args, result: { covered: true, note } });
          return { result: { data: stub } };
        }
        const derived = readCoverage.derivedSearch(call.name, args);
        if (derived) {
          const visit = readCoverage.record(call.name, args);
          const target = visit ? visitTarget(args) : void 0;
          const revisit = visit && target ? revisitAdvisory(call.name, target, visit) : null;
          const served = trimToolResult(call.name, derived, { advisory: revisit });
          pendingReplay = { name: call.name, args, result: derived };
          pushTrace(c, {
            ts: nowIso(),
            category: "tool",
            label: call.name,
            args,
            result: { derived: true, note: derived.note },
            resultBytes: served.bytes,
            truncated: served.truncated
          });
          return { result: { data: served.content } };
        }
      } else {
        readCoverage.invalidate(call.name, args);
      }
      return call === rawCall ? void 0 : { rewrite: call };
    },
    afterDispatch: (call, _result, row) => {
      if (pendingReplay) {
        readCoverage.cacheResult(pendingReplay.name, pendingReplay.args, { result: pendingReplay.result, anchor: row });
        pendingReplay = null;
        return void 0;
      }
      const run = pendingRun;
      pendingRun = null;
      if (!run) return void 0;
      const args = call.args;
      if (run.threw) {
        pushDurableStep(c, chatId, persistence, { ts: nowIso(), category: "tool", label: call.name, durationMs: nowMs2() - run.toolStart, args, result: run.out, isError: true });
        return void 0;
      }
      if (run.isReadTool && !isFailedToolResult(run.out)) readCoverage.cacheResult(call.name, args, { result: run.out ?? null, anchor: row });
      pushDurableStep(c, chatId, persistence, {
        ts: nowIso(),
        category: "tool",
        label: call.name,
        durationMs: nowMs2() - run.toolStart,
        args,
        result: run.out ?? null,
        isError: isFailedToolResult(run.out),
        resultBytes: run.bytes,
        truncated: run.truncated
      });
      usedTools.add(call.name);
      return void 0;
    },
    onNoToolCalls: async (ctx, turn) => {
      const iter = ctx.step;
      const { result, resolved, requested, advertised, advertisedNames } = metaOf(turn);
      const stallInput = {
        text: result.text,
        toolCallCount: result.toolCalls.length,
        availableToolCount: toolSpecs?.length ?? 0,
        recoveriesUsed: announcementRecoveries,
        availableToolNames: [...advertisedNames],
        requestText: userRequest
      };
      const shape = stallShape(stallInput);
      const requeueWithNudge = async (nudge) => {
        const narration = canonicalTurnText(result.text);
        if (narration) {
          const meta = provenanceMetadata(result, requested);
          const [narrationMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: narration, ...meta ? { metadata: meta } : {} }]);
          recordAppended(c, narrationMsg);
        }
        convo.push({ role: "assistant", content: replayTextOf(result.text) });
        convo.push({ role: "user", content: nudge });
      };
      if (runTool && shouldRecoverStalledTurn(stallInput)) {
        announcementRecoveries += 1;
        const lastChance = announcementRecoveries >= MAX_ANNOUNCEMENT_RECOVERIES;
        forceToolChoice = stallRecoveryToolChoice(stallInput);
        await requeueWithNudge(stallRecoveryNudge(lastChance, shape));
        pushDurableStep(c, chatId, persistence, {
          ts: nowIso(),
          category: "message",
          label: shape === "handed-off" ? "loop.recover_handed_off_work" : "loop.recover_announced_tool_call",
          args: { step: iter, attempt: announcementRecoveries, of: MAX_ANNOUNCEMENT_RECOVERIES, advertisedTools: advertised, shape },
          result: shape === "handed-off" ? `Model ended by telling the user to run the commands itself holds tools for \u2014 re-prompted to run them (${announcementRecoveries}/${MAX_ANNOUNCEMENT_RECOVERIES}).` : `Model announced a tool call without making one \u2014 re-prompted (${announcementRecoveries}/${MAX_ANNOUNCEMENT_RECOVERIES}).`
        });
        c.streamingText = "";
        emit(c);
        return { action: "continue" };
      }
      if (runTool && !shipRecoveryUsed && leftChangeUnshipped({
        codeChanged: c.codeChanged,
        toolNames: catalogToolNames,
        requestText: userRequest,
        events: runTrace(c)
      })) {
        shipRecoveryUsed = true;
        await requeueWithNudge(unshippedChangeNudge());
        pushDurableStep(c, chatId, persistence, {
          ts: nowIso(),
          category: "message",
          label: "loop.recover_unshipped_change",
          args: { step: iter, files: c.touchedFiles.slice(0, 20) },
          result: "Run changed code and ended without committing or pushing it \u2014 re-prompted to verify, self-review and ship (this local session is the change's only reviewer)."
        });
        c.streamingText = "";
        emit(c);
        return { action: "continue" };
      }
      const finalText = result.text.trim() || "No response.";
      const assistantMsg = await settleReply(finalText, result, requested);
      if (runTool && isExhaustedStall(stallInput)) {
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
            result: modelFailoverNotice(resolved, next, shape)
          });
          activeModel = next;
          announcementRecoveries = 0;
          forceToolChoice = stallRecoveryToolChoice(stallInput);
          convo.push({ role: "user", content: stallRecoveryNudge(false, shape) });
          c.streamingText = "";
          emit(c);
          return { action: "continue" };
        }
        const notice = stallExhaustedNotice(resolved, triedModels, shape);
        pushDurableStep(c, chatId, persistence, {
          ts: nowIso(),
          category: "error",
          label: "loop.stall_unrecovered",
          args: { step: iter, model: resolved, attempts: announcementRecoveries, tried: triedModels, advertisedTools: advertised, shape },
          result: notice,
          isError: true
        });
        c.error = notice;
      }
      emit(c);
      emitEvermindLearnReconcile(assistantMsg, finalText);
      onActivity?.(chatId);
      return { action: "stop", ok: true, output: finalText };
    }
  };
  const ports = {
    complete: async (ctx) => {
      const iter = ctx.step;
      c.streamingText = "";
      emit(c);
      const working = await buildWorkingTranscript(
        c,
        systemPrompt,
        (msgs) => summarizeMiddle(stream, activeModel, msgs, c.abort?.signal),
        (dropped) => {
          pushTrace(c, {
            ts: nowIso(),
            category: "message",
            label: "context.compacted",
            args: { droppedMessages: dropped },
            result: `Compressed ${dropped} earlier step(s) into a memory to stay within the context window.`
          });
          emit(c);
        }
      );
      if (c.abort?.signal.aborted) throw new Error("run stopped");
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
        // edit can never silently desync from this list — plus the local workspace
        // tools, which the prompt names in prose the pattern cannot see.
        required: alwaysAdvertised
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
      setActivity(c, { phase: "thinking", startedAt: Date.now(), step: iter });
      const composing = createComposingActivity(
        { set: (a) => {
          c.activity = a;
        }, repaint: () => emit(c), coalescedRepaint: () => emitStreaming(c) },
        { step: iter }
      );
      const handlers = {
        onModel: liveTurnModel(c),
        onTextDelta: (d) => {
          c.streamingText += d;
          if (firstTokenAt === void 0) {
            firstTokenAt = nowMs2();
            c.activity = { phase: "writing", startedAt: Date.now(), step: iter };
            emit(c);
            return;
          }
          emitStreaming(c);
        },
        // The first argument fragment is this turn's first token too: a tool-only turn
        // recorded no ttft at all, so "Thought for Xs" covered the whole turn.
        onToolCallDelta: (index, partial) => {
          if (firstTokenAt === void 0) firstTokenAt = nowMs2();
          composing.onDelta(index, partial);
        }
      };
      let turnRole = tools ? phase : "chat";
      const turnToolChoice = forceToolChoice;
      forceToolChoice = void 0;
      const request = (role, excludeModels) => asLiveTurn(c, () => stream(
        {
          messages: working,
          tools,
          tool_choice: tools ? turnToolChoice ?? "auto" : void 0,
          model: activeModel,
          modelStrict: !!activeModel && modelStrict,
          routingMode,
          maxTokens,
          reasoning,
          metadata,
          role,
          ...excludeModels.length > 0 ? { excludeModels } : {},
          signal: c.abort?.signal
        },
        handlers
      ));
      const turnError = (e) => {
        pushTrace(c, {
          ts: nowIso(),
          category: "error",
          label: "llm.complete",
          durationMs: nowMs2() - llmStart,
          // The model that broke, not the requested one: under auto-routing that is 'default'.
          args: { model: e instanceof StreamInterruptedError && e.model || activeModel || "default", step: iter },
          result: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
          isError: true
        });
        return e;
      };
      const restartTurn = () => {
        c.streamingText = "";
        firstTokenAt = void 0;
        composing.reset();
        emit(c);
      };
      try {
        result = await request(turnRole, [...brokenModels]);
      } catch (e) {
        if (c.abort?.signal.aborted) throw e;
        const isRetryableError = e instanceof StreamInterruptedError || e instanceof TransportError;
        if (!isRetryableError || activeModel) throw turnError(e);
        if (e instanceof StreamInterruptedError && e.model) {
          brokenModels.add(e.model);
          pushDurableStep(c, chatId, persistence, {
            ts: nowIso(),
            category: "message",
            label: "llm.stream_interrupted",
            args: { model: e.model, step: iter },
            result: `${e.message} \u2014 retrying this turn on another connected model. ${e.model} is left out for the rest of this run.`
          });
        } else {
          pushDurableStep(c, chatId, persistence, {
            ts: nowIso(),
            category: "message",
            label: "llm.transport_error",
            args: { step: iter },
            result: `${e.message} \u2014 retrying this turn on another connected model.`
          });
        }
        restartTurn();
        try {
          result = await request(turnRole, [...brokenModels]);
        } catch (retryError) {
          if (c.abort?.signal.aborted) throw retryError;
          throw turnError(retryError);
        }
      }
      if (turnRole === "plan" && !activeModel && result.toolCalls.some((tc) => isCodeChangeTool(tc.name))) {
        phase = "code";
        turnRole = "code";
        pushTrace(c, {
          ts: nowIso(),
          category: "message",
          label: "llm.role_handoff",
          args: { from: result.resolvedModel ?? "default", step: iter },
          result: `Analysis on ${result.resolvedModel ?? "the planning model"} reached its first code change \u2014 handing the edit to the strongest connected coding model.`
        });
        restartTurn();
        try {
          result = await request("code", [...brokenModels]);
        } catch (e) {
          if (c.abort?.signal.aborted) throw e;
          throw turnError(e);
        }
      }
      if (result.toolCalls.length > 0) announcementRecoveries = 0;
      if (result.resolvedModel && result.toolCalls.some((tc) => isCodeChangeTool(tc.name))) c.codeModel = result.resolvedModel;
      accrueByoUnresolved(c, result.byoUnresolved);
      accrueProviderCap(c, result.providerCap);
      const resolved = result.resolvedModel ?? activeModel ?? "default";
      const requested = activeModel ?? "default";
      setLastResolvedModel(chatId, result.resolvedModel);
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
      const argBytes = toolCallArgBytes(result.toolCalls);
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
          // What the turn asked the gateway for (analysis vs code vs chat), so a copied
          // report shows which model planned and which one wrote the code.
          role: turnRole,
          toolCalls: result.toolCalls.length,
          // How much the turn actually EMITTED. "1 tool call(s) · 202509ms" said
          // nothing about a turn that spent three minutes streaming 21 KB of
          // `write_file` arguments — which is what a long turn usually is.
          ...argBytes > 0 ? { argBytes } : {},
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
          ...narratedUnadvertised.length ? { narratedUnadvertised } : {},
          // The stream filter strips every call it lifts, so call markup still IN the text
          // is a dialect it does not know: the model tried to act and the call never ran.
          // Recorded so a copied report says "parser gap" instead of "won't call tools".
          ...result.toolCalls.length === 0 && hasCallMarkup(result.text) ? { unliftedCallMarkup: true } : {},
          // What the vendor's RAW response carried, counted before the gateway translated
          // it — so a text-only turn reads as "the model returned no call" or "a returned
          // call was lost on the way", never as a guess. Absent when the vendor does not report it.
          ...result.upstream ? { upstreamFunctionCalls: result.upstream.functionCalls, upstreamRecovered: result.upstream.recovered } : {}
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
      const meta = { result, resolved, requested, advertised: advertised.length, advertisedNames };
      const toolCalls = runTool ? result.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.args })) : [];
      return { content: replayTextOf(result.text), toolCalls, meta };
    },
    dispatch: async (call, ctx) => {
      const iter = ctx.step;
      const args = call.args;
      const isReadTool = isDedupableRead(call.name);
      const toolStart = nowMs2();
      setActivity(c, toolActivity(call.name, args, iter, Date.now()));
      if (!runTool) throw new Error("tool call without a tool runner");
      let out;
      try {
        out = await runTool(call.name, withObservedModel(chatId, call.name, args));
      } catch (e) {
        const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        out = { ok: false, error: message };
        const repeat = failureAdvisoryFor(call.name, args, out, iter);
        pendingRun = { out, toolStart, isReadTool, threw: true };
        return { data: repeat ? withAdvisory(out, repeat) : out, isError: true };
      }
      if (isCodeChangeTool(call.name)) {
        const first = !c.codeChanged;
        c.codeChanged = true;
        const f = codeChangeFile(args);
        if (f && !c.touchedFiles.includes(f)) c.touchedFiles.push(f);
        if (first && !c.ticketRecorded && req.projectId != null && req.runTool) {
          await recordCodeChangeTicket(chatId, c, req, "open").catch(() => {
          });
        }
      }
      if (isTicketRecordingTool(call.name)) c.ticketRecorded = true;
      await autoLinkCreatedItem(chatId, c, persistence, runTool, call.name, out);
      let advisory = null;
      if (isFailedToolResult(out)) {
        advisory = failureAdvisoryFor(call.name, args, out, iter);
      } else {
        failures.clear(call.name, args);
        if (isReadTool) {
          const visit = readCoverage.record(call.name, args);
          const target = visit ? visitTarget(args) : void 0;
          advisory = visit && target ? revisitAdvisory(call.name, target, visit) : null;
          if (advisory) {
            pushTrace(c, {
              ts: nowIso(),
              category: "message",
              label: "tools.revisit_guard",
              args: { step: iter, tool: call.name, target, visits: visit.count },
              result: advisory
            });
          }
        }
      }
      const trimmedOut = trimToolResult(call.name, out ?? null, { advisory });
      pendingRun = { out, toolStart, isReadTool, threw: false, bytes: trimmedOut.bytes, truncated: trimmedOut.truncated };
      return { data: trimmedOut.content, isError: isFailedToolResult(out) };
    }
  };
  const loop = await runAgentLoop({
    messages: convo,
    codec,
    ports,
    hooks,
    signal: c.abort?.signal,
    // No step cap. The kernel's consecutive-tool-failure breaker is the run's only
    // limit — see the "no tool-iteration ceiling" note at the top of this module.
    budget: {}
  });
  if (loop.finished || loop.cancelled) return;
  const streak = loop.failureStreak;
  c.streamingText = "";
  if (!c.abort?.signal.aborted) {
    const closeStart = nowMs2();
    try {
      const working = [
        { role: "system", content: systemPrompt },
        ...windowed(convo),
        {
          role: "user",
          content: `This turn was stopped because your last ${streak} tool calls all failed. Do NOT call any more tools. Answer the user now, in prose, using what you have already gathered \u2014 say what you completed, quote what the failing calls answered, and state plainly what is blocking you and what you need (a different argument, a permission, a decision) so the next turn can succeed.`
        }
      ];
      let closeFirstTokenAt;
      const closing = await asLiveTurn(c, () => stream(
        // No `tools` → the model can't call another tool and must produce text.
        { messages: working, model: activeModel, modelStrict: !!activeModel && modelStrict, routingMode, maxTokens, reasoning, metadata, signal: c.abort?.signal },
        {
          onModel: liveTurnModel(c),
          onTextDelta: (d) => {
            if (closeFirstTokenAt === void 0) closeFirstTokenAt = nowMs2();
            c.streamingText += d;
            emit(c);
          }
        }
      ));
      accrueByoUnresolved(c, closing.byoUnresolved);
      accrueProviderCap(c, closing.providerCap);
      pushTrace(c, {
        ts: nowIso(),
        category: "llm",
        label: "llm.complete",
        durationMs: nowMs2() - closeStart,
        ttftMs: closeFirstTokenAt !== void 0 ? closeFirstTokenAt - closeStart : void 0,
        args: { model: closing.resolvedModel ?? activeModel ?? "default", requestedModel: activeModel ?? "default", step: loop.step, toolCalls: 0, forcedFinish: true, failureStreak: streak, account: closing.account, byoUnresolved: closing.byoUnresolved },
        usage: closing.usage,
        finishReason: closing.finishReason,
        textChars: closing.text.length,
        result: `forced final synthesis (${streak} consecutive tool failures stopped the run) \xB7 ${closing.text.length} chars \xB7 finish: ${closing.finishReason ?? "\u2014"}`
      });
      const closingText = canonicalTurnText(closing.text);
      if (closingText) {
        convo.push({ role: "assistant", content: replayTextOf(closingText) });
        const meta = provenanceMetadata(closing, activeModel);
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
  recordRunFailure(
    c,
    chatId,
    req.persistence,
    "agent.loop",
    `Stopped after ${streak} consecutive failed tool calls over ${loop.step} steps (a forced final answer without tools also came back empty)`
  );
  c.error = `The assistant's last ${streak} tool calls all failed and it gave no answer. Read the failing steps above, then try again with what they ask for.`;
  emit(c);
}

// src/useBrainConversation.ts
function seedFrom(history) {
  return scopeToConsolidation(history).filter((m) => !isStepMessage(m) && !isStoppedTurn(m)).flatMap((m) => {
    if (m.role !== "assistant") return [{ role: m.role, content: m.content }];
    const content = replayTextOf(m.content);
    return content ? [{ role: "assistant", content }] : [];
  });
}
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
  const [messages, setMessages] = (0, import_react7.useState)([]);
  const [loadingMessages, setLoadingMessages] = (0, import_react7.useState)(false);
  const [reloadNonce, setReloadNonce] = (0, import_react7.useState)(0);
  const reloadMessages = (0, import_react7.useCallback)(() => setReloadNonce((n) => n + 1), []);
  const sendingRef = (0, import_react7.useRef)(/* @__PURE__ */ new Set());
  const [sendingChats, setSendingChats] = (0, import_react7.useState)(sendingRef.current);
  const markSending = (0, import_react7.useCallback)((key, on) => {
    const next = new Set(sendingRef.current);
    if (on) next.add(key);
    else next.delete(key);
    sendingRef.current = next;
    setSendingChats(next);
  }, []);
  const localSending = sendingChats.has(chatId);
  const chatIdRef = (0, import_react7.useRef)(chatId);
  chatIdRef.current = chatId;
  const [localError, setLocalError] = (0, import_react7.useState)("");
  const [ratings, setRatings] = (0, import_react7.useState)({});
  const [pendingAttachments, setPendingAttachments] = (0, import_react7.useState)([]);
  const [uploading, setUploading] = (0, import_react7.useState)(false);
  const autoRepliedChatIdRef = (0, import_react7.useRef)(null);
  const [snapshot, setSnapshot] = (0, import_react7.useState)(() => getRunSnapshot(chatId));
  (0, import_react7.useEffect)(() => {
    setSnapshot(getRunSnapshot(chatId));
    if (chatId == null) return;
    return subscribeRun(chatId, () => setSnapshot(getRunSnapshot(chatId)));
  }, [chatId]);
  (0, import_react7.useEffect)(() => {
    let cancelled = false;
    if (chatId == null) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    setLocalError("");
    persistence.getMessages(chatId).then((list) => {
      if (!cancelled) setMessages(mergeTranscript(list, getRunSnapshot(chatId).appended));
    }).catch((e) => {
      if (!cancelled) setLocalError(e instanceof Error ? e.message : "Failed to load messages");
    }).finally(() => {
      if (!cancelled) setLoadingMessages(false);
    });
    return () => {
      cancelled = true;
    };
  }, [persistence, chatId, reloadNonce]);
  (0, import_react7.useEffect)(() => {
    if (chatId == null || !persistence.subscribeMessages) return;
    return persistence.subscribeMessages(chatId, reloadMessages);
  }, [persistence, chatId, reloadMessages]);
  const lastMarkedRef = (0, import_react7.useRef)(null);
  (0, import_react7.useEffect)(() => {
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
  (0, import_react7.useEffect)(() => {
    const appended = snapshot.appended;
    if (appended.length === 0) return;
    setMessages((prev) => mergeTranscript(prev, appended));
  }, [snapshot.messagesEpoch, snapshot.appended]);
  (0, import_react7.useEffect)(() => {
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
  const buildRequest = (0, import_react7.useCallback)(
    (seed, userTurn, priorResearch) => ({
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
      priorResearch,
      userTurn,
      projectId,
      chatMode
    }),
    [fullSystemPrompt, toolSpecs, model, modelStrict, routingMode, pickFallbackModel, maxTokens, reasoning, runTool, needsConfirm, stream, persistence, onActivity, evermind, augmentSystemPrompt, projectId, chatMode]
  );
  const send = (0, import_react7.useCallback)(
    async (text, opts) => {
      const trimmed = text.trim();
      if (!trimmed || sendingRef.current.has(chatId) || isRunning(chatId)) return false;
      const addressedTo = opts?.addressedTo ?? null;
      const origin = chatId;
      markSending(origin, true);
      let id = chatId;
      if (id == null) {
        try {
          id = await ensureChatId?.() ?? null;
        } catch {
          id = null;
        }
        if (id == null) {
          markSending(origin, false);
          setLocalError("Could not start a chat.");
          return false;
        }
        markSending(id, true);
        markSending(origin, false);
      }
      const runChatId = id;
      const stillOpen = () => chatIdRef.current === runChatId || chatIdRef.current === origin;
      autoRepliedChatIdRef.current = id;
      const attachments = [...pendingAttachments];
      setPendingAttachments([]);
      setLocalError("");
      let displayContent = trimmed;
      if (attachments.length > 0) {
        const refs = attachments.map((a) => `[Attached: ${a.name}](${persistence.uploadUrl(a.key)})`).join("\n");
        displayContent = `${trimmed}

${refs}`;
      }
      const addressedList = addressedTo == null ? null : Array.isArray(addressedTo) ? addressedTo : addressedTo.kind === "group" ? addressedTo.members : [addressedTo];
      const metadata = withDirectedMetadata(addressedList, attachments.length > 0 ? { attachments } : void 0);
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
        if (stillOpen()) setMessages((prev) => [...prev, userMsg]);
        onActivity?.(id);
        if (messages.length === 0) onFirstUserTurn?.(id, trimmed);
        if (addressedTo) {
          const agents = directedAgentRecipients(addressedTo);
          if (agents.length > 0) {
            if (!persistence.requestAgentReply) {
              if (stillOpen()) setLocalError("This session cannot ask an agent to reply.");
            } else {
              for (const agent of agents) {
                try {
                  const reply = await persistence.requestAgentReply(id, { agentRef: agent.ref, agentName: agent.name });
                  if (reply && stillOpen()) {
                    setMessages((prev) => reply.id != null && prev.some((m) => m.id === reply.id) ? prev : [...prev, reply]);
                    onActivity?.(id);
                  }
                } catch (e) {
                  if (stillOpen()) setLocalError(e instanceof Error ? e.message : "The agent could not reply.");
                }
              }
            }
          }
          return true;
        }
        await startRun(id, buildRequest(seedFrom(messages), modelContent, priorResearchDigest(scopeToConsolidation(messages))));
        return true;
      } catch (e) {
        if (stillOpen()) {
          setPendingAttachments(attachments);
          setLocalError(e instanceof Error ? e.message : "Send failed");
        }
        return false;
      } finally {
        markSending(runChatId, false);
      }
    },
    [persistence, chatId, markSending, pendingAttachments, messages, ensureChatId, buildRequest, onActivity, onFirstUserTurn]
  );
  (0, import_react7.useEffect)(() => {
    if (chatId == null || loadingMessages || localSending || messages.length === 0) return;
    if (isRunning(chatId)) return;
    const last = messages[messages.length - 1];
    if (last.role !== "user") return;
    if (isDirectedToParticipant(last)) return;
    if (autoRepliedChatIdRef.current === chatId) return;
    autoRepliedChatIdRef.current = chatId;
    setLocalError("");
    void startRun(chatId, buildRequest(seedFrom(messages.slice(0, -1)), last.content, priorResearchDigest(scopeToConsolidation(messages))));
  }, [chatId, loadingMessages, localSending, messages, buildRequest]);
  const rateMessage = (0, import_react7.useCallback)(async (msg, rating) => {
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
  const attach = (0, import_react7.useCallback)(async (file) => {
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
  const removeAttachment = (0, import_react7.useCallback)((key) => {
    setPendingAttachments((prev) => prev.filter((a) => a.key !== key));
  }, []);
  const resolveConfirm = (0, import_react7.useCallback)((ok) => {
    if (chatId != null) resolveRunConfirm(chatId, ok);
  }, [chatId]);
  const clearError = (0, import_react7.useCallback)(() => {
    setLocalError("");
    clearRunError(chatId);
  }, [chatId]);
  const stop = (0, import_react7.useCallback)(() => {
    if (chatId != null) stopRun(chatId);
  }, [chatId]);
  const buildTriageReport = (0, import_react7.useCallback)(
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
    activity: snapshot.activity,
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

// src/brainRestPersistence.ts
function listQuery(params) {
  const q = new URLSearchParams();
  if (params?.projectId) q.set("projectId", params.projectId);
  if (params?.limit != null) q.set("limit", String(params.limit));
  if (params?.offset != null) q.set("offset", String(params.offset));
  const query = q.toString();
  return query ? `?${query}` : "";
}
function createBrainRestPersistence(opts) {
  const { baseUrl, request, getToken } = opts;
  return {
    listChats: (params) => request(`/api/brain/chats${listQuery(params)}`).then((r) => r.chats),
    getChat: (id) => request(`/api/brain/chats/${id}`),
    createChat: (body) => request("/api/brain/chats", { method: "POST", body: JSON.stringify(body) }),
    updateChat: (id, body) => request(`/api/brain/chats/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    /** Archives rather than destroys — `archived` is what the server reports. */
    deleteChat: (id) => request(`/api/brain/chats/${id}`, { method: "DELETE" }),
    /** Summarize a chat and store the summary on it. */
    summarizeChat: (id) => request(`/api/brain/chats/${id}/summarize`, { method: "POST" }),
    getMessages: (chatId, limit) => request(
      `/api/brain/chats/${chatId}/messages${limit != null ? `?limit=${limit}` : ""}`
    ).then((r) => r.messages),
    subscribeMessages: (chatId, onChanged) => subscribeToChatMessages(baseUrl, getToken, chatId, onChanged),
    /**
     * Advance this viewer's unread high-water mark (omit `seq` for "all read").
     *
     * Reading a chat in VS Code clears its badge on the web too — it is the same
     * server conversation. Best-effort: the run loop never blocks on it.
     */
    markChatRead: (chatId, seq) => request(`/api/brain/chats/${chatId}/read`, {
      method: "POST",
      body: JSON.stringify(seq != null ? { seq } : {})
    }),
    /**
     * Post turns, and attach the server's TRUTHFUL learn-gate outcome to the
     * assistant turn(s) this POST persisted.
     *
     * The outcome is transient — it is never persisted — so a host that drops it
     * renders a run that is silent about learning, which is exactly how
     * "Connected, yet nothing learned" became an unexplained mystery in the VSIX.
     * Folding it HERE is what stops one host from forgetting again.
     */
    sendMessages: (chatId, messages) => request(
      `/api/brain/chats/${chatId}/messages`,
      { method: "POST", body: JSON.stringify({ messages }) }
    ).then((r) => attachEvermindLearn(r.messages, r.evermindLearn)),
    /**
     * Set thumbs up/down on a message (null clears).
     *
     * `context.toolName` is the MCP tool the rated turn ran — the server files it,
     * with the reply's resolved model, as an `llm_action_ratings` row the learned
     * router ranks on. So the press teaches routing, not just a button colour.
     */
    setMessageFeedback: (messageId, feedback, context) => request(`/api/brain/messages/${messageId}/feedback`, {
      method: "PATCH",
      body: JSON.stringify({ feedback, toolName: context?.toolName ?? null })
    }),
    /**
     * Ask an invited agent participant to reply — a chat-scoped run that answers
     * AS the agent, returning the posted assistant turn (attributed through
     * `metadata.authoredBy`).
     */
    requestAgentReply: (chatId, input) => request(`/api/brain/chats/${chatId}/agent-reply`, {
      method: "POST",
      body: JSON.stringify(input)
    }).then((r) => r.message),
    upload: (file) => {
      if (opts.uploadFile) return opts.uploadFile(file);
      const form = new FormData();
      form.append("file", file);
      return request("/api/brain/upload", { method: "POST", body: form });
    },
    /** URL to view/download an uploaded file by key. */
    uploadUrl: (key) => `${baseUrl}/api/brain/uploads/${key}`,
    /**
     * Mint a short-lived signed public URL for an uploaded object so an upstream
     * LLM provider can fetch it (vision). Used only for an image too large to
     * inline as a data URL — see the image prep in the run loop.
     */
    signedUploadUrl: async (key) => {
      const { exp, sig } = await request("/api/brain/uploads/sign", {
        method: "POST",
        body: JSON.stringify({ key })
      });
      return `${baseUrl}/api/brain-files/${key}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
    }
  };
}

// src/roleHandoff.ts
function isCoderReask(role, previousRole) {
  return role === "code" && previousRole === "plan";
}

// src/transcriptBudget.ts
var DEFAULT_MIN_PAYLOAD = 240;
function createPayloadBudget(opts) {
  const minPayload = Math.min(opts.minPayload ?? DEFAULT_MIN_PAYLOAD, opts.perPayload);
  let remaining = Math.max(0, opts.total);
  let spent = 0;
  let trimmed = 0;
  let deduped = 0;
  let dedupedChars = 0;
  const seen = /* @__PURE__ */ new Map();
  let ordinal = 0;
  return {
    cap(payload, label) {
      if (!payload) return payload;
      ordinal += 1;
      const prior = seen.get(payload);
      if (prior) {
        deduped += 1;
        dedupedChars += payload.length;
        return `\u2026(identical to the ${ordinalWord(prior.ordinal)} payload in this report \u2014 ${prior.label}, ${payload.length.toLocaleString()} chars. Repeated verbatim; not reprinted.)`;
      }
      seen.set(payload, { ordinal, label });
      const cap2 = Math.max(minPayload, Math.min(opts.perPayload, remaining));
      if (payload.length <= cap2) {
        remaining -= payload.length;
        spent += payload.length;
        return payload;
      }
      if (remaining < minPayload) {
        trimmed += 1;
        return `\u2026(${payload.length.toLocaleString()} chars omitted \u2014 the report hit its size budget. The full result is on the live timeline.)`;
      }
      trimmed += 1;
      remaining -= cap2;
      spent += cap2;
      return `${payload.slice(0, cap2)}
\u2026(+${(payload.length - cap2).toLocaleString()} chars truncated \u2014 full result is on the live timeline)`;
    },
    stats() {
      return { spent, trimmed, deduped, dedupedChars };
    },
    note() {
      if (trimmed === 0 && deduped === 0) return null;
      const parts = [];
      if (trimmed) parts.push(`${trimmed} oversized payload(s) shortened`);
      if (deduped) {
        parts.push(
          `${deduped} payload(s) were byte-identical repeats and are shown as back references (${(dedupedChars / 1024).toFixed(1)} KB of repetition \u2014 itself a signal, see the Progress lines)`
        );
      }
      return `Note: this report is size-budgeted so its END survives pasting \u2014 ${parts.join("; ")}. Every turn, tool call and error is still present.`;
    }
  };
}
function ordinalWord(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// src/chatActivity.ts
var PHASES = ["started", "completed", "failed", "paused", "resumed", "cancelled"];
function isPhase(v) {
  return typeof v === "string" && PHASES.includes(v);
}
function str2(v) {
  return typeof v === "string" && v.trim() ? v : void 0;
}
function parseChatActivity(msg) {
  if (!msg.metadata) return null;
  let meta;
  try {
    const parsed = JSON.parse(msg.metadata);
    if (!parsed || typeof parsed !== "object") return null;
    meta = parsed;
  } catch {
    return null;
  }
  const ticketKind = str2(meta.ticketKind) ?? "task";
  const ticketRef = str2(meta.ticketRef) ?? "";
  const agentName = str2(meta.agentName) ?? str2(meta.agentRef) ?? "";
  if (meta.runMilestone != null && isPhase(meta.phase)) {
    return {
      kind: "milestone",
      phase: meta.phase,
      agentName,
      ticketKind,
      ticketRef,
      executionId: typeof meta.executionId === "number" ? meta.executionId : null,
      ...str2(meta.toStatus) ? { toStatus: str2(meta.toStatus) } : {},
      ...str2(meta.note) ? { note: str2(meta.note) } : {},
      ...str2(meta.question) ? { question: str2(meta.question) } : {}
    };
  }
  if (meta.agentDispatch === true) {
    return { kind: "dispatch", agentName, ticketKind, ticketRef };
  }
  return null;
}
function isActivityMessage(msg) {
  return parseChatActivity(msg) !== null;
}
function activityMessageCount(messages) {
  let n = 0;
  for (const m of messages) if (isActivityMessage(m)) n += 1;
  return n;
}
var DEFAULT_CHAT_ACTIVITY_LABELS = {
  milestoneStarted: "{agent} started working on {kind} #{ref}",
  milestoneCompleted: "{agent} finished {kind} #{ref}",
  milestoneCompletedWithLane: "{agent} finished {kind} #{ref} \u2014 moved to {lane}",
  milestoneFailed: "{agent}\u2019s run on {kind} #{ref} failed",
  milestonePaused: "{agent} paused on {kind} #{ref} \u2014 waiting on a human answer",
  milestonePausedWithQuestion: "{agent} paused on {kind} #{ref} \u2014 needs an answer: {question}",
  milestoneResumed: "{agent} resumed work on {kind} #{ref}",
  milestoneCancelled: "{agent}\u2019s run on {kind} #{ref} was cancelled",
  agentDispatched: "{agent} was assigned to {kind} #{ref}"
};
function activityIcon(activity) {
  if (activity.kind === "dispatch") return "\u{1F464}";
  switch (activity.phase) {
    case "started":
      return "\u25B6";
    case "completed":
      return "\u2713";
    case "failed":
      return "!";
    case "paused":
      return "?";
    case "resumed":
      return "\u25B6";
    case "cancelled":
      return "\u25A0";
    default:
      return "\u2022";
  }
}
function activityTone(activity) {
  if (activity.kind === "dispatch") return "neutral";
  if (activity.phase === "completed") return "good";
  if (activity.phase === "failed") return "bad";
  if (activity.phase === "paused") return "waiting";
  return "neutral";
}
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}
function chatActivityText(activity, labels) {
  const base = { agent: activity.agentName, kind: activity.ticketKind, ref: activity.ticketRef };
  if (activity.kind === "dispatch") return fill(labels.agentDispatched, base);
  switch (activity.phase) {
    case "started":
      return fill(labels.milestoneStarted, base);
    case "completed":
      return activity.toStatus ? fill(labels.milestoneCompletedWithLane, { ...base, lane: activity.toStatus }) : fill(labels.milestoneCompleted, base);
    case "failed":
      return fill(labels.milestoneFailed, base);
    case "paused":
      return activity.question ? fill(labels.milestonePausedWithQuestion, { ...base, question: activity.question }) : fill(labels.milestonePaused, base);
    case "resumed":
      return fill(labels.milestoneResumed, base);
    case "cancelled":
      return fill(labels.milestoneCancelled, base);
    default:
      return "";
  }
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

// src/agentPool.ts
var DEFAULT_AGENT_MODEL_SENTINEL = "builderforce-default";
var AGENT_POOL_PATHS = {
  owned: "/api/workforce/agents/mine",
  purchased: "/api/workforce/agents/purchased",
  registered: "/api/agents"
};
function poolAgentsFrom(input) {
  const wfById = /* @__PURE__ */ new Map();
  for (const a of [...input.owned, ...input.purchased]) wfById.set(String(a.id), a);
  const workforce = [...wfById.values()].map((a) => ({
    kind: "workforce",
    ref: String(a.id),
    name: a.name,
    meta: a.title || a.base_model || "",
    baseModel: a.base_model && a.base_model !== DEFAULT_AGENT_MODEL_SENTINEL ? a.base_model : null
  }));
  const registered = input.registered.filter((a) => a.isActive).map((a) => ({ kind: "registered", ref: String(a.id), name: a.name, meta: a.type, baseModel: null }));
  return [...workforce, ...registered];
}
async function loadAgentPoolVia(request) {
  const [owned, purchased, registered] = await Promise.all([
    request(AGENT_POOL_PATHS.owned).catch(() => []),
    request(AGENT_POOL_PATHS.purchased).catch(() => []),
    request(AGENT_POOL_PATHS.registered).catch(() => [])
  ]);
  return poolAgentsFrom({ owned: owned ?? [], purchased: purchased ?? [], registered: registered ?? [] });
}

// src/brainPersona.ts
var PERSONA_MODALITY_IDS = ["designer", "mobile", "webmobile", "evermind", "finetune", "voice"];
var STRATEGY_OKR_NOTE = 'Strategy and goals live as OKRs/Objectives (Objectives + Key Results) in their own tables \u2014 not as tasks on the Kanban board. When the user talks about goals, outcomes, or strategy, you can create and link Objectives and Key Results, and promote an epic titled like "OKR \u2026" into a real Objective, using the platform tools.';
var BASE_PERSONAS = {
  designer: {
    icon: "\u{1F310}",
    prompt: [
      "You are an expert AI coding assistant built into Builderforce.ai, a browser-based Builder. Help users generate and build websites and web apps.",
      "When the user describes an app to build, SCAFFOLD IT COMPLETELY in this turn: call the `create_file` tool for every file the app needs to actually run \u2014 an index.html entry, a package.json with real dependencies and a `build` script, and all of the src/ components \u2014 so the live Preview renders a working app immediately, not a single snippet. Default to a Vite + React app unless the user asks for something else. Prefer `create_file` over pasting code the user must apply by hand. When you have scaffolded the app, tell the user in one line what you built and that Preview is live and it is ready to Publish.",
      "Use markdown for your response: headings, lists, bold, and fenced code blocks.",
      "If the file tools are unavailable, fall back to suggesting files as a code block with the file path as the language tag so the user can create the file in one click. Examples: ```package.json (then JSON content), ```src/index.js (then JS content), ```.gitignore (then content).",
      "When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it."
    ].join("\n")
  },
  mobile: {
    icon: "\u{1F4F1}",
    prompt: [
      "You are an expert mobile app developer operating Builderforce.ai's Canvas Builder. The user is building a MOBILE app and previews it in a phone-sized device simulator.",
      'The project is a React Native app rendered for the web through react-native-web, so it runs in the browser preview AND stays portable to Expo. Import components (View, Text, Pressable, ScrollView, StyleSheet, FlatList) from "react-native" \u2014 never use HTML elements like div, span or button, and never use CSS files or className.',
      "Style with StyleSheet.create and flexbox. Remember there is no hover: design for touch, keep tap targets at least 44 points, and respect safe areas at the top and bottom of the screen.",
      "Design for a narrow portrait viewport (roughly 390 x 850 points) first. Prefer native navigation patterns \u2014 tab bars, stack headers, bottom sheets \u2014 over desktop patterns like sidebars and hover menus.",
      "When suggesting new or existing files, use a code block with the file path as the language tag so the user can create the file in one click. Examples: ```App.js (then the component), ```src/screens/Home.js.",
      "When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it."
    ].join("\n")
  },
  webmobile: {
    icon: "\u{1F5A5}\uFE0F",
    prompt: [
      "You are an expert full-stack app developer built into Builderforce.ai's browser Builder. The user is building ONE app that ships as BOTH a responsive web application AND a mobile app, from a single codebase.",
      'The project is a React app rendered through react-native-web, so the SAME source runs full-width as a website AND inside a phone-sized device simulator, and stays portable to Expo for native iOS/Android. Import components (View, Text, Pressable, ScrollView, StyleSheet, FlatList) from "react-native" \u2014 never use HTML elements like div, span or button, and never use CSS files or className.',
      "Style with StyleSheet.create and flexbox, and make layouts RESPONSIVE: use flex, percentage widths and useWindowDimensions to adapt between a wide desktop viewport and a narrow phone one. Keep tap targets at least 44 points and respect safe areas \u2014 there is no hover on mobile.",
      "When suggesting new or existing files, use a code block with the file path as the language tag so the user can create the file in one click. Examples: ```App.js (then the component), ```src/screens/Home.js.",
      "When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it."
    ].join("\n")
  },
  evermind: {
    icon: "\u{1F9E0}",
    prompt: [
      "You are assisting with growing an Evermind \u2014 Builderforce.ai's self-updating model that learns continuously (Write-Through Cognition) instead of being frozen after training.",
      "Help the user teach it: draft facts, skills, and examples to feed it, reason about what it has learned, and interpret its Knowledge Map (neocortex / hippocampus / limbic regions).",
      "This is NOT classic fine-tuning \u2014 the model updates in place as it learns. Keep guidance oriented around teaching and recall, not training runs or LoRA adapters."
    ].join("\n")
  },
  finetune: {
    icon: "\u{1F527}",
    prompt: [
      "You are assisting with building and fine-tuning a custom LLM inside Builderforce.ai. This is the classic pipeline: design a dataset, train a LoRA adapter in-browser (WebGPU), benchmark it, then publish and export it.",
      "Help the user draft instruction/response pairs, choose a base model and training hyperparameters, and reason about training runs and benchmark results."
    ].join("\n")
  },
  voice: {
    icon: "\u{1F399}",
    prompt: [
      "You are a voice director inside Builderforce.ai's Voice Studio.",
      "The user enrolls a reference sample to clone a voice (SSM/WebGPU acoustic model) and then synthesizes speech from typed text.",
      "Help them write natural, well-punctuated lines to synthesize, and advise on pacing, emphasis, and tone."
    ].join("\n")
  }
};
var MODALITY_PERSONAS = Object.fromEntries(
  PERSONA_MODALITY_IDS.map((id) => [id, { ...BASE_PERSONAS[id], prompt: `${BASE_PERSONAS[id].prompt}
${STRATEGY_OKR_NOTE}` }])
);
var DEFAULT_PERSONA = "default";
function modalityPersonaChoice(id) {
  return `modality:${id}`;
}
function agentPersonaChoice(agent) {
  return `agent:${agent.kind}:${agent.ref}`;
}
function personaModalityOf(choice) {
  if (!choice.startsWith("modality:")) return null;
  const id = choice.slice("modality:".length);
  return PERSONA_MODALITY_IDS.includes(id) ? id : null;
}
function personaAgentOf(choice, agents) {
  return agents.find((a) => agentPersonaChoice(a) === choice) ?? null;
}
function agentPersonaPrompt(name) {
  return `You are acting as the "${name}" agent for this workspace. Adopt its role, voice and duties when responding.`;
}
function personaSystemPrompt(choice, agents) {
  const modality = personaModalityOf(choice);
  if (modality) return MODALITY_PERSONAS[modality].prompt;
  const agent = personaAgentOf(choice, agents);
  return agent ? agentPersonaPrompt(agent.name) : void 0;
}
var PERSONA_OVERLAY_PREFACE = "Persona for this conversation \u2014 adopt the domain focus below. Where it describes an environment, preview, or tools that differ from the ones described above, the ones above are what you actually have: use those.";
function personaOverlay(choice, agents) {
  const modality = personaModalityOf(choice);
  if (modality) return `${PERSONA_OVERLAY_PREFACE}
${MODALITY_PERSONAS[modality].prompt}`;
  const agent = personaAgentOf(choice, agents);
  return agent ? agentPersonaPrompt(agent.name) : void 0;
}
function personaModel(choice, agents) {
  return personaAgentOf(choice, agents)?.baseModel ?? void 0;
}
function brainPersonaAgents(assignments, pool) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const a of assignments) {
    const key = agentPersonaChoice({ kind: a.agentKind, ref: a.agentRef });
    if (seen.has(key)) continue;
    seen.add(key);
    const pooled = pool.find((p) => p.kind === a.agentKind && p.ref === a.agentRef);
    out.push({ kind: a.agentKind, ref: a.agentRef, name: pooled?.name ?? `${a.agentKind}:${a.agentRef}`, baseModel: pooled?.baseModel ?? null });
  }
  return out;
}
var BRAIN_AGENT_ASSIGNMENTS_PATH = "/api/agent-assignments?scope=brain";
async function loadBrainPersonaAgentsVia(request) {
  const [assignments, pool] = await Promise.all([
    request(BRAIN_AGENT_ASSIGNMENTS_PATH).then((r) => r?.assignments ?? []).catch(() => []),
    loadAgentPoolVia(request).catch(() => [])
  ]);
  return brainPersonaAgents(assignments, pool);
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
var USER_CONFIGURED_PREFIXES = ["project_evermind:", "tenant_model:", "local/"];
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
  categoryLocal: "On this device",
  localDetail: "Runs on this machine via {runtime} \u2014 no plan usage, works offline.",
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
var MODEL_CATEGORIES = ["auto", "local", "byo", "free", "plan", "paid", "configured"];
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
    case "local":
      return labels.categoryLocal;
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
  for (const model of options.local ?? []) {
    add(model.id, model.label, labels.localDetail.replace("{runtime}", model.runtime), "local");
  }
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
    const unattached = "\u26A0\uFE0F Chat is NOT attached to a project (chat.projectId is null). The learn gate keys on the CHAT's project, so this chat contributes NOTHING to any Evermind \u2014 even though the panel shows the selected project as connected.";
    if (d.selectedProjectId == null) {
      out.push(
        `${unattached} No project is selected in the sidebar either, so there was nothing for the chat to adopt \u2014 SELECT a project, then re-open the chat. (Not an adopt bug.)`
      );
    } else {
      out.push(
        `${unattached} A project IS selected (${fmtProject(d.selectedProjectId, d.selectedProjectName)}) and the chat still came up unattached, so the ADOPT path is the fault, not the selection \u2014 investigate the self-heal that binds an open chat to the active project.`
      );
    }
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
  if (d.lastLearn && d.lastLearn.learned && ev && ev.version >= 1 && ev.version < d.lastLearn.version) {
    out.push(
      `\u26A0\uFE0F Last turn's learn step evaluated v${d.lastLearn.version} but the chat's project head is v${ev.version} \u2014 BEHIND it. A queued learn only moves a head forward, so the learn step and the panel are resolving DIFFERENT projects/heads.`
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
  const tokens2 = tokenMeter(acct);
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
    const tokenState = allowanceState(tokens2);
    if (tokens2 && tokenState === "exhausted") {
      out.push(
        `\u26A0\uFE0F AI token allowance is EXHAUSTED (${tokens2.used.toLocaleString("en-US")} / ${tokens2.limit.toLocaleString("en-US")} this period). The gateway returns 429 \`plan_token_limit_exceeded\`, so turns fail or stop mid-answer until ${acct.resetsAt ?? "the period resets"}.`
      );
    } else if (tokens2 && tokenState === "warn") {
      out.push(
        `\u26A0\uFE0F AI token allowance is ${tokens2.percentUsed}% used (${tokens2.remaining.toLocaleString("en-US")} left, resets ${acct.resetsAt ?? "at period end"}). Long turns may be cut off by the cap before the model finishes.`
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
  if (d.versions && (d.versions.ui || d.versions.api || d.versions.uiBuildId)) {
    const buildId = d.versions.uiBuildId;
    const client = `${d.versions.ui ?? "unknown"}${buildId ? `+${buildId}` : ""}` + (d.versions.uiBuiltAt && d.versions.uiBuiltAt !== "dev" ? ` (built ${d.versions.uiBuiltAt})` : "");
    lines.push(`- Versions: client ${client} \xB7 API ${d.versions.api ?? "unknown"}`);
    if (buildId === "dev") {
      lines.push(
        '  - \u26A0\uFE0F Client build id is "dev" \u2014 this capture did NOT come from a packaged build, so its behaviour may not match any released artifact.'
      );
    } else if (d.versions.ui && !buildId) {
      lines.push(
        '  - \u26A0\uFE0F No client build id \u2014 this client does not stamp one, so a rebuild carrying the SAME version is indistinguishable from the build it replaced. "Is the fix in?" cannot be answered from this report.'
      );
    }
    const webviewId = d.versions.webviewBuildId;
    if (webviewId) {
      const built = d.versions.webviewBuiltAt && d.versions.webviewBuiltAt !== "dev" ? ` (built ${d.versions.webviewBuiltAt})` : "";
      lines.push(`  - Webview bundle: ${webviewId}${built}`);
      if (buildId && buildId !== "dev" && webviewId !== buildId) {
        lines.push(
          "  - \u26A0\uFE0F The extension host and the webview were built from DIFFERENT source \u2014 this install is not one artifact, so a fix present in one half may be absent from the other. Reinstall the packaged extension before trusting either version above."
        );
      }
    }
    if (d.versions.posixShell) lines.push(`  - ${d.versions.posixShell}`);
  }
  lines.push(`- Chat: ${d.chatTitle?.trim() ? `"${d.chatTitle.trim()}"` : "Untitled"}${d.chatId != null ? ` (#${d.chatId})` : ""}${d.chatVisibility ? ` \xB7 ${d.chatVisibility}` : ""}`);
  if (d.mode) lines.push(`- Mode: ${d.mode}`);
  lines.push(`- Chat's project: ${fmtProject(d.projectId, d.projectName)}`);
  lines.push(
    `- Panel's selected project: ${fmtProject(d.selectedProjectId, d.selectedProjectName)}` + (d.selectedProjectId != null && d.selectedProjectId === d.projectId ? " (same as the chat's)" : "")
  );
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
    mode: src.mode ?? null,
    projectId: src.projectId ?? null,
    projectName: projectName ?? src.projectName ?? null,
    selectedProjectId: src.selectedProjectId ?? null,
    selectedProjectName: src.selectedProjectName ?? null,
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
    versions: {
      ui: src.uiVersion ?? null,
      api: apiVersion,
      uiBuildId: src.uiBuildId ?? null,
      uiBuiltAt: src.uiBuiltAt ?? null,
      webviewBuildId: src.webviewBuildId ?? null,
      webviewBuiltAt: src.webviewBuiltAt ?? null,
      posixShell: src.posixShell ?? null
    }
  };
}

// src/chatDiagnosticsReport.ts
var CHAT_DIAGNOSTICS_SCHEMA_VERSION = 1;
function buildChatDiagnosticsReport(input) {
  const { diagnostics, events, messages, model, running = false, surface, now } = input;
  const configuredModel = model && model !== "default" ? model : null;
  const run = events.length ? computeBrainDiagnostics(events, configuredModel ?? void 0, messages, { running }) : null;
  return {
    schemaVersion: CHAT_DIAGNOSTICS_SCHEMA_VERSION,
    capturedAt: (now ? now() : /* @__PURE__ */ new Date()).toISOString(),
    surface,
    likelyCause: run?.likelyCause ?? null,
    running,
    chat: diagnostics,
    run,
    provenance: {
      configuredModel,
      modelsUsed: modelsUsedInTrace(events),
      account: accountUsedInTrace(events) ?? null
    },
    // Read off the trace directly rather than through `run`, so the field is populated
    // identically whether or not a run block was built.
    staffing: events.length ? staffingSummaryInTrace(events) : null
  };
}
function formatChatDiagnosticsReportJson(report) {
  return ["## Diagnostics (JSON)", "```json", JSON.stringify(report, null, 2), "```"];
}

// src/artifactRoute.ts
var PMO_FOCUS_PARAM = "focus";
function pmoFocusValue(kind, ref) {
  return `${kind}:${ref}`;
}
function parsePmoFocus(value) {
  if (!value) return null;
  const at = value.indexOf(":");
  if (at <= 0) return null;
  const kind = value.slice(0, at);
  const id = value.slice(at + 1);
  if (!id) return null;
  return kind === "objective" || kind === "initiative" || kind === "portfolio" ? { kind, id } : null;
}
function pmoFocusDomId(kind, id) {
  return `pmo-${kind}-${id}`;
}
function artifactRoutePath(kind, ref, projectId) {
  const id = ref ? encodeURIComponent(ref) : "";
  const project = projectId != null ? `&project=${projectId}` : "";
  switch (kind) {
    case "objective":
    case "initiative":
    case "portfolio":
      return id ? `/projects?tab=portfolio&${PMO_FOCUS_PARAM}=${encodeURIComponent(pmoFocusValue(kind, ref))}` : "/projects?tab=portfolio";
    case "retro":
    case "poker":
      return `/projects?tab=ceremonies&ceremony=${kind}${id ? `&session=${id}` : ""}`;
    case "spec":
      return projectId != null && id ? `/projects?project=${projectId}&panel=prds&spec=${id}` : projectId != null ? `/projects?project=${projectId}&panel=prds` : "/projects";
    case "roadmap":
      return `/projects?tab=pm&section=roadmap${id ? `&roadmap=${id}` : ""}`;
    case "task":
    case "epic":
    case "gap":
    default: {
      const base = `/projects?tab=tasks${project}`;
      return id ? `${base}&task=${id}` : base;
    }
  }
}

// src/ui/PromptInput.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
var rowStyle = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", width: "100%" };
var fieldStyle = {
  flex: "1 1 200px",
  minWidth: 0,
  minHeight: 42,
  boxSizing: "border-box",
  background: "var(--bg-base, #fff)",
  color: "var(--text-primary, #111)",
  fontSize: "0.875rem",
  fontFamily: "inherit",
  lineHeight: 1.4,
  padding: "10px 12px",
  borderRadius: "var(--radius-lg, 10px)",
  border: "1px solid var(--border-subtle, #c8c8c8)",
  resize: "none"
};
var buttonStyle = (enabled) => ({
  flex: "0 0 auto",
  minWidth: 42,
  height: 42,
  padding: "0 16px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--border-subtle, #c8c8c8)",
  borderRadius: "var(--radius-lg, 10px)",
  background: enabled ? "var(--accent, #2563eb)" : "var(--bg-elevated, #eee)",
  color: enabled ? "var(--text-on-accent, #fff)" : "var(--text-muted, #666)",
  cursor: enabled ? "pointer" : "not-allowed",
  fontSize: "1rem",
  fontWeight: 700
});
function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  submitLabel,
  ariaLabel,
  disabled = false,
  busy = false,
  leading,
  secondaryContent,
  rows = 1,
  className,
  submitOnEnter = true
}) {
  const canSubmit = value.trim().length > 0 && !disabled && !busy;
  const submit = () => {
    if (canSubmit) onSubmit();
  };
  const handleSubmit = (event) => {
    event.preventDefault();
    submit();
  };
  const handleKeyDown = (event) => {
    if (!submitOnEnter || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };
  const shared = {
    value,
    placeholder,
    disabled,
    "aria-label": ariaLabel ?? placeholder,
    onChange: (event) => onChange(event.target.value),
    onKeyDown: handleKeyDown,
    style: fieldStyle
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("form", { onSubmit: handleSubmit, className, style: { display: "flex", flexDirection: "column", gap: 6, width: "100%" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: rowStyle, children: [
      leading,
      rows <= 1 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "text", ...shared }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("textarea", { rows, ...shared }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "submit", disabled: !canSubmit, "aria-label": submitLabel, title: submitLabel, "aria-busy": busy || void 0, style: buttonStyle(canSubmit), children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { "aria-hidden": "true", children: busy ? "\u2026" : "\u2191" }) })
    ] }),
    secondaryContent && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { fontSize: "0.75rem", color: "var(--text-muted, #666)" }, children: secondaryContent })
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ADDRESSED_TO_META_KEY,
  AGENT_POOL_PATHS,
  API_VERSION_PROBE_TIMEOUT_MS,
  API_VERSION_TTL_MS,
  ASK_USER_TOOL,
  ASK_USER_TOOL_SPEC,
  AUTHORED_BY_META_KEY,
  BACK_TO_BACK_AT,
  BASE_BRANCHES,
  BRAIN_AGENT_ASSIGNMENTS_PATH,
  BUILDERFORCE_PRODUCT_NAME,
  BrainActionsProvider,
  BrainContextProvider,
  BrainProvider,
  BrainRequestError,
  CHAT_DIAGNOSTICS_SCHEMA_VERSION,
  CHAT_MODES,
  CHAT_MODE_ICON,
  CODE_CHANGE_TOOLS,
  CONSOLIDATION_MARKER_PREFIX,
  CONSOLIDATION_META,
  DEFAULT_AGENT_MODEL_SENTINEL,
  DEFAULT_CHAT_ACTIVITY_LABELS,
  DEFAULT_CHAT_TITLE,
  DEFAULT_MODEL_CHOICE_LABELS,
  DEFAULT_MODEL_IDENTITY,
  DEFAULT_PERSONA,
  DEFAULT_TOOL_FAILURE_STREAK,
  DEFAULT_TOOL_LIMIT,
  EVERMIND_LEARN_MIN_CHARS,
  FAILURE_HARD_AT,
  FAILURE_NUDGE_AT,
  FailureTally,
  HISTORY_TOKEN_BUDGET,
  LOCAL_WORKSPACE_TOOLS,
  MAX_TOOL_RESULT_CHARS,
  MODALITY_PERSONAS,
  MODEL_CATEGORIES,
  NEW_CHAT_MODE,
  NOT_STARTED_TASK_STATUSES,
  ON_DEVICE_ANSWER_THRESHOLD,
  PERSONA_MODALITY_IDS,
  PMO_FOCUS_PARAM,
  PROJECT_EVERMIND_MODEL_PREFIX,
  PROVENANCE_META_KEY,
  PromptInput,
  READ_FILE_RESULT_CHARS,
  RESTING_CHAT_MODE,
  REVISIT_HARD_AT,
  REVISIT_NUDGE_AT,
  ReadCoverage,
  RepetitionLoopError,
  STEP_MESSAGE_ROLE,
  STOPPED_TURN_META_KEY,
  STOPPED_TURN_STEP,
  STREAM_IDLE_MS,
  StreamIdleError,
  StreamInterruptedError,
  TICKET_RECORDING_TOOLS,
  TOOL_ROUTER_DESCRIBE,
  TOOL_ROUTER_FIND,
  TOOL_ROUTER_INVOKE,
  TransportError,
  UNBACKED_TICKET_CLAIM_NOTICE,
  UNBACKED_WRITE_CLAIM_NOTICE,
  UNSCOPED_MUTATION_TOOLS,
  WEB_FETCH_TOOL_NAME,
  XmlToolCallFilter,
  accountUsedInTrace,
  activeHashtagToken,
  activeMentionToken,
  activeModelKey,
  activeTicketToken,
  activityIcon,
  activityMessageCount,
  activityTarget,
  activityTone,
  agentPersonaChoice,
  agentPersonaPrompt,
  allowanceState,
  announcesUntakenAction,
  applyRemoteRun,
  artifactRoutePath,
  asProvenanceAccount,
  askUserAnchorId,
  askUserBlock,
  attachEvermindLearn,
  attemptedPublish,
  brainPersonaAgents,
  brainRequestError,
  buildBrainTriageReport,
  buildChatDiagnosticsReport,
  buildComposerDirectives,
  buildModelItems,
  byoReasonHint,
  byoUnresolvedInTrace,
  byoUnresolvedSummary,
  byoVendorLabel,
  canChangeCodeHere,
  canShipHere,
  catalogToolNamesMentionedIn,
  chatActivityText,
  chatConversationDirective,
  chatErrorAction,
  chatModeDirective,
  chatWorkDirective,
  chatWorkLinkingDirective,
  claimsMissingToolData,
  classifyModelFunding,
  clearRunError,
  codeChangeFile,
  coerceAskUserPayload,
  composeEvermindHooks,
  computeBrainDiagnostics,
  computeRunProgress,
  consolidationMarkerContent,
  consolidationMetadata,
  countReconciledMemories,
  createBrainRestPersistence,
  createComposingActivity,
  createPayloadBudget,
  declinesShipping,
  deriveChatTitle,
  describeLiveStep,
  describeTool,
  detectAnnouncedButUnmadeToolCall,
  detectUnbackedTicketClaim,
  detectUnbackedWriteClaim,
  directedAgentRecipients,
  dirtyPathsOf,
  displayModelName,
  effortProfile,
  extractXmlToolCalls,
  failureReason,
  fetchApiVersionVia,
  fetchMcpToolEntries,
  filterMentionCandidates,
  filterModelItems,
  filterTicketCandidates,
  findTools,
  forgetResolvedModels,
  formatAssistantTranscriptHeading,
  formatBrainDiagnostics,
  formatBrainProvenance,
  formatBytes,
  formatChatDiagnostics,
  formatChatDiagnosticsReportJson,
  formatDispatchRefusals,
  formatEvermindLearnStep,
  formatEvermindMemoryBlock,
  formatModelScorecard,
  formatModelTurnLog,
  formatRunProgress,
  formatStaffingSummary,
  gatherChatDiagnostics,
  getGlobalRunState,
  getLastResolvedModel,
  getMcpToolStatus,
  getRunDriver,
  getRunSnapshot,
  getRunTrace,
  handleRouterCall,
  hasEditIntent,
  installRunDriver,
  isActivityMessage,
  isChatMode,
  isCodeChangeTool,
  isCoderReask,
  isConnectedAccountUnused,
  isConsolidationMarker,
  isDirectedToParticipant,
  isDispatchTool,
  isEffort,
  isEvermindModel,
  isFailedToolResult,
  isLocalWorkspaceTool,
  isMalformedToolCall,
  isMutationTool,
  isRouterTool,
  isRunning,
  isStepMessage,
  isStoppedTurn,
  isTicketRecordingTool,
  isTicketWriteTool,
  isTruncatedTurn,
  isUnscopedMutationTool,
  isUserConfiguredModelRef,
  lastConsolidationIndex,
  lastServedModel,
  leftChangeUnshipped,
  linkedTicketsToAdvance,
  linkedTicketsToComplete,
  loadAgentPoolVia,
  loadBrainPersonaAgentsVia,
  localStorageConfirmationPersistence,
  localToolsIn,
  mcpActionsFrom,
  mentionRecipient,
  mergeRecoveredTrace,
  midRunNotice,
  modalityPersonaChoice,
  modelCategoryLabel,
  modelFailoversInTrace,
  modelInUse,
  modelScorecard,
  modelTurnLog,
  modelsUsedInTrace,
  narratedUnadvertisedInTrace,
  nextFallbackModel,
  normalizeChatMode,
  onDeviceMemoryHooks,
  parseAskUser,
  parseByoUnresolved,
  parseChatActivity,
  parseDirectedRecipients,
  parseGitShortStatus,
  parseMessageAuthor,
  parseMessageProvenance,
  parsePmoFocus,
  parseStepMessage,
  perMillionUsd,
  personaAgentOf,
  personaModalityOf,
  personaModel,
  personaOverlay,
  personaSystemPrompt,
  pmoFocusDomId,
  pmoFocusValue,
  poolAgentsFrom,
  premiumCostLabel,
  prepareImageDataUrl,
  productForPlan,
  productModelName,
  progressDuration,
  projectMemoryHooks,
  ratedTurnContext,
  ratedTurnTool,
  readWithIdleWatchdog,
  reasoningForRun,
  repeatedFailureAdvisory,
  requestRunConfirm,
  resetApiVersionCache,
  resetBrainRunStore,
  resolveRecipient,
  resolveRunConfirm,
  revealsModelId,
  revisitAdvisory,
  routerToolSpecs,
  routingQueryForTurn,
  runBrainLoop,
  runProgressVerdict,
  savePendingPrompt,
  scopeToConsolidation,
  selectPendingAskUser,
  selectToolsForTurn,
  selfReviewShipDirective,
  serializeAskUser,
  setLastResolvedModel,
  setMcpToolStatus,
  shippedToBaseBranch,
  shortenTarget,
  stableStringify,
  staffingSummaryInTrace,
  stallRecoveriesInTrace,
  stallUnrecoveredInTrace,
  startRun,
  stepSig,
  stopRun,
  stoppedTurnMetadata,
  streamChatCompletion,
  stripAskUser,
  subscribeRun,
  subscribeRunStore,
  subscribeToChatMessages,
  takePendingPrompt,
  toolActivity,
  toolCallArgBytes,
  toolExposureInTrace,
  toolNamesMentionedIn,
  toolSpecsFor,
  traceEventToPersistInput,
  traceWithPersistedSteps,
  trimToolResult,
  turnInterruption,
  turnOptimizationDirective,
  unshippedChangeNudge,
  useBrainActions,
  useBrainChats,
  useBrainConfig,
  useBrainContext,
  useBrainConversation,
  useMcpExtensions,
  useOptionalBrainContext,
  useRegisterBrainActions,
  useToolConfirmationGate,
  utf8ByteLength,
  withAdvisory,
  withDirectedMetadata,
  withObservedModel,
  withProvenanceMetadata,
  workFiledNotStaffedVerdict,
  workItemLinkFromCreate
});
//# sourceMappingURL=index.cjs.map