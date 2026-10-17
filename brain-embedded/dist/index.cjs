"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
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
  BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS: () => BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS,
  BROWSER_ENGINE_MODEL: () => BROWSER_ENGINE_MODEL,
  BUILDERFORCE_PRODUCT_NAME: () => BUILDERFORCE_PRODUCT_NAME,
  BrainActionsProvider: () => BrainActionsProvider,
  BrainContextProvider: () => BrainContextProvider,
  BrainProvider: () => BrainProvider,
  BrainRequestError: () => BrainRequestError,
  CHAT_DIAGNOSTICS_SCHEMA_VERSION: () => CHAT_DIAGNOSTICS_SCHEMA_VERSION,
  CHAT_MODES: () => CHAT_MODES,
  CHAT_MODE_ICON: () => CHAT_MODE_ICON,
  CODE_CHANGE_TOOLS: () => CODE_CHANGE_TOOLS,
  CONNECT_RETRY_DELAYS_MS: () => CONNECT_RETRY_DELAYS_MS,
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
  EMPTY_GATEWAY_MODEL_OPTIONS: () => EMPTY_GATEWAY_MODEL_OPTIONS,
  FAILURE_HARD_AT: () => FAILURE_HARD_AT,
  FAILURE_NUDGE_AT: () => FAILURE_NUDGE_AT,
  FILE_DELIVERY_RULE: () => FILE_DELIVERY_RULE,
  FailureTally: () => FailureTally,
  HAND_OFF_TOOL: () => HAND_OFF_TOOL,
  HAND_OFF_TOOL_SPEC: () => HAND_OFF_TOOL_SPEC,
  HISTORY_TOKEN_BUDGET: () => HISTORY_TOKEN_BUDGET,
  LOCAL_WORKSPACE_TOOLS: () => LOCAL_WORKSPACE_TOOLS,
  MAX_STOP_HOOK_ROUNDS: () => MAX_STOP_HOOK_ROUNDS,
  MAX_TOOL_RESULT_CHARS: () => MAX_TOOL_RESULT_CHARS,
  MODALITY_PERSONAS: () => MODALITY_PERSONAS,
  MODEL_CATEGORIES: () => MODEL_CATEGORIES,
  NEW_CHAT_MODE: () => NEW_CHAT_MODE,
  NOT_SIGNED_IN: () => NOT_SIGNED_IN,
  NOT_STARTED_TASK_STATUSES: () => NOT_STARTED_TASK_STATUSES,
  ON_DEVICE_ANSWER_THRESHOLD: () => ON_DEVICE_ANSWER_THRESHOLD,
  PERSONA_MODALITY_IDS: () => PERSONA_MODALITY_IDS,
  PMO_FOCUS_PARAM: () => PMO_FOCUS_PARAM,
  PREVIEW_REVIEW_TOOL: () => PREVIEW_REVIEW_TOOL,
  PROJECT_EVERMIND_MODEL_PREFIX: () => PROJECT_EVERMIND_MODEL_PREFIX,
  PROVENANCE_META_KEY: () => PROVENANCE_META_KEY,
  PageEngineError: () => PageEngineError,
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
  STUDIO_WORKSPACE_TOOLS: () => STUDIO_WORKSPACE_TOOLS,
  SUBAGENT_OF_META_KEY: () => SUBAGENT_OF_META_KEY,
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
  USAGE_SURFACES: () => USAGE_SURFACES,
  USAGE_SURFACE_HEADER: () => USAGE_SURFACE_HEADER,
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
  appendRunMessage: () => appendRunMessage,
  applyRemoteRun: () => applyRemoteRun,
  artifactRoutePath: () => artifactRoutePath,
  asProvenanceAccount: () => asProvenanceAccount,
  askStopHook: () => askStopHook,
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
  canReviewInPreview: () => canReviewInPreview,
  canRunInParallel: () => canRunInParallel,
  canShipHere: () => canShipHere,
  catalogToolNamesMentionedIn: () => catalogToolNamesMentionedIn,
  chatActivityText: () => chatActivityText,
  chatConversationDirective: () => chatConversationDirective,
  chatErrorAction: () => chatErrorAction,
  chatModeDirective: () => chatModeDirective,
  chatRosterFromParticipants: () => chatRosterFromParticipants,
  chatWorkDirective: () => chatWorkDirective,
  chatWorkLinkingDirective: () => chatWorkLinkingDirective,
  childTaskBrief: () => childTaskBrief,
  claimsMissingToolData: () => claimsMissingToolData,
  classifyModelFunding: () => classifyModelFunding,
  clearRunError: () => clearRunError,
  codeChangeFile: () => codeChangeFile,
  codeChangesOf: () => codeChangesOf,
  coerceAskUserPayload: () => coerceAskUserPayload,
  completeLocal: () => completeLocal,
  completeLocalFirst: () => completeLocalFirst,
  composeEvermindHooks: () => composeEvermindHooks,
  computeBrainDiagnostics: () => computeBrainDiagnostics,
  computeRunProgress: () => computeRunProgress,
  consolidationMarkerContent: () => consolidationMarkerContent,
  consolidationMetadata: () => consolidationMetadata,
  contextWindowOf: () => contextWindowOf,
  countReconciledMemories: () => import_evermind3.countReconciledMemories,
  createBrainRestPersistence: () => createBrainRestPersistence,
  createBrowserEngineProber: () => createBrowserEngineProber,
  createComposingActivity: () => createComposingActivity,
  createHandoffFit: () => createHandoffFit,
  createHostModelStream: () => createHostModelStream,
  createLocalFirstStream: () => createLocalFirstStream,
  createLocalStream: () => createLocalStream,
  createPageEngineSet: () => createPageEngineSet,
  createPayloadBudget: () => createPayloadBudget,
  declinesReview: () => declinesReview,
  declinesShipping: () => declinesShipping,
  deferredLocalModelStore: () => deferredLocalModelStore,
  deriveChatTitle: () => deriveChatTitle,
  describeLiveStep: () => describeLiveStep,
  describeNetworkError: () => describeNetworkError,
  describeTool: () => describeTool,
  detectAnnouncedButUnmadeToolCall: () => detectAnnouncedButUnmadeToolCall,
  detectUnbackedTicketClaim: () => detectUnbackedTicketClaim,
  detectUnbackedWriteClaim: () => detectUnbackedWriteClaim,
  directedAgentRecipients: () => directedAgentRecipients,
  dirtyPathsOf: () => dirtyPathsOf,
  displayModelName: () => displayModelName,
  drainRunSteering: () => drainRunSteering,
  effortProfile: () => effortProfile,
  executeHandOff: () => executeHandOff,
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
  formatEvermindMemoryBlock: () => import_evermind3.formatEvermindMemoryBlock,
  formatModelScorecard: () => formatModelScorecard,
  formatModelTurnLog: () => formatModelTurnLog,
  formatRunProgress: () => formatRunProgress,
  formatStaffingSummary: () => formatStaffingSummary,
  formatSubagentDiagnostics: () => formatSubagentDiagnostics,
  gatewayCanChooseModel: () => gatewayCanChooseModel,
  gatewayModelIdentity: () => gatewayModelIdentity,
  gatewayModelWindows: () => gatewayModelWindows,
  gatewayPlanIsPaid: () => gatewayPlanIsPaid,
  gatewayPlanModels: () => gatewayPlanModels,
  gatherChatDiagnostics: () => gatherChatDiagnostics,
  getGlobalRunState: () => getGlobalRunState,
  getLastResolvedModel: () => getLastResolvedModel,
  getMcpToolStatus: () => getMcpToolStatus,
  getRunDriver: () => getRunDriver,
  getRunSnapshot: () => getRunSnapshot,
  getRunTrace: () => getRunTrace,
  handleRouterCall: () => handleRouterCall,
  hasEditIntent: () => hasEditIntent,
  hasPromptApi: () => hasPromptApi,
  hasWebGPU: () => hasWebGPU,
  installIndexedDbStepDurability: () => installIndexedDbStepDurability,
  installRunDriver: () => installRunDriver,
  installStepDurability: () => installStepDurability,
  invalidateGatewayModelOptions: () => invalidateGatewayModelOptions,
  isActivityMessage: () => isActivityMessage,
  isChatMode: () => isChatMode,
  isCodeChangeTool: () => isCodeChangeTool,
  isCoderReask: () => isCoderReask,
  isConnectFailure: () => isConnectFailure,
  isConnectedAccountUnused: () => isConnectedAccountUnused,
  isConsolidationMarker: () => isConsolidationMarker,
  isDirectedToParticipant: () => isDirectedToParticipant,
  isDispatchTool: () => isDispatchTool,
  isEffort: () => isEffort,
  isEvermindModel: () => isEvermindModel,
  isFailedToolResult: () => isFailedToolResult,
  isLocalWorkspaceTool: () => isLocalWorkspaceTool,
  isMalformedToolCall: () => isMalformedToolCall,
  isManagerRole: () => isManagerRole,
  isMutationTool: () => isMutationTool,
  isReadOnlyShellCall: () => isReadOnlyShellCall,
  isRepoPublishTool: () => isRepoPublishTool,
  isRouterTool: () => isRouterTool,
  isRunning: () => isRunning,
  isStepMessage: () => isStepMessage,
  isStoppedTurn: () => isStoppedTurn,
  isTicketRecordingTool: () => isTicketRecordingTool,
  isTicketWriteTool: () => isTicketWriteTool,
  isTruncatedTurn: () => isTruncatedTurn,
  isUnscopedMutationTool: () => isUnscopedMutationTool,
  isUsageSurface: () => isUsageSurface,
  isUserConfiguredModelRef: () => isUserConfiguredModelRef,
  lastConsolidationIndex: () => lastConsolidationIndex,
  lastServedModel: () => lastServedModel,
  leftChangeUnreviewed: () => leftChangeUnreviewed,
  leftChangeUnshipped: () => leftChangeUnshipped,
  linkedTicketsToAdvance: () => linkedTicketsToAdvance,
  linkedTicketsToComplete: () => linkedTicketsToComplete,
  loadAgentPoolVia: () => loadAgentPoolVia,
  loadBrainPersonaAgentsVia: () => loadBrainPersonaAgentsVia,
  loadGatewayModelOptions: () => loadGatewayModelOptions,
  localFallbackTrace: () => localFallbackTrace,
  localFirstApplies: () => localFirstApplies,
  localFirstWorkload: () => localFirstWorkload,
  localStorageConfirmationPersistence: () => localStorageConfirmationPersistence,
  localToolsIn: () => localToolsIn,
  localTransport: () => localTransport,
  mcpActionsFrom: () => mcpActionsFrom,
  mentionRecipient: () => mentionRecipient,
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
  packForModel: () => packForModel,
  pageEnginesFetch: () => pageEnginesFetch,
  pageRuntimePin: () => pageRuntimePin,
  parseAskUser: () => parseAskUser,
  parseByoUnresolved: () => parseByoUnresolved,
  parseChatActivity: () => parseChatActivity,
  parseDirectedRecipients: () => parseDirectedRecipients,
  parseGitShortStatus: () => parseGitShortStatus,
  parseHandOff: () => parseHandOff,
  parseMessageAuthor: () => parseMessageAuthor,
  parseMessageProvenance: () => parseMessageProvenance,
  parsePmoFocus: () => parsePmoFocus,
  parseStepMessage: () => parseStepMessage,
  parseSubagentOrigin: () => parseSubagentOrigin,
  perMillionUsd: () => perMillionUsd,
  personaAgentOf: () => personaAgentOf,
  personaModalityOf: () => personaModalityOf,
  personaModel: () => personaModel,
  personaOverlay: () => personaOverlay,
  personaSystemPrompt: () => personaSystemPrompt,
  placeholderAdvisory: () => placeholderAdvisory,
  placeholdersWritten: () => placeholdersWritten,
  planMessage: () => planMessage,
  pmoFocusDomId: () => pmoFocusDomId,
  pmoFocusValue: () => pmoFocusValue,
  poolAgentsFrom: () => poolAgentsFrom,
  premiumCostLabel: () => premiumCostLabel,
  prepareImageDataUrl: () => prepareImageDataUrl,
  previewReviewDirective: () => previewReviewDirective,
  probePageEngines: () => probePageEngines,
  productForPlan: () => productForPlan,
  productModelName: () => productModelName,
  progressDuration: () => progressDuration,
  projectMemoryHooks: () => projectMemoryHooks,
  promptApiAvailability: () => promptApiAvailability,
  promptApiFactory: () => promptApiFactory,
  promptApiInputQuota: () => promptApiInputQuota,
  promptApiMeasure: () => promptApiMeasure,
  promptStreamDeltas: () => promptStreamDeltas,
  providerFailureEvent: () => providerFailureEvent,
  providerFailureTrace: () => providerFailureTrace,
  queueRunSteering: () => queueRunSteering,
  ratedTurnContext: () => ratedTurnContext,
  ratedTurnTool: () => ratedTurnTool,
  readWithIdleWatchdog: () => readWithIdleWatchdog,
  reasoningForRun: () => reasoningForRun,
  repeatedFailureAdvisory: () => repeatedFailureAdvisory,
  resetApiVersionCache: () => resetApiVersionCache,
  resetBrainRunStore: () => resetBrainRunStore,
  resolveBrainStream: () => resolveBrainStream,
  resolveContextWindow: () => resolveContextWindow,
  resolveRecipient: () => resolveRecipient,
  resolveRunConfirm: () => resolveRunConfirm,
  retryOnConnectFailure: () => retryOnConnectFailure,
  revealsModelId: () => revealsModelId,
  revisitAdvisory: () => revisitAdvisory,
  routerToolSpecs: () => routerToolSpecs,
  routingQueryForTurn: () => routingQueryForTurn,
  runAbortSignal: () => runAbortSignal,
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
  stepRow: () => stepRow,
  stepSig: () => stepSig,
  stopRun: () => stopRun,
  stoppedTurnMetadata: () => stoppedTurnMetadata,
  streamChatCompletion: () => streamChatCompletion,
  stripAskUser: () => stripAskUser,
  studioToolsIn: () => studioToolsIn,
  subscribeRun: () => subscribeRun,
  subscribeRunStore: () => subscribeRunStore,
  subscribeToChatMessages: () => subscribeToChatMessages,
  summarizeLocalFirstAttempt: () => summarizeLocalFirstAttempt,
  takePendingPrompt: () => takePendingPrompt,
  ticketsReviewedInPreview: () => ticketsReviewedInPreview,
  toPromptApiTurn: () => toPromptApiTurn,
  toolActivity: () => toolActivity,
  toolCallArgBytes: () => toolCallArgBytes,
  toolExposureInTrace: () => toolExposureInTrace,
  toolNamesMentionedIn: () => toolNamesMentionedIn,
  toolSchemaTokens: () => toolSchemaTokens2,
  toolSpecsFor: () => toolSpecsFor,
  traceWithPersistedSteps: () => traceWithPersistedSteps,
  transcriptSeedFrom: () => transcriptSeedFrom,
  transportRetryTrace: () => transportRetryTrace,
  trimToolResult: () => trimToolResult,
  turnInterruption: () => turnInterruption,
  turnOptimizationDirective: () => turnOptimizationDirective,
  unreviewedChangeNudge: () => unreviewedChangeNudge,
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
  utf8ByteLength: () => utf8ByteLength2,
  withAdvisory: () => withAdvisory,
  withDirectedMetadata: () => withDirectedMetadata,
  withObservedModel: () => withObservedModel,
  withProvenanceMetadata: () => withProvenanceMetadata,
  withReadyPageModels: () => withReadyPageModels,
  withUsageSurface: () => withUsageSurface,
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
      let call2 = calls[i];
      let result;
      const pre = await hooks.beforeDispatch?.(call2, ctx);
      if (pre && "result" in pre) result = pre.result;
      else if (pre && "rewrite" in pre) call2 = pre.rewrite;
      if (!result) result = await ports.dispatch(call2, ctx);
      if (result.control?.kind === "finish") {
        const block = await hooks.onFinish?.(ctx, result.control.summary, call2);
        if (block) {
          result = { data: { ok: false, error: block }, isError: true };
        } else {
          finished = true;
          if (result.control.summary) ctx.output = result.control.summary;
        }
      } else if (result.control?.kind === "ask_human") {
        await hooks.onAskHuman?.(ctx, result.control, call2);
        awaitingInput = { approvalId: result.control.approvalId, question: result.control.question, callId: call2.id };
      }
      if (!result.control) ctx.failureStreak = result.isError ? ctx.failureStreak + 1 : 0;
      const row = codec.tool(call2, result);
      ctx.messages.push(row);
      const post = await hooks.afterDispatch?.(call2, result, row, ctx);
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

// ../packages/agent-loop/src/malformedCall.ts
var MALFORMED_CALL_RESULT = "This tool call's arguments were not valid JSON, so it was NOT executed. Re-issue it with strictly valid JSON: no comments, no trailing commas, no unescaped newlines or quotes inside string values.";
var TRUNCATED_CALL_RESULT = "This tool call was cut off by the output limit before its arguments were complete, so it was NOT executed. Re-issue it in your next response as ONE call with complete JSON \u2014 never several calls in one response. If the content is long, write it in parts: create it with its essential fields first, then extend it with follow-up calls.";
function malformedCallOutcome(call2, truncated, retryHint) {
  if (!call2.malformed) return null;
  const base = truncated ? TRUNCATED_CALL_RESULT : MALFORMED_CALL_RESULT;
  return { error: retryHint ? `${base} ${retryHint}` : base };
}
function malformedCallLabel(name, truncated) {
  return truncated ? `${name} (cut off by the output limit)` : `${name} (unparseable arguments)`;
}

// ../packages/agent-loop/src/runNarration.ts
var NARRATION_OPENER = new RegExp(
  "^(?:(?:now|next|first|then|so|okay|ok|alright|actually|great|good|perfect|but|and|also|finally)[,!.]?\\s+)*(?:let me|let's|i(?:'ll| will| need to| should| want to| am going to|'m going to| think| see| can see| notice| ran)\\b|looking (?:at|back|for)\\b|checking\\b|now the\\b|that was expected\\b)",
  "i"
);

// ../packages/agent-loop/src/turnPhase.ts
var MID_TURN_META_KEY = "midTurn";

// ../packages/agent-loop/src/stepRow.ts
var STEP_RESULT_CAP = 4e3;
function capped(value) {
  let s;
  try {
    s = JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
  return s.length > STEP_RESULT_CAP ? `${s.slice(0, STEP_RESULT_CAP)}\u2026[${s.length - STEP_RESULT_CAP} more chars]` : value ?? null;
}
function stepRow(step) {
  const metadata = JSON.stringify({
    kind: "step",
    category: step.category,
    label: step.label,
    args: step.args ?? null,
    result: capped(step.result),
    isError: step.isError ?? false,
    // Diagnostics scalars — tiny, and the whole point of keeping the row.
    ...step.durationMs != null ? { durationMs: step.durationMs } : {},
    ...step.resultBytes != null ? { resultBytes: step.resultBytes } : {},
    ...step.truncated ? { truncated: true } : {},
    ...step.usage ? { usage: step.usage } : {},
    ...step.finishReason != null ? { finishReason: step.finishReason } : {},
    ...step.textChars != null ? { textChars: step.textChars } : {},
    ...step.ttftMs != null ? { ttftMs: step.ttftMs } : {},
    ts: step.ts
  });
  return { role: "tool", content: "", metadata };
}

// ../packages/agent-loop/src/taskClosedState.ts
var TASK_CLOSED_STATUSES = ["done", "cancelled", "canceled", "completed", "archived"];
var CLOSED = new Set(TASK_CLOSED_STATUSES);

// ../packages/agent-loop/src/reasoning.ts
var REASONING_TAG = "think(?:ing)?|thought|antthinking|scratchpad|reasoning";
var QUICK_TAG_RE = new RegExp(`<\\s*/?\\s*(?:${REASONING_TAG}|final)\\b`, "i");
var FINAL_TAG_RE = /<\s*\/?\s*final\b[^<>]*>/gi;
var REASONING_TAG_RE = new RegExp(`<\\s*(/?)\\s*(?:${REASONING_TAG})\\b[^<>]*>`, "gi");
function findCodeRegions(text) {
  const regions = [];
  const fencedRe = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:(\n\2(?:\n|$))|$)/g;
  for (const match of text.matchAll(fencedRe)) {
    const lead = match[1] ?? "";
    const start = (match.index ?? 0) + lead.length;
    regions.push({ start, end: start + match[0].length - lead.length, unterminated: match[3] === void 0 });
  }
  const inlineRe = /`+(?:[^`\n]|\n(?![ \t]*\n))+`+/g;
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
function codeRegionAt(pos, regions) {
  return regions.find((r) => pos >= r.start && pos < r.end);
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
    const isClose = match[1] === "/";
    const region = codeRegionAt(idx, regions);
    if (region) {
      const releases = region.unterminated === true && kind === "thought" && isClose && region.start >= contentStart;
      if (!releases) continue;
      region.end = idx;
    }
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
  const answer2 = (content ?? "").trim();
  const thought = (reasoning ?? "").trim();
  if (!thought) return answer2;
  return answer2 ? `<think>${thought}</think>

${answer2}` : `<think>${thought}</think>`;
}

// ../packages/agent-loop/src/openaiCodec.ts
function toOpenAiToolCall(call2) {
  return { id: call2.id, type: "function", function: { name: call2.name, arguments: call2.arguments?.trim() ? call2.arguments : "{}" } };
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
    tool(call2, result) {
      const row = { role: "tool", tool_call_id: call2.id, content: serialize(result, call2) };
      return row;
    }
  };
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
var PROSE_LIST_ITEM = /^\s*(?:[-*•+]|\d{1,2}[.)])\s+(\S.*)$/;
var PROSE_BOLD_LEAD = /^\s*(?:\*\*|__)([^*_\n]+?)(?:\*\*|__)\s*(.*)$/;
var PROSE_CONTINUATION = /^\s{2,}\S/;
var PROSE_CHOICE_CUE = /\b(?:options?|choices?|choose|pick|which|prefer|approach|alternatives?)\b|\bwhat (?:would|do|should) (?:you|we) (?:like to )?(?:do|want)\b|\bhow (?:would|do) you (?:like|want)\b/i;
var PROSE_MAX_LABEL = 80;
var PROSE_MAX_OPTIONS = 6;
var plainLine = (line) => line.replace(/\*\*|__|`/g, "").trim();
function proseItemKind(line) {
  if (PROSE_LIST_ITEM.test(line)) return "marked";
  const bold = line.match(PROSE_BOLD_LEAD);
  if (!bold) return null;
  return !(bold[2] ?? "").trim() && plainLine(line).endsWith(":") ? null : "bold";
}
var isProseItem = (line) => proseItemKind(line) !== null;
function proseOption(line) {
  const body = line.match(PROSE_LIST_ITEM)?.[1] ?? line.trim();
  const bold = body.match(PROSE_BOLD_LEAD);
  let label;
  let rest;
  if (bold) {
    label = bold[1] ?? "";
    rest = bold[2] ?? "";
  } else {
    const sep = body.match(/\s+[—–-]\s+|:\s+/);
    label = sep?.index !== void 0 ? body.slice(0, sep.index) : body;
    rest = sep?.index !== void 0 ? body.slice(sep.index + sep[0].length) : "";
  }
  label = plainLine(label).replace(/[:.]$/, "").trim();
  const description = plainLine(rest).replace(/^[\s—–:-]+/, "").trim();
  if (!label || label.length > PROSE_MAX_LABEL) return null;
  return description ? { label, description } : { label };
}
function proseOptions(lines) {
  const options = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (isProseItem(line)) {
      const option = proseOption(line);
      if (!option) return null;
      options.push(option);
      continue;
    }
    const last = options[options.length - 1];
    if (!last || !PROSE_CONTINUATION.test(line)) return null;
    const more = plainLine(line);
    last.description = last.description ? `${last.description} ${more}` : more;
  }
  return options.length >= 2 && options.length <= PROSE_MAX_OPTIONS ? options : null;
}
function itemBlockStart(lines, end) {
  let kind = null;
  let i = end;
  while (i >= 0) {
    const line = lines[i] ?? "";
    const k = proseItemKind(line);
    if (k) {
      if (kind && k !== kind) break;
      kind = k;
      i--;
    } else if (!line.trim() || PROSE_CONTINUATION.test(line)) i--;
    else break;
  }
  let start = i + 1;
  while (start <= end && !(lines[start] ?? "").trim()) start++;
  return start;
}
function lineAbove(lines, index) {
  let i = index - 1;
  while (i >= 0 && !(lines[i] ?? "").trim()) i--;
  return i;
}
var isQuestionLine = (line) => !!line && !isProseItem(line) && plainLine(line).endsWith("?");
var isHeaderLine = (line) => !!line && !isProseItem(line) && plainLine(line).endsWith(":") && plainLine(line).length <= 60;
function liftProseAskUser(text) {
  if (!text || ASK_USER_FENCE.test(text)) return text;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let end = lines.length - 1;
  while (end >= 0 && !(lines[end] ?? "").trim()) end--;
  if (end < 1) return text;
  let question;
  let leadEnd;
  let itemStart;
  let itemEnd;
  if (isQuestionLine(lines[end])) {
    question = lines[end] ?? "";
    itemEnd = end - 1;
    itemStart = itemBlockStart(lines, itemEnd);
    const above = lineAbove(lines, itemStart);
    leadEnd = isHeaderLine(lines[above]) ? above : itemStart;
  } else {
    itemEnd = end;
    itemStart = itemBlockStart(lines, itemEnd);
    const above = lineAbove(lines, itemStart);
    if (!isQuestionLine(lines[above])) return text;
    question = lines[above] ?? "";
    leadEnd = above;
  }
  if (itemStart > itemEnd) return text;
  const cue = `${leadEnd < itemStart ? lines[leadEnd] ?? "" : ""} ${question}`;
  if (!PROSE_CHOICE_CUE.test(cue)) return text;
  const options = proseOptions(lines.slice(itemStart, itemEnd + 1));
  if (!options) return text;
  const payload = coerceAskUserPayload({ question: plainLine(question), options });
  if (!payload) return text;
  const lead = lines.slice(0, leadEnd).join("\n").trim();
  const block = serializeAskUser(payload);
  return lead ? `${lead}

${block}` : block;
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
var NOT_SIGNED_IN = "not_signed_in";
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
  if (message === NOT_SIGNED_IN) return { kind: "sign_in" };
  if (AUTH_PROSE.test(message)) return { kind: "auth" };
  if (CARD_PROSE.test(message)) return { kind: "validate_card" };
  if (UPGRADE_PROSE.test(message)) return { kind: "upgrade" };
  return null;
}

// src/networkErrorDetail.ts
var MAX_DEPTH = 4;
function causeChain(e) {
  const levels = [];
  let current = e;
  for (let depth = 0; current !== void 0 && current !== null && depth < MAX_DEPTH; depth++) {
    levels.push(current instanceof AggregateError && current.errors.length > 0 ? current.errors : [current]);
    current = current instanceof Error ? current.cause : void 0;
  }
  return levels;
}
function describeOne(e) {
  if (!(e instanceof Error)) return String(e);
  const code = e.code;
  const message = e.message.trim();
  if (!message) return typeof code === "string" && code ? code : e.name;
  return typeof code === "string" && code && !message.includes(code) ? `${code}: ${message}` : message;
}
function describeNetworkError(e) {
  const parts = [];
  for (const level of causeChain(e)) {
    const part = level.map(describeOne).filter((s, i, all) => all.indexOf(s) === i).join(" | ");
    if (part && !parts.includes(part)) parts.push(part);
  }
  return parts.join(" \u2190 ");
}
var NEVER_CONNECTED = /* @__PURE__ */ new Set([
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT"
]);
function isConnectFailure(e) {
  return causeChain(e).some((level) => level.some((err) => {
    const { code, syscall } = err ?? {};
    return typeof code === "string" && (NEVER_CONNECTED.has(code) || code === "ETIMEDOUT" && syscall === "connect");
  }));
}
var CONNECT_RETRY_DELAYS_MS = [1e3, 2e3, 4e3, 8e3, 16e3];
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function retryOnConnectFailure(send, opts = {}) {
  const delays = opts.delaysMs ?? CONNECT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (e) {
      if (opts.signal?.aborted) throw opts.signal.reason ?? e;
      if (attempt >= delays.length || !isConnectFailure(e)) throw e;
      const delay = delays[attempt];
      opts.onRetry?.(attempt + 1, delay, describeNetworkError(e));
      await pause(delay, opts.signal);
    }
  }
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
  /**
   * The gateway could not be reached at all, and stayed unreachable through every
   * backoff retry. Another model cannot help — none was ever asked — so the caller
   * reports the outage instead of retrying.
   */
  unreachable;
  constructor(message, model = void 0, options) {
    super(message, options?.cause !== void 0 ? { cause: options.cause } : void 0);
    this.name = "TransportError";
    this.model = model;
    this.unreachable = options?.unreachable === true;
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
  if (opts.arcStage) body.arcStage = opts.arcStage;
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
  const idleMs = opts.idleTimeoutMs ?? STREAM_IDLE_MS;
  const request = new AbortController();
  if (opts.signal?.aborted) request.abort();
  else opts.signal?.addEventListener("abort", () => request.abort(), { once: true });
  const headerDeadline = Number.isFinite(idleMs) && idleMs > 0 ? setTimeout(() => request.abort(), idleMs) : void 0;
  let res;
  try {
    res = await retryOnConnectFailure(
      () => doFetch(`${transport.baseUrl}/llm/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: request.signal
      }),
      { signal: request.signal, ...handlers.onConnectRetry ? { onRetry: handlers.onConnectRetry } : {} }
    );
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    if (request.signal.aborted) {
      throw new StreamInterruptedError(`the gateway sent nothing for ${Math.round(idleMs / 1e3)}s`, model);
    }
    if (e instanceof TypeError) {
      throw new TransportError(describeNetworkError(e), void 0, { cause: e, unreachable: isConnectFailure(e) });
    }
    throw e;
  } finally {
    clearTimeout(headerDeadline);
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
      chunkRead = await readWithIdleWatchdog(reader, { idleMs });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (e instanceof StreamIdleError) {
        throw new StreamInterruptedError(`the stream went silent for ${Math.round(e.idleMs / 1e3)}s`, resolvedModel());
      }
      throw new StreamInterruptedError(`the stream dropped mid-answer: ${describeNetworkError(e)}`, resolvedModel());
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
function resolveBrainStream(config) {
  return config.stream ?? ((opts, handlers) => streamChatCompletion({ ...opts, transport: config.transport }, handlers));
}
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
      stream: resolveBrainStream(config)
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
function normalise(text) {
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
  const scanned = normalise(t.slice(-TAIL_CHARS));
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

// ../packages/agent-stall/src/permissionMenu.ts
var TAIL_CHARS2 = 900;
var ACTION_VERB = "(?:run|execute|apply|implement|install|rebuild|build|compile|commit|push|merge|rebase|deploy|publish|release|ship|open|create|file|draft|write|add|update|patch|edit|change|modify|fix|resolve|refactor|rename|move|delete|remove|drop|close|cancel|archive|assign|dispatch|schedule|start|kick off|trigger|link|list|enumerate|show|generate|produce|proceed|continue|go ahead|do (?:it|that|this|them|so|first|next|now|any|all)|handle|take care of|work through|go through|tackle|clean up|tidy|sort out|migrate|convert|split|extract|bump|revert|restore|retry|re-?try|re-?run|verify|test|check|review|investigate|dig into|look into)";
var OFFER = new RegExp(
  [
    // "Would you like me to open the PRs?" · "Do you want me to merge these?"
    // · "Would you like me to proceed?"
    `\\b(?:would|do)\\s+you\\s+(?:like|want|prefer)\\s+(?:me|us)\\s+to\\b`,
    // "Shall I open PRs?" · "Should I cancel the stalled tickets?" · "Can I proceed?"
    // · "May I go ahead?"
    `\\b(?:shall|should|can|may)\\s+i\\b[^.?\\n]{0,80}\\?`,
    // "Want me to push these?" — the subjectless form.
    `\\bwant\\s+(?:me|us)\\s+to\\b`,
    // "Let me know if you'd like me to…" · "Let me know which of these to do"
    // · "Tell me which you'd prefer" · "Just say the word and I'll merge them"
    // "how" earns its place: "let me know how you'd like to proceed" is the single most
    // common way this pause is phrased, and it names no option at all.
    `\\blet me know\\b[^.\\n]{0,80}\\b(?:if|whether|which|what|how)\\b`,
    `\\b(?:tell|let)\\s+me\\s+know\\s+(?:which|what|whether|if)\\b`,
    `\\bsay the word\\b`,
    // "I can open the PRs if you'd like." · "I could cancel them if you want."
    // · "I'm happy to merge these if that's what you want."
    `\\bi\\s+(?:can|could|am happy to|'?m happy to|would be happy to)\\b[^.\\n]{0,120}?\\bif\\s+(?:you|that|you'?d|you would)\\b`,
    // "Confirm and I'll proceed." · "Approve and I'll merge them."
    `\\b(?:confirm|approve|give me the go-?ahead|give the go-?ahead)\\b[^.\\n]{0,40}\\band\\s+i(?:'ll| will)\\b`,
    // "Which would you like me to do first?" · "Which of these should I start with?"
    `\\bwhich\\s+(?:one|of these|of those)?\\s*(?:would|do|should|shall)\\s+(?:you|i)\\b`,
    // "Your call." · "Up to you." · "How would you like to proceed?" — and the
    // declarative order the same sentence takes inside a clause, "…how you would like
    // to proceed", which the interrogative-only form used to miss.
    `\\b(?:your call|up to you|it'?s your call)\\b`,
    `\\bhow\\s+(?:you\\s+(?:would|do)|(?:would|do)\\s+you)\\s+(?:want|like|prefer)\\b`
  ].join("|"),
  "gi"
);
var WINDOW_AFTER2 = 400;
var WINDOW_BEFORE2 = 120;
var ACTION_NEARBY = new RegExp(`\\b${ACTION_VERB}\\b`, "i");
var USERS_OWN_CHOICE = /\b(?:did you mean|do you mean|what did you (?:mean|intend)|which did you mean|prefer(?:ence|red)?\b|intended behaviou?r|by design|is that (?:right|correct|intended|what you)|am i (?:right|correct) (?:that|in)|credential|password|api ?key|secret|which account|whose|budget|deadline|priorit(?:y|ise|ize))\b/i;
function offersMenuInsteadOfActing(text) {
  const t = (text ?? "").trim();
  if (!t) return false;
  const scanned = t.slice(-TAIL_CHARS2);
  OFFER.lastIndex = 0;
  for (let m = OFFER.exec(scanned); m; m = OFFER.exec(scanned)) {
    const window2 = scanned.slice(
      Math.max(0, m.index - WINDOW_BEFORE2),
      m.index + m[0].length + WINDOW_AFTER2
    );
    if (!ACTION_NEARBY.test(window2)) continue;
    OFFER.lastIndex = 0;
    return true;
  }
  return false;
}
function pausesOnUsersOwnChoice(text) {
  return USERS_OWN_CHOICE.test((text ?? "").slice(-TAIL_CHARS2));
}
var ASK_USER_TOOL_NAME = "ask_user";
function askUserAdvertised(toolNames) {
  return (toolNames ?? []).some((n) => n.toLowerCase() === ASK_USER_TOOL_NAME);
}
function asksPermissionForRequestedWork(text, ctx) {
  if (!asksForChange(ctx.requestText)) return false;
  if (!offersMenuInsteadOfActing(text)) return false;
  if (pausesOnUsersOwnChoice(text) && !askUserAdvertised(ctx.availableToolNames)) return false;
  return true;
}
function permissionRecoveryNudge(lastChance, askUserAvailable = false) {
  const askBranch = askUserAvailable ? ` If some part of it genuinely IS the user's decision \u2014 two defensible options with no sensible default, something only they know \u2014 call \`${ASK_USER_TOOL_NAME}\` with the options as labelled choices instead of listing them in prose. That puts them on screen as buttons; a question in prose ends the run and costs a full round trip to answer. Do the parts that are NOT in question first, then ask about the rest.` : ` If some part of it genuinely IS the user's decision, say which single question you need answered, state which option you recommend and why, and carry out everything that does NOT depend on the answer before you stop.`;
  return "Your last turn ended by asking the user whether to do work they had ALREADY asked for. You hold the tools to do it, so the answer is yes and it is yours to carry out: pick the sensible default for anything you offered as an option, and DO IT NOW in this turn. Report what you did afterwards \u2014 do not re-state the offer." + askBranch + (lastChance ? " This is your last chance to act: your answer after this turn is shown to the user as-is, so either start the work now or state plainly, at the top of your reply, exactly what you did NOT do and the one decision you are blocked on." : "");
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
var TAIL_CHARS3 = 240;
function announcesUntakenAction(text) {
  const t = text.trim();
  if (!t) return false;
  return ANNOUNCED_ACTION.test(t.slice(-TAIL_CHARS3));
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
function stallRecoveryNudge(lastChance, shape, ctx) {
  if (shape === "handed-off") return handoffRecoveryNudge(lastChance);
  if (shape === "asked-permission") {
    return permissionRecoveryNudge(lastChance, askUserAdvertised(ctx?.availableToolNames));
  }
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
  if (asksPermissionForRequestedWork(input.text, input)) return "asked-permission";
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
    case "asked-permission":
      return `asked your permission to carry out work you had already asked for, ${rounds}, rather than carrying it out`;
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
    case "asked-permission":
      return "the work you asked for has NOT been started \u2014 the answer above is an offer to start it.";
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
  if (input.failoversUsed >= (input.maxFailovers ?? MAX_MODEL_FAILOVERS)) return void 0;
  const next = input.pick ? input.pick(input.tried) : nextFallbackModel(input.surface, input.tried);
  return next && !input.tried.includes(next) ? next : void 0;
}

// ../packages/run-policy/src/policy.ts
var PIN_RELEASE_STATUSES = [429, 413, 503];
var DECLINE_STATUS = 400;
var NONE = { kind: "none" };
function initialRunPolicy(opts = {}) {
  const model = opts.pinnedModel || void 0;
  return {
    phase: opts.startPhase ?? "plan",
    model,
    locked: false,
    pin: model,
    // Strictness belongs to a pin. With nothing pinned it would otherwise make the
    // run's first LOCK strict, which no host asks for.
    strictPin: !!opts.strictPin && !!model,
    broken: [...new Set((opts.excludeModels ?? []).filter(Boolean))],
    proven: [],
    tried: [],
    failovers: 0,
    turnRetries: 0,
    outcome: NONE,
    options: {
      pinReleasable: !!opts.pinReleasable,
      lockAfterFirstSuccess: !!opts.lockAfterFirstSuccess,
      maxFailovers: opts.maxFailovers ?? MAX_MODEL_FAILOVERS,
      decliningModelPrefixes: [...opts.decliningModelPrefixes ?? []],
      strictFailover: !!opts.strictFailover,
      preferProvenFailover: !!opts.preferProvenFailover,
      pinStrict: !!opts.strictPin && !!model,
      ...opts.fixedRole ? { fixedRole: opts.fixedRole } : {}
    }
  };
}
function nextTurn(state, turn) {
  return {
    role: turn.hasTools ? state.options.fixedRole ?? state.phase : "chat",
    model: state.model,
    strict: !!state.model && state.strictPin,
    excludeModels: [...state.broken]
  };
}
function offersHandOff(state) {
  return state.phase === "plan";
}
function reduceRunPolicy(state, event) {
  const s = { ...state, outcome: NONE };
  switch (event.type) {
    case "turn_succeeded":
      return succeeded(s, event.model, event.acted === true);
    case "code_change_attempted":
      return s.phase === "plan" && !s.model ? { ...s, phase: "code", outcome: { kind: "reask_as_coder" } } : s;
    case "hand_off":
      return s.phase === "plan" ? { ...s, phase: "code", outcome: { kind: "handed_off" } } : { ...s, outcome: { kind: "hand_off_rejected" } };
    case "verify_started":
      return { ...s, phase: "verify" };
    case "stalled":
      return stalled(s, event);
    case "transport_failed":
      return transportFailed(s, event);
  }
}
function succeeded(s, resolved, acted) {
  const proven = acted && resolved && resolved !== "default" && !s.proven.includes(resolved) ? [...s.proven, resolved] : s.proven;
  const next = { ...s, turnRetries: 0, proven };
  if (s.options.lockAfterFirstSuccess && !(s.model && s.strictPin) && resolved && resolved !== "default") {
    return { ...next, model: resolved, locked: true };
  }
  return next;
}
function stalled(s, e) {
  const tried = [...s.tried];
  const to = chooseStallFailover({
    activeModel: s.model,
    resolvedModel: e.resolvedModel,
    tried,
    failoversUsed: s.failovers,
    maxFailovers: s.options.maxFailovers,
    surface: e.surface,
    pick: failoverPicker(s, e)
  });
  if (!to) {
    const returned = s.model !== s.pin ? { model: s.pin, locked: false, strictPin: !!s.pin && s.options.pinStrict } : {};
    return { ...s, ...returned, tried, outcome: { kind: "failover_exhausted", tried } };
  }
  const failovers = s.failovers + 1;
  return {
    ...s,
    tried,
    failovers,
    model: to,
    locked: false,
    ...s.options.strictFailover ? { strictPin: true } : {},
    outcome: { kind: "failed_over", from: e.resolvedModel ?? s.model, to, attempt: failovers, of: s.options.maxFailovers }
  };
}
function failoverPicker(s, e) {
  const proven = s.options.preferProvenFailover ? [...s.proven].reverse() : [];
  if (proven.length === 0 && !e.pick && !e.surface) return void 0;
  if (proven.length === 0 && s.broken.length === 0) return e.pick;
  return (tried) => {
    const skip = [...tried, ...s.broken];
    return proven.find((m) => !skip.includes(m)) ?? (e.pick ? e.pick(skip) : nextFallbackModel(e.surface, skip));
  };
}
function transportFailed(s, e) {
  if (s.turnRetries >= 1 || e.kind === "unreachable") return { ...s, outcome: { kind: "fail_turn" } };
  const releasable = s.locked || s.options.pinReleasable;
  if (s.model && releasable && e.status !== void 0 && releasesPin(s, s.model, e.status)) {
    return {
      ...s,
      model: void 0,
      locked: false,
      pin: void 0,
      strictPin: false,
      turnRetries: s.turnRetries + 1,
      outcome: { kind: "retry_turn", released: s.model, status: e.status }
    };
  }
  if (isRequestRefusalStatus(e.status)) return { ...s, outcome: { kind: "fail_turn" } };
  if (s.model && s.locked && e.kind === "interrupted") {
    const brokenModel = e.model ?? s.model;
    return {
      ...s,
      model: void 0,
      locked: false,
      broken: s.broken.includes(brokenModel) ? s.broken : [...s.broken, brokenModel],
      turnRetries: s.turnRetries + 1,
      outcome: { kind: "retry_turn", broken: brokenModel, released: s.model }
    };
  }
  if (s.model) return { ...s, outcome: { kind: "fail_turn" } };
  const broken = e.kind === "interrupted" && e.model && !s.broken.includes(e.model) ? [...s.broken, e.model] : s.broken;
  return {
    ...s,
    broken,
    turnRetries: s.turnRetries + 1,
    outcome: { kind: "retry_turn", ...e.kind === "interrupted" && e.model ? { broken: e.model } : {} }
  };
}
function releasesPin(s, model, status2) {
  return PIN_RELEASE_STATUSES.includes(status2) || status2 === DECLINE_STATUS && s.options.decliningModelPrefixes.some((prefix) => model.startsWith(prefix));
}
function isRequestRefusalStatus(status2) {
  return status2 !== void 0 && status2 >= 400 && status2 < 500 && status2 !== 408 && !PIN_RELEASE_STATUSES.includes(status2);
}

// ../packages/run-policy/src/coderHandoff.ts
function isCoderReask(role, previousRole) {
  return role === "code" && previousRole === "plan";
}
var MAX_CALL_CHARS = 2e3;
var MAX_BRIEF_CHARS = 6e3;
function coderHandoffBrief(plannerText, calls) {
  const findings = plannerText.trim();
  const intended = calls.map((call2) => {
    const args = call2.args.length > MAX_CALL_CHARS ? `${call2.args.slice(0, MAX_CALL_CHARS)}\u2026` : call2.args;
    return `- ${call2.name} ${args}`;
  });
  const parts = [
    "HAND-OFF: the analysis for this request is complete \u2014 you are the coding model taking it from here. Everything the planner read is in the conversation above; do not start the investigation over or re-read files already returned above.",
    ...findings ? ["The planner concluded:", findings] : [],
    "It was about to make this change:",
    ...intended,
    "Make that change now. Correct it if it is wrong \u2014 a file you have not seen, or text that does not match \u2014 but act on it rather than re-planning. Read only what the edit itself needs and is not already above."
  ];
  const brief = parts.join("\n");
  return brief.length > MAX_BRIEF_CHARS ? `${brief.slice(0, MAX_BRIEF_CHARS)}\u2026` : brief;
}

// ../packages/run-policy/src/handoffBudget.ts
var DEFAULT_HANDOFF_RESERVE_TOKENS = 4096;
function toolSchemaTokens(schemas, estimate) {
  return schemas && schemas.length > 0 ? estimate(JSON.stringify(schemas)) : 0;
}
function handoffReserveTokens(maxTokens) {
  return maxTokens && maxTokens > 0 ? maxTokens : DEFAULT_HANDOFF_RESERVE_TOKENS;
}

// src/providerFailure.ts
function providerFailureEvent(error) {
  if (error instanceof StreamInterruptedError) {
    return { type: "transport_failed", kind: "interrupted", ...error.model ? { model: error.model } : {} };
  }
  if (error instanceof TransportError) {
    return { type: "transport_failed", kind: error.unreachable ? "unreachable" : "transport" };
  }
  if (error instanceof BrainRequestError) {
    if (isRequestRefusalStatus(error.status) && error.status !== DECLINE_STATUS) return null;
    return { type: "transport_failed", kind: "transport", status: error.status };
  }
  return null;
}

// src/runPolicyTraces.ts
function coderReaskTrace(ts, step, plannerModel) {
  return {
    ts,
    category: "message",
    label: "llm.role_handoff",
    args: { from: plannerModel ?? "default", step },
    result: `Analysis on ${plannerModel ?? "the planning model"} reached its first code change \u2014 handing the edit to the strongest connected coding model.`
  };
}
function handOffTrace(ts, step, tasks, via) {
  return {
    ts,
    category: "message",
    label: "llm.role_handoff",
    args: { step, tasks, via },
    result: `Planning handed off ${tasks} task${tasks === 1 ? "" : "s"} to the coding model.`
  };
}
function modelFailoverTrace(ts, step, from, outcome, shape) {
  return {
    ts,
    category: "message",
    label: "loop.model_failover",
    args: { step, from, to: outcome.to, attempt: outcome.attempt, of: outcome.of },
    result: modelFailoverNotice(from, outcome.to, shape)
  };
}
function transportRetryTrace(ts, step, outcome, message) {
  if (outcome.broken) {
    return {
      ts,
      category: "message",
      label: "llm.stream_interrupted",
      args: { model: outcome.broken, step },
      result: `${message} \u2014 retrying this turn on another connected model. ${outcome.broken} is left out for the rest of this run.`
    };
  }
  return {
    ts,
    category: "message",
    label: "llm.transport_error",
    args: { step },
    result: `${message} \u2014 retrying this turn on another connected model.`
  };
}
function providerFailureTrace(ts, step, model, error, durationMs) {
  return {
    ts,
    category: "error",
    label: "llm.complete",
    ...durationMs !== void 0 ? { durationMs } : {},
    args: { model: model || "default", step },
    result: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    isError: true
  };
}

// ../packages/local-inference/src/runtimes.ts
var BROWSER_ENGINE_BASE_URL = "http://browser.local";
var BFI_ENGINE_BASE_URL = "http://bfi.local";
var WEBLLM_ENGINE_BASE_URL = "http://webllm.local";
var LOCAL_RUNTIMES = [
  { id: "synapse", label: "Synapse", onDevice: true, catalog: "probe", tools: "all", reach: "http", ownedBy: "bfi" },
  {
    id: "ollama",
    label: "Ollama",
    onDevice: true,
    defaultBaseUrl: "http://127.0.0.1:11434",
    catalog: "probe",
    tools: "probe",
    reach: "http"
  },
  {
    id: "freetoken",
    label: "FreeToken",
    onDevice: true,
    defaultBaseUrl: "http://127.0.0.1:1919",
    catalog: "probe",
    tools: "unknown",
    reach: "http"
  },
  // Our transformer compiled to WebAssembly over WebGPU (`bfi-web`). Its models are the
  // catalog's (`LOCAL_MODEL_CATALOG`) that the page has downloaded; like `bfi serve` it
  // grammar-constrains `tools` for every model it loads.
  {
    id: "bfi",
    label: "Builderforce engine",
    onDevice: true,
    defaultBaseUrl: BFI_ENGINE_BASE_URL,
    catalog: "declared",
    tools: "all",
    reach: "page"
  },
  // MLC's WebLLM. Tool support is per MODEL (only its function-calling builds honour
  // `tools`), so the runtime says `unknown` and each catalog row declares its own.
  {
    id: "webllm",
    label: "WebLLM",
    onDevice: true,
    defaultBaseUrl: WEBLLM_ENGINE_BASE_URL,
    catalog: "declared",
    tools: "unknown",
    reach: "page"
  },
  // Chrome's built-in model (Prompt API). Its single model is declared by the page probe,
  // and it cannot take a tool turn: the Prompt API has no tool-call protocol.
  {
    id: "browser",
    label: "Gemini Nano",
    onDevice: true,
    defaultBaseUrl: BROWSER_ENGINE_BASE_URL,
    catalog: "declared",
    tools: "unknown",
    reach: "page"
  },
  { id: "kimi-code", label: "Kimi Code", onDevice: false, catalog: "declared", tools: "all", reach: "http" }
];
var HTTP_LOCAL_RUNTIMES = LOCAL_RUNTIMES.filter((r) => r.reach === "http");
var LOCAL_RUNTIME_IDS = LOCAL_RUNTIMES.map((r) => r.id);
function isLocalRuntimeId(value) {
  return typeof value === "string" && LOCAL_RUNTIME_IDS.includes(value);
}
function localRuntime(id) {
  return LOCAL_RUNTIMES.find((r) => r.id === id);
}

// ../packages/local-inference/src/ref.ts
var LOCAL_MODEL_PREFIX = "local/";
function formatLocalModelRef(runtime, model) {
  return `${LOCAL_MODEL_PREFIX}${runtime}/${model}`;
}
function parseLocalModelRef(ref) {
  if (!ref || !ref.startsWith(LOCAL_MODEL_PREFIX)) return null;
  const rest = ref.slice(LOCAL_MODEL_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const provider = rest.slice(0, slash);
  const model = rest.slice(slash + 1);
  if (!model || !isLocalRuntimeId(provider)) return null;
  return { provider, model };
}
function isLocalModelRef(ref) {
  return parseLocalModelRef(ref) !== null;
}

// ../packages/local-inference/src/endpoint.ts
function normalizeLocalBaseUrl(raw) {
  return raw.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}
function localChatCompletionsUrl(baseUrl) {
  return `${normalizeLocalBaseUrl(baseUrl)}/v1/chat/completions`;
}
var GATEWAY_COMPLETIONS_PATH = "/llm/v1/chat/completions";
var LOCAL_COMPLETIONS_PATH = "/v1/chat/completions";
function rewriteToLocalUrl(url) {
  return url.endsWith(GATEWAY_COMPLETIONS_PATH) ? `${url.slice(0, -GATEWAY_COMPLETIONS_PATH.length)}${LOCAL_COMPLETIONS_PATH}` : url;
}
function localAuthHeaders(endpoint) {
  return endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : {};
}

// ../packages/local-inference/src/catalog.ts
var MIB = 1024 * 1024;
var WEBGPU_DEFAULT_BINDING_BYTES = 128 * MIB;
var WEBLLM_FULL_BINDING_BYTES = 1024 * MIB;
function bonsai(size, params, bytes, contextTokens, layers) {
  const model = `bonsai-${size.toLowerCase()}-q1_0`;
  return {
    ref: formatLocalModelRef("bfi", model),
    runtime: "bfi",
    model,
    label: `Bonsai ${size} (1-bit)`,
    family: "bonsai",
    params,
    bytes,
    contextTokens,
    kv: { layers, kvHeads: 8, headDim: 128 },
    tools: true,
    source: { kind: "hf-file", repo: `prism-ml/Bonsai-${size}-gguf`, file: `Bonsai-${size}-Q1_0.gguf` },
    requires: { minBufferBytes: WEBGPU_DEFAULT_BINDING_BYTES }
  };
}
function webllm(modelId, fields) {
  return {
    ref: formatLocalModelRef("webllm", modelId),
    runtime: "webllm",
    model: modelId,
    label: fields.label,
    family: fields.family,
    params: fields.params,
    bytes: fields.bytes,
    contextTokens: fields.contextTokens,
    tools: fields.tools,
    source: { kind: "webllm", modelId },
    requires: { f16: true, minBufferBytes: fields.lowResource ? WEBGPU_DEFAULT_BINDING_BYTES : WEBLLM_FULL_BINDING_BYTES }
  };
}
var LOCAL_MODEL_CATALOG = [
  bonsai("1.7B", 17e8, 248302272, 32768, 28),
  bonsai("4B", 4e9, 572270624, 32768, 36),
  bonsai("8B", 819e7, 1158654496, 65536, 36),
  webllm("Qwen3-1.7B-q4f16_1-MLC", {
    label: "Qwen3 1.7B",
    family: "qwen3",
    params: 17e8,
    bytes: 984156278,
    contextTokens: 4096,
    tools: false,
    lowResource: true
  }),
  webllm("Llama-3.2-3B-Instruct-q4f16_1-MLC", {
    label: "Llama 3.2 3B Instruct",
    family: "llama-3.2",
    params: 321e7,
    bytes: 1816811105,
    contextTokens: 4096,
    tools: false,
    lowResource: true
  }),
  webllm("Qwen3-4B-q4f16_1-MLC", {
    label: "Qwen3 4B",
    family: "qwen3",
    params: 4e9,
    bytes: 2279167154,
    contextTokens: 4096,
    tools: false,
    lowResource: true
  }),
  webllm("Hermes-3-Llama-3.1-8B-q4f16_1-MLC", {
    label: "Hermes 3 Llama 3.1 8B",
    family: "hermes-3",
    params: 803e7,
    bytes: 4526847881,
    contextTokens: 4096,
    tools: true,
    lowResource: false
  })
];
function localCatalogModel(ref) {
  return LOCAL_MODEL_CATALOG.find((m) => m.ref === ref);
}
function localCatalogFor(runtime) {
  return LOCAL_MODEL_CATALOG.filter((m) => m.runtime === runtime);
}

// ../packages/local-inference/src/fit.ts
function localModelFit(model, support) {
  if (!support.supported) {
    return { fits: false, reason: "webgpu_unavailable", ...support.reason ? { detail: support.reason } : {} };
  }
  if (model.requires.f16 && !support.f16) return { fits: false, reason: "shader_f16_unavailable" };
  if (support.maxBufferBytes < model.requires.minBufferBytes) return { fits: false, reason: "buffer_too_small" };
  return { fits: true };
}

// ../packages/local-inference/src/plan.ts
function localModelUnfitReason(model, workload) {
  if (workload.agentic && model.tools !== true) return "tools";
  if (model.contextTokens !== void 0 && model.contextTokens < workload.inputTokens + workload.outputTokens) {
    return "context";
  }
  return null;
}
function localFirstPlan(input) {
  const onDevice = new Set(LOCAL_RUNTIMES.filter((r) => r.onDevice).map((r) => r.id));
  const rank = (id) => LOCAL_RUNTIMES.findIndex((r) => r.id === id);
  const candidates = input.probes.filter((p) => p.reachable && onDevice.has(p.provider)).sort((a, b) => rank(a.provider) - rank(b.provider)).flatMap(
    (p) => p.models.filter((m) => localModelUnfitReason(m, input.workload) === null).map((m) => ({
      kind: "local",
      ref: m.ref,
      provider: p.provider,
      model: m.model,
      endpoint: p.endpoint
    }))
  );
  const preferredIndex = input.preferred ? candidates.findIndex((c) => c.kind === "local" && c.ref === input.preferred) : -1;
  if (preferredIndex > 0) candidates.unshift(...candidates.splice(preferredIndex, 1));
  const local = candidates.slice(0, Math.max(0, input.maxLocalAttempts ?? 1));
  return input.cloud ? [...local, { kind: "cloud", ...input.cloud.model ? { model: input.cloud.model } : {} }] : local;
}

// ../packages/local-inference/src/failover.ts
var LocalFirstUnavailableError = class extends Error {
  constructor() {
    super("local_first_unavailable: no local model fits this call and no cloud fallback is available");
    this.name = "LocalFirstUnavailableError";
  }
};
async function runLocalFirst(plan, run, options = {}) {
  if (plan.length === 0) throw new LocalFirstUnavailableError();
  const attempts = [];
  const record = (entry) => {
    attempts.push(entry);
    options.onAttempt?.(entry);
  };
  for (let i = 0; i < plan.length; i++) {
    const attempt = plan[i];
    const isLast = i === plan.length - 1;
    const state = { committed: false };
    try {
      const result = await run(attempt, () => {
        state.committed = true;
      });
      if (state.committed || isLast || (options.accept?.(result) ?? true)) {
        record({ attempt, outcome: "served" });
        return { result, served: attempt, attempts };
      }
      record({ attempt, outcome: "refused", detail: "empty_response" });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      record({ attempt, outcome: "failed", detail });
      if (options.signal?.aborted || state.committed || isLast) throw e;
    }
  }
  throw new LocalFirstUnavailableError();
}

// ../packages/learned-routing/src/actionTypes.ts
var ACTION_TYPES = [
  "sql",
  "frontend_ui",
  "backend_api",
  "refactor",
  "bugfix",
  "tests",
  "docs",
  "devops_ci",
  "data_migration",
  "analysis",
  "provisioning",
  "decision",
  "other"
];
var DEFAULT_ACTION_TYPE = "other";
var ACTION_TYPE_SET = new Set(ACTION_TYPES);

// ../packages/workload/src/actionClassifier.ts
var MIN_CONFIDENCE = 0.45;
var INSTRUCTION_CHARS = 600;
var CONTEXT_CHARS = 2e3;
var CONTEXT_WEIGHT = 0.5;
var sig = (source, weight = 1) => ({
  re: new RegExp(source, "i"),
  weight
});
var SIGNALS = [
  [
    "data_migration",
    [
      sig("\\bbackfill(ing|ed)?\\b", 2),
      sig("\\bdata migration\\b", 2),
      sig("\\bre-?index(ing)?\\b"),
      sig("\\bmigrate .{0,20}\\bdata\\b", 2),
      sig("\\bseed (the )?(database|table|data)\\b", 2),
      sig("\\betl\\b", 2)
    ]
  ],
  [
    "sql",
    [
      sig("\\bsql\\b", 2),
      sig("\\bquery\\b"),
      sig("\\bschema\\b"),
      sig("\\bmigration\\b"),
      sig("\\bpostgres|postgresql|sqlite|mysql\\b", 2),
      sig("\\bcreate table|alter table|drop table\\b", 2),
      sig("\\bindex(es)? on\\b"),
      sig("\\bforeign key|primary key\\b", 2)
    ]
  ],
  [
    "tests",
    [
      sig("\\bunit test|integration test|e2e test\\b", 2),
      sig("\\btests?\\b"),
      sig("\\bvitest|jest|pytest|playwright|mocha\\b", 2),
      sig("\\btest coverage\\b", 2),
      sig("\\bassert(ion)?s?\\b"),
      sig("\\bspec file\\b", 2)
    ]
  ],
  [
    "docs",
    [
      sig("\\bdocument(ation)?\\b", 2),
      sig("\\breadme\\b", 2),
      sig("\\bchangelog\\b", 2),
      sig("\\bdocstring|jsdoc|tsdoc\\b", 2),
      sig("\\bwrite .{0,20}\\bguide\\b", 2),
      sig("\\bcomment(s|ing)?\\b")
    ]
  ],
  [
    "devops_ci",
    [
      sig("\\bci\\b|\\bcd\\b", 2),
      sig("\\bgithub actions?|gitlab ci|jenkins|circleci\\b", 2),
      sig("\\bdocker(file)?|kubernetes|k8s|helm\\b", 2),
      sig("\\bdeploy(ment|ing)?\\b"),
      sig("\\bpipeline\\b"),
      sig("\\bbuild (script|config|failure)\\b", 2),
      sig("\\bterraform|ansible\\b", 2)
    ]
  ],
  [
    "provisioning",
    [
      sig("\\bprovision(ing|ed)?\\b", 2),
      sig("\\bspin up\\b", 2),
      sig("\\bcreate (a|an|the) (bucket|cluster|queue|instance|database|namespace)\\b", 2),
      sig("\\bdns|certificate|tls cert\\b"),
      sig("\\bconfigure .{0,20}\\b(account|tenant|workspace|environment)\\b")
    ]
  ],
  [
    "frontend_ui",
    [
      sig("\\bui\\b|\\bux\\b", 2),
      sig("\\bcomponent\\b"),
      sig("\\breact|vue|svelte|angular\\b", 2),
      sig("\\bcss|tailwind|stylesheet|styling\\b", 2),
      sig("\\bbutton|modal|dropdown|layout|page\\b"),
      sig("\\bresponsive|dark mode|accessib(le|ility)\\b", 2),
      sig("\\bfront-?end\\b", 2)
    ]
  ],
  [
    "backend_api",
    [
      sig("\\bapi\\b", 2),
      sig("\\bendpoint|route handler\\b", 2),
      sig("\\brest|graphql|grpc\\b", 2),
      sig("\\bback-?end\\b", 2),
      sig("\\bservice layer|controller|middleware\\b", 2),
      sig("\\bserver\\b"),
      sig("\\bauth(entication|orization)?\\b")
    ]
  ],
  [
    "refactor",
    [
      sig("\\brefactor(ing|ed)?\\b", 2),
      sig("\\bclean ?up\\b", 2),
      sig("\\bextract (a |the )?(function|method|component|module|helper)\\b", 2),
      sig("\\brename\\b"),
      sig("\\bdeduplicat|\\bdry\\b", 2),
      sig("\\brestructure|reorganis|reorganiz\\b", 2),
      sig("\\bsimplify\\b")
    ]
  ],
  [
    "bugfix",
    [
      sig("\\bbug\\b", 2),
      sig("\\bfix(es|ed|ing)?\\b", 2),
      sig("\\bbroken|crash(es|ing)?|regression\\b", 2),
      sig("\\berror\\b"),
      sig("\\bstack ?trace|exception\\b", 2),
      sig("\\bnot working|fails? to\\b", 2),
      sig("\\bdebug(ging)?\\b")
    ]
  ],
  [
    "analysis",
    [
      sig("\\banalys|analyz\\b", 2),
      sig("\\binvestigate|investigation\\b", 2),
      sig("\\bresearch\\b", 2),
      sig("\\bexplain|summaris|summariz\\b"),
      sig("\\bwhy (does|is|did|are)\\b", 2),
      sig("\\baudit|assess(ment)?\\b", 2),
      sig("\\bcompare\\b")
    ]
  ],
  [
    "decision",
    [
      sig("\\bapprove|approval\\b", 2),
      sig("\\bshould we\\b", 2),
      sig("\\bdecide|decision\\b", 2),
      sig("\\bsign ?off\\b", 2),
      sig("\\bchoose between\\b", 2)
    ]
  ]
];
function classifyRunAction(prompt) {
  const text = (prompt ?? "").trim();
  if (!text) {
    return { actionType: DEFAULT_ACTION_TYPE, confidence: 0 };
  }
  const paragraphBreak = text.indexOf("\n\n");
  const instructionEnd = paragraphBreak > 0 ? Math.min(paragraphBreak, INSTRUCTION_CHARS) : INSTRUCTION_CHARS;
  const instruction = text.slice(0, instructionEnd);
  const context = text.slice(instructionEnd, CONTEXT_CHARS);
  let total = 0;
  let best = null;
  for (const [actionType, signals] of SIGNALS) {
    let score2 = 0;
    for (const s of signals) {
      if (s.re.test(instruction)) {
        score2 += s.weight;
      } else if (context && s.re.test(context)) {
        score2 += s.weight * CONTEXT_WEIGHT;
      }
    }
    total += score2;
    if (score2 > 0 && (best === null || score2 > best.score)) {
      best = { actionType, score: score2 };
    }
  }
  if (!best || total === 0) {
    return { actionType: DEFAULT_ACTION_TYPE, confidence: 0 };
  }
  const confidence = best.score / total;
  if (confidence < MIN_CONFIDENCE) {
    return { actionType: DEFAULT_ACTION_TYPE, confidence };
  }
  return { actionType: best.actionType, confidence };
}

// ../packages/workload/src/arcStage.ts
var ARC_STAGES = ["idea", "make", "run", "measure", "reach"];
var ARC_STAGE_SET = new Set(ARC_STAGES);
function isArcStage(value) {
  return typeof value === "string" && ARC_STAGE_SET.has(value);
}

// ../packages/agent-tools/src/modelRoles.ts
var MODEL_ROLES = ["plan", "code", "verify", "explore", "chat", "utility"];
var MODEL_ROLE_DESCRIPTIONS = {
  plan: "Deciding an approach or breaking work down \u2014 no code written yet.",
  code: "Writing or editing code. The default when no role is named.",
  verify: "Checking work already done \u2014 reading test/build output, reviewing a diff.",
  explore: "Investigation \u2014 locating, searching, summarising.",
  chat: "A conversational answer with no task-shaped work behind it.",
  utility: "Small, mechanical, low-stakes work \u2014 formatting, extraction, a lookup."
};
var ROLE_SET = new Set(MODEL_ROLES);
function isModelRole(value) {
  return typeof value === "string" && ROLE_SET.has(value);
}
function delegationRole(raw) {
  return isModelRole(raw) ? raw : "code";
}

// ../packages/agent-tools/src/workstreamScope.ts
function normalizeScopePath(path) {
  return path.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}
function inScope(path, scope) {
  const p = normalizeScopePath(path);
  return scope.some((entry) => {
    const s = normalizeScopePath(entry);
    return s === "" || p === s || p.startsWith(`${s}/`);
  });
}
function overlappingScopes(scopes) {
  for (let i = 0; i < scopes.length; i++) {
    for (let j = i + 1; j < scopes.length; j++) {
      for (const path of scopes[i].paths) {
        if (inScope(path, scopes[j].paths) || scopes[j].paths.some((q) => inScope(q, [path]))) {
          return { a: scopes[i].label, b: scopes[j].label, path: normalizeScopePath(path) };
        }
      }
    }
  }
  return null;
}

// ../packages/agent-tools/src/jsonKeyRead.ts
var JSON_KEY_READ_MAX_CHARS = 12e3;
var MAX_LISTED_KEYS = 60;
function keysOf(value) {
  return value !== null && typeof value === "object" ? Object.keys(value) : [];
}
function readJsonKey(text, key) {
  let root;
  try {
    root = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "the file is not valid JSON, so `key` cannot be used \u2014 read it by line window instead" };
  }
  const segments = key.split(".").filter((s) => s.length > 0);
  if (segments.length === 0) return { ok: false, error: '`key` is empty \u2014 name a dot path such as "admin.visitorFlow"' };
  let node = root;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const container = node !== null && typeof node === "object" ? node : null;
    if (!container || !Object.prototype.hasOwnProperty.call(container, segment)) {
      const at = segments.slice(0, i).join(".") || "(root)";
      return {
        ok: false,
        error: `key "${segments.slice(0, i + 1).join(".")}" not found \u2014 ${at} has no "${segment}"`,
        availableKeys: keysOf(node).slice(0, MAX_LISTED_KEYS)
      };
    }
    node = container[segment];
  }
  const content = JSON.stringify(node, null, 2) ?? "null";
  if (content.length <= JSON_KEY_READ_MAX_CHARS) return { ok: true, key: segments.join("."), content };
  return { ok: true, key: segments.join("."), tooLarge: true, size: content.length, childKeys: keysOf(node).slice(0, MAX_LISTED_KEYS) };
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
function inferRepoFromPath(path) {
  if (typeof path !== "string" || !path.trim()) return null;
  const parts = path.split(/[\\/]/).filter((s) => s.length > 0 && s !== ".");
  if (parts.length < 2) return null;
  return safeRepoArg(parts[0]);
}
function repoScopedScript(script, repo) {
  const dir = safeRepoArg(repo);
  return dir ? `cd "${dir}" || exit 1
${script}` : script;
}
function buildListCheckoutsCommand() {
  return 'for d in */; do [ -e "$d.git" ] && printf "%s\\n" "${d%/}"; done';
}
function parseCheckoutList(stdout) {
  if (!stdout) return [];
  const names = [];
  for (const line of stdout.split(/\r?\n/)) {
    const name = line.trim().replace(/\/+$/, "");
    if (!name || name === "*" || name === "." || name === "..") continue;
    const safe = safeRepoArg(name);
    if (safe) names.push(safe);
  }
  return names;
}
function notARepoResult(action, candidates = []) {
  const named = candidates.filter(Boolean);
  const extra = named.length ? `Candidate repositories: ${named.map((c) => `"${c}"`).join(", ")}. Re-run this tool with \`repo\` set to the one holding the code you are working on (e.g. { "repo": "${named[0]}" }).` : "No git checkouts were found at the top level of the open folder. File edits still work; only the git tools need a repository.";
  return {
    data: {
      ok: false,
      action,
      error: "not a git repository at the workspace root \u2014 this usually means the open folder CONTAINS the repositories rather than being one (several checkouts side by side). " + extra,
      ...named.length ? { candidates: named } : {}
    }
  };
}
async function notARepoWithCandidates(action, ctx) {
  const listed = await ctx.caps.shell.run(buildListCheckoutsCommand());
  return notARepoResult(action, parseCheckoutList(listed.stdout));
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
  const explicitRepo = opts.repo;
  let repo = explicitRepo;
  let path = opts.path;
  let r = await ctx.caps.shell.run(buildGitCommand(action, { ...opts, repo, path }));
  if (isNotARepo(r) && !explicitRepo) {
    const inferred = inferRepoFromPath(opts.path);
    if (inferred) {
      const inner = commitPathCandidates(opts.path ?? "", inferred);
      path = inner.length > 0 ? inner[inner.length - 1] : void 0;
      r = await ctx.caps.shell.run(buildGitCommand(action, { ...opts, repo: inferred, path }));
      if (!isNotARepo(r)) repo = inferred;
    }
    if (isNotARepo(r)) return notARepoWithCandidates(action, ctx);
  }
  const result = gitToolResult(action, r);
  if (repo && result.data.ok) {
    result.data.repo = repo;
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
  if (isNotARepo(r) && !repo) return notARepoWithCandidates(action, ctx);
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

// ../packages/agent-tools/src/semantic-tools.ts
var SEARCH_DEFAULT_LIMIT = 8;
var SEARCH_MAX_LIMIT = 25;
var MAP_DEFAULT_TOKENS = 1500;
var MAP_MAX_TOKENS = 8e3;
var semanticSearchTool = defineTool({
  name: "semantic_search",
  description: `Find code by MEANING or by name in one call \u2014 returns whole functions/classes (path, line range, symbol, snippet) ranked by identifier-aware keyword match (resolveMembership matches "membership") plus local embeddings. Use it FIRST for questions phrased in words \u2014 "where is X handled", "how does Y work", "what validates Z" \u2014 where search_code needs an exact substring you do not know yet. Then read_file only the hit you will edit, at its line range. For exact strings, usages and config values use search_code; for a known symbol's definition use find_symbol.`,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: 'What you are looking for, in words or identifiers, e.g. "stripe webhook to ledger".' },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict to, e.g. "api/src".' },
      limit: { type: "number", description: `Max results (default ${SEARCH_DEFAULT_LIMIT}, max ${SEARCH_MAX_LIMIT}).` }
    },
    required: ["query"]
  },
  requires: ["repo.semantic"],
  async execute(args, ctx) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { data: { ok: false, error: "query is required" } };
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : void 0;
    const requested = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.floor(args.limit) : SEARCH_DEFAULT_LIMIT;
    const limit = Math.min(SEARCH_MAX_LIMIT, Math.max(1, requested));
    const r = await ctx.caps.semantic.search(query, { scope, limit });
    if (!r.ok) return { data: r };
    const results = (r.results ?? []).map((h) => ({
      at: `${h.path}:${h.startLine}-${h.endLine}`,
      symbol: h.symbol ?? void 0,
      kind: h.kind,
      via: h.source,
      snippet: h.snippet
    }));
    const data = { ok: true, query, total: results.length, results };
    if (r.indexing) {
      data.note = "The index is still being built \u2014 these results cover only the files scanned so far. A miss is not proof of absence yet; fall back to search_code if needed.";
    } else if (results.length === 0) {
      data.note = `Nothing matched "${query}"${scope ? ` under "${scope}"` : ""}. Rephrase with likely identifier words, drop \`path\`, or use search_code for an exact string.`;
    }
    return { data };
  }
});
var repoMapTool = defineTool({
  name: "repo_map",
  description: "The repository's SHAPE in one call: files ordered by how much the rest of the code depends on them, each with its most-referenced definitions as `line: signature`. Call it once at the start of unfamiliar work instead of exploring with list_files and reads; pass `focus` (paths you are working in) to rank that area first.",
  parameters: {
    type: "object",
    properties: {
      focus: { type: "array", items: { type: "string" }, description: 'Optional repo-relative paths to rank first, e.g. ["api/src/billing"].' },
      maxTokens: { type: "number", description: `Budget for the map (default ${MAP_DEFAULT_TOKENS}, max ${MAP_MAX_TOKENS}).` }
    }
  },
  requires: ["repo.semantic"],
  async execute(args, ctx) {
    const focus = Array.isArray(args.focus) ? args.focus.filter((f) => typeof f === "string" && f.trim() !== "") : [];
    const requested = typeof args.maxTokens === "number" && Number.isFinite(args.maxTokens) ? Math.floor(args.maxTokens) : MAP_DEFAULT_TOKENS;
    const maxTokens = Math.min(MAP_MAX_TOKENS, Math.max(200, requested));
    const r = await ctx.caps.semantic.repoMap({ maxTokens, focus });
    if (!r.ok) return { data: r };
    const data = { ok: true, map: r.map ?? "" };
    if (r.indexing) data.note = "The index is still being built \u2014 the map covers only the files scanned so far.";
    return { data };
  }
});
var SEMANTIC_TOOLS = [semanticSearchTool, repoMapTool];

// ../packages/agent-tools/src/writeOverwriteGuard.ts
var WRITE_OVERWRITE_LARGE_BYTES = 2048;
var WRITE_OVERWRITE_SHRINK_RATIO = 0.5;
function utf8ByteLength(text) {
  return new TextEncoder().encode(text).length;
}
var NOT_FOUND = /not found|no such file|enoent|does not exist|404\b/i;
function isNotFoundReadError(error) {
  return !!error && NOT_FOUND.test(error);
}
function probeFromRepoRead(read) {
  if (!read.ok) {
    if (isNotFoundReadError(read.error)) return { status: "missing" };
    return { status: "unreadable", reason: read.error?.trim() || "read failed" };
  }
  const content = read.content ?? "";
  if (read.truncated) {
    const contentLines = content === "" ? 0 : content.split(/\r?\n/).length;
    const totalLines = typeof read.totalLines === "number" && Number.isFinite(read.totalLines) ? read.totalLines : null;
    if (totalLines != null && contentLines > 0) {
      const windowBytes = utf8ByteLength(content);
      return { status: "ok", bytes: Math.round(windowBytes * (totalLines / contentLines)), truncated: true };
    }
    return {
      status: "unreadable",
      reason: "read was truncated; refusing to overwrite without the full file"
    };
  }
  if (content === "") {
    if (read.totalLines === 0) return { status: "ok", bytes: 0 };
    return {
      status: "unreadable",
      reason: "read returned empty contents; refusing to treat that as an empty file"
    };
  }
  return { status: "ok", bytes: utf8ByteLength(content) };
}
function refuseWriteOverwrite(probe, incoming) {
  if (probe.status === "missing") return null;
  if (probe.status === "unreadable") {
    return `cannot overwrite: ${probe.reason}. A failed or empty read is not an empty file \u2014 use edit_file after a successful read, or create a new path.`;
  }
  const incomingBytes = utf8ByteLength(incoming);
  if (probe.bytes >= WRITE_OVERWRITE_LARGE_BYTES && incomingBytes < probe.bytes * WRITE_OVERWRITE_SHRINK_RATIO) {
    return `refusing to replace a large existing file (${probe.bytes} bytes) with a much smaller body (${incomingBytes} bytes). Use edit_file for surgical changes.`;
  }
  return null;
}

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
function readFileKey(path, file, key) {
  if (file.truncated === true) {
    return { ok: false, path, key, error: "the file is too large to load whole, so `key` cannot be used \u2014 page it with offset/limit" };
  }
  const read = readJsonKey(file.content ?? "", key);
  if (!read.ok) return { path, key, ...read };
  if ("tooLarge" in read) {
    return {
      ok: true,
      path,
      key: read.key,
      childKeys: read.childKeys,
      note: `"${read.key}" is ${read.size} characters \u2014 too large to return whole. Read one of its childKeys, e.g. key "${read.key}.${read.childKeys[0] ?? "\u2026"}".`
    };
  }
  return { ok: true, path, key: read.key, content: read.content };
}
var readFileTool = defineTool({
  name: "read_file",
  description: "Read a repo file on the ticket branch. Returns up to " + READ_DEFAULT_LINE_LIMIT + ' lines at a time: a large file comes back as a paginated line window (never a hard failure), and the result\'s `truncated`/`totalLines` tell you when more remains \u2014 read the next chunk by calling again with `offset`. For a large JSON file (an i18n catalog, a config) pass `key` with a dot path such as "admin.visitorFlow" to get just that subtree instead of paging line windows. Always read a file before editing it so you preserve existing code and only change what is needed.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      offset: { type: "number", description: "1-based line to start reading from (for paging through a large file). Default 1." },
      limit: { type: "number", description: `Max lines to return. Default ${READ_DEFAULT_LINE_LIMIT}. Read the next window with offset = previous offset + returned lines.` },
      key: { type: "string", description: 'JSON files only: a dot path (e.g. "admin.visitorFlow") \u2014 returns that subtree, or its child keys when it is too large. Ignores offset/limit.' }
    },
    required: ["path"]
  },
  requires: ["repo.read"],
  async execute(args, ctx) {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) return { data: { ok: false, error: "path is required" } };
    const offset = typeof args.offset === "number" && args.offset > 0 ? Math.floor(args.offset) : void 0;
    const limit = typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : void 0;
    const key = typeof args.key === "string" ? args.key.trim() : "";
    const r = await ctx.caps.repoRead.readFile(path);
    if (!r.ok) return { data: r };
    if (key) return { data: readFileKey(r.path ?? path, r, key) };
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
  description: 'Create a new file, or replace a whole file you have already read, with its complete contents. Prefer edit_file for surgical changes to an existing file \u2014 write_file refuses to replace a large existing file with a much smaller body, and a failed or empty read of a path you are about to overwrite is a hard stop (not an empty file). New-file create (read 404 / not found) is still allowed. How the write lands depends on the surface: in an editor/on-prem workspace it edits the file in place; in a cloud/review run it is staged on the ticket branch as a reviewable pending change. Do NOT narrate a specific mechanism (e.g. "opened a PR") \u2014 just state what the file now contains. Use once per deliverable file. Provide the FULL file content.',
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
    if (ctx.caps.repoRead) {
      let existing;
      try {
        existing = await ctx.caps.repoRead.readFile(path);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "read failed";
        return {
          data: {
            ok: false,
            error: `cannot overwrite: ${reason}. A failed or empty read is not an empty file \u2014 use edit_file after a successful read, or create a new path.`
          }
        };
      }
      const refusal2 = refuseWriteOverwrite(probeFromRepoRead(existing), content);
      if (refusal2) return { data: { ok: false, error: refusal2 } };
    }
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
  description: "Make a surgical in-place edit to an existing file on the ticket branch: replace an exact snippet with new text, without rewriting the whole file. Read the file first so `old_string` matches EXACTLY (including indentation). `old_string` must be unique in the file unless you set `replace_all`. Prefer this over write_file for small changes to large files. A success returns `excerpt` \u2014 the edited lines with line numbers and a little context \u2014 so do NOT re-read the file to check the edit. A miss returns `nearest` \u2014 the closest matching line and its neighbours \u2014 copy `old_string` from there.",
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
      data: r.ok ? {
        ok: true,
        ...r.branch ? { branch: r.branch } : {},
        ...r.commitUrl ? { commitUrl: r.commitUrl } : {},
        replaced: r.replaced,
        ...r.region ? { region: r.region } : {},
        ...r.excerpt ? { excerpt: r.excerpt } : {}
      } : { ok: false, error: r.error, ...r.nearest ? { nearest: r.nearest } : {} }
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
  description: "Statically validate the files you have written: it parses committed JSON/YAML and runs the platform's shell-free changed-source quality policies, returning structured path/line/rule diagnostics to fix BEFORE finishing. On the cloud Worker it ALSO polls CI (build/type-check/test) for this branch's HEAD and reports success/pending/failure \u2014 that is this executor's in-run substitute for a local shell. The same static validation runs automatically at finish, so it cannot be skipped. Never claim a build/test passed unless this tool (or run_command on a Container) reported success.",
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
  ...SEMANTIC_TOOLS,
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
    const str4 = (v) => typeof v === "string" ? v.trim() : "";
    const slug = str4(args.slug);
    const name = str4(args.name);
    const description = str4(args.description);
    const body = str4(args.body);
    if (!slug || !name || !description || !body) {
      return { data: { ok: false, error: "slug, name, description and body are all required" } };
    }
    const evidence = str4(args.evidence);
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

// ../packages/agent-tools/src/live-subagent-tools.ts
var LIVE_DELEGATION_NOTE = "HERE the child runs IN THE BACKGROUND: the call returns its handle at once and you keep working \u2014 plan, code, or start more children \u2014 while it does its slice. Its messages appear in the chat under its own name, and its report reaches you on its own when it finishes (call wait_agents only when you cannot go on without it). Redirect it with message_agent; cancel it with stop_agent. Do not edit the files a child is working on while it runs.";
var LIVE_FANOUT_NEXT = "Keep working on anything not delegated; when their reports are in (they arrive on their own, or call wait_agents), check the combined result, fix anything the slices broke between them, and report per workstream and ticket.";
var SUBAGENT_CONTROL_TOOL_NAMES = { wait: "wait_agents", message: "message_agent", stop: "stop_agent" };
var MAX_WAIT_SECONDS = 600;
var DEFAULT_WAIT_SECONDS = 300;
var handlesOf = (v) => Array.isArray(v) ? v.filter((h) => typeof h === "string" && h.trim() !== "").map((h) => h.trim()) : [];
var live = (ctx) => ctx.caps.orchestration?.live ?? null;
var unavailable = () => ({ data: { ok: false, error: "this surface runs no background sub-agents" } });
var waitAgentsTool = defineTool({
  name: SUBAGENT_CONTROL_TOOL_NAMES.wait,
  description: "Wait for your running sub-agents and collect their reports. Use it only when your next step depends on their results (e.g. verifying and committing a fan-out). Pass `agents` to wait for specific handles; omit it to wait for all of yours. Returns the reports that came in and which are still running at the timeout.",
  parameters: {
    type: "object",
    properties: {
      agents: { type: "array", items: { type: "string" }, description: "Handles to wait for, e.g. ['a1','a3']. Omit for all of yours." },
      timeout_seconds: { type: "number", description: `How long to wait (default ${DEFAULT_WAIT_SECONDS}, max ${MAX_WAIT_SECONDS}).` }
    }
  },
  requires: ["orchestrate.live"],
  async execute(args, ctx) {
    const controls = live(ctx);
    if (!controls) return unavailable();
    const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(1, Number(args.timeout_seconds) || DEFAULT_WAIT_SECONDS));
    const { reports, running, note } = await controls.wait(handlesOf(args.agents), seconds * 1e3, ctx.signal);
    const changedFiles = [...new Set(reports.flatMap((r) => r.changedFiles ?? []))];
    return {
      data: {
        ok: true,
        reports,
        running,
        // Read by the ticket backstop (`codeChangesOf`) like any delegation result.
        ...changedFiles.length ? { changedFiles } : {},
        ...note ? { note } : running.length ? { note: `${running.join(", ")} still running \u2014 their reports will reach you when they finish.` } : {}
      }
    };
  }
});
var messageAgentTool = defineTool({
  name: SUBAGENT_CONTROL_TOOL_NAMES.message,
  description: "Redirect one of your running sub-agents mid-task: narrow its scope, correct a wrong assumption, hand it a fact it lacks. It reads the message before its next step. The message is shown in the chat.",
  parameters: {
    type: "object",
    properties: {
      agent: { type: "string", description: "The child's handle, e.g. 'a2'." },
      message: { type: "string", description: "The direction, standalone \u2014 it has none of your conversation." }
    },
    required: ["agent", "message"]
  },
  requires: ["orchestrate.live"],
  async execute(args, ctx) {
    const controls = live(ctx);
    if (!controls) return unavailable();
    const handle = typeof args.agent === "string" ? args.agent.trim() : "";
    const text = typeof args.message === "string" ? args.message.trim() : "";
    if (!handle || !text) return { data: { ok: false, error: "agent and message are required" } };
    const out = await controls.message(handle, text);
    return { data: out };
  }
});
var stopAgentTool = defineTool({
  name: SUBAGENT_CONTROL_TOOL_NAMES.stop,
  description: "Stop running sub-agents of yours \u2014 one or more by handle, or all of them. A stopped child reports what it had done.",
  parameters: {
    type: "object",
    properties: {
      agents: { type: "array", items: { type: "string" }, description: "Handles to stop. Omit to stop ALL of your running children." }
    }
  },
  requires: ["orchestrate.live"],
  async execute(args, ctx) {
    const controls = live(ctx);
    if (!controls) return unavailable();
    const named = handlesOf(args.agents);
    const stopped = await controls.stop(named.length ? named : "all");
    return { data: { ok: true, stopped } };
  }
});
var SUBAGENT_CONTROL_TOOLS = [waitAgentsTool, messageAgentTool, stopAgentTool];

// ../packages/agent-tools/src/subagent-tools.ts
var ROLE_ENUM_DESCRIPTION = MODEL_ROLES.map((role) => `${role} \u2014 ${MODEL_ROLE_DESCRIPTIONS[role]}`).join(" \xB7 ");
var spawnAgentTool = defineTool({
  name: "spawn_agent",
  description: "Delegate a self-contained sub-task to a child agent that works in its OWN context and reports back when it is done. Use it when finding something out would take many turns you do not want to carry \u2014 locating where a behaviour lives across an unfamiliar tree, checking whether a pattern is used anywhere else, summarising a large file you only need one fact from. The child sees NOTHING of this conversation, so `task` must state everything it needs to know, and it answers in prose \u2014 it cannot hand you files or tool output. Do NOT delegate work you can do in a turn or two. The child is a clone of you: it holds every tool you hold and carries its slice out end to end \u2014 investigating, editing, running commands, recording the work. You remain accountable for what ships, so check what it reports. " + LIVE_DELEGATION_NOTE,
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
      role: {
        type: "string",
        enum: [...MODEL_ROLES],
        description: `What kind of call the child's turns are \u2014 lets the surface pick a model suited to the work rather than reusing yours. Defaults to 'code'. ${ROLE_ENUM_DESCRIPTION}`
      },
      as_agent: {
        type: "string",
        description: "Run the child AS one of the workspace's agents \u2014 its id or name (e.g. 'Ada'). The child adopts that agent's role, bio, skills and personality so the delegated slice is done in that agent's voice and expertise. Prefer an agent already in this chat (builtin_chats_list_agents) or from builtin_cloud_agents_list_mine. Optional: when no teammate's role fits the slice, omit it and the child runs as a plain sub-agent."
      }
    },
    required: ["label", "task"]
  },
  requires: ["orchestrate"],
  async execute(args, ctx) {
    const str4 = (v) => typeof v === "string" ? v.trim() : "";
    const label = str4(args.label);
    const task = str4(args.task);
    if (!task) return { data: { ok: false, error: "task is required \u2014 the child sees none of your conversation" } };
    const role = delegationRole(args.role);
    const asAgent = str4(args.as_agent);
    const r = await ctx.caps.orchestration.spawn({
      label: label || task.slice(0, 60),
      task,
      role,
      ...asAgent ? { asAgent } : {}
    });
    return { data: r, ...r.ok ? {} : { isError: true } };
  }
});
var MAX_WORKSTREAMS = 4;
var FANOUT_OUTPUT_CHARS = 4800;
var SPAWN_AGENTS_TOOL = "spawn_agents";
function parseWorkstreams(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return "workstreams is required \u2014 one entry per independent slice";
  if (raw.length > MAX_WORKSTREAMS) {
    return `at most ${MAX_WORKSTREAMS} workstreams per call \u2014 run the rest in a second call once these are back`;
  }
  const str4 = (v) => typeof v === "string" ? v.trim() : "";
  const out = [];
  for (const [i, item] of raw.entries()) {
    const w = item ?? {};
    const task = str4(w.task);
    if (!task) return `workstream ${i + 1} has no task \u2014 each child sees none of your conversation`;
    const ticket = str4(w.ticket);
    const role = str4(w.role);
    out.push({
      label: str4(w.label) || task.slice(0, 60),
      task,
      ...ticket ? { ticket } : {},
      ...role ? { role } : {},
      asAgent: str4(w.as_agent)
    });
  }
  return out;
}
var spawnAgentsTool = defineTool({
  name: SPAWN_AGENTS_TOOL,
  description: `Run SEVERAL independent workstreams side by side \u2014 up to ${MAX_WORKSTREAMS} child agents at once, each in its own context, each reporting back to the chat. Use it when the request splits into slices that do not depend on each other: a PRD's workstreams, one change per package or feature. Each child is a clone of you with every tool you hold, and carries its slice out end to end. Give slices that do not touch the same files, so they do not overwrite each other; once their reports are in, check the combined result and report per workstream. File one ticket per workstream first and pass its id as \`ticket\`. Each child sees nothing of this conversation, so every \`task\` must stand alone: what to change, where, and how to know it is done. ` + LIVE_DELEGATION_NOTE,
  parameters: {
    type: "object",
    properties: {
      workstreams: {
        type: "array",
        minItems: 1,
        maxItems: MAX_WORKSTREAMS,
        description: "One entry per independent slice of the work.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "A few words naming the workstream, e.g. 'W8: company \u2192 project'." },
            task: { type: "string", description: "The child's complete, standalone brief." },
            ticket: { type: "string", description: "The ticket this workstream delivers, echoed in the result." },
            role: { type: "string", enum: [...MODEL_ROLES], description: "Model role for the child. Defaults to code." },
            as_agent: { type: "string", description: "Run this workstream AS one of the workspace's agents (its name or id). Optional: omit it when no teammate's role fits, and the child runs as a plain sub-agent." }
          },
          required: ["label", "task"]
        }
      }
    },
    required: ["workstreams"]
  },
  requires: ["orchestrate.fanout"],
  // The CLOUD form: each child is one `orchestrate` spawn — its own durable run. The
  // editor starts its children as runs in its own process (`subagentFanOutTool.ts`) on
  // the same schema and parser.
  async execute(args, ctx) {
    const parsed = parseWorkstreams(args.workstreams);
    if (typeof parsed === "string") return { data: { ok: false, error: parsed } };
    const outputChars = Math.floor(FANOUT_OUTPUT_CHARS / parsed.length);
    const results = await Promise.all(parsed.map((w) => ctx.caps.orchestration.spawn({
      label: w.label,
      task: w.task,
      role: delegationRole(w.role),
      outputChars,
      ...w.ticket ? { ticket: w.ticket } : {},
      ...w.asAgent ? { asAgent: w.asAgent } : {}
    }).then((r) => ({ label: w.label, ...r }))));
    return {
      data: {
        ok: results.every((r) => r.ok),
        workstreams: results,
        next: LIVE_FANOUT_NEXT
      }
    };
  }
});
var SUBAGENT_TOOLS = [spawnAgentTool, spawnAgentsTool, ...SUBAGENT_CONTROL_TOOLS];

// ../packages/agent-tools/src/stableStringify.ts
function stableStringify(value) {
  if (value === null || value === void 0) return "null";
  if (typeof value === "number" && !Number.isFinite(value)) return JSON.stringify(String(value));
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Error) {
    return stableStringify({ name: value.name, message: value.message, stack: value.stack });
  }
  if (value instanceof Uint8Array) {
    return stableStringify({ type: "Uint8Array", data: Array.from(value) });
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value;
  const keys = Object.keys(record).filter((k) => record[k] !== void 0).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

// ../packages/workload/src/profile.ts
var TYPICAL_OUTPUT_TOKENS = {
  code: 4e3,
  plan: 1500,
  verify: 800,
  explore: 1e3,
  chat: 800,
  utility: 400
};
var DEFAULT_OUTPUT_TOKENS = 1e3;
var nonNegative = (n) => typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.ceil(n) : void 0;
function profileWorkload(input) {
  const role = isModelRole(input.role) ? input.role : void 0;
  const { actionType, confidence } = classifyRunAction(input.instruction);
  const cap2 = nonNegative(input.maxOutputTokens);
  const typical = role ? TYPICAL_OUTPUT_TOKENS[role] : DEFAULT_OUTPUT_TOKENS;
  return {
    role,
    arcStage: isArcStage(input.arcStage) ? input.arcStage : void 0,
    actionType,
    actionConfidence: confidence,
    inputTokens: nonNegative(input.inputTokens) ?? 0,
    outputTokens: cap2 !== void 0 ? Math.min(cap2, typical) : typical,
    agentic: input.hasTools === true
  };
}

// ../packages/workload/src/tokens.ts
var CHARS_PER_TOKEN = 4;
function estimateTokensFromChars(charCount) {
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

// src/localFirstTraces.ts
function summarizeLocalFirstAttempt(record) {
  const { attempt } = record;
  return {
    target: attempt.kind === "local" ? attempt.ref : attempt.model ?? "gateway",
    outcome: record.outcome,
    ...record.detail ? { detail: record.detail } : {}
  };
}
function localFallbackTrace(ts, step, attempts) {
  if (!attempts || attempts.length < 2) return null;
  const served = attempts.find((a) => a.outcome === "served");
  const skipped = attempts.filter((a) => a.outcome !== "served");
  if (!served || skipped.length === 0) return null;
  const why = skipped.map((a) => `${a.target} ${a.outcome}${a.detail ? ` (${a.detail})` : ""}`).join("; ");
  return {
    ts,
    category: "message",
    label: "llm.local_fallback",
    args: { step, from: skipped[0].target, to: served.target, attempts: attempts.map((a) => ({ ...a })) },
    result: `Local-first: ${why} \u2014 this turn was answered by ${served.target}.`
  };
}

// src/windowFit/modelWindow.ts
var positive = (n) => typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : void 0;
function contextWindowOf(modelRef, sources = {}) {
  if (!modelRef) return void 0;
  if (isLocalModelRef(modelRef)) {
    const live2 = [...sources.models ?? [], ...(sources.probes ?? []).flatMap((p) => p.models)].find((m) => m.ref === modelRef)?.contextTokens;
    return positive(live2) ?? positive(localCatalogModel(modelRef)?.contextTokens);
  }
  return positive(sources.cloud?.(modelRef));
}
async function resolveContextWindow(modelRef, sources = {}) {
  if (!modelRef) return void 0;
  let probes;
  if (sources.probes && isLocalModelRef(modelRef)) {
    try {
      probes = await sources.probes();
    } catch {
      probes = void 0;
    }
  }
  return contextWindowOf(modelRef, { ...sources.cloud ? { cloud: sources.cloud } : {}, ...probes ? { probes } : {} });
}

// src/localFirstTransport.ts
var globalFetch = (input, init) => fetch(input, init);
function localTransport(endpoint, fetchImpl = globalFetch, options = {}) {
  return {
    baseUrl: normalizeLocalBaseUrl(endpoint.baseUrl),
    getToken: () => endpoint.token ?? null,
    fetch: async (input, init) => {
      try {
        return await fetchImpl(rewriteToLocalUrl(input), init);
      } catch (e) {
        if (!options.failFast || init.signal?.aborted) throw e;
        throw new Error(`local_runtime_unreachable: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
}
function probedTarget(ref, probes) {
  for (const p of probes) {
    if (!p.reachable) continue;
    const m = p.models.find((x) => x.ref === ref);
    if (m) return { ref, provider: p.provider, model: m.model, endpoint: p.endpoint };
  }
  return null;
}
async function fittedFor(target, opts, fit, probes) {
  if (!fit) return opts.messages;
  const contextTokens = contextWindowOf(target.ref, { probes });
  return fit(opts.messages, {
    ref: target.ref,
    ...contextTokens ? { contextTokens } : {},
    ...opts.tools ? { tools: opts.tools } : {},
    ...opts.maxTokens ? { maxTokens: opts.maxTokens } : {}
  });
}
async function streamOnLocal(target, opts, handlers, transport, messages) {
  const served = await streamChatCompletion({ ...opts, messages, model: target.model, transport }, handlers);
  return { ...served, resolvedModel: target.ref, resolvedVendor: `local/${target.provider}` };
}
function createLocalStream(endpoint, model, fetchImpl, route = {}) {
  const transport = localTransport(endpoint, fetchImpl);
  const probes = route.probes ?? [];
  const pin = parseLocalModelRef(route.ref);
  const pinned = route.ref && pin ? { ref: route.ref, provider: pin.provider, model, endpoint } : null;
  return async (opts, handlers = {}) => {
    const asked = opts.model;
    if (asked && asked !== route.ref && asked !== model) {
      if (isLocalModelRef(asked)) {
        const parsed = parseLocalModelRef(asked);
        const sameRuntime = pin && parsed && parsed.provider === pin.provider ? { ref: asked, provider: parsed.provider, model: parsed.model, endpoint } : null;
        const target = probedTarget(asked, probes) ?? sameRuntime;
        if (target) {
          const t = target.endpoint === endpoint ? transport : localTransport(target.endpoint, fetchImpl);
          const messages2 = await fittedFor(target, opts, route.fit, probes);
          return streamOnLocal(target, opts, committingHandlers(handlers, () => void 0, target.ref), t, messages2);
        }
      } else if (route.cloud) {
        return route.cloud(opts, handlers);
      }
    }
    if (!pinned) return streamChatCompletion({ ...opts, model, transport }, handlers);
    const messages = await fittedFor(pinned, opts, route.fit, probes);
    return streamOnLocal(pinned, opts, committingHandlers(handlers, () => void 0, pinned.ref), transport, messages);
  };
}
function localFirstWorkload(call2) {
  const chars = JSON.stringify(call2.messages).length + (call2.tools ? JSON.stringify(call2.tools).length : 0);
  return profileWorkload({
    role: call2.role,
    hasTools: (call2.tools?.length ?? 0) > 0,
    inputTokens: estimateTokensFromChars(chars),
    ...call2.maxTokens ? { maxOutputTokens: call2.maxTokens } : {}
  });
}
function localFirstApplies(call2) {
  return !call2.model && (call2.routingMode ?? "auto") === "auto";
}
function coreMessages(messages) {
  const system = messages.filter((m) => m.role === "system");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return lastUser ? [...system, lastUser] : system;
}
function committingHandlers(handlers, commit, servedAs) {
  if (servedAs) handlers.onModel?.(servedAs, void 0);
  return {
    ...handlers,
    onTextDelta: (delta) => {
      commit();
      handlers.onTextDelta?.(delta);
    },
    onToolCallDelta: (index, partial) => {
      commit();
      handlers.onToolCallDelta?.(index, partial);
    },
    ...servedAs ? { onModel: () => void 0 } : {}
  };
}
var answered = (r) => r.text.trim().length > 0 || r.toolCalls.length > 0;
function createLocalFirstStream(input) {
  return async (opts, handlers = {}) => {
    if (!localFirstApplies(opts)) {
      if (!opts.model || !isLocalModelRef(opts.model)) {
        if (!input.cloud) throw new Error(NOT_SIGNED_IN);
        return input.cloud(opts, handlers);
      }
      const local = probedTarget(opts.model, input.probes);
      if (local) {
        const transport = localTransport(local.endpoint, input.fetch);
        const messages = await fittedFor(local, opts, input.fit, input.probes);
        return streamOnLocal(local, opts, committingHandlers(handlers, () => void 0, local.ref), transport, messages);
      }
    }
    const routed = opts.model ? { ...opts, model: void 0 } : opts;
    const plan = localFirstPlan({
      probes: input.probes,
      workload: localFirstWorkload(input.fit ? { ...routed, messages: coreMessages(routed.messages) } : routed),
      cloud: input.cloud ? {} : null
    });
    if (plan.length === 0) throw new Error(NOT_SIGNED_IN);
    const { result, attempts } = await runLocalFirst(
      plan,
      async (attempt, commit) => {
        if (attempt.kind === "cloud") return input.cloud(routed, committingHandlers(handlers, commit));
        const transport = localTransport(attempt.endpoint, input.fetch, { failFast: true });
        const messages = await fittedFor(attempt, routed, input.fit, input.probes);
        return streamOnLocal(attempt, routed, committingHandlers(handlers, commit, attempt.ref), transport, messages);
      },
      { signal: opts.signal, accept: answered, ...input.onAttempt ? { onAttempt: input.onAttempt } : {} }
    );
    const summaries = attempts.map(summarizeLocalFirstAttempt);
    return { ...result, localFirst: summaries };
  };
}
async function completeLocal(endpoint, model, messages, signal, fetchImpl = globalFetch) {
  const res = await fetchImpl(localChatCompletionsUrl(endpoint.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", ...localAuthHeaders(endpoint) },
    body: JSON.stringify({ model, messages, stream: false }),
    ...signal ? { signal } : {}
  });
  if (!res.ok) {
    const txt = await res.text().catch((e) => `(body unreadable: ${e instanceof Error ? e.message : String(e)})`);
    throw new Error(`local_complete_failed_${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}
async function completeLocalFirst(input) {
  const plan = localFirstPlan({
    probes: input.probes,
    workload: localFirstWorkload({ messages: input.messages }),
    cloud: input.cloud ? {} : null
  });
  if (plan.length === 0) throw new Error(NOT_SIGNED_IN);
  const { result } = await runLocalFirst(
    plan,
    (attempt) => attempt.kind === "cloud" ? input.cloud() : completeLocal(attempt.endpoint, attempt.model, input.messages, input.signal, input.fetch),
    {
      ...input.signal ? { signal: input.signal } : {},
      accept: (text) => text.trim().length > 0,
      ...input.onAttempt ? { onAttempt: input.onAttempt } : {}
    }
  );
  return result;
}

// src/windowFit/packForModel.ts
var import_handoff4 = require("@seanhogg/builderforce-memory/handoff");
var import_evermind = require("@seanhogg/builderforce-memory/evermind");

// src/workingTranscript.ts
var import_handoff3 = require("@seanhogg/builderforce-memory/handoff");
var HISTORY_WINDOW = 80;
var HISTORY_TOKEN_BUDGET = 64e3;
var COMPACT_TAIL_TOKEN_BUDGET = 4e4;
function messageTokens(m) {
  return (0, import_handoff3.messageTokens)(m, import_handoff3.defaultEstimateTokens);
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
  let total = transcriptTokens(w);
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
function transcriptTokens(msgs) {
  return (0, import_handoff3.tokensOf)(msgs, import_handoff3.defaultEstimateTokens);
}
function fitsVerbatim(msgs, extraTokens = 0) {
  return msgs.length <= HISTORY_WINDOW && extraTokens + transcriptTokens(msgs) <= HISTORY_TOKEN_BUDGET;
}
async function buildWorkingTranscript(state, systemPrompt, summarize, onFolded) {
  const convo = state.transcript;
  if (fitsVerbatim(convo)) {
    state.compactMemo = null;
    return [{ role: "system", content: systemPrompt }, ...windowed(convo)];
  }
  const memo = state.compactMemo && state.compactMemo.coveredEnd <= convo.length ? state.compactMemo : null;
  if (memo && fitsVerbatim(convo.slice(verbatimStart(convo, memo.coveredEnd)), (0, import_handoff3.defaultEstimateTokens)(memo.note))) {
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

// src/windowFit/packForModel.ts
var DEFAULT_HANDOFF_TIMEOUT_MS = 2e4;
function toolSchemaTokens2(tools) {
  return toolSchemaTokens(tools, import_handoff4.defaultEstimateTokens);
}
function recallBlock(recall) {
  return async (query, budgetChars) => {
    const result = await recall(query);
    if (!result?.seeded || result.items.length === 0) return "";
    return (0, import_evermind.formatEvermindMemoryBlock)(result.items).slice(0, budgetChars);
  };
}
async function packForModel(input) {
  const summarizer = input.summarizer;
  const pack = await (0, import_handoff4.packHandoff)({
    messages: input.messages,
    targetContextTokens: input.contextTokens,
    reserveOutputTokens: handoffReserveTokens(input.maxTokens),
    toolsTokens: toolSchemaTokens2(input.tools),
    ...input.from ? { from: input.from } : {},
    to: input.to,
    ...summarizer ? {
      summarize: async (dropped) => await summarizeMiddle(summarizer.stream, summarizer.model, dropped, summarizer.signal) ?? ""
    } : {},
    ...input.recall ? { recall: recallBlock(input.recall) } : {},
    timeoutMs: input.timeoutMs ?? DEFAULT_HANDOFF_TIMEOUT_MS
  });
  input.onTrace?.({
    ...input.from ? { from: input.from } : {},
    to: input.to,
    dropped: pack.dropped,
    summarized: pack.summarized,
    recalled: pack.recalled,
    estimatedTokens: pack.estimatedTokens,
    fits: pack.fits
  });
  return { messages: pack.messages, pack };
}
function createHandoffFit(options = {}) {
  return async (messages, target) => {
    if (!target.contextTokens) return messages;
    const { messages: packed } = await packForModel({
      messages,
      to: target.ref,
      contextTokens: target.contextTokens,
      ...target.tools ? { tools: target.tools } : {},
      ...target.maxTokens ? { maxTokens: target.maxTokens } : {},
      ...options
    });
    return packed;
  };
}

// src/pageEngines/pageRuntimePin.ts
function pageRuntimePin(ref) {
  const pin = parseLocalModelRef(ref);
  if (!pin) return null;
  const runtime = localRuntime(pin.provider);
  if (runtime.reach !== "page" || !runtime.defaultBaseUrl) return null;
  return { ...pin, endpoint: { baseUrl: runtime.defaultBaseUrl } };
}

// src/hostModelStream.ts
var handoffFit = createHandoffFit();
function createHostModelStream(input) {
  const resolveLocal = input.localPin ?? pageRuntimePin;
  const fit = input.fit ?? handoffFit;
  return async (opts, handlers = {}) => {
    const hostPin = await input.pinned?.() ?? null;
    const localRef = hostPin ?? opts.model;
    const local = localRef ? resolveLocal(localRef) : null;
    const cloud = await input.cloud();
    if (local && localRef) {
      return createLocalStream(local.endpoint, local.model, input.fetch, { ref: localRef, cloud, fit })(opts, handlers);
    }
    if (hostPin && !isLocalModelRef(hostPin) && cloud) {
      return cloud({ ...opts, model: hostPin, modelStrict: true }, handlers);
    }
    const probes = input.probes ? await input.probes() : [];
    if (probes.length === 0) {
      if (!cloud) throw new Error(NOT_SIGNED_IN);
      return cloud(opts, handlers);
    }
    return createLocalFirstStream({
      probes,
      cloud,
      fit,
      ...input.fetch ? { fetch: input.fetch } : {},
      ...input.onAttempt ? { onAttempt: input.onAttempt } : {}
    })(opts, handlers);
  };
}

// src/pageEngines/engineFailure.ts
function reportPageEngineFailure(runtime, stage, error) {
  console.warn(`BuilderForce page engine: ${runtime} ${stage} failed (${errorMessage(error)})`);
}

// src/pageEngines/types.ts
var PageEngineError = class extends Error {
  status;
  code;
  constructor(status2, code, message = code) {
    super(message);
    this.name = "PageEngineError";
    this.status = status2;
    this.code = code;
  }
};
var abortReason = (signal) => signal.reason ?? new DOMException("Aborted", "AbortError");
var errorMessage = (e) => e instanceof Error ? e.message : String(e);
var hasTools = (body) => Array.isArray(body.tools) && body.tools.length > 0;
function memoizedProbe(runtime, run, config = {}) {
  const ttlMs = config.ttlMs ?? PAGE_ENGINE_PROBE_TTL_MS;
  const now = config.now ?? (() => Date.now());
  let memo;
  return {
    probe(options = {}) {
      const at = now();
      if (!options.fresh && memo && at - memo.at < ttlMs) return memo.value;
      const value = run().catch((e) => {
        reportPageEngineFailure(runtime, "probe", e);
        return null;
      });
      memo = { at, value };
      return value;
    },
    invalidate() {
      memo = void 0;
    }
  };
}
var PAGE_ENGINE_PROBE_TTL_MS = 3e4;

// src/pageEngines/messages.ts
function messageText(content) {
  if (content === null || content === void 0) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = [];
  for (const part of content) {
    const { type, text } = part ?? {};
    if (type !== "text" || typeof text !== "string") return null;
    parts.push(text);
  }
  return parts.join("\n");
}

// src/promptApi.ts
function promptApiFactory() {
  if (typeof globalThis === "undefined") return null;
  const g = globalThis;
  return g.LanguageModel ?? g.ai?.languageModel ?? null;
}
function hasPromptApi() {
  return promptApiFactory() !== null;
}
async function promptApiAvailability(factory = promptApiFactory()) {
  if (!factory) return "unavailable";
  try {
    if (factory.availability) {
      const status2 = await factory.availability();
      return status2 === "readily" ? "available" : status2;
    }
    if (factory.capabilities) {
      const { available } = await factory.capabilities();
      return available === "readily" ? "available" : available === "after-download" ? "downloadable" : "unavailable";
    }
  } catch {
  }
  return "unavailable";
}
function promptApiInputQuota(session) {
  const quota = session.inputQuota ?? session.maxTokens;
  return typeof quota === "number" && Number.isFinite(quota) && quota > 0 ? quota : void 0;
}
async function promptApiMeasure(session, input, signal) {
  if (session.measureInputUsage) return session.measureInputUsage(input, signal ? { signal } : void 0);
  if (session.countPromptTokens) return session.countPromptTokens(input);
  return void 0;
}
async function* promptStreamDeltas(stream) {
  const reader = stream.getReader();
  let full = "";
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) return;
      if (typeof value !== "string") continue;
      const cumulative = value.startsWith(full);
      const delta = cumulative ? value.slice(full.length) : value;
      full = cumulative ? value : full + value;
      if (delta) yield delta;
    }
  } finally {
    reader.releaseLock();
  }
}

// src/browserEngine.ts
var BROWSER_ENGINE_MODEL = "gemini-nano";
var BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS = 4096;
async function readInputQuota() {
  const factory = promptApiFactory();
  if (!factory) return void 0;
  try {
    const session = await factory.create();
    try {
      return promptApiInputQuota(session);
    } finally {
      session.destroy();
    }
  } catch {
    return void 0;
  }
}
async function probeOnce(knownQuota, learnQuota) {
  if (await promptApiAvailability() !== "available") return null;
  let contextTokens = knownQuota();
  if (contextTokens === void 0) {
    contextTokens = await readInputQuota();
    if (contextTokens !== void 0) learnQuota(contextTokens);
  }
  const probe = {
    provider: "browser",
    endpoint: { baseUrl: BROWSER_ENGINE_BASE_URL },
    reachable: true,
    models: [
      {
        ref: formatLocalModelRef("browser", BROWSER_ENGINE_MODEL),
        provider: "browser",
        model: BROWSER_ENGINE_MODEL,
        label: localRuntime("browser").label,
        tools: false,
        contextTokens: contextTokens ?? BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS
      }
    ]
  };
  return probe;
}
function createBrowserEngineProber(config = {}) {
  let quota;
  return memoizedProbe(
    "browser",
    () => probeOnce(
      () => quota,
      (q) => {
        quota = q;
      }
    ),
    config
  );
}
function toPromptApiTurn(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return { error: "no_messages" };
  const system = [];
  const turns = [];
  for (const raw of messages) {
    const { role, content, tool_calls } = raw ?? {};
    if (Array.isArray(tool_calls) && tool_calls.length > 0) return { error: "tool_messages_unsupported" };
    const text = messageText(content);
    if (text === null) return { error: "non_text_content_unsupported" };
    if (role === "system") system.push(text);
    else if (role === "user" || role === "assistant") turns.push({ role, content: text });
    else return { error: "tool_messages_unsupported" };
  }
  const last = turns.pop();
  if (!last || last.role !== "user") return { error: "last_message_not_user" };
  const joined = system.filter((s) => s.trim().length > 0).join("\n\n");
  return {
    initialPrompts: [...joined ? [{ role: "system", content: joined }] : [], ...turns],
    prompt: last.content
  };
}
var isQuotaError = (e) => e?.name === "QuotaExceededError";
var chunk = (delta, finish) => ({
  model: BROWSER_ENGINE_MODEL,
  choices: [{ index: 0, delta, finish_reason: finish }]
});
async function* sessionChunks(session, prompt, signal) {
  try {
    for await (const delta of promptStreamDeltas(session.promptStreaming(prompt, signal ? { signal } : void 0))) {
      yield chunk({ content: delta }, null);
    }
    yield chunk({}, "stop");
  } catch (e) {
    if (isQuotaError(e) && !signal?.aborted) throw new PageEngineError(413, "context_exceeded", errorMessage(e));
    throw e;
  } finally {
    session.destroy();
  }
}
async function promptApiCompletions(body, signal) {
  if (hasTools(body)) throw new PageEngineError(400, "tools_unsupported");
  const turn = toPromptApiTurn(body.messages);
  if ("error" in turn) throw new PageEngineError(400, turn.error);
  const factory = promptApiFactory();
  if (!factory || await promptApiAvailability(factory) !== "available") {
    throw new PageEngineError(503, "browser_engine_unavailable");
  }
  let session;
  try {
    session = await factory.create({
      ...turn.initialPrompts.length > 0 ? { initialPrompts: turn.initialPrompts } : {},
      ...signal ? { signal } : {}
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw isQuotaError(e) ? new PageEngineError(413, "context_exceeded", errorMessage(e)) : new PageEngineError(503, "browser_engine_unavailable", errorMessage(e));
  }
  const quota = promptApiInputQuota(session);
  const needed = await promptApiMeasure(session, turn.prompt, signal).catch((e) => {
    if (!signal?.aborted) reportPageEngineFailure("browser", "measure", e);
    return void 0;
  });
  if (quota !== void 0 && needed !== void 0 && (session.inputUsage ?? 0) + needed > quota) {
    session.destroy();
    throw new PageEngineError(413, "context_exceeded");
  }
  return sessionChunks(session, turn.prompt, signal);
}
var promptApiEngine = {
  runtime: "browser",
  baseUrl: BROWSER_ENGINE_BASE_URL,
  ...createBrowserEngineProber(),
  chatCompletions: promptApiCompletions
};

// src/pageEngines/fetchShim.ts
var globalFetch2 = (input, init) => fetch(input, init);
function refusal(status2, code, message = code) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status: status2,
    headers: { "content-type": "application/json" }
  });
}
function refusalFor(engine, e) {
  if (e instanceof PageEngineError) return refusal(e.status, e.code, e.message);
  return refusal(500, `${engine.runtime}_engine_failed`, errorMessage(e));
}
var encoder = new TextEncoder();
var sseFrame = (data) => encoder.encode(`data: ${JSON.stringify(data)}

`);
var DONE_FRAME = encoder.encode("data: [DONE]\n\n");
function sseBody(first, chunks, signal) {
  let pending = first;
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = pending ?? await chunks.next();
        pending = null;
        if (next.done) {
          controller.enqueue(DONE_FRAME);
          controller.close();
          return;
        }
        controller.enqueue(sseFrame(next.value));
      } catch (e) {
        if (signal?.aborted) {
          controller.error(e);
          return;
        }
        controller.enqueue(sseFrame({ error: { message: errorMessage(e) } }));
        controller.close();
      }
    },
    cancel() {
      void chunks.return?.(void 0);
    }
  });
}
async function foldChunks(chunks) {
  let content = "";
  let model;
  let finish = null;
  let usage;
  const calls = /* @__PURE__ */ new Map();
  for (; ; ) {
    const next = await chunks.next();
    if (next.done) break;
    const chunk2 = next.value;
    model = chunk2.model ?? model;
    if (chunk2.usage) usage = chunk2.usage;
    for (const choice of chunk2.choices ?? []) {
      if (typeof choice.delta?.content === "string") content += choice.delta.content;
      for (const call2 of choice.delta?.tool_calls ?? []) {
        const slot = calls.get(call2.index) ?? { type: "function", function: { name: "", arguments: "" } };
        if (call2.id) slot.id = call2.id;
        if (call2.function?.name) slot.function.name += call2.function.name;
        if (call2.function?.arguments) slot.function.arguments += call2.function.arguments;
        calls.set(call2.index, slot);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }
  const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call2]) => call2);
  const message = { role: "assistant", content, ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {} };
  return {
    object: "chat.completion",
    ...model ? { model } : {},
    choices: [{ index: 0, message, finish_reason: finish ?? (toolCalls.length > 0 ? "tool_calls" : "stop") }],
    ...usage ? { usage } : {}
  };
}
async function answer(engine, init) {
  const signal = init.signal ?? void 0;
  if (signal?.aborted) throw abortReason(signal);
  let body;
  try {
    body = JSON.parse(typeof init.body === "string" ? init.body : "");
    if (!body || typeof body !== "object") throw new Error("not an object");
  } catch {
    return refusal(400, "invalid_request");
  }
  let chunks;
  try {
    chunks = (await engine.chatCompletions(body, signal))[Symbol.asyncIterator]();
    if (body.stream !== true) {
      return new Response(JSON.stringify(await foldChunks(chunks)), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    const first = await chunks.next();
    return new Response(sseBody(first, chunks, signal), {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  } catch (e) {
    void chunks?.return?.(void 0);
    if (signal?.aborted) throw e;
    return refusalFor(engine, e);
  }
}
function pageEnginesFetch(engines, base = globalFetch2) {
  const routes = new Map(engines.map((engine) => [localChatCompletionsUrl(engine.baseUrl), engine]));
  return (input, init) => {
    const engine = (init.method ?? "GET").toUpperCase() === "POST" ? routes.get(input) : void 0;
    return engine ? answer(engine, init) : base(input, init);
  };
}
async function probePageEngines(engines, options) {
  const probes = await Promise.all(engines.map((engine) => engine.probe(options)));
  return probes.filter((p) => p !== null);
}

// src/pageEngines/modelStore.ts
function backendFor(row, options) {
  const { hf, webllm: webllm2 } = options;
  if (row.source.kind === "hf-file") {
    return hf ? {
      ready: async (r) => await hf.status(r.ref) === "ready",
      download: (r, onProgress, signal) => hf.download(r.ref, onProgress, signal),
      remove: (r) => hf.remove(r.ref)
    } : void 0;
  }
  const { modelId } = row.source;
  return webllm2 ? {
    ready: () => webllm2.has(modelId),
    download: (_r, onProgress, signal) => webllm2.download(modelId, onProgress, signal),
    remove: () => webllm2.remove(modelId)
  } : void 0;
}
function createLocalModelStore(options) {
  const catalog = options.catalog ?? LOCAL_MODEL_CATALOG;
  const listeners = /* @__PURE__ */ new Set();
  const inFlight = /* @__PURE__ */ new Map();
  const emit2 = () => {
    for (const listener of listeners) listener();
  };
  const changed = () => {
    for (const engine of options.engines ?? []) engine.invalidate();
    emit2();
  };
  const rowOf = (ref) => {
    const row = catalog.find((m) => m.ref === ref);
    if (!row) throw new Error(`unknown_model: ${ref}`);
    return row;
  };
  async function describe(row, supports) {
    const pending = inFlight.get(row.ref);
    if (pending) return { ...row, state: "downloading", progress: pending.progress };
    const backend = backendFor(row, options);
    const support = supports.get(row.runtime);
    if (!backend || !support) return { ...row, state: "unsupported", reason: "engine_unavailable" };
    const fit = localModelFit(row, support);
    if (!fit.fits) return { ...row, state: "unsupported", reason: fit.reason };
    const ready = await backend.ready(row).catch((e) => {
      reportPageEngineFailure(row.runtime, "cache_lookup", e);
      return false;
    });
    return { ...row, state: ready ? "ready" : "absent" };
  }
  return {
    async listLocalModels() {
      const runtimes = [...new Set(catalog.map((m) => m.runtime))];
      const answers = await Promise.all(
        runtimes.map(async (runtime) => {
          const probe = options.support[runtime];
          return [runtime, probe ? await probe() : null];
        })
      );
      const supports = new Map(answers);
      return Promise.all(catalog.map((row) => describe(row, supports)));
    },
    download(ref, onProgress, signal) {
      const existing = inFlight.get(ref);
      if (existing) return existing.done;
      const row = rowOf(ref);
      const backend = backendFor(row, options);
      if (!backend) return Promise.reject(new Error(`engine_unavailable: ${row.runtime}`));
      const entry = { progress: 0, done: Promise.resolve() };
      entry.done = backend.download(
        row,
        (fraction) => {
          entry.progress = fraction;
          onProgress?.(fraction);
          emit2();
        },
        signal
      ).finally(() => {
        inFlight.delete(ref);
        changed();
      });
      inFlight.set(ref, entry);
      emit2();
      return entry.done;
    },
    async remove(ref) {
      const row = rowOf(ref);
      await backendFor(row, options)?.remove(row);
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
function deferredLocalModelStore(store) {
  const resolved = async () => store();
  return {
    listLocalModels: async () => (await resolved()).listLocalModels(),
    download: async (ref, onProgress, signal) => (await resolved()).download(ref, onProgress, signal),
    remove: async (ref) => (await resolved()).remove(ref),
    subscribe(listener) {
      let unsubscribe;
      let gone = false;
      void resolved().then((real) => {
        if (!gone) unsubscribe = real.subscribe(listener);
      });
      return () => {
        gone = true;
        unsubscribe?.();
      };
    }
  };
}

// src/pageEngines/catalogProbe.ts
async function catalogProbe(runtime, baseUrl, support, isReady, contextOf = (row) => row.contextTokens) {
  if (!support.supported) return null;
  const fitting = localCatalogFor(runtime).filter((row) => localModelFit(row, support).fits);
  const ready = await Promise.all(
    fitting.map(
      (row) => isReady(row).catch((e) => {
        reportPageEngineFailure(runtime, "cache_lookup", e);
        return false;
      })
    )
  );
  const rows = fitting.filter((_, i) => ready[i]);
  if (rows.length === 0) return null;
  return {
    provider: runtime,
    endpoint: { baseUrl },
    reachable: true,
    models: rows.map((row) => ({
      ref: formatLocalModelRef(runtime, row.model),
      provider: runtime,
      model: row.model,
      label: row.label,
      tools: row.tools,
      contextTokens: contextOf(row)
    }))
  };
}

// src/pageEngines/residentModel.ts
var settled = () => void 0;
function createResidentModel(create) {
  let engine;
  let resident;
  let tail = Promise.resolve();
  return {
    acquire(id, load) {
      const run = tail.then(async () => {
        engine ??= await create();
        if (resident !== id) {
          const previous = resident;
          resident = void 0;
          await load(engine, previous);
          resident = id;
        }
        return engine;
      });
      tail = run.then(settled, settled);
      return run;
    },
    get engine() {
      return engine;
    },
    get resident() {
      return resident;
    },
    evict(id) {
      if (resident !== id || !engine) return void 0;
      resident = void 0;
      return engine;
    }
  };
}

// src/pageEngines/bfiEngine.ts
var BFI_STATUS = {
  webgpu_unavailable: 503,
  context_exceeded: 413,
  invalid_request: 400
};
function bfiError(e) {
  if (e instanceof PageEngineError) return e;
  const message = errorMessage(e);
  const code = /^([a-z_]+):/.exec(message)?.[1];
  return code && BFI_STATUS[code] ? new PageEngineError(BFI_STATUS[code], code, message) : e;
}
var BFI_CONTEXT_FLOOR = 2048;
function predictedContext(engine, row, support) {
  const planned = row.kv ? engine.contextFor({
    ...row.kv,
    trainedContext: row.contextTokens,
    f16: support.f16,
    maxBufferBytes: support.maxBufferBytes
  }) : 0;
  return planned > 0 ? planned : Math.min(BFI_CONTEXT_FLOOR, row.contextTokens);
}
var UNSUPPORTED = { supported: false, reason: "bfi_unavailable", f16: false, maxBufferBytes: 0 };
function createBfiEngine(options) {
  let module2;
  const bfi = () => module2 ??= options.loadBfi();
  const support = () => bfi().then((m) => m.BfiEngine.support()).catch((e) => {
    reportPageEngineFailure("bfi", "support", e);
    return UNSUPPORTED;
  });
  const resident = createResidentModel(async () => (await bfi()).BfiEngine.create());
  const served = /* @__PURE__ */ new Map();
  const residentEngine = (row) => resident.acquire(row.ref, async (engine, previous) => {
    if (previous) engine.unload();
    const { stream, bytes } = await options.store.open(row.ref);
    const info = await engine.load(stream, bytes);
    if (info.contextTokens > 0 && served.get(row.ref) !== info.contextTokens) {
      served.set(row.ref, info.contextTokens);
      prober.invalidate();
    }
  });
  const prober = memoizedProbe("bfi", async () => {
    const rows = localCatalogFor("bfi");
    const states = await Promise.all(rows.map((row) => options.store.status(row.ref)));
    const ready = new Set(rows.filter((_, i) => states[i] === "ready").map((row) => row.ref));
    if (ready.size === 0) return null;
    const device = await support();
    const { BfiEngine } = await bfi();
    return catalogProbe(
      "bfi",
      BFI_ENGINE_BASE_URL,
      device,
      async (row) => ready.has(row.ref),
      (row) => served.get(row.ref) ?? predictedContext(BfiEngine, row, device)
    );
  }, options);
  async function chatCompletions(body, signal) {
    const row = localCatalogModel(formatLocalModelRef("bfi", typeof body.model === "string" ? body.model : ""));
    if (!row) throw new PageEngineError(404, "model_not_found");
    if (await options.store.status(row.ref) !== "ready") throw new PageEngineError(503, "model_not_downloaded");
    if (signal?.aborted) throw abortReason(signal);
    let live2;
    try {
      live2 = await residentEngine(row);
    } catch (e) {
      const mapped = bfiError(e);
      throw mapped instanceof PageEngineError ? mapped : new PageEngineError(503, "bfi_engine_unavailable", errorMessage(e));
    }
    return bfiChunks(live2, JSON.stringify({ ...body, stream: true }), signal);
  }
  return { runtime: "bfi", baseUrl: BFI_ENGINE_BASE_URL, ...prober, support, chatCompletions };
}
function closingChunk(finalJson) {
  try {
    const final = JSON.parse(finalJson);
    const finish = final.choices?.[0]?.finish_reason ?? null;
    if (!finish && !final.usage) return null;
    return {
      ...final.model ? { model: final.model } : {},
      choices: [{ index: 0, delta: {}, finish_reason: finish }],
      ...final.usage ? { usage: final.usage } : {}
    };
  } catch {
    return null;
  }
}
async function* bfiChunks(engine, requestJson, signal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const queue = [];
  let wake;
  const state = {};
  const notify = () => {
    wake?.();
    wake = void 0;
  };
  engine.chat(
    requestJson,
    (json) => {
      try {
        queue.push(JSON.parse(json));
        notify();
      } catch (e) {
        reportPageEngineFailure("bfi", "chunk", e);
      }
    },
    controller.signal
  ).then(
    (final) => {
      state.outcome = { ok: true, final };
      notify();
    },
    (error) => {
      state.outcome = { ok: false, error };
      notify();
    }
  );
  try {
    for (; ; ) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (state.outcome) break;
      await new Promise((resolve) => wake = resolve);
    }
    const settled2 = state.outcome;
    if (!settled2.ok) throw signal?.aborted ? abortReason(signal) : bfiError(settled2.error);
    const closing = closingChunk(settled2.final);
    if (closing) yield closing;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!state.outcome) controller.abort();
  }
}

// src/pageEngines/hfModelStore.ts
var LOCAL_MODEL_CACHE = "builderforce-local-models";
function hfResolveUrl(repo, file) {
  return `https://huggingface.co/${repo}/resolve/main/${file}`;
}
var BYTES_HEADER = "x-builderforce-model-bytes";
function hfRow(ref) {
  const row = localCatalogModel(ref);
  if (!row || row.source.kind !== "hf-file") throw new Error(`unknown_model: ${ref}`);
  return row;
}
var urlOf = (ref) => {
  const { source } = hfRow(ref);
  return hfResolveUrl(source.repo, source.file);
};
function createHfModelStore(options = {}) {
  const storage = () => {
    const caches = options.caches ?? globalThis.caches;
    if (!caches) throw new Error("cache_storage_unavailable");
    return caches;
  };
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const entry = async (ref) => {
    const caches = storage();
    if (!await caches.has(LOCAL_MODEL_CACHE)) return void 0;
    return (await caches.open(LOCAL_MODEL_CACHE)).match(urlOf(ref));
  };
  return {
    async status(ref) {
      try {
        return await entry(ref) ? "ready" : "absent";
      } catch (e) {
        reportPageEngineFailure("bfi", "cache_lookup", e);
        return "absent";
      }
    },
    async download(ref, onProgress, signal) {
      const row = hfRow(ref);
      const url = urlOf(ref);
      await globalThis.navigator?.storage?.persist?.().catch((e) => reportPageEngineFailure("bfi", "persist", e));
      const res = await fetchImpl(url, { credentials: "omit", ...signal ? { signal } : {} });
      if (!res.ok || !res.body) throw new Error(`download_failed: HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || row.bytes;
      let loaded = 0;
      const counted = res.body.pipeThrough(
        new TransformStream({
          transform(chunk2, controller) {
            loaded += chunk2.byteLength;
            onProgress?.(Math.min(1, loaded / total));
            controller.enqueue(chunk2);
          }
        })
      );
      const cache2 = await storage().open(LOCAL_MODEL_CACHE);
      await cache2.put(
        url,
        new Response(counted, {
          headers: { "content-type": "application/octet-stream", [BYTES_HEADER]: String(total) }
        })
      );
      if (loaded !== total) {
        await cache2.delete(url);
        throw new Error(`download_incomplete: ${loaded} of ${total} bytes`);
      }
    },
    async remove(ref) {
      const caches = storage();
      if (!await caches.has(LOCAL_MODEL_CACHE)) return;
      await (await caches.open(LOCAL_MODEL_CACHE)).delete(urlOf(ref));
    },
    async open(ref) {
      const res = await entry(ref);
      if (!res?.body) throw new Error(`model_not_downloaded: ${ref}`);
      const bytes = Number(res.headers.get(BYTES_HEADER)) || hfRow(ref).bytes;
      return { stream: res.body, bytes };
    }
  };
}

// src/pageEngines/webgpu.ts
var UNSUPPORTED2 = (reason) => ({ supported: false, reason, f16: false, maxBufferBytes: 0 });
var pageGpu = () => globalThis.navigator?.gpu;
function hasWebGPU() {
  return pageGpu() != null;
}
async function webGpuSupport(gpu = pageGpu()) {
  if (!gpu) return UNSUPPORTED2("webgpu_missing");
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return UNSUPPORTED2("no_adapter");
    return {
      supported: true,
      f16: adapter.features.has("shader-f16"),
      maxBufferBytes: adapter.limits.maxStorageBufferBindingSize ?? 0
    };
  } catch (e) {
    return UNSUPPORTED2(e instanceof Error ? e.message : String(e));
  }
}

// src/pageEngines/webllmEngine.ts
var WEBLLM_MODEL_CACHE = "webllm/model";
var FORWARDED_FIELDS = [
  "tools",
  "tool_choice",
  "temperature",
  "top_p",
  "max_tokens",
  "stop",
  "seed",
  "frequency_penalty",
  "presence_penalty",
  "response_format"
];
var defaultLoader = () => import("@mlc-ai/web-llm");
function toWebLlmMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) throw new PageEngineError(400, "no_messages");
  const system = [];
  const rest = [];
  for (const raw of messages) {
    const message = raw ?? {};
    const text = messageText(message.content);
    if (text === null) throw new PageEngineError(400, "non_text_content_unsupported");
    if (message.role === "system") system.push(text);
    else rest.push({ ...message, content: text });
  }
  const joined = system.filter((s) => s.trim().length > 0).join("\n\n");
  return [...joined ? [{ role: "system", content: joined }] : [], ...rest];
}
function createWebLlmEngine(options = {}) {
  const load = options.loadWebLlm ?? defaultLoader;
  const support = options.support ?? (() => webGpuSupport());
  let module2;
  const webllm2 = () => module2 ??= load();
  const resident = createResidentModel(async () => {
    const lib = await webllm2();
    return options.workerUrl ? new lib.WebWorkerMLCEngine(new Worker(options.workerUrl, { type: "module" })) : new lib.MLCEngine();
  });
  const residentEngine = (modelId, onProgress) => resident.acquire(modelId, async (engine) => {
    engine.setInitProgressCallback((r) => onProgress?.(r.progress));
    await engine.reload(modelId);
  });
  const cached2 = async (modelId) => {
    const storage = options.caches ?? globalThis.caches;
    if (storage && !await storage.has(WEBLLM_MODEL_CACHE)) return false;
    return (await webllm2()).hasModelInCache(modelId);
  };
  const prober = memoizedProbe(
    "webllm",
    async () => catalogProbe("webllm", WEBLLM_ENGINE_BASE_URL, await support(), (row) => cached2(row.model)),
    options
  );
  async function chatCompletions(body, signal) {
    const modelId = typeof body.model === "string" ? body.model : "";
    const row = localCatalogModel(formatLocalModelRef("webllm", modelId));
    if (!row) throw new PageEngineError(404, "model_not_found");
    if (hasTools(body) && !row.tools) throw new PageEngineError(400, "tools_unsupported");
    const messages = toWebLlmMessages(body.messages);
    const ready = await cached2(modelId).catch((e) => {
      throw new PageEngineError(503, "webllm_cache_unreadable", errorMessage(e));
    });
    if (!ready) throw new PageEngineError(503, "model_not_downloaded");
    if (signal?.aborted) throw abortReason(signal);
    let live2;
    try {
      live2 = await residentEngine(modelId);
    } catch (e) {
      throw new PageEngineError(503, "webllm_engine_unavailable", errorMessage(e));
    }
    const request = { messages, stream: true, stream_options: { include_usage: true } };
    for (const field of FORWARDED_FIELDS) if (body[field] !== void 0) request[field] = body[field];
    if (!hasTools(body)) {
      delete request.tools;
      delete request.tool_choice;
    }
    return interruptible(await live2.chat.completions.create(request), live2, signal);
  }
  const models = {
    // A failed lookup rejects: the model store reads it (and reports why) per row.
    has: (modelId) => cached2(modelId),
    async download(modelId, onProgress, signal) {
      if (signal?.aborted) throw abortReason(signal);
      const onAbort = () => void resident.engine?.unload().catch((e) => reportPageEngineFailure("webllm", "unload", e));
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        await residentEngine(modelId, onProgress);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
      if (signal?.aborted) throw abortReason(signal);
      onProgress?.(1);
      prober.invalidate();
    },
    async remove(modelId) {
      await resident.evict(modelId)?.unload();
      await (await webllm2()).deleteModelAllInfoInCache(modelId);
      prober.invalidate();
    }
  };
  return { runtime: "webllm", baseUrl: WEBLLM_ENGINE_BASE_URL, ...prober, chatCompletions, models };
}
async function* interruptible(stream, engine, signal) {
  const onAbort = () => void engine.interruptGenerate();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const chunk2 of stream) {
      if (signal?.aborted) throw abortReason(signal);
      yield chunk2;
    }
    if (signal?.aborted) throw abortReason(signal);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

// src/pageEngines/pageEngineSet.ts
function createPageEngineSet(options = {}) {
  const hf = createHfModelStore();
  const bfi = options.loadBfi ? createBfiEngine({ loadBfi: options.loadBfi, store: hf }) : void 0;
  const webllm2 = createWebLlmEngine(options.webllmWorkerUrl ? { workerUrl: options.webllmWorkerUrl } : {});
  const engines = [...bfi ? [bfi] : [], webllm2, promptApiEngine];
  const store = createLocalModelStore({
    ...bfi ? { hf } : {},
    webllm: webllm2.models,
    support: { webllm: () => webGpuSupport(), ...bfi ? { bfi: bfi.support } : {} },
    engines
  });
  return {
    engines,
    store,
    probe: (probeOptions) => probePageEngines(engines, probeOptions),
    fetch: (base) => pageEnginesFetch(engines, base)
  };
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
function isReadOnlyShellCall(tool, args) {
  if (tool !== "run_command" || !args || typeof args !== "object") return false;
  const record = args;
  const command = typeof record.command === "string" ? record.command : typeof record.cmd === "string" ? record.cmd : "";
  return isReadOnlyShellCommand(command);
}

// src/finishReason.ts
var TRUNCATED_REASONS = /* @__PURE__ */ new Set(["length", "max_tokens", "maxtokens", "model_length", "output_limit"]);
var MALFORMED_TOOL_CALL_REASONS = /* @__PURE__ */ new Set(["malformed_function_call", "malformed_tool_call", "invalid_tool_call"]);
var normalise2 = (finishReason) => (finishReason ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
function turnInterruption(finishReason) {
  const reason = normalise2(finishReason);
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
var TOOL_TURN_MIN_MAX_TOKENS = EFFORT_PROFILES.thorough.maxTokens;
function turnMaxTokens(effortMaxTokens, canCallTools) {
  if (!canCallTools) return effortMaxTokens;
  return Math.max(effortMaxTokens ?? 0, TOOL_TURN_MIN_MAX_TOKENS);
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
function projectMemoryHooks(projectId, request, chatId, surface = "web") {
  const json = { "Content-Type": "application/json" };
  const chatParam = chatId != null && chatId > 0 ? `&chatId=${chatId}` : "";
  return {
    recall: (query) => request(`/api/projects/${projectId}/evermind/recall`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ query, ...chatId != null ? { chatId } : {} })
    }).catch(() => null),
    answer: (query, opts) => request(
      `/api/projects/${projectId}/answer?query=${encodeURIComponent(query)}&tools=${opts.toolsAvailable ? "1" : "0"}${chatParam}&surface=${surface}${opts.model ? `&model=${encodeURIComponent(opts.model)}` : ""}`
    ).then((r) => r?.answer ?? null).catch(() => null),
    cacheAnswer: (query, answer2, origin) => {
      void request(`/api/projects/${projectId}/answer`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ question: query, answer: answer2, ...origin ? { origin } : {} })
      }).catch(() => {
      });
    }
  };
}

// src/index.ts
var import_evermind3 = require("@seanhogg/builderforce-memory/evermind");

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
      const cache2 = await store();
      if (!cache2) return null;
      try {
        const hit = await cache2.lookup(query);
        if (!hit || hit.score < ON_DEVICE_ANSWER_THRESHOLD || !hit.response.trim()) return null;
        return { text: hit.response, source: "qa-cache" };
      } catch {
        return null;
      }
    },
    cacheAnswer: async (query, answer2) => {
      const cache2 = await store();
      if (!cache2) return;
      try {
        await cache2.store(query, answer2);
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
      cacheAnswer: (query, answer2, origin) => {
        for (const layer of caching) {
          try {
            void Promise.resolve(origin ? layer.cacheAnswer?.(query, answer2, origin) : layer.cacheAnswer?.(query, answer2)).catch(() => {
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
  "_get_error_group",
  // The BOARD-SURVEY reads. All three are `mutates: false` and all three are expensive —
  // `tickets.pending_changes` compares every ticket branch against its base, and the
  // stall census walks every non-terminal ticket. Their absence here is what let VS Code
  // chat #115 (2026-09-20) call `builtin_tickets_pending_changes` twice with BYTE-
  // IDENTICAL arguments, six seconds and 19 KB apiece, for an answer already in its
  // context. Safe to dedupe only because a `git_push` / `open_pull_request` now forgets
  // platform reads (see `REPO_PUBLISH_TOOLS`) — these read branch state, so a run that
  // pushes between two surveys must see the second one for real.
  "_pending_changes",
  "_stalled_tickets",
  "_census"
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
var REVIEWED_TASK_STATUSES = /* @__PURE__ */ new Set(["in_progress", "in_review"]);
function linkedTicketsReviewedComplete(listResult, reviewedTaskIds) {
  const reviewed = new Set(reviewedTaskIds.map(String));
  return selectLinkedTasks(listResult, REVIEWED_TASK_STATUSES).filter((ticket) => reviewed.has(ticket.ref));
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
function chatRosterFromParticipants(participants) {
  return (participants ?? []).filter((p) => p.kind === "agent" && p.ref).map((p) => ({ ref: p.ref, name: p.name || p.ref }));
}
function describeRoster(roster) {
  return roster.map((a) => `${a.name} (agentRef ${a.ref}${a.role ? `, ${a.role}` : ""})`).join("; ");
}
function chatWorkDirective(chatId, opts) {
  const throughThem = opts?.canDelegate ? " When you do a slice of the work here instead of dispatching it, do it THROUGH one of them: spawn_agent with as_agent=<that agent's name> so the slice is done in that agent's persona, and say which agent did what. Work that names no agent is work nobody owns." : "";
  const roster = opts?.roster ?? [];
  const staffed = roster.length > 0;
  const delegatesLocally = !!(opts?.canFanOut || opts?.canDelegate);
  const localSpawn = opts?.canFanOut ? "spawn_agents (several tickets whose files do not overlap, side by side \u2014 one workstream per ticket, with ticket=<id>, paths and as_agent) or spawn_agent (one slice)" : "spawn_agent (one slice at a time)";
  const pickByRole = "as_agent = the agent whose role fits the slice: a Developer for a code slice, a QA agent for a test or verify slice (builtin_cloud_agents_persona_brief with role=developer or role=qa-tester says who holds it). When nobody fitting is named \u2014 as_agent omitted, or a teammate without the role \u2014 the spawn tools STAFF the role on this project themselves: a capable teammate, or a Developer/QA HIRED into the workspace and project, with the ticket of the slice assigned to them, and the child runs AS that agent. So a missing Developer is never a reason not to delegate: omit as_agent and spawn";
  const whoIsHere = staffed ? `\u2022 THE AGENTS IN THIS CHAT are ${describeRoster(roster)}. A human put them here: that is this platform's way of saying these are the people this work belongs to.
` : "";
  const ordering = staffed ? delegatesLocally ? `\u2022 DELEGATE TO THEM, HERE. That is the DEFAULT in this chat, not a fallback. Work that falls inside one of their roles is THEIR work, and this session runs it on this machine: hand it to a local sub-agent with ${localSpawn}, ${pickByRole}. Then say which agent did what. A local sub-agent is NOT a cloud run \u2014 it needs no ticket assignment and no builtin_chats_dispatch_agent, and the workspace's execution kill-switch does not stop it. Do NOT make the change yourself merely because you could do it faster \u2014 the human staffed this conversation.
` : `\u2022 DISPATCH TO THEM. That is the DEFAULT in this chat, not a fallback. Work that falls inside one of their roles is THEIR work: assign the ticket and start the run with builtin_chats_dispatch_agent (chatId=${chatId}, agentRef=<the ref above>, taskId=<the ticket>), then say who picked it up. Do NOT make the change yourself merely because you could do it faster \u2014 the human staffed this conversation, and a session that quietly does its agents' work leaves them idle and leaves the user unable to see who did what.${opts?.canEditHere ? " You DO hold the workspace file tools; keep them for what dispatch cannot cover \u2014 reading and locating the code so the directive you hand an agent is specific, checking what a run came back with, and an edit the user asks YOU for in this message." : ""}
` : opts?.canEditHere ? `\u2022 DO IT HERE WHEN YOU CAN. No agent has been invited into this chat, so there is nobody to hand it to. This session has the workspace file tools, so anything you could change yourself in a handful of tool calls \u2014 a bug fix, a small refactor, a CSS or copy change, anything you have already located in the code \u2014 you MAKE, now. Dispatching a cloud agent for work you are already holding costs a whole run to do less than you can, and leaves the user waiting for it. Then record the change against this chat.${delegatesLocally ? ` Several independent slices go to local sub-agents with ${localSpawn}, ${pickByRole} \u2014 not to cloud agents.` : ""} Dispatch is for work this session genuinely cannot do: a long-horizon or repetitive batch, or work that must run somewhere you are not.
` : "";
  const finish = delegatesLocally ? `\u2022 FINISH WHAT YOU FILED. A ticket nobody is working has not started: every ticket you filed is either done in this session or handed to a local sub-agent (${pickByRole}). builtin_chats_dispatch_agent starts a CLOUD run \u2014 use it only when the user asks for the work to run in the cloud, or it must run where this session is not. A dispatched agent joins this chat and can be steered mid-run with builtin_executions_post_message.
` : `\u2022 FINISH BY DISPATCHING what you did not do yourself. A ticket that no agent is running has not started. Every create/update tool returns an \`autoRun\` verdict \u2014 read it. When \`autoRun.dispatched\` is true, say which agent picked the work up. When it is false, do not stop there: pick a capable agent (${staffed ? "one of the agents above, or " : ""}builtin_cloud_agents_list_mine, or builtin_tasks_assignees for the accountable roster) \u2014 a Developer for code work, a QA agent for test work \u2014 and start the run yourself with builtin_chats_dispatch_agent (chatId=${chatId}, agentRef=<the agent>, taskId=<the ticket>). A dispatched agent joins this chat and can be steered mid-run with builtin_executions_post_message.
`;
  const refused = delegatesLocally ? " An execution kill-switch or run cap stops CLOUD runs only \u2014 an `autoRun: execution_disabled` verdict on a ticket is about the cloud \u2014 so hand the slice to a local sub-agent instead. When the user asks for sub-agents, start them; do not ask how to proceed." : " If the work is something you could do here, do it instead.";
  return `MODE: WORK. This conversation exists to get something DONE, not to describe it. Take the work all the way to a finished change or a running agent.
${chatWorkLinkingDirective(chatId)}
` + whoIsHere + ordering + finish + `\u2022 STAFF WITH THE TEAM. The workspace's agents (builtin_chats_list_agents for those already in this chat, builtin_cloud_agents_list_mine for all of them) are the people this work belongs to. Match each ticket to the agent whose role fits it \u2014 Developer work to a developer, QA work to a QA agent \u2014 and never leave a ticket with no agent on it.${throughThem}
\u2022 builtin_chats_runs (chatId=${chatId}) says what has ALREADY run on this chat's tickets and who started each run. Read it before claiming work is under way, and before starting a duplicate: an empty result means nothing was ever dispatched, whatever the transcript says about it.
\u2022 If dispatch is genuinely refused \u2014 no capable agent, an execution kill-switch, an exhausted run cap, a human gate on the lane, a lifecycle-managed stage with no bound role \u2014 the refusal names the reason and what would clear it. Report THAT reason and do not retry the same dispatch hoping for a different answer.${refused} Never imply work has begun when nothing was dispatched, and never describe a dispatch you did not make.`;
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
  const { filterProjectId, pinnedProjectId, activeChatId: controlledActiveId, onActiveChatChange, placeholderTitles } = options;
  const placeholdersRef = (0, import_react6.useRef)(placeholderTitles);
  placeholdersRef.current = placeholderTitles;
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
  const setMemoryEnabled = (0, import_react6.useCallback)(async (id, on) => {
    const prevValue = chatsRef.current.find((c) => c.id === id)?.memoryEnabled ?? true;
    setChats((prev) => prev.map((c) => c.id === id ? { ...c, memoryEnabled: on } : c));
    try {
      const updated = await persistence.updateChat(id, { memoryEnabled: on });
      setChats((prev) => prev.map((c) => c.id === id ? { ...c, memoryEnabled: updated.memoryEnabled ?? on } : c));
    } catch (e) {
      setChats((prev) => prev.map((c) => c.id === id ? { ...c, memoryEnabled: prevValue } : c));
      setError(e instanceof Error ? e.message : "Failed to switch memory");
      throw e;
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
    if (chat && chat.title && chat.title !== DEFAULT_CHAT_TITLE && !placeholdersRef.current?.includes(chat.title)) return;
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
    setMemoryEnabled,
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

// src/transcriptSeed.ts
function transcriptSeedFrom(history) {
  return scopeToConsolidation(history).filter((m) => !isStepMessage(m) && !isStoppedTurn(m)).flatMap((m) => {
    if (m.role !== "assistant") return [{ role: m.role, content: m.content }];
    const content = replayTextOf(m.content);
    return content ? [{ role: "assistant", content }] : [];
  });
}

// src/mergeTranscript.ts
function mergeTranscript(base, extra) {
  if (extra.length === 0) return base;
  const have = new Set(base.map((m) => m.id));
  const fresh = extra.filter((m) => !have.has(m.id));
  if (fresh.length === 0) return base;
  return [...base, ...fresh].sort((a, b) => a.seq - b.seq);
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
    const sig2 = stepSig(parsed.step.category, parsed.step.label, parsed.tsIso);
    if (seen.has(sig2)) continue;
    seen.add(sig2);
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
  // The semantic index (Builderforce Desktop). Pinned for the same reason and more so:
  // its whole purpose is the question phrased in words — "how do refunds reach the
  // ledger?" — which is exactly the turn whose text shares no stem with the tool name.
  // Inert where the host does not advertise them (desktop app not running, web Brain).
  "semantic_search",
  "repo_map",
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
  "spawn_agent",
  // Its side-by-side twin — what a planner's `hand_off` fans out to; editor-only.
  "spawn_agents",
  // The owner's verbs for children running in the background (editor-only): a turn about
  // "check on Ada" or "tell a2 to stop" shares no stem with the tool names either.
  "wait_agents",
  "message_agent",
  "stop_agent"
]);
var CODE_CHANGE_TOOLS = /* @__PURE__ */ new Set([
  "write_file",
  "edit_file",
  "delete_file",
  "canvas_write_build_file",
  "canvas_edit_build_file",
  "canvas_restore_build_file"
]);
var PREVIEW_REVIEW_TOOL = "canvas_inspect_preview";
var STUDIO_WORKSPACE_TOOLS = /* @__PURE__ */ new Set([
  "canvas_list_build_files",
  "canvas_read_build_file",
  "canvas_search_build_files",
  "canvas_write_build_file",
  "canvas_edit_build_file",
  "canvas_read_build_diagnostics",
  "canvas_read_preview_console",
  "canvas_list_build_file_history",
  "canvas_restore_build_file",
  // Install / build / type-check / test in the browser runtime: "does it build?" shares
  // no stem with the tool's name, the same miss that dropped `run_command` on the IDE.
  "canvas_run_build_command",
  PREVIEW_REVIEW_TOOL
]);
var UNSCOPED_MUTATION_TOOLS = /* @__PURE__ */ new Set([
  "run_command",
  // The Studio's twin: the same shell, run in the browser runtime, whose changed files
  // are saved back to the workspace — so a cached `canvas_read_build_file` is as stale
  // after it as a `read_file` is after `run_command`.
  "canvas_run_build_command",
  "git_sync_latest",
  "git_undo",
  "git_redo",
  // Cleanup checks out the base branch and fast-forwards it, so every file in the
  // checkout can differ from what a read before it returned — the same reason the
  // three above are here.
  "git_cleanup_merged"
]);
var PROJECT_MEMORY_TOOLS = /* @__PURE__ */ new Set(["recall_facts", "remember_fact"]);
var REPO_PUBLISH_TOOLS = /* @__PURE__ */ new Set([
  "git_commit",
  "git_push",
  "open_pull_request",
  // Cleanup deletes the merged branch locally and on origin, so the branch inventory a
  // platform read returns is different after it. It is ALSO an unscoped mutation (it
  // checks out and fast-forwards the base), and that set already clears everything —
  // listing it here states the second reason rather than relying on the first.
  "git_cleanup_merged"
]);
function isRepoPublishTool(name) {
  return REPO_PUBLISH_TOOLS.has(name);
}
var REPO_STATE_READ_TOOLS = /* @__PURE__ */ new Set(["review_ticket_branches"]);
function isRepoStateReadTool(name) {
  return REPO_STATE_READ_TOOLS.has(name);
}
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
function canReviewInPreview(toolNames) {
  return toolNames.includes(PREVIEW_REVIEW_TOOL);
}
function studioToolsIn(toolNames) {
  return canReviewInPreview(toolNames) ? toolNames.filter((name) => STUDIO_WORKSPACE_TOOLS.has(name)) : [];
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
var QUESTION_KEYS = ["query", "q", "search", "pattern", "glob", "key"];
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
    const sig2 = callSignature(ev);
    if (seenCalls.has(sig2)) duplicateCalls += 1;
    else seenCalls.add(sig2);
    const failed = Boolean(ev.isError) || isFailedToolResult(ev.result);
    if (current && current.sig === sig2) {
      current.streak.count += 1;
      if (failed) current.streak.failed += 1;
      if (current.streak.count === 2) streaks += 1;
      if (!longestStreak || current.streak.count > longestStreak.count) longestStreak = current.streak;
    } else {
      current = { sig: sig2, streak: { label: ev.label, count: 1, failed: failed ? 1 : 0 } };
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
var TREE_WIDE_READ_TOOLS = /* @__PURE__ */ new Set(["search_code", "find_symbol", "list_files", "semantic_search", "repo_map"]);
function visitedScopeIs(visited, target) {
  return visited === target || (visited?.startsWith(`${target}${VISIT_QUESTION_SEPARATOR}`) ?? false);
}
function isUnscopedMutation(tool, args) {
  return isUnscopedMutationTool(tool) && !isReadOnlyShellCall(tool, args);
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
function asPositiveInt(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
function requestedReadWindow(args) {
  const start = asPositiveInt(args.offset, 1);
  const limit = asPositiveInt(args.limit, READ_DEFAULT_LINE_LIMIT);
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
   * - A local tool that PUBLISHES work (`git_commit`, `git_push`, `open_pull_request`)
   *   changes no byte a FILE read would see — but it does change what a PLATFORM read of
   *   branch / pull-request state returns, so it forgets the platform reads and keeps the
   *   file reads. See {@link isRepoPublishTool}: without this, a run that surveys the
   *   board, pushes the branches and surveys again is served its own pre-push answer.
   *   The same sweep forgets host reads of REPOSITORY STATE (`review_ticket_branches`,
   *   see {@link isRepoStateReadTool}) — a cached branch review must not outlive a push.
   * - The remaining local tools (`git_status`, `git_diff`, …) change nothing a read
   *   observes, so they forget nothing.
   * - Anything else is a platform or MCP call. It may have changed what a PLATFORM read
   *   returns (a ticket update changes the ticket list), so target-less platform reads
   *   are forgotten; file reads are not, because a ticket write does not edit source.
   */
  invalidate(tool, args) {
    if (isUnscopedMutation(tool, args)) {
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
    if (isLocalWorkspaceTool(tool) && !isRepoPublishTool(tool)) return;
    for (const [key, read] of [...this.exact.entries()]) {
      if (!isLocalWorkspaceTool(read.tool) || isRepoStateReadTool(read.tool)) this.exact.delete(key);
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
    if (typeof wanted.key === "string") return null;
    const want = requestedReadWindow(wanted);
    for (const read of this.exact.values()) {
      if (read.tool !== "read_file" || !read.cached) continue;
      if (typeof read.args.key === "string") continue;
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
  const str4 = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return str4.length > n ? str4.slice(0, n) + `\u2026 (+${str4.length - n} chars)` : str4;
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
function unresolvedAppFailuresInTrace(events) {
  let last = 0;
  for (const ev of events) {
    if (ev.category !== "tool" || ev.isError) continue;
    const r = ev.result;
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const o = r;
    if (typeof o.failures !== "number") continue;
    if (o.failures > 0 && typeof o.report !== "string") continue;
    last = o.failures;
  }
  return last;
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
  const toolEvents2 = events.filter((e) => e.category === "tool");
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
  for (const ev of toolEvents2) {
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
  const recoveredToolEvents = toolEvents2.filter((e) => e.recovered).length;
  const recoveredTurns = llm.filter((e) => e.recovered).length;
  const turnCoveragePartial = recoveredToolEvents > 0 && recoveredTurns === 0;
  const contextPressure = promptTokenPeak >= CONTEXT_PROMPT_PEAK || truncatedToolResults > 0 || downgradeEvents > 0 || largestLossyResultBytes >= LARGE_LOSSY_RESULT_BYTES;
  const contextConsequence = emptyOrLengthFinishes > 0 || downgradeEvents > 0 || loopExhausted || errors.some((e) => e.label === "llm.complete");
  const contextSignal = contextPressure && contextConsequence;
  const contextPressureOnly = contextPressure && !contextConsequence;
  const degradationSignal = evermindUsed.length > 0 && emptyOrLengthFinishes > 0 && (!tokensMeasured || promptTokenPeak < CONTEXT_PROMPT_PEAK) && truncatedToolResults === 0;
  const didWork = toolEvents2.length > 0 || completionTokenTotal > 0 || llm.length > 0;
  const announcedUnmadeToolCall = detectAnnouncedButUnmadeToolCall(events, messages);
  const stallRecoveries = stallRecoveriesInTrace(events);
  const modelFailovers = modelFailoversInTrace(events);
  const stallUnrecovered = stallUnrecoveredInTrace(events);
  const stallRecovered = stallRecoveredInTrace(events);
  const streamRetries = streamRetriesInTrace(events);
  const exposure = toolExposureInTrace(events);
  const narratedUnadvertisedTools = narratedUnadvertisedInTrace(events);
  const noToolsAdvertised = exposure.min === 0 && toolEvents2.length === 0;
  const memoryOnlyRun = memoryAnswers.length > 0 && llm.length === 0;
  const progress = computeRunProgress(events, messages);
  const noProgress = progress.spinning || progress.noEffect && !ctx.running;
  const staffing = staffingSummaryInTrace(events);
  const workFiledNotStaffed = staffing.verdict === "filed-not-staffed" || staffing.verdict === "staffing-refused";
  const unresolvedAppFailures = unresolvedAppFailuresInTrace(events);
  const healthy = errors.length === 0 && !loopExhausted && emptyOrLengthFinishes === 0 && !contextSignal && !announcedUnmadeToolCall && !noProgress && unresolvedAppFailures === 0 && didWork;
  const likelyCause = memoryOnlyRun ? "memory-answered" : noToolsAdvertised ? "no-tools-advertised" : narratedUnadvertisedTools.length > 0 ? "tool-not-advertised" : announcedUnmadeToolCall ? "tool-calls-not-emitted" : noProgress ? "no-progress" : contextSignal && !degradationSignal ? "context-exhaustion" : degradationSignal && !contextSignal ? "model-degradation" : unresolvedAppFailures > 0 ? "app-errors-unresolved" : workFiledNotStaffed ? "work-filed-not-staffed" : healthy ? "healthy" : "inconclusive";
  return {
    turns: llm.length,
    toolCalls: toolEvents2.length,
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
    unresolvedAppFailures,
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
  const verdict = d.likelyCause === "memory-answered" ? `ANSWERED FROM MEMORY \u2014 no model ran this turn. The reply was served by the memory-first short-circuit (${(d.memoryAnswers ?? []).map((m) => m.source === "evermind" ? `the project Evermind SSM${m.projectId != null ? ` of project #${m.projectId}` : ""}${m.version != null ? ` v${m.version}` : ""}` : "the Q&A cache").join(", ")}), so zero turns, zero tokens and zero tool calls is EXPECTED, not a fault. ${evermindAnswers.length ? "The Evermind SSM cannot call tools and answers only from what it has learned, so it can neither fetch live data nor do work \u2014 if the reply was wrong, garbled or stale, that is the cause. Turn Memory off for this chat, or disable inference on that head." : "The reply is a replay of an earlier answer to the same question; ask a differently-worded question to reach the model."} Switching models changes nothing here.` : d.likelyCause === "no-tools-advertised" ? 'NO TOOLS ADVERTISED \u2014 at least one turn was handed ZERO tool definitions, so it could not have emitted a call whatever it wanted to do. This is a catalog/config failure on our side, not a model fault: the gateway MCP catalog (`/llm/v1/mcp/tools`) failed to load, or no actions were registered for this surface. See the "Tools available to the model" line in the Chat diagnostics block for the fetch error. Switching models will not help.' : d.likelyCause === "tool-not-advertised" ? `TOOL NOT ADVERTISED \u2014 a turn wrote out ${d.narratedUnadvertisedTools.map((n) => `\`${n}\``).join(", ")} as prose while that tool was NOT among the ones it was offered that turn. No model can emit a call for a function it was never given, so this is OUR per-turn tool selection dropping a tool the prompt asked for \u2014 not a model that "won't call tools". Fix the selection (pin the tool, or name it in the system prompt so it is force-included) rather than switching models.` : d.likelyCause === "tool-calls-not-emitted" ? 'TOOL CALLS NOT EMITTED \u2014 a turn NARRATED a tool call in prose ("I\'ll call the tool\u2026", a bare `builtin_\u2026` name) but the run recorded ZERO tool steps, so nothing executed and the answer never got its data. The tools WERE advertised and the agent loop only runs structured `tool_calls`, so this is a model/provider fault: the model is describing calls instead of emitting them. Try a different model.' : d.likelyCause === "no-progress" ? (d.progress && runProgressVerdict(d.progress)) ?? "NO PROGRESS \u2014 the run repeated work without advancing." : d.likelyCause === "context-exhaustion" ? `Likely CONTEXT EXHAUSTION (case A) \u2014 ${contextEvidence(d)}.` : d.likelyCause === "model-degradation" ? "Likely MODEL DEGRADATION (case B) \u2014 an Evermind/SSM turn returned empty while tokens stayed low." : d.likelyCause === "app-errors-unresolved" ? `APP STILL BROKEN \u2014 every tool call succeeded, but the run's last diagnostics read still reported ${d.unresolvedAppFailures} build/runtime failure(s) in the app it was working on. The tools are fine; the app is not. Read that diagnostics result in the trace below for the error \u2014 if it points into a package CDN or the preview runtime rather than the project's own files, the fault is the platform's, and rewriting project files will not fix it.` : d.likelyCause === "work-filed-not-staffed" ? workFiledNotStaffedVerdict(d.staffing) : d.likelyCause === "healthy" ? "No failure signal \u2014 no errors, no truncated or empty turns, and no context pressure. Nothing here needs triaging." : "Inconclusive \u2014 not enough signal to separate context exhaustion from model degradation.";
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

// src/memorySavings.ts
function callMemoryEffect(trimmedTokens, recallTokens) {
  const t = Math.max(0, Math.round(trimmedTokens));
  const r = Math.max(0, Math.round(recallTokens));
  return t > 0 || r > 0 ? { trimmedTokens: t, recallTokens: r } : void 0;
}
function emptyRunUsage() {
  return { promptTokens: 0, completionTokens: 0, model: null };
}

// src/runStore/runCell.ts
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
    codePhaseReached: false,
    runId: "",
    ticketRecorded: false,
    touchedFiles: [],
    deltaTicketId: null,
    deltaRecordedFiles: [],
    runTraceFrom: 0,
    persistStep: null,
    compactMemo: null,
    runUsage: emptyRunUsage(),
    lastServedModel: null,
    liveTurn: null,
    stoppedTurn: null,
    snapshot: EMPTY_SNAPSHOT
  };
}

// src/runStore/runCells.ts
var cells = /* @__PURE__ */ new Map();
var storeListeners = /* @__PURE__ */ new Set();
var MAX_CELLS = 50;
var MAX_TRACE_EVENTS = 500;
var MAX_APPENDED = 50;
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
  c.persistStep?.(ev);
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
function recordRunFailure(c, label, message) {
  const last = runTrace(c).at(-1);
  if (last?.isError && typeof last.result === "string" && last.result.endsWith(message)) return;
  pushTrace(c, {
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
function accrueProviders(c, field, raw) {
  if (!raw) return;
  const before = c[field].length;
  const next = new Set(c[field]);
  for (const p of raw.split(",").map((s) => s.trim()).filter(Boolean)) next.add(p);
  if (next.size !== before) c[field] = [...next];
}
function accrueByoUnresolved(c, raw) {
  accrueProviders(c, "byoUnresolved", raw);
}
function accrueProviderCap(c, raw) {
  accrueProviders(c, "providerCap", raw);
}

// src/runStore/turnPersistence.ts
function provenanceMetadata(result, requested, base) {
  const model = result.resolvedModel;
  if (!model) return withProvenanceMetadata(null, base);
  const account = asProvenanceAccount(result.account);
  const asked = requested && requested !== "default" && requested !== model ? requested : void 0;
  return withProvenanceMetadata({
    model,
    ...account ? { account } : {},
    ...asked ? { requestedModel: asked } : {}
  }, base);
}
async function persistMidTurnText(chatId, c, persistence, result, requested) {
  const text = canonicalTurnText(result.text);
  if (!text) return;
  const metadata = provenanceMetadata(result, requested, { [MID_TURN_META_KEY]: true });
  const [msg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: text, ...metadata ? { metadata } : {} }]);
  recordAppended(c, msg);
}
function canonicalTurnText(text) {
  const { content, reasoning } = splitVendorReasoning({ content: text });
  return canonicalReasoningText(content, reasoning);
}
function persistStep(chatId, persistence, ev) {
  void persistence.sendMessages(chatId, [stepRow(ev)]).catch(() => {
  });
}
function stoppedTurnOf(c) {
  const live2 = c.liveTurn;
  const text = live2 ? c.streamingText : "";
  const model = live2?.model;
  const result = !live2 ? "Stopped by user." : model ? `Stopped by user while ${model} was streaming (${text.length} chars kept).` : `Stopped by user before the gateway named the model (${text.length} chars kept).`;
  return {
    text,
    source: { ...live2 },
    event: {
      ts: nowIso(),
      category: "message",
      label: STOPPED_TURN_STEP,
      ...model ? { args: { model } } : {},
      ...live2 ? { textChars: text.length } : {},
      result
    }
  };
}
async function keepStoppedTurn(chatId, c, persistence) {
  const stopped = c.stoppedTurn;
  c.stoppedTurn = null;
  if (!stopped) return;
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
function connectRetryStep(c, step) {
  return (attempt, delayMs, reason) => {
    pushTrace(c, {
      ts: nowIso(),
      category: "message",
      label: "llm.connect_retry",
      args: { step, attempt },
      result: `Could not reach BuilderForce (${reason}). Trying again in ${Math.round(delayMs / 1e3)}s \u2014 nothing was sent, so nothing is repeated.`
    });
  };
}

// src/runStore/runControl.ts
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
function runAbortSignal(chatId) {
  return cells.get(chatId)?.abort?.signal;
}
function appendRunMessage(chatId, msg) {
  const c = cells.get(chatId);
  if (!c) return;
  recordAppended(c, msg);
  emit(c);
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

// ../packages/write-outbox/src/idempotency.ts
var fallbackCounter = 0;
function defaultId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  fallbackCounter += 1;
  return `ob-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function batchIdempotencyKey(batch) {
  const head = batch[0];
  return head ? head.batch ?? head.id : void 0;
}

// ../packages/write-outbox/src/policy.ts
var OUTBOX_MAX_ITEMS = 25;
var OUTBOX_MAX_WAIT_MS = 5e3;
var OUTBOX_MAX_ENTRIES = 1e3;
var OUTBOX_RETRY_BASE_MS = 1e3;
var OUTBOX_RETRY_MAX_MS = 5 * 6e4;
function isPermanentHttpFailure(error) {
  const status2 = error?.status;
  if (typeof status2 !== "number") return false;
  return status2 >= 400 && status2 < 500 && ![401, 408, 409, 425, 429].includes(status2);
}

// ../packages/write-outbox/src/sealedBatch.ts
var bySeq = (a, b) => a.seq - b.seq;
function sendable(e, scope) {
  return scope === void 0 || e.scope === void 0 || e.scope === scope;
}
function takeBatch(l, scope, upTo, maxItems) {
  const due = (e) => e.seq <= upTo && sendable(e, scope);
  const start = l.entries.findIndex(due);
  if (start < 0) return null;
  const head = l.entries[start];
  let n = 0;
  const at = (i) => l.entries[start + i];
  if (head.batch) {
    while (at(n) && at(n).batch === head.batch) n += 1;
  } else {
    while (at(n) && n < maxItems && !at(n).batch && due(at(n))) n += 1;
  }
  const batch = l.entries.splice(start, n);
  const sealed = !head.batch;
  if (sealed) {
    for (const e of batch) {
      e.batch = head.id;
      if (scope !== void 0) e.scope = scope;
    }
  }
  return { batch, sealed };
}
function sendContext(batch) {
  const head = batch[0];
  return {
    idempotencyKey: batchIdempotencyKey(batch),
    ids: batch.map((e) => e.id),
    ...head.scope !== void 0 ? { scope: head.scope } : {}
  };
}
function drainContext(taken, scope, newId) {
  return {
    idempotencyKey: batchIdempotencyKey(taken) ?? newId(),
    ids: taken.map((e) => e.id),
    ...scope ? { scope } : {}
  };
}

// ../packages/write-outbox/src/outbox.ts
function createOutbox(opts) {
  const maxItems = Math.max(1, opts.maxItems ?? OUTBOX_MAX_ITEMS);
  const maxWaitMs = opts.maxWaitMs ?? OUTBOX_MAX_WAIT_MS;
  const retry = opts.retry ? {
    baseMs: opts.retry.baseMs ?? OUTBOX_RETRY_BASE_MS,
    maxMs: opts.retry.maxMs ?? OUTBOX_RETRY_MAX_MS,
    isPermanent: opts.retry.isPermanent ?? isPermanentHttpFailure
  } : null;
  const store = opts.store ?? null;
  const maxEntries = Math.max(
    maxItems,
    opts.maxEntries ?? (retry || store ? OUTBOX_MAX_ENTRIES : Number.POSITIVE_INFINITY)
  );
  const newId = opts.newId ?? defaultId;
  const lanes = /* @__PURE__ */ new Map();
  let lastSeq = 0;
  let dropped = 0;
  let closed = false;
  const isOnline = () => opts.online?.isOnline() ?? true;
  const lane = (key) => {
    let l = lanes.get(key);
    if (!l) {
      l = { entries: [], timer: null, retryTimer: null, attempt: 0, inFlight: 0, tail: Promise.resolve() };
      lanes.set(key, l);
    }
    return l;
  };
  const nextSeq = () => {
    lastSeq = Math.max(lastSeq + 1, Date.now() * 1e3);
    return lastSeq;
  };
  const loaded = store ? Promise.resolve().then(() => store.load()).then(
    (entries) => {
      for (const e of entries) {
        lane(e.key).entries.push(e);
        lastSeq = Math.max(lastSeq, e.seq);
      }
      for (const l of lanes.values()) l.entries.sort(bySeq);
    },
    (error) => opts.onStoreError?.(error)
  ) : Promise.resolve();
  let writes = loaded;
  const persist = (op) => {
    if (!store) return;
    writes = writes.then(() => op(store)).catch((error) => opts.onStoreError?.(error));
  };
  const drop = (key, entries, reason) => {
    if (entries.length === 0) return;
    dropped += entries.length;
    const ids2 = entries.map((e) => e.id);
    persist((s) => s.remove(ids2));
    opts.onDrop?.({ key, count: entries.length, reason });
  };
  const enforceBound = () => {
    let total = 0;
    for (const l of lanes.values()) total += l.entries.length;
    while (total > maxEntries) {
      let oldestKey;
      let oldest;
      for (const [k, l] of lanes) {
        const head = l.entries[0];
        if (head && (!oldest || head.seq < oldest.entries[0].seq)) {
          oldest = l;
          oldestKey = k;
        }
      }
      if (!oldest) return;
      drop(oldestKey, oldest.entries.splice(0, 1), "overflow");
      total -= 1;
    }
  };
  const currentScope = () => opts.scope ? opts.scope() : void 0;
  const take = (l, scope, upTo) => {
    const next = takeBatch(l, scope, upTo, maxItems);
    if (!next) return null;
    if (next.sealed) persist((s) => s.put(next.batch));
    return next.batch;
  };
  const clearTimer = (l) => {
    if (l.timer !== null) clearTimeout(l.timer);
    l.timer = null;
  };
  const clearRetry = (l) => {
    if (l.retryTimer !== null) clearTimeout(l.retryTimer);
    l.retryTimer = null;
  };
  const scheduleRetry = (key, l) => {
    if (!retry || closed || l.retryTimer !== null) return;
    l.attempt += 1;
    const delay = Math.min(retry.maxMs, retry.baseMs * 2 ** (l.attempt - 1));
    const jittered = Math.round(delay * (0.8 + Math.random() * 0.4));
    l.retryTimer = setTimeout(() => {
      l.retryTimer = null;
      void flushKey(key, { final: false, probe: true });
    }, jittered);
  };
  const armTimer = (key, l) => {
    if (l.timer !== null || maxWaitMs <= 0) return;
    l.timer = setTimeout(() => {
      l.timer = null;
      void flushKey(key, { final: false, auto: true });
    }, maxWaitMs);
  };
  const requeue = (l, entries) => {
    l.entries.unshift(...entries);
    l.entries.sort(bySeq);
  };
  const sendBatch = async (key, l, batch, final) => {
    const items = batch.map((e) => e.item);
    const ctx = sendContext(batch);
    const ids2 = ctx.ids;
    l.inFlight += batch.length;
    try {
      await opts.send(key, opts.coalesce ? opts.coalesce(items) : items, { final, ...ctx });
      l.inFlight -= batch.length;
      l.attempt = 0;
      persist((s) => s.remove(ids2));
      return true;
    } catch (error) {
      l.inFlight -= batch.length;
      opts.onError?.(error, key);
      if (retry && !retry.isPermanent(error)) {
        requeue(l, batch);
        scheduleRetry(key, l);
        return false;
      }
      drop(key, batch, retry ? "rejected" : "failed");
      return true;
    }
  };
  const flushKey = (key, mode) => {
    const l = lanes.get(key);
    if (!l) return Promise.resolve();
    const upTo = mode.probe ? Number.POSITIVE_INFINITY : lastSeq;
    if (mode.final) {
      const scope = currentScope();
      if (!isOnline() || scope === null) return Promise.resolve();
      clearTimer(l);
      const batches = [];
      for (let b = take(l, scope, upTo); b; b = take(l, scope, upTo)) batches.push(b);
      return Promise.all(batches.map((b) => sendBatch(key, l, b, true))).then(() => void 0);
    }
    const run = l.tail.then(async () => {
      await loaded;
      if (mode.auto && l.retryTimer !== null) return;
      if (mode.auto && !isOnline()) {
        scheduleRetry(key, l);
        return;
      }
      if (!mode.auto && l.retryTimer !== null) {
        clearRetry(l);
      }
      const scope = currentScope();
      if (scope === null) {
        scheduleRetry(key, l);
        return;
      }
      clearTimer(l);
      for (let batch = take(l, scope, upTo); batch; batch = take(l, scope, upTo)) {
        if (!await sendBatch(key, l, batch, false)) return;
      }
      if (l.entries.length > 0) armTimer(key, l);
    });
    l.tail = run;
    return run;
  };
  const flushAll = (final) => Promise.all([...lanes.keys()].map((k) => flushKey(k, { final }))).then(() => void 0);
  const unsubscribe = opts.online?.subscribe((online) => {
    if (!online || closed) return;
    for (const l of lanes.values()) {
      clearRetry(l);
      l.attempt = 0;
    }
    void flushAll(false);
  });
  if (store) {
    void loaded.then(() => {
      enforceBound();
      for (const [k, l] of lanes) if (l.entries.length > 0) void flushKey(k, { final: false, auto: true });
    });
  }
  return {
    enqueue(key, item) {
      const l = lane(key);
      const scope = currentScope();
      const entry = { id: newId(), key, item, seq: nextSeq(), ...scope ? { scope } : {} };
      l.entries.push(entry);
      persist((s) => s.put([entry]));
      enforceBound();
      const unsealed = l.entries.reduce((n, e) => e.batch ? n : n + 1, 0);
      if (unsealed >= maxItems) {
        void flushKey(key, { final: false, auto: true });
      } else {
        armTimer(key, l);
      }
      return entry.id;
    },
    async flush(key, flushOpts) {
      const final = flushOpts?.final ?? false;
      if (key === void 0) return flushAll(final);
      return flushKey(key, { final });
    },
    drainWith(key, request) {
      const l = lane(key);
      const run = l.tail.then(async () => {
        await loaded;
        clearTimer(l);
        const scope = currentScope();
        const taken = [];
        if (scope !== null) {
          const parked = [];
          for (const e of l.entries) (sendable(e, scope) ? taken : parked).push(e);
          l.entries = parked;
        }
        const items = taken.map((e) => e.item);
        const ctx = drainContext(taken, scope, newId);
        const ids2 = ctx.ids;
        l.inFlight += taken.length;
        try {
          const result = await request(opts.coalesce && items.length ? opts.coalesce(items) : items, ctx);
          l.inFlight -= taken.length;
          if (taken.length) persist((s) => s.remove(ids2));
          return result;
        } catch (error) {
          l.inFlight -= taken.length;
          if (retry) requeue(l, taken);
          else drop(key, taken, "failed");
          throw error;
        }
      });
      l.tail = run.catch(() => void 0);
      return run;
    },
    size(key) {
      if (key !== void 0) return lanes.get(key)?.entries.length ?? 0;
      let n = 0;
      for (const l of lanes.values()) n += l.entries.length;
      return n;
    },
    stats() {
      let queued = 0;
      let inFlight = 0;
      for (const l of lanes.values()) {
        queued += l.entries.length;
        inFlight += l.inFlight;
      }
      return { queued, inFlight, dropped };
    },
    ready: () => loaded.then(() => writes),
    close() {
      closed = true;
      unsubscribe?.();
      for (const l of lanes.values()) {
        clearTimer(l);
        clearRetry(l);
      }
    }
  };
}

// ../packages/write-outbox/src/stores.ts
var isEntry = (v) => typeof v === "object" && v !== null && typeof v.id === "string" && typeof v.seq === "number";
function idbRunner(opts) {
  const storeName = opts.storeName ?? "entries";
  let db = null;
  const open = () => {
    db ??= new Promise((resolve, reject) => {
      const req = opts.indexedDB.open(opts.dbName, 1);
      req.onupgradeneeded = () => {
        const created = req.result;
        if (!created.objectStoreNames.contains(storeName)) created.createObjectStore(storeName, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((error) => {
      db = null;
      throw error;
    });
    return db;
  };
  return async (mode, body) => {
    const handle = await open();
    return new Promise((resolve, reject) => {
      const tx = handle.transaction(storeName, mode);
      const req = body(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req ? req.result : void 0);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
}
var readAll = async (run) => (await run("readonly", (s) => s.getAll()) ?? []).filter(isEntry);
function createIndexedDbOutboxStore(opts) {
  const run = idbRunner(opts);
  return {
    async load() {
      return (await readAll(run)).filter((r) => r.partition === opts.partition).map(({ partition: _p, ...entry }) => entry);
    },
    async put(entries) {
      await run("readwrite", (s) => {
        for (const e of entries) s.put(opts.partition === void 0 ? e : { ...e, partition: opts.partition });
      });
    },
    async remove(ids2) {
      await run("readwrite", (s) => {
        for (const id of ids2) s.delete(id);
      });
    }
  };
}
async function listIndexedDbOutboxPartitions(opts) {
  const partitions = /* @__PURE__ */ new Set();
  for (const r of await readAll(idbRunner(opts))) if (typeof r.partition === "string") partitions.add(r.partition);
  return [...partitions];
}

// src/stepOutbox.ts
var STEP_BATCH_MAX = 25;
var STEP_BATCH_WAIT_MS = 5e3;
var isStepRow = (m) => m.role === "tool";
var durability = null;
var stores = /* @__PURE__ */ new Map();
var runKeys = /* @__PURE__ */ new Set();
var replays = /* @__PURE__ */ new Map();
var stopListening = null;
function installStepDurability(next) {
  stopListening?.();
  stopListening = null;
  durability = next;
  stores.clear();
  runKeys.clear();
  replays.clear();
  if (!next) return;
  stopListening = next.online?.subscribe((online) => {
    if (online) void drainStoredSteps();
  }) ?? null;
  void drainStoredSteps();
}
var optionsFor = (d, key) => {
  let store = stores.get(key);
  if (!store) {
    store = d.storeFor(key);
    stores.set(key, store);
  }
  return {
    store,
    ...d.online ? { online: d.online } : {},
    ...d.scope ? { scope: d.scope } : {}
  };
};
function stepDurabilityFor(chatId, runKey) {
  if (!durability) return {};
  const key = runKey === chatId ? `chat:${chatId}` : `chat:${chatId}:run:${runKey}`;
  runKeys.add(key);
  return optionsFor(durability, key);
}
async function drainStoredSteps() {
  const d = durability;
  if (!d?.sendRows || !d.storedKeys) return;
  const sendRows = d.sendRows;
  let keys;
  try {
    keys = await d.storedKeys();
  } catch {
    return;
  }
  await Promise.all(keys.filter((key) => !runKeys.has(key)).map((key) => {
    let replay = replays.get(key);
    if (!replay) {
      replay = batchStepPersistence({
        async sendMessages(chatId, rows, opts) {
          await sendRows(chatId, rows, opts?.scope);
          return [];
        }
      }, optionsFor(d, key));
      replays.set(key, replay);
    }
    return replay.flush();
  }));
}
var withEventKeys = (rows, ids2) => rows.map((m, i) => m.eventKey || !ids2[i] ? m : { ...m, eventKey: `step:${ids2[i]}` });
function batchStepPersistence(base, opts = {}) {
  const steps = createOutbox({
    maxItems: opts.maxRows ?? STEP_BATCH_MAX,
    maxWaitMs: opts.waitMs ?? STEP_BATCH_WAIT_MS,
    retry: {},
    ...opts.store ? { store: opts.store } : {},
    ...opts.online ? { online: opts.online } : {},
    ...opts.scope ? { scope: opts.scope } : {},
    send: (chatId, rows, ctx) => base.sendMessages(chatId, withEventKeys(rows, ctx.ids), ctx.scope !== void 0 ? { scope: ctx.scope } : void 0)
  });
  const sendMessages = async (chatId, messages) => {
    if (messages.length > 0 && messages.every(isStepRow)) {
      for (const m of messages) steps.enqueue(chatId, m);
      return [];
    }
    return steps.drainWith(chatId, async (pending, ctx) => {
      if (pending.length === 0) return base.sendMessages(chatId, messages);
      const saved = await base.sendMessages(chatId, [...withEventKeys(pending, ctx.ids), ...messages]);
      return saved.slice(pending.length);
    });
  };
  return {
    persistence: { ...base, sendMessages },
    flush: () => steps.flush()
  };
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
function succeeded2(ev) {
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
    if (succeeded2(steps[i]) && isPush(steps[i])) pushedAt = i;
  }
  if (pushedAt < 0) return false;
  const touched = opts?.touchedFiles ?? [];
  for (let i = pushedAt; i < steps.length; i += 1) {
    const ev = steps[i];
    if (!succeeded2(ev)) continue;
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

// src/previewReview.ts
var REVIEW_RECORD_TOOL = "builtin_reviews_record";
function previewReviewDirective(chatId) {
  return `REVIEW YOUR OWN CHANGE \u2014 in this Studio session YOU are its reviewer. The app runs in a live preview in this browser that no other agent can reach, so a ticket you leave "in_review" sits at 75% on the board forever, and dispatching a QA or design agent to review it is not a substitute \u2014 even when agents are invited into this chat, the review of a change THIS session made is yours. When your turn changes the app, finish it in this order:
1. VERIFY \u2014 \`canvas_read_build_diagnostics\` must show no current failures. Then call \`canvas_inspect_preview\` with the CSS selectors your change targets and the widths the request is about (a phone bug: include the widths it names, or [360, 390, 414]; a desktop layout: the desktop viewport). Read the numbers against what was ASKED, not only the pass/fail: a pill that must hug its label is a few dozen px tall, not the card's height; a mobile menu must not make the page wider than the screen; an image must not cover the headline (\`occludedBy\`). If a width fails, or the measurements show the change did not do what was asked, FIX it and inspect again.
2. RECORD \u2014 when every width passes and the measurements match the request, record the review with builtin_reviews_record (taskId = the ticket tracking the change \u2014 builtin_chats_list_tickets with chatId=${chatId} lists it; verdict "complete"; a summary that QUOTES the measurements that prove it, e.g. ".character-tag 74\xD723px at 390px; page 390px wide at 390px"). One call per ticket the change delivers. If something the ticket asked for is genuinely not done, record verdict "gaps" with each gap instead of "complete".
3. CLOSE \u2014 a ticket linked to this chat that has a "complete" review recorded after a passing inspection moves to done (100%) automatically when your turn ends. If the ticket you reviewed is not linked yet, link it with builtin_chats_link_ticket (chatId=${chatId}) first. Report each ticket's verdict with the key measurements.
Never say a change works or a ticket is done without a passing \`canvas_inspect_preview\` AFTER your last edit. If the preview cannot be inspected (it is not running, or the probe times out), say so plainly and leave the ticket in review \u2014 do not record a "complete" review you could not verify.`;
}
function toolEvents(events) {
  return events.filter((event) => event.category === "tool");
}
function lastChangeIndex(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isCodeChangeTool(event.label) && !event.isError && !isFailedToolResult(event.result)) return index;
  }
  return -1;
}
function isPassingInspection(event) {
  if (event.label !== PREVIEW_REVIEW_TOOL || event.isError || isFailedToolResult(event.result)) return false;
  const result = event.result;
  return result?.passed === true;
}
function completeReviewTaskId(event) {
  if (event.label !== REVIEW_RECORD_TOOL || event.isError || isFailedToolResult(event.result)) return null;
  const args = event.args ?? {};
  const recorded = event.result?.verdict ?? args.verdict;
  if (recorded !== "complete") return null;
  const taskId = Number(args.taskId);
  return Number.isInteger(taskId) && taskId > 0 ? taskId : null;
}
function ticketsReviewedInPreview(events) {
  const tools = toolEvents(events);
  const lastChange = lastChangeIndex(tools);
  if (lastChange < 0) return [];
  let inspected = false;
  const reviewed = /* @__PURE__ */ new Set();
  for (const event of tools.slice(lastChange + 1)) {
    if (isPassingInspection(event)) inspected = true;
    else if (inspected) {
      const taskId = completeReviewTaskId(event);
      if (taskId != null) reviewed.add(taskId);
    }
  }
  return [...reviewed];
}
function inspectedAfterLastChange(events) {
  const tools = toolEvents(events);
  const lastChange = lastChangeIndex(tools);
  return tools.slice(lastChange + 1).some((event) => event.label === PREVIEW_REVIEW_TOOL);
}
function recordedReviewAfterLastChange(events) {
  const tools = toolEvents(events);
  const lastChange = lastChangeIndex(tools);
  return tools.slice(lastChange + 1).some((event) => event.label === REVIEW_RECORD_TOOL && !event.isError);
}
var DECLINES_REVIEW = /\b(?:don'?t|do not|never|without)\s+(?:review|verify|inspect|test|close|closing|mark)\w*|\b(?:leave|keep)\s+(?:it|them|the\s+tickets?)\s+(?:open|in\s+review)\b/i;
function declinesReview(text) {
  return DECLINES_REVIEW.test(text ?? "");
}
function leftChangeUnreviewed(input) {
  return input.codeChanged && canReviewInPreview(input.toolNames) && !declinesReview(input.requestText) && !(inspectedAfterLastChange(input.events) && recordedReviewAfterLastChange(input.events));
}
function unreviewedChangeNudge() {
  return 'You changed the app in this run and ended the turn without reviewing it. In the Studio you are the reviewer \u2014 nobody else can see this preview, so an unreviewed change parks its ticket in review forever. Finish it now: call `canvas_inspect_preview` with the selectors your change targets and the widths the request is about, check the measurements against what was asked (fix and re-inspect if they fail), then record builtin_reviews_record on each ticket the change delivers \u2014 verdict "complete" quoting the measurements, or "gaps" naming what is missing. A complete review after a passing inspection closes the ticket when your turn ends. If you genuinely cannot verify \u2014 the preview is not running, or the change is unfinished \u2014 say so plainly at the TOP of your answer and name exactly what is left.';
}

// src/runLineage.ts
var SUBAGENT_OF_META_KEY = "subagentOf";
function lineageMetadata(lineage, metadata) {
  let base = {};
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed;
    } catch {
    }
  }
  return JSON.stringify({
    ...base,
    [MID_TURN_META_KEY]: true,
    [AUTHORED_BY_META_KEY]: { kind: "agent", ref: lineage.agent.ref, name: lineage.agent.name },
    [SUBAGENT_OF_META_KEY]: { handle: lineage.handle, owner: lineage.ownerName, label: lineage.label }
  });
}
function parseSubagentOrigin(msg) {
  if (!msg.metadata) return null;
  try {
    const o = JSON.parse(msg.metadata)[SUBAGENT_OF_META_KEY];
    if (o && typeof o.handle === "string" && typeof o.owner === "string") {
      return { handle: o.handle, owner: o.owner, label: typeof o.label === "string" ? o.label : "" };
    }
  } catch {
  }
  return null;
}
function lineagePersistence(base, lineage, onPersisted) {
  return {
    ...base,
    async sendMessages(chatId, messages) {
      const saved = await base.sendMessages(
        chatId,
        messages.map((m) => ({ ...m, metadata: lineageMetadata(lineage, m.metadata) }))
      );
      for (const msg of saved) if (msg.role !== "tool") onPersisted(msg);
      return saved;
    }
  };
}

// src/runStore/runBackstops.ts
function attachDeltaToRunTicket(toolName, args, deltaTicketId) {
  if (toolName !== "builtin_tickets_from_delta" || deltaTicketId == null) return;
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const bag = args;
  if (bag.taskId == null) bag.taskId = deltaTicketId;
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
  pushTrace(c, {
    ts: nowIso(),
    category: "tool",
    label: "builtin_tickets_from_delta",
    durationMs: nowMs2() - toolStart,
    args: { ...args, auto: true, phase },
    result: out ?? null,
    isError: isFailedToolResult(out)
  });
}
async function updateLinkedTickets(chatId, c, req, select, status2, reason) {
  if (!req.runTool) return;
  let listed;
  try {
    listed = await req.runTool("builtin_chats_list_tickets", { chatId });
  } catch {
    return;
  }
  for (const t of select(listed)) {
    const id = Number(t.ref);
    if (!Number.isInteger(id)) continue;
    const toolStart = nowMs2();
    let out;
    try {
      out = await req.runTool("builtin_tasks_update", { id, status: status2 });
    } catch (e) {
      out = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    pushTrace(c, {
      ts: nowIso(),
      category: "tool",
      label: "builtin_tasks_update",
      durationMs: nowMs2() - toolStart,
      args: { id, status: status2, auto: true, reason },
      result: out ?? null,
      isError: isFailedToolResult(out)
    });
  }
}
async function autoLinkCreatedItem(chatId, c, runTool, toolName, out) {
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
  pushTrace(c, {
    ts: nowIso(),
    category: "tool",
    label: "builtin_chats_link_ticket",
    durationMs: nowMs2() - toolStart,
    args: { chatId, kind: link.kind, ref: link.ref, linkType: link.linkType, auto: true },
    result: result ?? null,
    isError: isFailedToolResult(result)
  });
}

// src/runStore/runMemory.ts
var import_evermind2 = require("@seanhogg/builderforce-memory/evermind");

// src/runStore/convoText.ts
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

// src/runStore/runMemory.ts
async function recallForRun(c, convo, evermind) {
  let recalled = null;
  if (!evermind?.recall) return { recalled, block: null, blockTokens: 0 };
  const query = latestUserText(convo);
  if (!query) return { recalled, block: null, blockTokens: 0 };
  try {
    recalled = await evermind.recall(query);
  } catch {
    recalled = null;
  }
  if (recalled?.seeded && recalled.items.length > 0) {
    const block = (0, import_evermind2.formatEvermindMemoryBlock)(recalled.items);
    if (block) {
      pushTrace(c, {
        ts: nowIso(),
        category: "recall",
        label: "evermind.recall",
        args: { query, version: recalled.version },
        result: { count: recalled.items.length, version: recalled.version, mode: recalled.mode, items: recalled.items }
      });
      return { recalled, block, blockTokens: transcriptTokens([{ role: "system", content: block }]) };
    }
  }
  return { recalled, block: null, blockTokens: 0 };
}
async function answerFromMemory(chatId, c, req, allTools, memoryReplay) {
  const { evermind, persistence, onActivity, model } = req;
  const convo = c.transcript;
  if (!(evermind?.answer && memoryReplay && !c.abort?.signal.aborted)) return false;
  const query = latestUserText(convo);
  if (!query) return false;
  let memAnswer = null;
  try {
    memAnswer = await evermind.answer(query, {
      toolsAvailable: !!allTools && allTools.length > 0,
      // What this turn would have run on — the saving a hit records is priced at it.
      model: model || c.lastServedModel || void 0
    });
  } catch {
    memAnswer = null;
  }
  const finalText = canonicalTurnText(memAnswer?.text ?? "");
  if (!finalText) return false;
  convo.push({ role: "assistant", content: replayTextOf(finalText) });
  const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: finalText }]);
  c.streamingText = "";
  recordAppended(c, assistantMsg);
  pushTrace(c, {
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
  return true;
}
function emitEvermindLearnReconcile(run, assistantMsg, finalText) {
  const { c, convo, recalled } = run;
  const evermind = run.req.evermind;
  const learn = assistantMsg?.evermindLearn;
  if (learn?.learned) {
    pushTrace(c, {
      ts: nowIso(),
      category: "learn",
      label: "evermind.learn",
      // `targets` carries the per-Evermind breakdown (a project can fan out to many)
      // so the timeline can name each by id; the renderer falls back to `version` alone.
      result: { version: learn.version, queued: true, ...learn.targets ? { targets: learn.targets } : {} }
    });
    const reconciled = recalled?.items ? (0, import_evermind2.countReconciledMemories)(recalled.items, finalText) : 0;
    if (reconciled > 0) {
      pushTrace(c, {
        ts: nowIso(),
        category: "reconcile",
        label: "evermind.reconcile",
        result: { count: reconciled, version: learn.version }
      });
    }
  } else if (learn && learn.reason && learn.reason !== "too-short") {
    pushTrace(c, {
      ts: nowIso(),
      category: "learn",
      label: "evermind.learn",
      result: { version: learn.version, skipped: true, reason: learn.reason, ...learn.targets ? { targets: learn.targets } : {} }
    });
  }
  if (evermind?.cacheAnswer && run.memoryReplay) {
    const q = latestUserText(convo);
    const spent = c.runUsage;
    const origin = spent.model && spent.promptTokens + spent.completionTokens > 0 ? { model: spent.model, promptTokens: spent.promptTokens, completionTokens: spent.completionTokens } : void 0;
    if (q) {
      const cached2 = origin ? evermind.cacheAnswer(q, finalText, origin) : evermind.cacheAnswer(q, finalText);
      void Promise.resolve(cached2).catch(() => {
      });
    }
  }
}

// src/planHandoff.ts
var HAND_OFF_TOOL = "hand_off";
var FAN_OUT_TOOL = "spawn_agents";
var FAN_OUT_BATCH = 4;
var MAX_HAND_OFF_TASKS = 12;
var TASK_CREATE_TOOL = "builtin_tasks_create";
var HAND_OFF_TOOL_SPEC = {
  type: "function",
  function: {
    name: HAND_OFF_TOOL,
    description: "END THE ANALYSIS and hand the work to the coding model(s). You are the planning model: read what you need, then call this ONCE with the tasks \u2014 do NOT edit files yourself. Each task becomes a ticket linked to this chat. Tasks that own separate files run side by side, one coding agent each, and each reports back to this chat; otherwise the coding model implements them in order. Every task must stand alone \u2014 the agent that implements it sees none of this conversation: say what to change, where, and how to know it is done.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What the analysis concluded, in a few sentences \u2014 the coders read this first." },
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: MAX_HAND_OFF_TASKS,
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: 'Ticket title, e.g. "Rebuild UserDetailDrawer on SlideOutPanel".' },
              brief: { type: "string", description: "The complete, standalone instruction: files, the change, the primitives to use." },
              paths: {
                type: "array",
                items: { type: "string" },
                description: "Workspace-relative files or directories this task OWNS. Tasks with disjoint paths run in parallel."
              },
              acceptance: { type: "string", description: "How to know it is done (tests, behaviour)." }
            },
            required: ["title", "brief"]
          }
        }
      },
      required: ["summary", "tasks"]
    }
  }
};
var str2 = (v) => typeof v === "string" ? v.trim() : "";
function parseHandOff(args) {
  const a = args ?? {};
  const summary = str2(a.summary);
  if (!Array.isArray(a.tasks) || a.tasks.length === 0) {
    return "hand_off needs { summary, tasks:[{ title, brief, paths? }] } with at least one task";
  }
  if (a.tasks.length > MAX_HAND_OFF_TASKS) {
    return `at most ${MAX_HAND_OFF_TASKS} tasks per hand-off \u2014 merge related slices`;
  }
  const tasks = [];
  for (const [i, raw] of a.tasks.entries()) {
    const t = raw ?? {};
    const title = str2(t.title);
    const brief = str2(t.brief);
    if (!title || !brief) return `task ${i + 1} needs both a title and a brief`;
    const paths = Array.isArray(t.paths) ? t.paths.map(str2).filter(Boolean) : [];
    const acceptance = str2(t.acceptance);
    tasks.push({ title, brief, paths, ...acceptance ? { acceptance } : {} });
  }
  return { summary, tasks };
}
function ticketDescription(task, summary) {
  return [
    task.brief,
    task.paths.length ? `Paths: ${task.paths.join(", ")}` : "",
    task.acceptance ? `Done when: ${task.acceptance}` : "",
    summary ? `Context: ${summary}` : ""
  ].filter(Boolean).join("\n\n");
}
function childTaskBrief(task, summary, ticketId) {
  return [
    ticketId != null ? `Ticket #${ticketId}: ${task.title}` : task.title,
    task.brief,
    task.paths.length ? `Your slice covers: ${task.paths.join(", ")}. Sibling slices are working beside you on other paths.` : "",
    task.acceptance ? `Done when: ${task.acceptance}` : "",
    summary ? `Background (the analysis is finished \u2014 do not redo it): ${summary}` : "",
    "Make the change now. Read only what the change itself needs. Finish with what you changed and anything outside your slice that must still change."
  ].filter(Boolean).join("\n\n");
}
function canRunInParallel(tasks) {
  if (tasks.length < 2 || tasks.some((t) => t.paths.length === 0)) return false;
  return overlappingScopes(tasks.map((t) => ({ label: t.title, paths: t.paths }))) === null;
}
function planMessage(plan, ticketIds, parallel) {
  const lines = plan.tasks.map((t, i) => {
    const id = ticketIds[i];
    return `${i + 1}. ${id != null ? `#${id} ` : ""}${t.title}${t.paths.length ? ` \u2014 ${t.paths.join(", ")}` : ""}`;
  });
  return [
    `**Plan \u2014 ${plan.tasks.length} task${plan.tasks.length === 1 ? "" : "s"}**${parallel ? " (running side by side; each reports back here)" : ""}`,
    plan.summary,
    lines.join("\n")
  ].filter(Boolean).join("\n\n");
}
function isFailed(out) {
  if (out == null) return true;
  if (typeof out !== "object") return false;
  const o = out;
  return o.ok === false || typeof o.error === "string" && o.error.length > 0;
}
async function call(ports, name, args) {
  const now = ports.now ?? (() => Date.now());
  const start = now();
  let out;
  try {
    out = await ports.runTool(name, args);
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  ports.step?.(name, { ...args, auto: true, reason: "hand_off" }, out, now() - start);
  return out;
}
async function fileTickets(plan, ports) {
  if (ports.projectId == null || !ports.toolNames.has(TASK_CREATE_TOOL)) return plan.tasks.map(() => void 0);
  const ids2 = [];
  for (const task of plan.tasks) {
    const out = await call(ports, TASK_CREATE_TOOL, {
      projectId: ports.projectId,
      title: task.title,
      description: ticketDescription(task, plan.summary),
      taskType: "task"
    });
    const id = !isFailed(out) ? out.id : void 0;
    ids2.push(typeof id === "number" ? id : void 0);
    if (!isFailed(out)) await ports.afterCreate?.(TASK_CREATE_TOOL, out).catch(() => void 0);
  }
  return ids2;
}
function asRecord(out) {
  if (typeof out === "string") {
    try {
      const parsed = JSON.parse(out);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return out && typeof out === "object" ? out : null;
}
var INLINE_NEXT = "HAND-OFF: the analysis is complete and you are the coding model. Implement the tasks below in order \u2014 do not re-plan or re-read what the planner already read. After each task, verify it, then move to the next. When all are done, build and test, commit and push, and report per ticket.";
var PARALLEL_NEXT = "HAND-OFF: the tasks ran side by side, one coding agent each, and each has reported into the chat. The children had no shell and no git. You are the coding model: verify the combined change (build and test), fix what the slices broke between them and anything they said was outside their paths, implement any task that failed, then commit, push and report per ticket.";
var BACKGROUND_NEXT = "HAND-OFF: one coding agent per task is now running IN THE BACKGROUND, each posting into the chat under its own name; the children have no shell and no git. You are the coding model: do not redo their tasks. Work on anything not delegated, then call wait_agents for their reports (or act on each as it arrives), verify the combined change (build and test), fix what the slices broke between them, implement any task that failed, then commit, push and report per ticket.";
async function executeHandOff(plan, ports) {
  const ids2 = await fileTickets(plan, ports);
  const tickets = plan.tasks.map((t, i) => ({ title: t.title, ...ids2[i] != null ? { id: ids2[i] } : {} }));
  const parallel = ports.toolNames.has(FAN_OUT_TOOL) && canRunInParallel(plan.tasks);
  await ports.postPlan?.(planMessage(plan, ids2, parallel)).catch(() => void 0);
  if (parallel) {
    const workstreams = [];
    const changed = /* @__PURE__ */ new Set();
    const placeholders = [];
    let fanOutOk = true;
    let background = false;
    for (let start = 0; start < plan.tasks.length; start += FAN_OUT_BATCH) {
      const batch = plan.tasks.slice(start, start + FAN_OUT_BATCH);
      const out = asRecord(await call(ports, FAN_OUT_TOOL, {
        workstreams: batch.map((t, k) => {
          const id = ids2[start + k];
          return {
            label: id != null ? `#${id} ${t.title}` : t.title,
            task: childTaskBrief(t, plan.summary, id),
            role: "code",
            ...id != null ? { ticket: String(id) } : {}
          };
        })
      }));
      const started = Array.isArray(out?.agents) ? out.agents : Array.isArray(out?.workstreams) ? out.workstreams : null;
      if (!out || out.ok === false && !started) {
        if (start === 0) {
          fanOutOk = false;
          break;
        }
        workstreams.push({ ok: false, error: typeof out?.error === "string" ? out.error : "fan-out failed", tasks: batch.map((t) => t.title) });
        continue;
      }
      if (started) workstreams.push(...started);
      if (out.running === true) background = true;
      if (Array.isArray(out.changedFiles)) {
        for (const f of out.changedFiles) if (typeof f === "string") changed.add(f);
      }
      if (Array.isArray(out.placeholders)) placeholders.push(...out.placeholders);
    }
    if (fanOutOk) {
      return {
        ok: true,
        mode: "parallel",
        tickets,
        workstreams,
        ...changed.size ? { changedFiles: [...changed] } : {},
        ...placeholders.length ? { placeholders } : {},
        next: background ? BACKGROUND_NEXT : PARALLEL_NEXT
      };
    }
  }
  return {
    ok: true,
    mode: "inline",
    tickets,
    next: `${INLINE_NEXT}

${plan.tasks.map((t, i) => `${i + 1}. ${ids2[i] != null ? `#${ids2[i]} ` : ""}${t.title}
${childTaskBrief(t, plan.summary, ids2[i])}`).join("\n\n")}`
  };
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

// src/restatedReply.ts
var RESTATED_MIN_WORDS = 40;
var RESTATED_CONTAINMENT = 0.6;
function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : "").join(" ");
  }
  return "";
}
function previousReplyText(convo) {
  let i = convo.length - 1;
  while (i >= 0 && convo[i].role !== "user") i--;
  for (i -= 1; i >= 0; i--) {
    const m = convo[i];
    if (m.role === "user") return "";
    if (m.role === "assistant") {
      const text = textOf(m.content).trim();
      if (text) return text;
    }
  }
  return "";
}
function shingles(text) {
  const words2 = text.toLowerCase().replace(/[^a-z0-9#\s]+/g, " ").split(/\s+/).filter(Boolean);
  const out = /* @__PURE__ */ new Set();
  for (let i = 0; i + 2 < words2.length; i++) out.add(`${words2[i]} ${words2[i + 1]} ${words2[i + 2]}`);
  return out;
}
function isRestatedReply(current, previous) {
  const now = shingles(current);
  if (now.size + 2 < RESTATED_MIN_WORDS || !previous.trim()) return false;
  const before = shingles(previous);
  let seen = 0;
  for (const s of now) if (before.has(s)) seen += 1;
  return seen / now.size >= RESTATED_CONTAINMENT;
}
function restatedReplyNudge() {
  return [
    "Your reply repeats the status you already gave the user last turn \u2014 they have it. Do not restate it.",
    "Instead: take the FIRST unfinished item and do it now, with tools. If every remaining item is blocked, say which one and exactly what would unblock it, in one or two lines.",
    "If the remaining items are not yet tickets, file one ticket per item (builtin_tasks_create, linked to this chat) so the status lives on the board instead of in a repeated summary.",
    "End with only what CHANGED this turn."
  ].join("\n");
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

// src/repeatedWrite.ts
function contentWriteOf(tool, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const { path, content } = args;
  if (typeof path !== "string" || !path.trim() || typeof content !== "string") return null;
  return { path: path.trim(), fingerprint: `${tool}:${stableStringify(args)}` };
}
function pathOf(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const path = args.path;
  return typeof path === "string" && path.trim() ? path.trim() : null;
}
var WriteLedger = class {
  written = /* @__PURE__ */ new Map();
  /** Is this call a full-content write identical to the last one that landed on its
   *  path, with nothing touching that path since? */
  isRepeat(tool, args) {
    const write = contentWriteOf(tool, args);
    return !!write && this.written.get(write.path) === write.fingerprint;
  }
  /**
   * A non-read call ran. A successful full-content write is remembered; anything else
   * that names a path forgets that path; `unscoped` (a shell command, a checkout)
   * forgets everything. A FAILED write forgets its path — the file's state is unknown.
   */
  record(tool, args, options) {
    if (options.unscoped) {
      this.written.clear();
      return;
    }
    const write = options.ok ? contentWriteOf(tool, args) : null;
    if (write) {
      this.written.set(write.path, write.fingerprint);
      return;
    }
    const path = pathOf(args);
    if (path) this.written.delete(path);
  }
};
function repeatedWriteNote(tool, path) {
  return `Not re-run: this exact \`${tool}\` of "${path}" already succeeded earlier in this run and nothing has changed the file since, so it already holds this content \u2014 writing it again cannot change anything. If something still looks broken, the cause is not that the write failed: re-read the error (it may predate your write), look elsewhere for the cause, or tell the user what you see.`;
}

// src/codeChanges.ts
var DELEGATION_TOOLS = /* @__PURE__ */ new Set(["spawn_agent", "spawn_agents", "wait_agents", HAND_OFF_TOOL]);
function isDelegationTool(name) {
  return DELEGATION_TOOLS.has(name);
}
function codeChangesOf(name, args, out) {
  if (isCodeChangeTool(name)) {
    if (isFailedToolResult(out)) return null;
    const file = codeChangeFile(args);
    return file ? [file] : [];
  }
  if (isDelegationTool(name)) {
    const files = out?.changedFiles;
    if (!Array.isArray(files)) return null;
    const named = files.filter((f) => typeof f === "string" && f.trim().length > 0);
    return named.length ? named : null;
  }
  return null;
}

// src/placeholderGuard.ts
var PLACEHOLDER_GUARD_LABEL = "tools.placeholder_guard";
var SOURCE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|cs|rb|php|sql|sh|ps1|vue|svelte)$/i;
var COMMENT_MARKERS = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bXXX\b/,
  /\bfor now\b/i,
  /\b(?:a|the) (?:proper|real|full) implementation (?:would|should|will)\b/i,
  /\bnot (?:yet )?(?:implemented|wired)\b/i,
  // The model's own reasoning left in the source — it was talking to itself, not
  // documenting the code.
  /\blet me\b/i,
  /\bI'll\b/
];
var STUB_THROW = /throw new Error\(\s*["'`]\s*(?:not (?:yet )?implemented|todo)/i;
function commentOf(line) {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("#") || t.startsWith("*") || t.startsWith("/*")) return t;
  const slash = line.indexOf("//");
  if (slash > 0 && line[slash - 1] !== ":") return line.slice(slash);
  return null;
}
function markedLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const comment = commentOf(line);
    if (comment && COMMENT_MARKERS.some((re) => re.test(comment)) || STUB_THROW.test(line)) {
      out.push(line.trim().slice(0, 160));
    }
  }
  return out;
}
function placeholdersWritten(tool, args) {
  const a = args ?? {};
  const path = typeof a.path === "string" ? a.path : "";
  if (!path || !SOURCE_FILE.test(path)) return [];
  const added = tool === "write_file" ? a.content : tool === "edit_file" ? a.new_string : void 0;
  if (typeof added !== "string" || !added) return [];
  const before = new Set(typeof a.old_string === "string" ? markedLines(a.old_string) : []);
  return markedLines(added).filter((text) => !before.has(text)).map((text) => ({ path, text }));
}
function placeholderAdvisory(hits) {
  if (!hits.length) return null;
  const shown = hits.slice(0, 3).map((h) => `\`${h.text}\``).join(", ");
  return `PLACEHOLDER WRITTEN in ${hits[0].path}: ${shown}${hits.length > 3 ? ` (+${hits.length - 3} more)` : ""}. This is unfinished work, and comments that narrate your own reasoning do not belong in the source. Finish it in this run \u2014 or, if it is genuinely blocked, say so plainly in your reply and name the blocker. Never report work that contains a placeholder as done or fixed.`;
}
function placeholderTraceEvent(tool, hits, ts) {
  return {
    ts,
    category: "message",
    label: PLACEHOLDER_GUARD_LABEL,
    args: { tool, hits },
    result: placeholderAdvisory(hits) ?? ""
  };
}
function delegationPlaceholders(result) {
  return asHits(resultField(result, "placeholders"));
}
function asHits(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const hit = x;
    return typeof hit.path === "string" && typeof hit.text === "string" ? [{ path: hit.path, text: hit.text }] : [];
  });
}
function resultField(result, key) {
  let obj = result;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return void 0;
    }
  }
  return obj && typeof obj === "object" ? obj[key] : void 0;
}

// src/completionGuard.ts
var TICKET_UPDATE = /tasks[._]update/i;
var DONE_STATUSES = /* @__PURE__ */ new Set(["done", "completed", "complete"]);
function isTicketCompletion(tool, args) {
  if (!TICKET_UPDATE.test(tool)) return false;
  const status2 = args?.status;
  return typeof status2 === "string" && DONE_STATUSES.has(status2.toLowerCase());
}
function canCompleteTicket(isOnBaseBranch, userDeclinedShipping) {
  if (isOnBaseBranch) return true;
  if (userDeclinedShipping) return true;
  return false;
}
function notOnBaseBranchAdvisory() {
  return "CANNOT MARK DONE \u2014 code is not on the base branch (main/master). Either ship to main/master first, or if you intentionally left the code uncommitted, say so explicitly in your reply so this guard knows to allow it.";
}
var PlaceholderLedger = class {
  open = /* @__PURE__ */ new Map();
  /** Account for ONE successful write, given the hits the guard found in it. */
  record(tool, args, hits) {
    const a = args ?? {};
    const path = typeof a.path === "string" ? a.path : "";
    if (!path) return;
    if (tool === "write_file") {
      this.set(path, hits.map((h) => h.text));
      return;
    }
    if (tool === "edit_file") {
      const current = new Set(this.open.get(path) ?? []);
      const removed = typeof a.old_string === "string" ? markedLines(a.old_string) : [];
      const kept = new Set(typeof a.new_string === "string" ? markedLines(a.new_string) : []);
      for (const text of removed) if (!kept.has(text)) current.delete(text);
      for (const h of hits) current.add(h.text);
      this.set(path, [...current]);
      return;
    }
    if (tool === "delete_file") this.open.delete(path);
  }
  /** Placeholders a delegated child reported writing. The parent never saw those edits,
   *  so they stay outstanding until the parent rewrites or edits the lines itself. */
  add(hits) {
    for (const h of hits) {
      const texts = this.open.get(h.path) ?? /* @__PURE__ */ new Set();
      texts.add(h.text);
      this.open.set(h.path, texts);
    }
  }
  outstanding() {
    return [...this.open.entries()].flatMap(([path, texts]) => [...texts].map((text) => ({ path, text })));
  }
  set(path, texts) {
    if (texts.length) this.open.set(path, new Set(texts));
    else this.open.delete(path);
  }
};
function completionAdvisory(open) {
  if (!open.length) return null;
  const shown = open.slice(0, 3).map((h) => `${h.path}: \`${h.text}\``).join("; ");
  return `MARKED DONE OVER A PLACEHOLDER. This run wrote ${open.length} placeholder(s) it has not removed \u2014 ${shown}${open.length > 3 ? ` (+${open.length - 3} more)` : ""}. A ticket is done when its code works in the product, not when a stub compiles. Finish the placeholder and keep the ticket done, or set it back to in_progress and name what blocks it.`;
}

// src/windowFit/runWindowFit.ts
function windowFitTrace(ts, step, t) {
  const how = t.summarized ? "summarized" : t.recalled ? "recalled from memory" : "elided";
  return {
    ts,
    category: "message",
    label: "llm.handoff",
    args: { step, ...t },
    result: t.dropped > 0 ? `Packed the transcript for ${t.to}${t.from ? ` (from ${t.from})` : ""}: ${t.dropped} earlier message(s) ${how}, ~${t.estimatedTokens} tokens${t.fits ? "" : " \u2014 still over its window"}.` : `Handed the transcript to ${t.to}${t.from ? ` (from ${t.from})` : ""} verbatim, ~${t.estimatedTokens} tokens.`
  };
}
function windowFitRecallFailedTrace(ts, step, error) {
  return {
    ts,
    category: "message",
    label: "llm.handoff_recall_failed",
    args: { step },
    result: `The memory recall for the hand-off note failed (${error instanceof Error ? error.message : String(error)}) \u2014 the dropped messages were elided instead.`
  };
}
function createRunWindowFit(deps) {
  let lastServed;
  const recalls = /* @__PURE__ */ new Map();
  if (deps.priorRecall) recalls.set(deps.priorRecall.query, Promise.resolve(deps.priorRecall.result));
  const recallFor = (step) => deps.recall ? (query) => {
    let hit = recalls.get(query);
    if (!hit) {
      hit = deps.recall(query).catch((error) => {
        deps.trace(windowFitRecallFailedTrace(deps.now(), step, error));
        return null;
      });
      recalls.set(query, hit);
    }
    return hit;
  } : void 0;
  return {
    async prepare(req) {
      const to = req.model;
      if (!to) return req.messages;
      const window2 = await resolveContextWindow(to, deps.windowSources);
      if (window2 === void 0) return req.messages;
      const differs = lastServed !== void 0 && lastServed !== to;
      if (!differs && window2 >= deps.workingBudgetTokens) return req.messages;
      const recall = recallFor(req.step);
      const { messages } = await packForModel({
        messages: req.messages,
        to,
        ...lastServed ? { from: lastServed } : {},
        contextTokens: window2,
        ...req.tools ? { tools: req.tools } : {},
        ...req.maxTokens ? { maxTokens: req.maxTokens } : {},
        ...deps.summarizer ? { summarizer: deps.summarizer() } : {},
        ...recall ? { recall } : {},
        onTrace: (t) => {
          if (differs || t.dropped > 0 || !t.fits) deps.trace(windowFitTrace(deps.now(), req.step, t));
        }
      });
      return messages;
    },
    served(model) {
      if (model) lastServed = model;
    }
  };
}

// src/runStore/runPreamble.ts
async function prepareRunLoop(chatId, c, req, runKey) {
  const { resolvedSystemPrompt, tools: toolSpecs, model, modelStrict, runTool, stream, evermind } = req;
  const convo = c.transcript;
  const canAskUser = !!runTool && (toolSpecs?.length ?? 0) > 0;
  const catalog = canAskUser ? [...toolSpecs ?? [], ASK_USER_TOOL_SPEC, HAND_OFF_TOOL_SPEC] : toolSpecs;
  const allTools = catalog && catalog.length > 0 ? catalog : void 0;
  const runMode = normalizeChatMode(req.chatMode ?? "work");
  const metadata = {
    chatId,
    guestTurnId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    guestTurnInput: latestUserText(convo),
    mode: runMode,
    ...req.projectId != null ? { projectId: req.projectId } : {}
  };
  const { recalled, block: recallBlock2, blockTokens: recallBlockTokens } = await recallForRun(c, convo, evermind);
  let systemPrompt = recallBlock2 ? `${resolvedSystemPrompt}

${recallBlock2}` : resolvedSystemPrompt;
  const priorRecall = { query: latestUserText(convo), result: recalled };
  const memoryReplay = memoryReplayable(latestUserText(convo), { followUp: isFollowUpTurn(convo) });
  if (await answerFromMemory(chatId, c, req, allTools, memoryReplay)) return null;
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

${chatModeDirective(runMode, chatId, { canEditHere, canDelegate: catalogToolNames.includes("spawn_agent"), canFanOut: catalogToolNames.includes("spawn_agents"), roster: req.chatRoster })}

${turnOptimizationDirective()}`;
  const canShip = canShipHere(catalogToolNames);
  if (canShip) systemPrompt = `${systemPrompt}

${selfReviewShipDirective(chatId)}`;
  if (canReviewInPreview(catalogToolNames)) systemPrompt = `${systemPrompt}

${previewReviewDirective(chatId)}`;
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
  const alwaysAdvertised = [
    ...toolNamesMentionedIn(systemPrompt),
    ...localToolsIn(catalogToolNames),
    // The Studio's workspace vocabulary, including the preview review its contract
    // requires — empty everywhere but the Studio (see `studioToolsIn`).
    ...studioToolsIn(catalogToolNames),
    // The project-memory pair (recall before re-reading; remember what was learned) is
    // the cheapest tool in the catalog and the first one relevance would drop.
    ...memoryToolsIn(catalogToolNames),
    // Asking the user is never off-topic: it is how the run stops when it cannot
    // proceed, so relevance against the request must not be what decides whether the
    // agent is allowed to ask. Its one schema is also the cheapest in the catalog.
    ...canAskUser ? [ASK_USER_TOOL] : []
  ];
  const windowFit = createRunWindowFit({
    workingBudgetTokens: HISTORY_TOKEN_BUDGET,
    summarizer: () => ({ stream, model: run.policy.model, signal: c.abort?.signal }),
    ...evermind?.recall ? { recall: (q) => evermind.recall(q), priorRecall } : {},
    ...req.windowSources ? { windowSources: req.windowSources } : {},
    trace: (ev) => pushTrace(c, ev),
    now: nowIso
  });
  const run = {
    chatId,
    runKey,
    c,
    req,
    convo,
    canAskUser,
    allTools,
    catalogToolNames,
    alwaysAdvertised,
    // Tools this run has actually called — pinned into every later turn's selection
    // so a multi-step task never loses a tool it is mid-way through using.
    usedTools: /* @__PURE__ */ new Set(),
    systemPrompt,
    metadata,
    recalled,
    recallBlockTokens,
    memoryReplay,
    userRequest,
    // One re-prompt per run for a final reply that repeats the previous turn's answer
    // (see `restatedReply.ts`). Captured before the loop: the transcript grows as it runs.
    priorReply: previousReplyText(convo),
    // The user's ACTUAL request for this run, resolved once. Every turn's tool
    // selection scores against this and nothing else — see `completeTurn.ts`.
    requestQuery: routingQueryForTurn(convo),
    windowFit,
    // What this run has already read. Two guards, one tally (see `readCoverage.ts`):
    // an EXACT repeat of a successful read-only call — same tool, same arguments —
    // returns an "already returned above" stub instead of re-fetching + re-injecting
    // the payload; and a target re-read at SHIFTING offsets gets an advisory once it
    // starts circling. Both are invalidated together, and only for what a later
    // mutation actually touched — never wiped wholesale by an unrelated call.
    readCoverage: new ReadCoverage(),
    // What this run has already FAILED at (see `repeatedFailure.ts`). The read guards
    // above deliberately record only SUCCESSES, so an identical failing call — the same
    // `git_status` answered with the same remedy three times, the same platform read
    // answered 502 twice — got no pushback at all and could repeat until the budget was
    // gone. The first retry stays free; from the second the model reads the count and the
    // error it already has, and the moves that remain.
    failures: new FailureTally(),
    // What this run has already WRITTEN (see `repeatedWrite.ts`): the third loop shape —
    // a successful full-content write sent again byte for byte, because an error from
    // before it was still on screen. Replaying it cannot change the file, so it is answered
    // without running.
    writeLedger: new WriteLedger(),
    // Placeholders this run wrote and has not removed — read when a ticket is marked done
    // (see `completionGuard.ts`).
    placeholderLedger: new PlaceholderLedger(),
    // THE model hand-off policy (`@builderforce/run-policy`), shared with every other agent
    // loop. ANALYSIS first, then the CODE: under auto-routing each turn tells the gateway
    // what kind of call it is. Until the run reaches its first code change the turns are
    // analysis (`plan` — the tenant's own precedence decides who plans); from then on they
    // are `code`, which the gateway leads with the strongest connected model. A run that
    // already changed code (a resumed turn) starts as `code`. The policy also holds the
    // model this run is CURRENTLY talking to, every model it has already tried, and the
    // models that broke mid-turn: a model that burns its whole stall budget fails over to
    // another one rather than handing the user a promise (see the final-answer hook),
    // and one that breaks mid-stream is routed around for the rest of the run. A pinned
    // model is the user's own choice and is never routed around.
    policy: initialRunPolicy({
      pinnedModel: model,
      strictPin: modelStrict,
      startPhase: c.codeChanged || c.codePhaseReached ? "code" : "plan"
    }),
    // Bounded counter for the announced-but-never-made tool call recovery, so a model
    // that keeps narrating instead of acting cannot spin the loop. Not one-shot: a model
    // that stalls once frequently stalls again on the very next turn, and spending the
    // single retry on the first stall left the user holding the SECOND promise. The
    // stall budget (`agent-stall`) bounds these recoveries on its own — a run has no
    // iteration ceiling to fall back on.
    forceToolChoice: void 0,
    announcementRecoveries: 0,
    // One re-prompt per run for a code change left unshipped (see `selfReviewShip.ts`).
    // One, not a budget: the second time the model stops short it has read the contract
    // twice, and its answer — including "I cannot ship this because…" — is the answer.
    shipRecoveryUsed: false,
    reviewRecoveryUsed: false,
    // One redirect per run for an explicit sub-agent request the run neither started nor
    // refused on a real result (see `delegationRequest.ts`).
    delegationRecoveryUsed: false,
    restateRecoveryUsed: false,
    stopHookRounds: 0,
    redirectAskToDelegation: false,
    pendingReplay: null,
    pendingRun: null,
    lastTurnInterruption: null
  };
  return run;
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

// src/composingActivity.ts
function utf8ByteLength2(text) {
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
  for (const c of calls) total += utf8ByteLength2(c.args ?? "");
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
      bytes += utf8ByteLength2(partial.argsFragment ?? "");
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

// src/runSteering.ts
var inboxes = /* @__PURE__ */ new Map();
function queueRunSteering(runKey, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const queue = inboxes.get(runKey) ?? [];
  queue.push(trimmed);
  inboxes.set(runKey, queue);
}
function drainRunSteering(runKey) {
  const queue = inboxes.get(runKey);
  if (!queue?.length) return [];
  inboxes.delete(runKey);
  return queue;
}

// src/runStore/runLoopContext.ts
var DEDUP_READ_TOOLS = /* @__PURE__ */ new Set(["read_file", "search_code", "list_files", "find_symbol", "file_outline", "semantic_search", "repo_map"]);
var isDedupableRead = (name) => DEDUP_READ_TOOLS.has(name) || isRepoStateReadTool(name) || isReadOnlyPlatformTool(name);
var metaOf = (turn) => turn.meta;
function reportToPolicy(run, event) {
  return run.policy = reduceRunPolicy(run.policy, event);
}
function failureAdvisoryFor(run, name, args, out, step) {
  const attempts = run.failures.record(name, args);
  const advisory = repeatedFailureAdvisory(name, attempts, failureReason(out));
  if (advisory) {
    pushTrace(run.c, {
      ts: nowIso(),
      category: "message",
      label: "tools.repeat_failure_guard",
      args: { step, tool: name, attempts },
      result: advisory
    });
  }
  return advisory;
}
async function settleReply(run, rawText, result, requested) {
  const { c, chatId, convo } = run;
  const text = canonicalTurnText(rawText);
  convo.push({ role: "assistant", content: replayTextOf(text) });
  const meta = provenanceMetadata(result, requested);
  const [assistantMsg] = await run.req.persistence.sendMessages(chatId, [{ role: "assistant", content: text, ...meta ? { metadata: meta } : {} }]);
  c.streamingText = "";
  recordAppended(c, assistantMsg);
  return assistantMsg;
}

// src/runStore/completeTurn.ts
function completeTurnPort(run) {
  const { c, chatId, runKey, req, convo, systemPrompt, metadata, recallBlockTokens, allTools, requestQuery, usedTools, canAskUser, alwaysAdvertised } = run;
  const { stream, routingMode, maxTokens, reasoning, runTool } = req;
  return async (ctx) => {
    const iter = ctx.step;
    c.streamingText = "";
    emit(c);
    for (const text of drainRunSteering(runKey)) convo.push({ role: "user", content: text });
    const working = await buildWorkingTranscript(
      c,
      systemPrompt,
      (msgs) => summarizeMiddle(stream, run.policy.model, msgs, c.abort?.signal),
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
    const trimmed = c.compactMemo ? transcriptTokens([{ role: "system", content: systemPrompt }, ...c.transcript]) - transcriptTokens(working) : 0;
    const memoryEffect = callMemoryEffect(trimmed, recallBlockTokens);
    const callMetadata = memoryEffect ? { ...metadata, memory: memoryEffect } : metadata;
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
      // While planning, the planner's deliverable is never off-topic either.
      required: offersHandOff(run.policy) && canAskUser ? [...alwaysAdvertised, HAND_OFF_TOOL] : alwaysAdvertised
    });
    const selected = offersHandOff(run.policy) ? selection.tools : selection.tools.filter((t) => t.function.name !== HAND_OFF_TOOL);
    const advertised = selection.trimmed ? [...selected, ...routerToolSpecs(allTools?.length ?? 0)] : selected;
    const tools = advertised.length > 0 ? advertised : void 0;
    const advertisedNames = new Set(advertised.map((t) => t.function.name));
    if (selection.trimmed) {
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: "tools.selected",
        args: { step: iter },
        result: `${selected.length} of ${selection.available} tools advertised this turn (relevance-selected; ${usedTools.size} pinned from earlier calls)`
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
      onConnectRetry: connectRetryStep(c, iter),
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
    let turnRole = nextTurn(run.policy, { hasTools: !!tools }).role;
    const turnToolChoice = run.forceToolChoice;
    run.forceToolChoice = void 0;
    const request = async (extra = []) => {
      const ask = nextTurn(run.policy, { hasTools: !!tools });
      const messages = await run.windowFit.prepare({ messages: extra.length > 0 ? [...working, ...extra] : working, model: ask.model, tools, maxTokens: turnMaxTokens(maxTokens, !!tools), step: iter });
      return asLiveTurn(c, () => stream(
        {
          messages,
          tools,
          tool_choice: tools ? turnToolChoice ?? "auto" : void 0,
          model: ask.model,
          modelStrict: ask.strict,
          // Raised to the tool-turn floor when tools are on offer: a file write is
          // output, and the Effort ceiling cut every one of them off mid-JSON.
          routingMode,
          maxTokens: turnMaxTokens(maxTokens, !!tools),
          reasoning,
          metadata: callMetadata,
          role: ask.role,
          ...ask.excludeModels.length > 0 ? { excludeModels: ask.excludeModels } : {},
          signal: c.abort?.signal
        },
        handlers
      ));
    };
    const turnError = (e) => {
      pushTrace(c, providerFailureTrace(nowIso(), iter, e instanceof StreamInterruptedError && e.model || run.policy.model, e, nowMs2() - llmStart));
      return e;
    };
    const restartTurn = () => {
      c.streamingText = "";
      firstTokenAt = void 0;
      composing.reset();
      emit(c);
    };
    try {
      result = await request();
    } catch (e) {
      if (c.abort?.signal.aborted) throw e;
      const failure = providerFailureEvent(e);
      const outcome = failure ? reportToPolicy(run, failure).outcome : null;
      if (!outcome || outcome.kind !== "retry_turn") throw turnError(e);
      pushTrace(c, transportRetryTrace(nowIso(), iter, outcome, e.message));
      restartTurn();
      try {
        result = await request();
      } catch (retryError) {
        if (c.abort?.signal.aborted) throw retryError;
        throw turnError(retryError);
      }
    }
    if (turnRole === "plan" && result.toolCalls.some((tc) => isCodeChangeTool(tc.name)) && reportToPolicy(run, { type: "code_change_attempted" }).outcome.kind === "reask_as_coder") {
      turnRole = nextTurn(run.policy, { hasTools: !!tools }).role;
      c.codePhaseReached = true;
      const brief = coderHandoffBrief(replayTextOf(result.text), result.toolCalls);
      pushTrace(c, coderReaskTrace(nowIso(), iter, result.resolvedModel));
      restartTurn();
      try {
        result = await request([{ role: "user", content: brief }]);
      } catch (e) {
        if (c.abort?.signal.aborted) throw e;
        throw turnError(e);
      }
    }
    reportToPolicy(run, { type: "turn_succeeded", ...result.resolvedModel ? { model: result.resolvedModel } : {} });
    run.windowFit.served(result.resolvedModel ?? run.policy.model);
    if (result.toolCalls.length > 0) run.announcementRecoveries = 0;
    if (result.resolvedModel && result.toolCalls.some((tc) => isCodeChangeTool(tc.name))) c.codeModel = result.resolvedModel;
    accrueByoUnresolved(c, result.byoUnresolved);
    accrueProviderCap(c, result.providerCap);
    const resolved = result.resolvedModel ?? run.policy.model ?? "default";
    const requested = run.policy.model ?? "default";
    c.runUsage.promptTokens += result.usage?.prompt ?? 0;
    c.runUsage.completionTokens += result.usage?.completion ?? 0;
    if (result.resolvedModel) {
      c.runUsage.model = result.resolvedModel;
      c.lastServedModel = result.resolvedModel;
    }
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
    const localFallback = localFallbackTrace(nowIso(), iter, result.localFirst);
    if (localFallback) pushTrace(c, localFallback);
    const narratedUnadvertised = result.toolCalls.length === 0 ? toolNamesMentionedIn(result.text).filter((n) => !advertisedNames.has(n)) : [];
    const argBytes = toolCallArgBytes(result.toolCalls);
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
    run.lastTurnInterruption = turnInterruption(result.finishReason);
    const meta = { result, resolved, requested, advertised: advertised.length, advertisedNames };
    const toolCalls = runTool ? result.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.args })) : [];
    return { content: replayTextOf(result.text), toolCalls, meta };
  };
}

// src/runStore/dispatchTool.ts
function dispatchToolPort(run) {
  const { c, chatId, req, readCoverage, failures, writeLedger, placeholderLedger } = run;
  const { runTool } = req;
  return async (call2, ctx) => {
    const iter = ctx.step;
    const args = call2.args;
    const declined = malformedCallOutcome(call2, run.lastTurnInterruption === "truncated");
    if (declined) {
      const truncated = run.lastTurnInterruption === "truncated";
      pushTrace(c, {
        ts: nowIso(),
        category: "error",
        isError: true,
        durationMs: 0,
        label: malformedCallLabel(call2.name, truncated),
        args: { arguments: String(call2.raw?.arguments ?? "").slice(0, 200) },
        result: declined
      });
      return { data: declined, isError: true };
    }
    const isReadTool = isDedupableRead(call2.name);
    const toolStart = nowMs2();
    setActivity(c, toolActivity(call2.name, args, iter, Date.now()));
    if (!runTool) throw new Error("tool call without a tool runner");
    let out;
    try {
      out = await runTool(call2.name, withObservedModel(chatId, call2.name, args));
    } catch (e) {
      const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      out = { ok: false, error: message };
      const repeat = failureAdvisoryFor(run, call2.name, args, out, iter);
      if (!isReadTool) writeLedger.record(call2.name, args, { ok: false, unscoped: isUnscopedMutation(call2.name, args) });
      run.pendingRun = { out, toolStart, isReadTool, threw: true };
      return { data: repeat ? withAdvisory(out, repeat) : out, isError: true };
    }
    const changed = codeChangesOf(call2.name, args, out);
    if (changed) {
      const first = !c.codeChanged;
      c.codeChanged = true;
      for (const f of changed) if (!c.touchedFiles.includes(f)) c.touchedFiles.push(f);
      if (first && !c.ticketRecorded && req.projectId != null && req.runTool) {
        await recordCodeChangeTicket(chatId, c, req, "open").catch(() => {
        });
      }
    }
    if (isTicketRecordingTool(call2.name)) c.ticketRecorded = true;
    await autoLinkCreatedItem(chatId, c, runTool, call2.name, out);
    let advisory = null;
    if (!isReadTool) writeLedger.record(call2.name, args, { ok: !isFailedToolResult(out), unscoped: isUnscopedMutation(call2.name, args) });
    if (isFailedToolResult(out)) {
      advisory = failureAdvisoryFor(run, call2.name, args, out, iter);
    } else {
      failures.clear(call2.name, args);
      const placeholders = placeholdersWritten(call2.name, args);
      if (placeholders.length) {
        pushTrace(c, placeholderTraceEvent(call2.name, placeholders, nowIso()));
        advisory = placeholderAdvisory(placeholders);
      }
      if (isCodeChangeTool(call2.name)) placeholderLedger.record(call2.name, args, placeholders);
      if (isDelegationTool(call2.name)) placeholderLedger.add(delegationPlaceholders(out));
      if (isTicketCompletion(call2.name, args)) {
        const placeholderWarning = completionAdvisory(placeholderLedger.outstanding());
        const events = c.trace;
        const isOnBaseBranch = shippedToBaseBranch(events);
        const canComplete = canCompleteTicket(isOnBaseBranch, false);
        if (!canComplete) {
          const said = notOnBaseBranchAdvisory();
          pushTrace(c, { ts: nowIso(), category: "message", label: "tools.completion_guard", args: { tool: call2.name, isOnBaseBranch }, result: said });
          advisory = said;
        } else if (placeholderWarning) {
          pushTrace(c, { ts: nowIso(), category: "message", label: "tools.completion_guard", args: { tool: call2.name, open: placeholderLedger.outstanding() }, result: placeholderWarning });
          advisory = placeholderWarning;
        }
      }
      if (isReadTool) {
        const visit = readCoverage.record(call2.name, args);
        const target = visit ? visitTarget(args) : void 0;
        advisory = visit && target ? revisitAdvisory(call2.name, target, visit) : null;
        if (advisory) {
          pushTrace(c, {
            ts: nowIso(),
            category: "message",
            label: "tools.revisit_guard",
            args: { step: iter, tool: call2.name, target, visits: visit.count },
            result: advisory
          });
        }
      }
    }
    const trimmedOut = trimToolResult(call2.name, out ?? null, { advisory });
    run.pendingRun = { out, toolStart, isReadTool, threw: false, bytes: trimmedOut.bytes, truncated: trimmedOut.truncated };
    return { data: trimmedOut.content, isError: isFailedToolResult(out) };
  };
}

// src/delegationRequest.ts
var SPAWN_TOOLS = /* @__PURE__ */ new Set(["spawn_agent", "spawn_agents"]);
var ASKS_FOR_SUBAGENTS = /\bsub[- ]?agents?\b|\bspawn(?:_agents?|\s+(?:agents?|workers?|children))\b|\b(?:parallel|concurrent)\s+(?:agents?|workers?)\b|\bfan[- ]?out\b/i;
var DECLINES_SUBAGENTS = /\b(?:no|without|don'?t\s+use|do\s+not\s+use|never\s+use|skip(?:\s+the)?)\s+(?:any\s+)?sub[- ]?agents?\b/i;
function asksForSubagents(text) {
  const t = text ?? "";
  return ASKS_FOR_SUBAGENTS.test(t) && !DECLINES_SUBAGENTS.test(t);
}
function canSpawnHere(toolNames) {
  return toolNames.some((n) => SPAWN_TOOLS.has(n));
}
function attemptedDelegation(events) {
  return events.some((e) => e.category === "tool" && SPAWN_TOOLS.has(e.label));
}
function leftDelegationUndone(input) {
  return canSpawnHere(input.toolNames) && asksForSubagents(input.requestText) && !attemptedDelegation(input.events);
}
function undelegatedRequestNudge(toolNames) {
  const fanOut = toolNames.includes("spawn_agents");
  const call2 = fanOut ? 'Call spawn_agents NOW: one workstream per open ticket whose files do not overlap \u2014 ticket=<id>, a complete standalone task brief, role "code". Each child is a clone of you and makes its change itself. It takes up to 4 per call and returns at once \u2014 the children run in the background, so start the next batch right away if there are more. Use spawn_agent for a slice that must run alone.' : 'Call spawn_agent NOW, one slice at a time, with a complete standalone task brief and role "code". The child is a clone of you and makes its change itself.';
  return `The user asked for this work to be done by SUB-AGENTS, and none has been started. Do not ask how to proceed \u2014 the user already said. A sub-agent here is a LOCAL child run on this machine: it needs no cloud dispatch, no ticket assignment and no Developer on the roster. The workspace execution kill-switch and every \`autoRun: execution_disabled\` verdict stop CLOUD runs only \u2014 they do not apply to it. as_agent is optional: with no fitting teammate, OMIT it \u2014 the spawn tools staff the role on this project themselves (a capable teammate, or a Developer hired into the workspace and project, with the ticket assigned) and the child runs AS that agent. ${call2} Keep working while they run; when their reports are in (they arrive on their own, or call wait_agents), verify their changes and report what each child delivered, per ticket.`;
}

// src/runStore/beforeDispatch.ts
function beforeDispatchHook(run) {
  const { c, chatId, runKey, req, allTools, catalogToolNames, usedTools, readCoverage, writeLedger, placeholderLedger } = run;
  const { runTool, needsConfirm, persistence } = req;
  return async (rawCall, ctx) => {
    const iter = ctx.step;
    run.pendingReplay = null;
    run.pendingRun = null;
    let call2 = rawCall;
    {
      const aliased = resolveToolAlias(call2.name);
      if (aliased !== call2.name) call2 = { ...call2, name: aliased };
    }
    if (isRouterTool(call2.name)) {
      const routed = handleRouterCall(allTools ?? [], call2.name, call2.args);
      if ("result" in routed) {
        pushTrace(c, {
          ts: nowIso(),
          category: "tool",
          label: call2.name,
          args: call2.args,
          result: routed.result
        });
        return { result: { data: routed.result } };
      }
      const routedArgs = routed.dispatch.args ?? {};
      call2 = { ...call2, name: routed.dispatch.name, args: routedArgs, raw: { ...call2.raw, name: routed.dispatch.name, arguments: JSON.stringify(routedArgs) } };
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: "tools.routed",
        args: { step: iter, via: rawCall.name },
        result: `Called ${call2.name} through the tool router (it was not advertised directly this turn).`
      });
    }
    if (call2.name === ASK_USER_TOOL) {
      if (run.redirectAskToDelegation) {
        run.redirectAskToDelegation = false;
        return { result: { data: { ok: false, error: undelegatedRequestNudge(catalogToolNames) } } };
      }
      return { result: { data: { error: "ask_user needs { question, options:[{label}] } with 2+ options. Retry or answer in prose." } } };
    }
    if (call2.name === HAND_OFF_TOOL) {
      if (!offersHandOff(run.policy)) {
        return { result: { data: { ok: false, error: "The plan was already handed off \u2014 you are the coding model now. Implement the tasks; do not re-plan." } } };
      }
      const plan = parseHandOff(call2.args);
      if (typeof plan === "string") return { result: { data: { ok: false, error: plan } } };
      reportToPolicy(run, { type: "hand_off" });
      c.codePhaseReached = true;
      pushTrace(c, handOffTrace(nowIso(), ctx.step, plan.tasks.length, HAND_OFF_TOOL));
      const outcome = await executeHandOff(plan, {
        runTool: (name, args2) => runTool(name, args2),
        toolNames: new Set(catalogToolNames),
        ...req.projectId != null ? { projectId: req.projectId } : {},
        afterCreate: (toolName, out) => autoLinkCreatedItem(chatId, c, runTool, toolName, out),
        step: (label, args2, out, durationMs) => pushTrace(c, {
          ts: nowIso(),
          category: "tool",
          label,
          durationMs,
          args: args2,
          result: out ?? null,
          isError: isFailedToolResult(out)
        }),
        postPlan: async (text) => {
          const [msg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: text, metadata: JSON.stringify({ [MID_TURN_META_KEY]: true }) }]);
          if (!msg) return;
          recordAppended(c, msg);
          emit(c);
        },
        now: nowMs2
      });
      const changed = codeChangesOf(HAND_OFF_TOOL, call2.args, outcome);
      if (changed) {
        c.codeChanged = true;
        for (const f of changed) if (!c.touchedFiles.includes(f)) c.touchedFiles.push(f);
      }
      usedTools.add(HAND_OFF_TOOL);
      placeholderLedger.add(delegationPlaceholders(outcome));
      return { result: { data: outcome } };
    }
    const args = call2.args;
    attachDeltaToRunTicket(call2.name, args, c.deltaTicketId);
    if (needsConfirm && needsConfirm({ name: call2.name, args })) {
      const ok = await requestRunConfirm(runKey, { name: call2.name, args }, { step: iter });
      if (!ok) {
        const declined = { cancelled: true, reason: "User declined this action." };
        pushTrace(c, { ts: nowIso(), category: "tool", label: call2.name, args, result: declined });
        return { result: { data: declined } };
      }
    }
    if (isDedupableRead(call2.name)) {
      if (readCoverage.isRepeat(call2.name, args)) {
        const cached2 = readCoverage.cachedResult(call2.name, args);
        if (cached2 && !stillInWorkingContext(c, cached2.anchor)) {
          const replayNote = `Replayed from this run's read cache: this exact ${call2.name} call succeeded earlier in the run, but its result was compressed out of the working context, so here it is again \u2014 served from memory, not re-read. Act on it now; do not request it again.`;
          const visit = readCoverage.record(call2.name, args);
          const target = visit ? visitTarget(args) : void 0;
          const revisit = visit && target ? revisitAdvisory(call2.name, target, visit) : null;
          const replayed = trimToolResult(call2.name, cached2.result ?? null, { advisory: revisit ? `${replayNote}

${revisit}` : replayNote });
          run.pendingReplay = { name: call2.name, args, result: cached2.result };
          pushTrace(c, {
            ts: nowIso(),
            category: "tool",
            label: call2.name,
            args,
            result: { replayed: true, note: replayNote },
            resultBytes: replayed.bytes,
            truncated: replayed.truncated
          });
          return { result: { data: replayed.content } };
        }
        const stub = {
          note: `Duplicate ${call2.name} call \u2014 identical arguments to an earlier call this turn, whose result is already in the conversation above. Reuse that result instead of re-reading; do not repeat it (this saves context and avoids looping).`
        };
        pushTrace(c, { ts: nowIso(), category: "tool", label: call2.name, args, result: stub });
        return { result: { data: stub } };
      }
      const covered = readCoverage.coveredRead(call2.name, args);
      if (covered) {
        const visit = readCoverage.record(call2.name, args);
        const target = visit ? visitTarget(args) : void 0;
        const revisit = visit && target ? revisitAdvisory(call2.name, target, visit) : null;
        const note = revisit ? `${covered.note}

${revisit}` : covered.note;
        if (covered.cached && !stillInWorkingContext(c, covered.cached.anchor)) {
          const replayed = trimToolResult(call2.name, covered.cached.result ?? null, { advisory: note });
          run.pendingReplay = { name: call2.name, args, result: covered.cached.result };
          pushTrace(c, {
            ts: nowIso(),
            category: "tool",
            label: call2.name,
            args,
            result: { covered: true, replayed: true, note },
            resultBytes: replayed.bytes,
            truncated: replayed.truncated
          });
          return { result: { data: replayed.content } };
        }
        const stub = { note };
        pushTrace(c, { ts: nowIso(), category: "tool", label: call2.name, args, result: { covered: true, note } });
        return { result: { data: stub } };
      }
      const derived = readCoverage.derivedSearch(call2.name, args);
      if (derived) {
        const visit = readCoverage.record(call2.name, args);
        const target = visit ? visitTarget(args) : void 0;
        const revisit = visit && target ? revisitAdvisory(call2.name, target, visit) : null;
        const served = trimToolResult(call2.name, derived, { advisory: revisit });
        run.pendingReplay = { name: call2.name, args, result: derived };
        pushTrace(c, {
          ts: nowIso(),
          category: "tool",
          label: call2.name,
          args,
          result: { derived: true, note: derived.note },
          resultBytes: served.bytes,
          truncated: served.truncated
        });
        return { result: { data: served.content } };
      }
    } else {
      if (writeLedger.isRepeat(call2.name, args)) {
        const note = repeatedWriteNote(call2.name, String(args.path ?? "").trim());
        pushTrace(c, { ts: nowIso(), category: "message", label: "tools.repeat_write_guard", args: { step: iter, tool: call2.name }, result: note });
        pushTrace(c, { ts: nowIso(), category: "tool", label: call2.name, args, result: { skipped: true, note } });
        return { result: { data: { ok: true, applied: false, unchanged: true, note } } };
      }
      readCoverage.invalidate(call2.name, args);
    }
    return call2 === rawCall ? void 0 : { rewrite: call2 };
  };
}

// src/runStore/toolCallHooks.ts
function beforeToolCallsHook(run) {
  const { c, chatId, catalogToolNames, userRequest } = run;
  const { runTool, persistence, onActivity } = run.req;
  return async (ctx, turn, calls) => {
    const { result, requested } = metaOf(turn);
    const askCall = calls.find((tc) => tc.name === ASK_USER_TOOL);
    if (askCall && runTool && !run.delegationRecoveryUsed && leftDelegationUndone({
      toolNames: catalogToolNames,
      requestText: userRequest,
      events: runTrace(c)
    })) {
      run.delegationRecoveryUsed = true;
      run.redirectAskToDelegation = true;
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: "loop.recover_undelegated_request",
        args: { step: ctx.step, via: "ask_user" },
        result: "The user asked for sub-agents and the run asked how to proceed without starting one \u2014 answered with the local delegation contract instead of settling the question."
      });
    } else if (askCall) {
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
        const assistantMsg = await settleReply(run, reply, result, requested);
        emit(c);
        emitEvermindLearnReconcile(run, assistantMsg, reply);
        onActivity?.(chatId);
        return { action: "stop", ok: true, output: reply };
      }
    }
    await persistMidTurnText(chatId, c, persistence, result, requested);
    c.streamingText = "";
    emit(c);
    return void 0;
  };
}
function afterDispatchHook(run) {
  const { c, readCoverage, usedTools } = run;
  return (call2, _result, row) => {
    if (run.pendingReplay) {
      readCoverage.cacheResult(run.pendingReplay.name, run.pendingReplay.args, { result: run.pendingReplay.result, anchor: row });
      run.pendingReplay = null;
      return void 0;
    }
    const ran = run.pendingRun;
    run.pendingRun = null;
    if (!ran) return void 0;
    const args = call2.args;
    if (ran.threw) {
      pushTrace(c, { ts: nowIso(), category: "tool", label: call2.name, durationMs: nowMs2() - ran.toolStart, args, result: ran.out, isError: true });
      return void 0;
    }
    if (ran.isReadTool && !isFailedToolResult(ran.out)) readCoverage.cacheResult(call2.name, args, { result: ran.out ?? null, anchor: row });
    pushTrace(c, {
      ts: nowIso(),
      category: "tool",
      label: call2.name,
      durationMs: nowMs2() - ran.toolStart,
      args,
      result: ran.out ?? null,
      isError: isFailedToolResult(ran.out),
      resultBytes: ran.bytes,
      truncated: ran.truncated
    });
    usedTools.add(call2.name);
    return void 0;
  };
}

// src/stopHooks.ts
var MAX_STOP_HOOK_ROUNDS = 4;
async function askStopHook(hook, input) {
  if (!hook || input.round >= MAX_STOP_HOOK_ROUNDS) return null;
  try {
    const nudge = (await hook(input))?.trim();
    return nudge ? nudge : null;
  } catch {
    return null;
  }
}

// src/runStore/finalAnswerHook.ts
function finalAnswerHook(run) {
  const { c, chatId, runKey, req, convo, canAskUser, catalogToolNames, userRequest, priorReply } = run;
  const { tools: toolSpecs, pickFallbackModel, runTool, persistence, onActivity } = req;
  return async (ctx, turn) => {
    const iter = ctx.step;
    const { result, resolved, requested, advertised, advertisedNames } = metaOf(turn);
    const stallInput = {
      text: result.text,
      toolCallCount: result.toolCalls.length,
      availableToolCount: toolSpecs?.length ?? 0,
      recoveriesUsed: run.announcementRecoveries,
      availableToolNames: [...advertisedNames],
      requestText: userRequest
    };
    const shape = stallShape(stallInput);
    const requeueWithNudge = async (nudge) => {
      await persistMidTurnText(chatId, c, persistence, result, requested);
      convo.push({ role: "assistant", content: replayTextOf(result.text) });
      convo.push({ role: "user", content: nudge });
    };
    const steering = drainRunSteering(runKey);
    if (steering.length > 0) {
      await requeueWithNudge(steering.join("\n\n"));
      c.streamingText = "";
      emit(c);
      return { action: "continue" };
    }
    if (runTool && shouldRecoverStalledTurn(stallInput)) {
      run.announcementRecoveries += 1;
      const lastChance = run.announcementRecoveries >= MAX_ANNOUNCEMENT_RECOVERIES;
      run.forceToolChoice = stallRecoveryToolChoice(stallInput);
      await requeueWithNudge(stallRecoveryNudge(lastChance, shape, stallInput));
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: shape === "handed-off" ? "loop.recover_handed_off_work" : "loop.recover_announced_tool_call",
        args: { step: iter, attempt: run.announcementRecoveries, of: MAX_ANNOUNCEMENT_RECOVERIES, advertisedTools: advertised, shape },
        result: shape === "handed-off" ? `Model ended by telling the user to run the commands itself holds tools for \u2014 re-prompted to run them (${run.announcementRecoveries}/${MAX_ANNOUNCEMENT_RECOVERIES}).` : `Model announced a tool call without making one \u2014 re-prompted (${run.announcementRecoveries}/${MAX_ANNOUNCEMENT_RECOVERIES}).`
      });
      c.streamingText = "";
      emit(c);
      return { action: "continue" };
    }
    const stopNudge = runTool ? await askStopHook(req.onStop, { codeChanged: c.codeChanged, touchedFiles: c.touchedFiles, requestText: userRequest, round: run.stopHookRounds }) : null;
    if (stopNudge) {
      run.stopHookRounds += 1;
      await requeueWithNudge(stopNudge);
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: "loop.stop_hook",
        args: { step: iter, round: run.stopHookRounds },
        result: `A workspace stop hook held the run for another turn: ${stopNudge.slice(0, 200)}`
      });
      c.streamingText = "";
      emit(c);
      return { action: "continue" };
    }
    if (runTool && !run.shipRecoveryUsed && leftChangeUnshipped({
      codeChanged: c.codeChanged,
      toolNames: catalogToolNames,
      requestText: userRequest,
      events: runTrace(c)
    })) {
      run.shipRecoveryUsed = true;
      await requeueWithNudge(unshippedChangeNudge());
      pushTrace(c, {
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
    if (runTool && !run.reviewRecoveryUsed && leftChangeUnreviewed({
      codeChanged: c.codeChanged,
      toolNames: catalogToolNames,
      requestText: userRequest,
      events: runTrace(c)
    })) {
      run.reviewRecoveryUsed = true;
      await requeueWithNudge(unreviewedChangeNudge());
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: "loop.recover_unreviewed_change",
        args: { step: iter, files: c.touchedFiles.slice(0, 20) },
        result: "Run changed the app and ended without inspecting the preview and recording a review \u2014 re-prompted to verify and review (this Studio session is the change's only reviewer)."
      });
      c.streamingText = "";
      emit(c);
      return { action: "continue" };
    }
    if (runTool && !run.delegationRecoveryUsed && leftDelegationUndone({
      toolNames: catalogToolNames,
      requestText: userRequest,
      events: runTrace(c)
    })) {
      run.delegationRecoveryUsed = true;
      await requeueWithNudge(undelegatedRequestNudge(catalogToolNames));
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: "loop.recover_undelegated_request",
        args: { step: iter, via: "reply" },
        result: "The user asked for sub-agents and the run ended without starting one \u2014 re-prompted to spawn them locally."
      });
      c.streamingText = "";
      emit(c);
      return { action: "continue" };
    }
    if (runTool && !run.restateRecoveryUsed && isRestatedReply(result.text, priorReply)) {
      run.restateRecoveryUsed = true;
      await requeueWithNudge(restatedReplyNudge());
      pushTrace(c, {
        ts: nowIso(),
        category: "message",
        label: "loop.recover_restated_reply",
        args: { step: iter },
        result: "Final reply repeated the previous turn's answer \u2014 re-prompted to act on the next unfinished item instead of restating it."
      });
      c.streamingText = "";
      emit(c);
      return { action: "continue" };
    }
    const settledText = result.text.trim();
    const finalText = (canAskUser ? liftProseAskUser(settledText) : settledText) || "No response.";
    const assistantMsg = await settleReply(run, finalText, result, requested);
    if (runTool && isExhaustedStall(stallInput)) {
      const { outcome } = reportToPolicy(run, { type: "stalled", resolvedModel: resolved, pick: pickFallbackModel });
      if (outcome.kind === "failed_over") {
        pushTrace(c, modelFailoverTrace(nowIso(), iter, resolved, outcome, shape));
        run.announcementRecoveries = 0;
        run.forceToolChoice = stallRecoveryToolChoice(stallInput);
        convo.push({ role: "user", content: stallRecoveryNudge(false, shape, stallInput) });
        c.streamingText = "";
        emit(c);
        return { action: "continue" };
      }
      const notice = stallExhaustedNotice(resolved, run.policy.tried, shape);
      pushTrace(c, {
        ts: nowIso(),
        category: "error",
        label: "loop.stall_unrecovered",
        args: { step: iter, model: resolved, attempts: run.announcementRecoveries, tried: run.policy.tried, advertisedTools: advertised, shape },
        result: notice,
        isError: true
      });
      c.error = notice;
    }
    emit(c);
    emitEvermindLearnReconcile(run, assistantMsg, finalText);
    onActivity?.(chatId);
    return { action: "stop", ok: true, output: finalText };
  };
}

// src/runStore/runLoop.ts
var runCodec = openAiChatCodec((r) => typeof r.data === "string" ? r.data : JSON.stringify(r.data));
async function runLoop(chatId, c, req, runKey) {
  const run = await prepareRunLoop(chatId, c, req, runKey);
  if (!run) return;
  const { convo, systemPrompt, metadata } = run;
  const { routingMode, stream, persistence, onActivity, maxTokens, reasoning } = req;
  const loop = await runAgentLoop({
    messages: convo,
    codec: runCodec,
    ports: { complete: completeTurnPort(run), dispatch: dispatchToolPort(run) },
    hooks: {
      beforeToolCalls: beforeToolCallsHook(run),
      beforeDispatch: beforeDispatchHook(run),
      afterDispatch: afterDispatchHook(run),
      onNoToolCalls: finalAnswerHook(run)
    },
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
      const closeAsk = nextTurn(run.policy, { hasTools: false });
      const closing = await asLiveTurn(c, () => stream(
        // No `tools` → the model can't call another tool and must produce text.
        { messages: working, model: closeAsk.model, modelStrict: closeAsk.strict, routingMode, maxTokens, reasoning, metadata, signal: c.abort?.signal },
        {
          onModel: liveTurnModel(c),
          onConnectRetry: connectRetryStep(c, loop.step),
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
        args: { model: closing.resolvedModel ?? closeAsk.model ?? "default", requestedModel: closeAsk.model ?? "default", step: loop.step, toolCalls: 0, forcedFinish: true, failureStreak: streak, account: closing.account, byoUnresolved: closing.byoUnresolved },
        usage: closing.usage,
        finishReason: closing.finishReason,
        textChars: closing.text.length,
        result: `forced final synthesis (${streak} consecutive tool failures stopped the run) \xB7 ${closing.text.length} chars \xB7 finish: ${closing.finishReason ?? "\u2014"}`
      });
      const closingText = canonicalTurnText(closing.text);
      if (closingText) {
        convo.push({ role: "assistant", content: replayTextOf(closingText) });
        const meta = provenanceMetadata(closing, closeAsk.model);
        const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: "assistant", content: closingText, ...meta ? { metadata: meta } : {} }]);
        c.streamingText = "";
        recordAppended(c, assistantMsg);
        emit(c);
        emitEvermindLearnReconcile(run, assistantMsg, closingText);
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
    "agent.loop",
    `Stopped after ${streak} consecutive failed tool calls over ${loop.step} steps (a forced final answer without tools also came back empty)`
  );
  c.error = `The assistant's last ${streak} tool calls all failed and it gave no answer. Read the failing steps above, then try again with what they ask for.`;
  emit(c);
}

// src/runStore/startRun.ts
async function startRun(runKey, request) {
  const driver = getRunDriver();
  if (driver) return driver.start(runKey, request);
  const c = getCell(runKey);
  if (c.running) return;
  const lineage = request.lineage;
  const chatId = lineage?.rootChatId ?? runKey;
  const steps = batchStepPersistence(request.persistence, stepDurabilityFor(chatId, runKey));
  const runPersistence = lineage ? lineagePersistence(steps.persistence, lineage, (msg) => appendRunMessage(chatId, msg)) : steps.persistence;
  const req = { ...request, persistence: runPersistence };
  c.persistStep = (ev) => persistStep(chatId, runPersistence, ev);
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
  c.runUsage = emptyRunUsage();
  try {
    await runLoop(chatId, c, req, runKey);
  } catch (e) {
    if (!c.abort?.signal.aborted) {
      c.error = e instanceof Error ? e.message : "Reply failed";
      c.errorAction = chatErrorAction(e);
      recordRunFailure(c, "agent.run", c.error);
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
      await updateLinkedTickets(chatId, c, req, linkedTicketsToAdvance, "in_progress", "worked-ticket-off-backlog").catch(() => {
      });
    }
    const shipped = !aborted && c.codeChanged && shippedToBaseBranch(runTrace(c), { touchedFiles: c.touchedFiles });
    if (shipped && req.projectId != null && req.runTool) {
      await updateLinkedTickets(chatId, c, req, linkedTicketsToComplete, "done", "shipped-to-base-branch").catch(() => {
      });
    }
    const reviewedInPreview = !aborted && c.codeChanged ? ticketsReviewedInPreview(runTrace(c)) : [];
    if (reviewedInPreview.length && req.projectId != null && req.runTool) {
      await updateLinkedTickets(
        chatId,
        c,
        req,
        (listed) => linkedTicketsReviewedComplete(listed, reviewedInPreview),
        "done",
        "reviewed-in-preview"
      ).catch(() => {
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
    c.persistStep = null;
    c.activity = null;
    emit(c);
    await steps.flush();
  }
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
    windowSources,
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
    chatMode,
    chatRoster
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
      ...windowSources ? { windowSources } : {},
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
      chatMode,
      chatRoster
    }),
    [fullSystemPrompt, toolSpecs, model, modelStrict, routingMode, pickFallbackModel, windowSources, maxTokens, reasoning, runTool, needsConfirm, stream, persistence, onActivity, evermind, augmentSystemPrompt, projectId, chatMode, chatRoster]
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
        await startRun(id, buildRequest(transcriptSeedFrom(messages), modelContent, priorResearchDigest(scopeToConsolidation(messages))));
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
    void startRun(chatId, buildRequest(transcriptSeedFrom(messages.slice(0, -1)), last.content, priorResearchDigest(scopeToConsolidation(messages))));
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
      const { exp, sig: sig2 } = await request("/api/brain/uploads/sign", {
        method: "POST",
        body: JSON.stringify({ key })
      });
      return `${baseUrl}/api/brain-files/${key}?exp=${exp}&sig=${encodeURIComponent(sig2)}`;
    }
  };
}

// src/indexedDbStepDurability.ts
function installIndexedDbStepDurability(opts) {
  const { indexedDB: factory, dbName } = opts;
  installStepDurability({
    storeFor: (key) => createIndexedDbOutboxStore({ indexedDB: factory, dbName, partition: key }),
    storedKeys: () => listIndexedDbOutboxPartitions({ indexedDB: factory, dbName }),
    sendRows: async (chatId, rows, scope) => {
      if (scope !== void 0 && scope !== opts.scope()) {
        throw new Error("step rows parked: not the current identity");
      }
      await opts.sendRows(chatId, rows);
    },
    online: opts.online,
    scope: opts.scope
  });
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
function str3(v) {
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
  const ticketKind = str3(meta.ticketKind) ?? "task";
  const ticketRef = str3(meta.ticketRef) ?? "";
  const agentName = str3(meta.agentName) ?? str3(meta.agentRef) ?? "";
  if (meta.runMilestone != null && isPhase(meta.phase)) {
    return {
      kind: "milestone",
      phase: meta.phase,
      agentName,
      ticketKind,
      ticketRef,
      executionId: typeof meta.executionId === "number" ? meta.executionId : null,
      ...str3(meta.toStatus) ? { toStatus: str3(meta.toStatus) } : {},
      ...str3(meta.note) ? { note: str3(meta.note) } : {},
      ...str3(meta.question) ? { question: str3(meta.question) } : {}
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
var FILE_DELIVERY_RULE = [
  "DELIVER CODE BY WRITING IT. Every file you produce goes into the project through your file tools: create new files, and change existing ones in place with the edit tool rather than rewriting them. The user is looking at a live Preview that shows only what you have written.",
  'NEVER hand the user code to copy, paste, add or apply by hand, and never answer with a code block in place of a file write \u2014 not for a stylesheet, not for "the rest of the file", not as a last resort after a failed write.',
  "When a write fails, read its error, fix the call and issue it again. When a file is too long for one call, write a smaller working first version and extend it with further edits.",
  "Only if you have NO tool that writes files at all, give each file as a code block whose language tag is its path (```src/App.jsx), and say that this surface cannot write files."
].join("\n");
var BASE_PERSONAS = {
  designer: {
    icon: "\u{1F310}",
    prompt: [
      "You are an expert AI coding assistant built into Builderforce.ai, a browser-based Builder. Help users generate and build websites and web apps.",
      "When the user describes an app to build, SCAFFOLD IT COMPLETELY in this turn: write every file the app needs to actually run \u2014 an index.html entry, a package.json with real dependencies and a `build` script, and all of the src/ components \u2014 so the live Preview renders a working app immediately, not a single snippet. Default to a Vite + React app unless the user asks for something else. List the project's files before writing, so you build on the starter rather than over it. When you have scaffolded the app, tell the user in one line what you built and that Preview is live and it is ready to Publish.",
      "Use markdown for your prose: headings, lists and bold.",
      FILE_DELIVERY_RULE
    ].join("\n")
  },
  mobile: {
    icon: "\u{1F4F1}",
    prompt: [
      "You are an expert mobile app developer operating Builderforce.ai's Canvas Builder. The user is building a MOBILE app and previews it in a phone-sized device simulator.",
      'The project is a React Native app rendered for the web through react-native-web, so it runs in the browser preview AND stays portable to Expo. Import components (View, Text, Pressable, ScrollView, StyleSheet, FlatList) from "react-native" \u2014 never use HTML elements like div, span or button, and never use CSS files or className.',
      "Style with StyleSheet.create and flexbox. Remember there is no hover: design for touch, keep tap targets at least 44 points, and respect safe areas at the top and bottom of the screen.",
      "Design for a narrow portrait viewport (roughly 390 x 850 points) first. Prefer native navigation patterns \u2014 tab bars, stack headers, bottom sheets \u2014 over desktop patterns like sidebars and hover menus.",
      FILE_DELIVERY_RULE
    ].join("\n")
  },
  webmobile: {
    icon: "\u{1F5A5}\uFE0F",
    prompt: [
      "You are an expert full-stack app developer built into Builderforce.ai's browser Builder. The user is building ONE app that ships as BOTH a responsive web application AND a mobile app, from a single codebase.",
      'The project is a React app rendered through react-native-web, so the SAME source runs full-width as a website AND inside a phone-sized device simulator, and stays portable to Expo for native iOS/Android. Import components (View, Text, Pressable, ScrollView, StyleSheet, FlatList) from "react-native" \u2014 never use HTML elements like div, span or button, and never use CSS files or className.',
      "Style with StyleSheet.create and flexbox, and make layouts RESPONSIVE: use flex, percentage widths and useWindowDimensions to adapt between a wide desktop viewport and a narrow phone one. Keep tap targets at least 44 points and respect safe areas \u2014 there is no hover on mobile.",
      FILE_DELIVERY_RULE
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
function withReadyPageModels(options, rows) {
  const ready = (rows ?? []).filter((row) => row.state === "ready");
  if (ready.length === 0) return options;
  return {
    ...options,
    local: [
      ...options.local ?? [],
      ...ready.map((row) => ({ id: row.ref, label: row.label, runtime: localRuntime(row.runtime).label }))
    ]
  };
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
    const local = parseLocalModelRef(model);
    if (local) {
      return item ? { name: item.label, detail: item.detail } : {
        name: localCatalogModel(model)?.label ?? local.model,
        detail: labels.localDetail.replace("{runtime}", localRuntime(local.provider).label)
      };
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
  const agentCount = d.agents?.length ?? 0;
  if (agentCount === 0) {
    out.push("\u2139\uFE0F No agents are invited into this chat (chats.list_agents is empty), so dispatched agents post nothing back here.");
  }
  const runs = d.runs;
  if (runs && agentCount > 0 && runs.linkedRunnableTickets > 0 && runs.runs.length === 0) {
    const names = (d.agents ?? []).map((a) => a.name?.trim() || a.agentRef).join(", ");
    out.push(
      `\u26A0\uFE0F ${agentCount} agent(s) are in this chat (${names}) and ZERO runs have ever been started against its ${runs.linkedRunnableTickets} runnable ticket(s). The work was filed and staffed on paper; nobody was dispatched. Anything that got done was done by this session itself. Start one with the \u25B6 control on a linked ticket, or ask in-chat for the agent to be dispatched.`
    );
  }
  if (runs && runs.runs.length > 0 && !runs.dispatchers.some((dsp) => dsp.startsWith("user:"))) {
    out.push(
      `\u2139\uFE0F Every run on this chat's tickets was started by ${runs.dispatchers.join(", ")} \u2014 none by a person pressing Run. This conversation has not dispatched anything itself.`
    );
  }
  const ran = runs?.runs ?? [];
  if (ran.length > 0) {
    const shellless = ran.filter((r) => executorHasShell(r.executor) === false);
    if (shellless.length === ran.length) {
      const why = d.account?.containerRuntime === false ? " This workspace's plan does not include the container surface, so every cloud run is routed there by design \u2014 upgrade, or run the work in the editor/on-prem where there IS a shell." : " The container surface was not used \u2014 either no agent here is set to it, or no container was live and the run was demoted. Check the agent's runtime surface.";
      out.push(
        `\u26A0\uFE0F All ${ran.length} run(s) on this chat executed on the DURABLE surface, which has no shell: none of them could build, type-check or test the code they wrote.${why}`
      );
    } else if (shellless.length > 0) {
      out.push(
        `\u2139\uFE0F ${shellless.length} of ${ran.length} run(s) executed on the shell-less durable surface and could not build or test their own output (runs ${shellless.slice(0, 5).map((r) => `#${r.executionId}`).join(", ")}).`
      );
    }
    const unknown = ran.filter((r) => r.executor == null && r.hostId == null);
    if (unknown.length === ran.length) {
      out.push(
        `\u2139\uFE0F No run on this chat recorded WHERE it executed. These predate the executor stamp, so "did it have a shell?" is unanswerable from here \u2014 read the runs' own tool audit.`
      );
    }
  }
  const hollow = (runs?.runs ?? []).filter((r) => r.produced === false && r.status === "completed");
  if (hollow.length > 0) {
    out.push(
      `\u26A0\uFE0F ${hollow.length} run(s) on this chat COMPLETED without producing anything \u2014 no commit, PR, merge or lane move (runs ${hollow.slice(0, 5).map((r) => `#${r.executionId}`).join(", ")}). A green run that shipped nothing is not progress; read those runs' output before dispatching the same work again.`
    );
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
var MAX_RUNS_LISTED = 10;
function dispatcherGloss(submittedBy) {
  if (submittedBy.startsWith("user:")) return "a human pressed Run";
  if (submittedBy.startsWith("system:lane-auto")) return "board autonomy, not this conversation";
  if (submittedBy.startsWith("system:coordinator")) return "the manager's coordination pass";
  if (submittedBy.startsWith("manager:")) return "the manager";
  if (submittedBy.includes("lane-approver")) return "a lane approver";
  return "unrecognised dispatcher";
}
function executorGloss(executor) {
  if (executor === "on-prem") return "on-prem machine (real shell, the machine's own clone)";
  if (executor === "container") return "container (real shell + local clone \u2014 can build, type-check and test)";
  if (executor === "durable") return "durable (serverless, NO shell \u2014 edits over the git API; cannot build or test)";
  if (executor === "github_actions") return "GitHub Actions (the repo's own runners)";
  return "executor not recorded";
}
function executorHasShell(executor) {
  if (executor === "durable") return false;
  if (executor === "container" || executor === "on-prem" || executor === "github_actions") return true;
  return null;
}
function shortTime(iso) {
  if (!iso) return "\u2014";
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}
function runHistoryLines(runs) {
  if (!runs) {
    return [`- Execution history: not gathered (this surface did not read the chat's runs \u2014 absent is NOT the same as "nothing ran")`];
  }
  if (runs.linkedRunnableTickets === 0) {
    return ["- Execution history: no runnable ticket (task/epic/gap) is linked to this chat, so there is nothing here that could have been run."];
  }
  if (runs.runs.length === 0) {
    return [
      `- Execution history: ZERO runs against ${runs.linkedRunnableTickets} linked runnable ticket(s). No cloud agent has ever been dispatched for this chat \u2014 any code that changed was changed by the session itself.`
    ];
  }
  const out = [];
  out.push(
    `- Execution history (${runs.runs.length} run(s) over ${runs.linkedRunnableTickets} linked runnable ticket(s), newest first) \xB7 started by: ${runs.dispatchers.map((dsp) => `${dsp} (${dispatcherGloss(dsp)})`).join(", ")}`
  );
  const executors = runs.executors ?? [];
  if (executors.length > 0) {
    out.push(`  - ran on: ${executors.map(executorGloss).join("; ")}`);
  }
  for (const run of runs.runs.slice(0, MAX_RUNS_LISTED)) {
    const who = run.agentName?.trim() || run.agentRef || "no agent recorded";
    const ticket = `#${run.taskId}${run.taskTitle ? ` "${run.taskTitle}"` : ""}`;
    const produced = run.produced === true ? " \xB7 produced output" : run.produced === false ? " \xB7 produced NOTHING" : "";
    const failed = run.errorMessage ? ` \xB7 ${run.errorMessage}` : "";
    const where = run.hostName ? ` \xB7 on on-prem "${run.hostName}"` : run.executor ? ` \xB7 on ${run.executor}` : " \xB7 on ? (executor not recorded)";
    out.push(
      `  - run #${run.executionId} \xB7 ${who} \xB7 ${ticket} \xB7 ${run.status}${produced}${where} \xB7 by ${run.submittedBy}${run.source ? ` via ${run.source}` : ""} \xB7 ${shortTime(run.createdAt)}${run.completedAt ? ` \u2192 ${shortTime(run.completedAt)}` : ""}${failed}`
    );
  }
  if (runs.runs.length > MAX_RUNS_LISTED) {
    out.push(`  - \u2026and ${runs.runs.length - MAX_RUNS_LISTED} earlier run(s) not listed.`);
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
  if (d.surface) lines.push(`- Surface: ${d.surface} (where this CONVERSATION runs; where each dispatched RUN ran is under Execution history)`);
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
      `- Plan: ${acct.plan ?? "unknown"} \xB7 billing ${acct.billingStatus ?? "none"}${acct.billingStatus === "none" || acct.billingStatus == null ? " (no payment method on file)" : ""}${acct.canUsePremiumModels != null ? ` \xB7 premium models ${acct.canUsePremiumModels ? "entitled" : "NOT entitled"}` : ""}${acct.containerRuntime != null ? ` \xB7 container runtime ${acct.containerRuntime ? "entitled (cloud runs get a real shell + clone)" : "NOT entitled (cloud runs are routed to the shell-less durable surface)"}` : ""}`
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
  lines.push(
    `- Agents in chat (${agents.length})` + (agents.length ? ": " + agents.map((a) => {
      const name = a.name?.trim();
      const kind = a.builtinKind ? `, built-in ${a.builtinKind}` : "";
      return name && name !== a.agentRef ? `${name} [${a.agentRef}] (${a.role}${kind})` : `${a.agentRef} (${a.role}${kind})`;
    }).join(", ") : "")
  );
  const tickets = d.tickets ?? [];
  if (tickets.length) {
    lines.push(`- Linked tickets (${tickets.length}):`);
    for (const tk of tickets) {
      lines.push(`  - ${tk.kind} #${tk.ref}${tk.label ? ` "${tk.label}"` : ""}${tk.linkType || tk.status ? ` [${[tk.linkType, tk.status].filter(Boolean).join(", ")}]` : ""}`);
    }
  } else {
    lines.push("- Linked tickets (0)");
  }
  lines.push(...runHistoryLines(d.runs));
  const signals = diagnosticsSignals(d);
  if (signals.length) {
    lines.push("", "### Signals");
    for (const s of signals) lines.push(`- ${s}`);
  }
  return lines;
}

// src/subagentDiagnostics.ts
var EXCERPT_CHARS = 280;
var MAX_FAILURES = 3;
var excerpt = (v) => {
  const text = (typeof v === "string" ? v : JSON.stringify(v ?? "")).replace(/\s+/g, " ").trim();
  return text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}\u2026` : text;
};
function stateOf(c) {
  if (c.running) return "running";
  if (c.error) return "failed";
  return c.lastMessage?.trim() ? "done" : "ended without a report";
}
function spanOf(events) {
  const times = events.map((e) => Date.parse(e.ts)).filter(Number.isFinite);
  if (times.length < 2) return "";
  const s = Math.round((Math.max(...times) - Math.min(...times)) / 1e3);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
function formatSubagentDiagnostics(children, capturedAtMs) {
  if (children.length === 0) return [];
  const running = children.filter((c) => c.running).length;
  const lines = [`--- Sub-agents (${children.length}${running ? ` \xB7 ${running} running` : ""}) ---`];
  for (const c of children) {
    const tools = c.events.filter((e) => e.category === "tool");
    const failures = tools.filter((e) => e.isError || isFailedToolResult(e.result));
    const files = /* @__PURE__ */ new Set();
    for (const e of tools) for (const f of codeChangesOf(e.label, e.args, e.result) ?? []) files.add(f);
    const models = modelsUsedInTrace(c.events);
    const span = spanOf(c.events);
    lines.push(
      `\u2022 ${c.handle} ${c.name} \u2014 "${c.label}" \xB7 sub-agent of ${c.owner}${c.depth > 1 ? ` (depth ${c.depth})` : ""}${c.ticket ? ` \xB7 ticket ${c.ticket}` : ""}`
    );
    lines.push(
      `  State: ${stateOf(c)} \xB7 Turns: ${c.events.filter((e) => e.category === "llm").length} \xB7 Tool calls: ${tools.length} \xB7 Failed: ${failures.length}${span ? ` \xB7 ${span}` : ""}`
    );
    if (models.length) lines.push(`  Models: ${models.join(", ")}`);
    if (c.running && c.activity) lines.push(`  Now: ${describeLiveStep(c.activity, capturedAtMs)}`);
    if (files.size) lines.push(`  Changed: ${[...files].join(", ")}`);
    for (const f of failures.slice(0, MAX_FAILURES)) lines.push(`  Failed step: ${f.label} \u2014 ${excerpt(f.result)}`);
    if (failures.length > MAX_FAILURES) lines.push(`  \u2026and ${failures.length - MAX_FAILURES} more failed step(s)`);
    if (c.error) lines.push(`  Error: ${excerpt(c.error)}`);
    if (c.lastMessage?.trim()) lines.push(`  ${c.running ? "Last message" : "Report"}: ${excerpt(c.lastMessage)}`);
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
  const [projectName, agents, tickets, runs, head, plan, apiVersion] = await Promise.all([
    safely(src.readProjectName, null),
    safely(src.readAgents, []),
    safely(src.readTickets, []),
    safely(src.readRuns, null),
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
    // Spread-if-present, like every other optional above: an API that sends no feature
    // set leaves the key ABSENT, and the report omits the line rather than claiming the
    // workspace is not entitled. "Unknown" and "no" are different findings.
    ...plan?.features?.entitled?.containerRuntime != null ? { containerRuntime: plan.features.entitled.containerRuntime } : {},
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
    agents: agents.map((a) => ({
      agentRef: a.agentRef,
      role: a.role,
      ...a.name ? { name: a.name } : {},
      ...a.builtinKind != null ? { builtinKind: a.builtinKind } : {}
    })),
    runs,
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

// src/gatewayModels.ts
function gatewayPlanIsPaid(surface) {
  return surface.premium === true || (surface.effectivePlan ?? "free") !== "free";
}
function gatewayCanChooseModel(surface) {
  if (typeof surface.canChooseModel === "boolean") return surface.canChooseModel;
  return gatewayPlanIsPaid(surface) || surface.canUseFrontierModels === true || surface.canUsePremiumModels === true || (surface.byo?.providers?.length ?? 0) > 0 || (surface.byo?.models?.length ?? 0) > 0;
}
function gatewayModelIdentity(surface) {
  return { product: productForPlan(gatewayPlanIsPaid(surface)), canChoose: gatewayCanChooseModel(surface) };
}
function gatewayPlanModels(surface) {
  if (surface.models) return surface.models.filter((id) => typeof id === "string" && !!id);
  return (surface.data ?? []).map((row) => row.model ?? row.id).filter((id) => !!id);
}
function gatewayModelWindows(surface) {
  const windows = /* @__PURE__ */ new Map();
  for (const m of surface?.byo?.models ?? []) {
    if (m.id && typeof m.contextWindow === "number" && m.contextWindow > 0) windows.set(m.id, m.contextWindow);
  }
  return (ref) => windows.get(ref);
}
var EMPTY_GATEWAY_MODEL_OPTIONS = {
  surface: {},
  options: { byo: [], free: [], plan: [], paid: [] },
  identity: { product: "free", canChoose: false }
};
var cache;
function invalidateGatewayModelOptions() {
  cache = void 0;
}
function loadGatewayModelOptions(request, cacheKey, labels) {
  if (cache?.key === cacheKey) return cache.value;
  const value = fetchGatewayModelOptions(request, labels).catch(() => {
    cache = void 0;
    return EMPTY_GATEWAY_MODEL_OPTIONS;
  });
  cache = { key: cacheKey, value };
  return value;
}
async function fetchGatewayModelOptions(request, labels) {
  const raw = await request("/llm/v1/models");
  const plan = gatewayPlanModels(raw);
  const byo = (raw.byo?.models ?? []).filter((m) => typeof m?.id === "string").map((m) => ({ id: m.id, vendor: m.vendor ?? "" }));
  const [configured, paid] = await Promise.all([
    request("/api/llm/models").then((r) => (r.models ?? []).filter((m) => typeof m?.ref === "string" && !!m.ref).map((m) => ({ id: m.ref, label: m.name?.trim() || m.ref }))).catch(() => []),
    raw.canUsePremiumModels === true ? premiumCatalog(request, labels.paidCostDetail).catch(() => []) : Promise.resolve([])
  ]);
  return {
    surface: { ...raw, data: plan.map((id) => ({ id })) },
    options: { configured, byo, free: raw.freeModels ?? [], plan, paid },
    identity: gatewayModelIdentity(raw)
  };
}
async function premiumCatalog(request, costTemplate) {
  const json = await request("/llm/v1/catalog");
  return (json.data ?? []).filter((m) => !!m.id && !m.pool && ((m.pricing?.prompt ?? 0) > 0 || (m.pricing?.completion ?? 0) > 0) && (m.supportedParameters?.includes("tools") ?? false)).sort((a, b) => (a.pricing?.prompt ?? 0) + (a.pricing?.completion ?? 0) - ((b.pricing?.prompt ?? 0) + (b.pricing?.completion ?? 0))).map((m) => ({
    id: m.id,
    cost: premiumCostLabel({ prompt: m.pricing?.prompt ?? 0, completion: m.pricing?.completion ?? 0 }, costTemplate)
  }));
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

// src/workspaceRoles.ts
var MANAGER_ROLES = /* @__PURE__ */ new Set(["owner", "admin", "manager"]);
function isManagerRole(role) {
  return typeof role === "string" && MANAGER_ROLES.has(role.toLowerCase());
}

// src/ui/PromptInput.tsx
var import_react8 = require("react");
var import_jsx_runtime4 = require("react/jsx-runtime");
var boxStyle = (active) => ({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-end",
  gap: 8,
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 6px 6px 12px",
  borderRadius: 18,
  border: "none",
  background: "var(--chat-input-bg, var(--bg-elevated, #f3f4f6))",
  boxShadow: active ? "0 0 0 2px var(--accent, #2563eb)" : "none",
  transition: "box-shadow 120ms ease"
});
var fieldRowStyle = { display: "flex", alignItems: "flex-end", gap: 8, flex: "1 1 180px", minWidth: 0 };
var fieldStyle = {
  flex: "1 1 auto",
  minWidth: 0,
  minHeight: 36,
  boxSizing: "border-box",
  background: "transparent",
  color: "var(--text-primary, #111)",
  fontSize: "0.875rem",
  fontFamily: "inherit",
  lineHeight: 1.4,
  padding: "8px 0",
  border: "none",
  outline: "none",
  resize: "none"
};
var roundButtonStyle = (enabled) => ({
  flex: "0 0 auto",
  width: 36,
  height: 36,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  borderRadius: "50%",
  background: enabled ? "var(--accent, #2563eb)" : "var(--surface-interactive, rgba(128, 128, 128, 0.18))",
  color: enabled ? "var(--text-on-accent, #fff)" : "var(--text-muted, #6b7280)",
  cursor: enabled ? "pointer" : "not-allowed"
});
var ArrowUpGlyph = () => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("path", { d: "M12 19V5M5 12l7-7 7 7" }) });
var StopGlyph = () => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("svg", { width: "12", height: "12", viewBox: "0 0 12 12", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("rect", { width: "12", height: "12", rx: "2", fill: "currentColor" }) });
function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  submitLabel,
  ariaLabel,
  disabled = false,
  busy = false,
  onStop,
  stopLabel,
  leading,
  secondaryContent,
  rows = 1,
  className,
  submitOnEnter = true
}) {
  const [focused, setFocused] = (0, import_react8.useState)(false);
  const empty = value.trim().length === 0;
  const canSubmit = !empty && !disabled && !busy;
  const showStop = busy && empty && !!onStop && !!stopLabel;
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
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: boxStyle(focused || !empty), onFocus: () => setFocused(true), onBlur: () => setFocused(false), children: [
      leading,
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: fieldRowStyle, children: [
        rows <= 1 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "text", ...shared }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("textarea", { rows, ...shared }),
        showStop ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", onClick: onStop, "aria-label": stopLabel, title: stopLabel, style: roundButtonStyle(true), children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(StopGlyph, {}) }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "submit", disabled: !canSubmit, "aria-label": submitLabel, title: submitLabel, "aria-busy": busy || void 0, style: roundButtonStyle(canSubmit), children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ArrowUpGlyph, {}) })
      ] })
    ] }),
    secondaryContent && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { fontSize: "0.75rem", color: "var(--text-muted, #666)" }, children: secondaryContent })
  ] });
}

// ../packages/spend-contract/src/index.ts
var USAGE_SURFACES = ["web", "vsix", "on_prem", "cloud", "sdk", "rovr"];
function isUsageSurface(raw) {
  return typeof raw === "string" && USAGE_SURFACES.includes(raw);
}
var USAGE_SURFACE_HEADER = "x-builderforce-surface";

// src/usageSurface.ts
function withUsageSurface(fetchImpl, surface) {
  return (input, init) => fetchImpl(input, {
    ...init,
    headers: { ...init.headers ?? {}, [USAGE_SURFACE_HEADER]: surface }
  });
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
  BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS,
  BROWSER_ENGINE_MODEL,
  BUILDERFORCE_PRODUCT_NAME,
  BrainActionsProvider,
  BrainContextProvider,
  BrainProvider,
  BrainRequestError,
  CHAT_DIAGNOSTICS_SCHEMA_VERSION,
  CHAT_MODES,
  CHAT_MODE_ICON,
  CODE_CHANGE_TOOLS,
  CONNECT_RETRY_DELAYS_MS,
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
  EMPTY_GATEWAY_MODEL_OPTIONS,
  FAILURE_HARD_AT,
  FAILURE_NUDGE_AT,
  FILE_DELIVERY_RULE,
  FailureTally,
  HAND_OFF_TOOL,
  HAND_OFF_TOOL_SPEC,
  HISTORY_TOKEN_BUDGET,
  LOCAL_WORKSPACE_TOOLS,
  MAX_STOP_HOOK_ROUNDS,
  MAX_TOOL_RESULT_CHARS,
  MODALITY_PERSONAS,
  MODEL_CATEGORIES,
  NEW_CHAT_MODE,
  NOT_SIGNED_IN,
  NOT_STARTED_TASK_STATUSES,
  ON_DEVICE_ANSWER_THRESHOLD,
  PERSONA_MODALITY_IDS,
  PMO_FOCUS_PARAM,
  PREVIEW_REVIEW_TOOL,
  PROJECT_EVERMIND_MODEL_PREFIX,
  PROVENANCE_META_KEY,
  PageEngineError,
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
  STUDIO_WORKSPACE_TOOLS,
  SUBAGENT_OF_META_KEY,
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
  USAGE_SURFACES,
  USAGE_SURFACE_HEADER,
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
  appendRunMessage,
  applyRemoteRun,
  artifactRoutePath,
  asProvenanceAccount,
  askStopHook,
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
  canReviewInPreview,
  canRunInParallel,
  canShipHere,
  catalogToolNamesMentionedIn,
  chatActivityText,
  chatConversationDirective,
  chatErrorAction,
  chatModeDirective,
  chatRosterFromParticipants,
  chatWorkDirective,
  chatWorkLinkingDirective,
  childTaskBrief,
  claimsMissingToolData,
  classifyModelFunding,
  clearRunError,
  codeChangeFile,
  codeChangesOf,
  coerceAskUserPayload,
  completeLocal,
  completeLocalFirst,
  composeEvermindHooks,
  computeBrainDiagnostics,
  computeRunProgress,
  consolidationMarkerContent,
  consolidationMetadata,
  contextWindowOf,
  countReconciledMemories,
  createBrainRestPersistence,
  createBrowserEngineProber,
  createComposingActivity,
  createHandoffFit,
  createHostModelStream,
  createLocalFirstStream,
  createLocalStream,
  createPageEngineSet,
  createPayloadBudget,
  declinesReview,
  declinesShipping,
  deferredLocalModelStore,
  deriveChatTitle,
  describeLiveStep,
  describeNetworkError,
  describeTool,
  detectAnnouncedButUnmadeToolCall,
  detectUnbackedTicketClaim,
  detectUnbackedWriteClaim,
  directedAgentRecipients,
  dirtyPathsOf,
  displayModelName,
  drainRunSteering,
  effortProfile,
  executeHandOff,
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
  formatSubagentDiagnostics,
  gatewayCanChooseModel,
  gatewayModelIdentity,
  gatewayModelWindows,
  gatewayPlanIsPaid,
  gatewayPlanModels,
  gatherChatDiagnostics,
  getGlobalRunState,
  getLastResolvedModel,
  getMcpToolStatus,
  getRunDriver,
  getRunSnapshot,
  getRunTrace,
  handleRouterCall,
  hasEditIntent,
  hasPromptApi,
  hasWebGPU,
  installIndexedDbStepDurability,
  installRunDriver,
  installStepDurability,
  invalidateGatewayModelOptions,
  isActivityMessage,
  isChatMode,
  isCodeChangeTool,
  isCoderReask,
  isConnectFailure,
  isConnectedAccountUnused,
  isConsolidationMarker,
  isDirectedToParticipant,
  isDispatchTool,
  isEffort,
  isEvermindModel,
  isFailedToolResult,
  isLocalWorkspaceTool,
  isMalformedToolCall,
  isManagerRole,
  isMutationTool,
  isReadOnlyShellCall,
  isRepoPublishTool,
  isRouterTool,
  isRunning,
  isStepMessage,
  isStoppedTurn,
  isTicketRecordingTool,
  isTicketWriteTool,
  isTruncatedTurn,
  isUnscopedMutationTool,
  isUsageSurface,
  isUserConfiguredModelRef,
  lastConsolidationIndex,
  lastServedModel,
  leftChangeUnreviewed,
  leftChangeUnshipped,
  linkedTicketsToAdvance,
  linkedTicketsToComplete,
  loadAgentPoolVia,
  loadBrainPersonaAgentsVia,
  loadGatewayModelOptions,
  localFallbackTrace,
  localFirstApplies,
  localFirstWorkload,
  localStorageConfirmationPersistence,
  localToolsIn,
  localTransport,
  mcpActionsFrom,
  mentionRecipient,
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
  packForModel,
  pageEnginesFetch,
  pageRuntimePin,
  parseAskUser,
  parseByoUnresolved,
  parseChatActivity,
  parseDirectedRecipients,
  parseGitShortStatus,
  parseHandOff,
  parseMessageAuthor,
  parseMessageProvenance,
  parsePmoFocus,
  parseStepMessage,
  parseSubagentOrigin,
  perMillionUsd,
  personaAgentOf,
  personaModalityOf,
  personaModel,
  personaOverlay,
  personaSystemPrompt,
  placeholderAdvisory,
  placeholdersWritten,
  planMessage,
  pmoFocusDomId,
  pmoFocusValue,
  poolAgentsFrom,
  premiumCostLabel,
  prepareImageDataUrl,
  previewReviewDirective,
  probePageEngines,
  productForPlan,
  productModelName,
  progressDuration,
  projectMemoryHooks,
  promptApiAvailability,
  promptApiFactory,
  promptApiInputQuota,
  promptApiMeasure,
  promptStreamDeltas,
  providerFailureEvent,
  providerFailureTrace,
  queueRunSteering,
  ratedTurnContext,
  ratedTurnTool,
  readWithIdleWatchdog,
  reasoningForRun,
  repeatedFailureAdvisory,
  resetApiVersionCache,
  resetBrainRunStore,
  resolveBrainStream,
  resolveContextWindow,
  resolveRecipient,
  resolveRunConfirm,
  retryOnConnectFailure,
  revealsModelId,
  revisitAdvisory,
  routerToolSpecs,
  routingQueryForTurn,
  runAbortSignal,
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
  stepRow,
  stepSig,
  stopRun,
  stoppedTurnMetadata,
  streamChatCompletion,
  stripAskUser,
  studioToolsIn,
  subscribeRun,
  subscribeRunStore,
  subscribeToChatMessages,
  summarizeLocalFirstAttempt,
  takePendingPrompt,
  ticketsReviewedInPreview,
  toPromptApiTurn,
  toolActivity,
  toolCallArgBytes,
  toolExposureInTrace,
  toolNamesMentionedIn,
  toolSchemaTokens,
  toolSpecsFor,
  traceWithPersistedSteps,
  transcriptSeedFrom,
  transportRetryTrace,
  trimToolResult,
  turnInterruption,
  turnOptimizationDirective,
  unreviewedChangeNudge,
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
  withReadyPageModels,
  withUsageSurface,
  workFiledNotStaffedVerdict,
  workItemLinkFromCreate
});
//# sourceMappingURL=index.cjs.map