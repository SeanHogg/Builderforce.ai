/**
 * @seanhogg/builderforce-brain-embedded
 *
 * Embeddable AI assistant ("Brain") for React — a headless, tool-capable
 * streaming chat core with an MCP-style action registry.
 *
 * Mount one <BrainProvider config={...}> high in your tree (inject auth,
 * persistence, and a system-prompt resolver), wrap pages in
 * <BrainActionsProvider>/<BrainContextProvider>, register tools the assistant
 * can call with useRegisterBrainActions, and drive the conversation with
 * useBrainChats + useBrainConversation. Render the UI however you like.
 */

// Injection seam
export { BrainProvider, useBrainConfig } from './config';
export type { BrainConfig, BrainRuntime, BrainPersistenceAdapter } from './config';

// Streaming client + tool/message types
export { streamChatCompletion } from './streamChatCompletion';
export type {
  BrainTransport,
  BrainToolSpec,
  ChatCompletionMessage,
  ContentPart,
  TextContentPart,
  ImageUrlContentPart,
  StreamHandlers,
  StreamChatOptions,
  StreamChatResult,
  CompletionMetadata,
  AssembledToolCall,
} from './streamChatCompletion';

// ONE reading of `finish_reason`: a turn cut off by the output ceiling, or one whose
// tool call the provider could not parse, is an INTERRUPTED action — not a spoken
// answer — and every consumer that judges a turn must agree on that.
export { turnInterruption, isTruncatedTurn, isMalformedToolCall } from './finishReason';
export type { TurnInterruption } from './finishReason';

// Actionable chat errors: the gateway's structured entitlement fields survive the
// fetch boundary, and ONE classifier turns any failure into the fix a user can take
// (reconnect / upgrade / add a card). Consumed by the run store AND the banner UI.
export { BrainRequestError, brainRequestError, chatErrorAction } from './chatError';
export type { ChatErrorAction, ChatErrorActionKind } from './chatError';

// Composer Effort → real request params (max_tokens + vendor-neutral reasoning
// intent) + the level's prose nudge. The ONE effort table: hosts render their
// menu from it and the request builder consumes it, so they cannot drift.
export { effortProfile, isEffort, reasoningForRun } from './effort';
export type { Effort, EffortProfile, ReasoningLevel, ReasoningIntent } from './effort';

// Client-side image prep for vision messages (downscale → inline data URL)
export { prepareImageDataUrl } from './imagePrep';
export type { PreparedImage } from './imagePrep';

// Project-Evermind memory hooks for the run loop (recall → learn → reconcile).
export {
  formatEvermindMemoryBlock,
  countReconciledMemories,
  EVERMIND_LEARN_MIN_CHARS,
} from './evermindMemory';
export type {
  EvermindRunHooks,
  EvermindRecallResult,
  EvermindRecallItem,
} from './evermindMemory';

// MCP-style client action registry (the extension contract)
export {
  BrainActionsProvider,
  useBrainActions,
  useRegisterBrainActions,
} from './BrainActionsContext';
export type { BrainAction, BrainActionsContextValue } from './BrainActionsContext';

// Bridge server-side (tenant-registered) MCP extensions into the client loop.
export { useMcpExtensions } from './useMcpExtensions';
export type { UseMcpExtensionsOptions, McpToolResultInfo } from './useMcpExtensions';
// …and the React-free half, so a headless runner (the VS Code probe / scenario
// harness) builds the SAME tool list the hook does instead of a second copy.
export { fetchMcpToolEntries, mcpActionsFrom } from './mcpCatalog';
export type { McpToolEntry } from './mcpCatalog';
// Action → advertised tool spec. The single mapping, so a headless runner shows the
// model exactly what the React registry would.
export { toolSpecsFor } from './toolSpecs';
// The inline tool-call dialect filter the streaming client runs over every content
// delta. Exported so a harness standing in for the gateway applies the SAME lifting,
// rather than testing a transport that is kinder than the real one.
export { XmlToolCallFilter, extractXmlToolCalls } from './xmlToolCalls';
export type { ParsedXmlToolCall } from './xmlToolCalls';

// Ambient page context
export {
  BrainContextProvider,
  useBrainContext,
  useOptionalBrainContext,
} from './BrainContext';
export type { BrainContextValue, BrainPageContext } from './BrainContext';

// Conversation + chat-list hooks
export { useBrainChats, deriveChatTitle, DEFAULT_CHAT_TITLE } from './useBrainChats';
export type { UseBrainChats, UseBrainChatsOptions } from './useBrainChats';
export { useBrainConversation } from './useBrainConversation';
export { subscribeToChatMessages } from './chatMessageSubscription';
export type { UseBrainConversation, UseBrainConversationOptions } from './useBrainConversation';

// Cross-chat run indicators — which chats are executing / awaiting a confirm RIGHT
// NOW (the module-level agent loop keeps running across chat switches, so a host
// can light up the still-live conversations in a session list / dropdown).
export { subscribeRunStore, getGlobalRunState } from './brainRunStore';
export type { GlobalRunState } from './brainRunStore';

// Framework-free run-loop entry + observation — a non-React host (e.g. the native
// VS Code chat participant) drives a run with `runBrainLoop`/`startRun` and observes
// it via `subscribeRun` + `getRunSnapshot`/`getRunTrace`, the same store the React
// `useBrainConversation` hook reads, without pulling in React.
export {
  startRun,
  runBrainLoop,
  stopRun,
  isRunning,
  subscribeRun,
  getRunSnapshot,
  getRunTrace,
  clearRunError,
  resolveRunConfirm,
  // Teardown only — a headless harness reuses one chat id across scenarios, and the
  // store is a module-level singleton keyed by it.
  resetBrainRunStore,
} from './brainRunStore';
export type { BrainRunRequest, BrainRunSnapshot } from './brainRunStore';

// Execution triage — capture the Brain run (LLM/tool/error trace) as a report.
export {
  buildBrainTriageReport,
  detectUnbackedWriteClaim,
  detectUnbackedTicketClaim,
  detectAnnouncedButUnmadeToolCall,
  isFailedToolResult,
  isEvermindModel,
  modelsUsedInTrace,
  accountUsedInTrace,
  byoUnresolvedInTrace,
  parseByoUnresolved,
  byoReasonHint,
  byoUnresolvedSummary,
  formatBrainProvenance,
  computeBrainDiagnostics,
  formatBrainDiagnostics,
  stallRecoveriesInTrace,
  modelFailoversInTrace,
  stallUnrecoveredInTrace,
  toolExposureInTrace,
  narratedUnadvertisedInTrace,
} from './brainTriage';
export type { BrainTraceEvent, BuildBrainTriageOptions, BrainDiagnostics, ByoUnresolvedEntry, ToolExposure } from './brainTriage';

// Durable tool/memory STEP rows — the reader for what the run loop persisted, so a
// reopened chat's timeline AND its triage diagnostics both see the steps the live
// in-memory trace no longer holds.
export { stepSig, parseStepMessage, traceWithPersistedSteps } from './persistedSteps';
export type { PersistedStep } from './persistedSteps';

// Deployed API version (session-cached) — the "which build produced this capture?"
// half of the diagnostics version stamp. Each surface supplies its own /health read.
export { fetchApiVersionVia, resetApiVersionCache, API_VERSION_TTL_MS, API_VERSION_PROBE_TIMEOUT_MS } from './apiVersion';

// The untaken-tool-call contract, re-exported from `@builderforce/agent-stall` so a
// React host reaches it through the package it already depends on.
//
// `nextFallbackModel` — which model to try NEXT when the current one won't emit tool
// calls — used to be defined HERE, which put it out of reach of the server-side reply
// loop; that loop then hand-rolled the decision and shipped a failover branch that
// could never run. It now lives beside the recovery budget it serves.
//
// The DETECTORS come with it: a surface that DIAGNOSES a stalled reply (the manager
// chat diagnostics report) must recognise a stall by exactly the predicate the loop
// recovers on, or the report describes a different bug than the one the loop saw.
export {
  nextFallbackModel,
  claimsMissingToolData,
  announcesUntakenAction,
  toolNamesMentionedIn,
  catalogToolNamesMentionedIn,
} from '@builderforce/agent-stall';
export type { ModelFallbackSurface } from '@builderforce/agent-stall';

// Chat ⇄ work linking — the directive that ties identified work / code changes to
// the current chat, plus the predicates behind the "a code change is always tied to
// a ticket" backstop (reused by non-React hosts driving the run loop directly).
export {
  chatWorkLinkingDirective,
  isCodeChangeTool,
  isTicketRecordingTool,
  codeChangeFile,
  workItemLinkFromCreate,
  linkedTicketsToAdvance,
  CODE_CHANGE_TOOLS,
  TICKET_RECORDING_TOOLS,
  NOT_STARTED_TASK_STATUSES,
} from './chatWorkLinking';
export type { CreatedWorkItemLink, LinkedTicketToAdvance } from './chatWorkLinking';

// Chat MODE — conversation (`chat`) vs execution (`work`). The single source for what
// a mode MEANS to the model, shared by the web Brain, the VS Code webview and the
// shared agent loop (migration 0409).
export {
  CHAT_MODES,
  NEW_CHAT_MODE,
  RESTING_CHAT_MODE,
  isChatMode,
  normalizeChatMode,
  chatModeDirective,
  chatConversationDirective,
  chatWorkDirective,
} from './chatMode';
export type { ChatMode } from './chatMode';

// Landing-page → auth → replay handoff
export { savePendingPrompt, takePendingPrompt } from './pendingPrompt';

// Chat consolidation markers (compress a long chat into a summary base context)
export {
  CONSOLIDATION_META,
  CONSOLIDATION_MARKER_PREFIX,
  consolidationMetadata,
  consolidationMarkerContent,
  isConsolidationMarker,
  lastConsolidationIndex,
  scopeToConsolidation,
} from './consolidation';

// Directed messages (address a chat turn to a participant instead of the BRAIN)
export {
  ADDRESSED_TO_META_KEY,
  AUTHORED_BY_META_KEY,
  withDirectedMetadata,
  parseDirectedRecipient,
  parseMessageAuthor,
  isDirectedToParticipant,
  mentionRecipient,
  resolveRecipient,
  activeMentionToken,
  filterMentionCandidates,
} from './directedMessage';
export type { DirectedRecipient, RecipientChoice, MentionToken } from './directedMessage';

// Per-reply model/account provenance (the "which LLM / whose account" chip)
export {
  PROVENANCE_META_KEY,
  parseMessageProvenance,
  withProvenanceMetadata,
  isConnectedAccountUnused,
} from './provenance';
export type { MessageProvenance, ProvenanceAccount } from './provenance';

// WHICH model name a viewer is allowed to see — the routed product ("Builderforce
// Free" / "Builderforce PRO") vs the upstream id. One rule for every surface.
export {
  BUILDERFORCE_PRODUCT_NAME,
  DEFAULT_MODEL_IDENTITY,
  displayModelName,
  isUserConfiguredModelRef,
  productForPlan,
  productModelName,
  revealsModelId,
} from './modelIdentity';
export type { ModelIdentityContext, RoutedProduct } from './modelIdentity';

// What a thumbs press is ABOUT: the model that served the turn + the MCP tool it ran.
export { ratedTurnContext, ratedTurnTool } from './turnRating';
export type { RatableMessage, RatedTurnContext } from './turnRating';

// The model the last completion actually resolved to — what `builtin_session_current_model`
// is answered with, and what a host can show as "running on X".
export { getLastResolvedModel, setLastResolvedModel } from './lastResolvedModel';

// Shared data shapes
export type { BrainChat, BrainMessage, BrainModality, ChatInputAttachment, EvermindLearnOutcome, EvermindLearnTarget } from './types';
export { routingQueryForTurn, turnOptimizationDirective } from './turnOptimization';
export { STEP_MESSAGE_ROLE, isStepMessage, attachEvermindLearn, formatEvermindLearnStep } from './types';

// "Copy diagnostics" — pure serializer for the chat's identity + Evermind wiring state
export { formatChatDiagnostics, classifyModelFunding, allowanceState } from './chatDiagnostics';
export { gatherChatDiagnostics } from './gatherChatDiagnostics';

// Model choice — WHICH models a surface offers, in what order, and who pays. Shared
// by the composer `/` menu (web + webview) AND the VS Code host's QuickPick, which
// runs in Node and cannot import the React UI package.
export {
  buildModelItems,
  filterModelItems,
  activeModelKey,
  modelCategoryLabel,
  modelInUse,
  perMillionUsd,
  premiumCostLabel,
  byoVendorLabel,
  MODEL_CATEGORIES,
  DEFAULT_MODEL_CHOICE_LABELS,
  PROJECT_EVERMIND_MODEL_PREFIX,
} from './modelChoice';
export type {
  ChatModelOptions,
  ChatModelSelection,
  ModelCategory,
  ModelChoiceLabels,
  ModelItem,
} from './modelChoice';
export { getMcpToolStatus, setMcpToolStatus, type McpToolStatus } from './mcpToolStatus';
export { selectToolsForTurn, DEFAULT_TOOL_LIMIT, type ToolSelection } from './selectTools';
// The tool ROUTER — three fixed tools that keep the whole catalog reachable even when
// per-turn selection trims it, so a tool below the cut is a lookup away, not missing.
export {
  routerToolSpecs,
  isRouterTool,
  handleRouterCall,
  findTools,
  describeTool,
  TOOL_ROUTER_FIND,
  TOOL_ROUTER_DESCRIBE,
  TOOL_ROUTER_INVOKE,
  type ToolCatalogMatch,
} from './toolRouter';
export type { ChatDiagnosticsData, ChatDiagnosticsEvermind, ChatDiagnosticsAccount, ChatDiagnosticsMeter, AllowanceState } from './chatDiagnostics';
export type { ChatDiagnosticsSources, ChatDiagnosticsPlanSnapshot, ChatDiagnosticsModelSurface, ChatDiagnosticsEvermindHead, ChatDiagnosticsMessageLike } from './gatherChatDiagnostics';
