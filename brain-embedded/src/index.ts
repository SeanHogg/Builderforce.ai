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
export { BrainProvider, resolveBrainStream, useBrainConfig } from './config';
export type { BrainConfig, BrainRuntime, BrainPersistenceAdapter, InlinedAttachments } from './config';
export { createLocalBrainPersistence, type LocalBrainPersistenceOptions } from './localFirstPersistence';
// PRD 36 — a local chat's identity off the machine, its run usage ledger, and its sync.
export { createLocalChatIdentity, type ChatBindingPort, type LocalChatIdentity } from './localChat/chatIdentity';
export { createRunUsageLedger, withRunUsage, type RunUsageLedger } from './localChat/usageLedger';
export type { RecordAvoidedCallInput, RunOutcomeValue } from './localChat/gateLedger';
// The pipeline route report (WS-R): the device ledger's routed runs, priced with the one
// device cost rule, and the pure report math they feed (`@builderforce/pipeline-route`).
export { gateAcceptedSince, routeRunRecords, runOutcomesSince, summarizeGateRuns, usageRowsSince, type GateReport, type GateRouteStats } from './localChat/routeLedger';
export { callCostMillicents } from './localChat/callCost';
export type { RunUsageValue, UsagePipelineRoute } from './localChat/usageLedger';
export type { RunEndOutcome } from './runStore/runTypes';
export { DEFAULT_ROUTE_THRESHOLD, summarizeRouteRuns } from '@builderforce/pipeline-route';
// A PreFetch WRITE action's confirm, as the run's pending confirm carries it — the
// surfaces render it as the confirm chip (brain-ui `PrefetchConfirmChip`) through this.
export { prefetchConfirmOf, type PrefetchConfirm, type PrefetchResult } from '@builderforce/prefetch';
export type { RouteReport, RouteRunRecord, ScoreBin } from '@builderforce/pipeline-route';
export { bindChatHistoryForSync } from './localChat/chatSync';

// Streaming client + tool/message types
// RepetitionLoopError: a model stuck repeating one block of prose, cut mid-stream.
export { streamChatCompletion, StreamInterruptedError, RepetitionLoopError, TransportError } from './streamChatCompletion';
// THE classification of a failed completion for the run policy, and the timeline step a
// policy retry records — one of each for every browser agent loop.
export { providerFailureEvent } from './providerFailure';
export type { ProviderFailureEvent } from './providerFailure';
export { providerFailureTrace, transportRetryTrace } from './runPolicyTraces';
// The reason behind Node's opaque `fetch failed` / `terminated`, read off the `cause` chain.
export { describeNetworkError, isConnectFailure, retryOnConnectFailure, CONNECT_RETRY_DELAYS_MS } from './networkErrorDetail';
export type { ConnectRetryOptions } from './networkErrorDetail';
// Local first, failover to the cloud: the shared streamer bound to a runtime on the
// user's machine (`@builderforce/local-inference`), for every client that runs the loop
// there (the VS Code extension host, the Chrome extension).
export {
  completeLocal,
  completeLocalFirst,
  createLocalFirstStream,
  createLocalStream,
  localFirstApplies,
  localFirstWorkload,
  localTransport,
} from './localFirstTransport';
export type { LocalAttemptFit, LocalChatMessage, LocalFetch, LocalFirstStreamInput, LocalStreamRoute } from './localFirstTransport';
// The ONE host routing step over those two streams — pin, gateway pin, or local first —
// that the web app, Rovr and the editor each supply only their pin, probes and cloud to.
export { createHostModelStream } from './hostModelStream';
export { isFallbackFailure } from './hostModelStream';
export { inferenceModeForModelPick } from './inferenceModeForModelPick';
export { createModelFallbackChannel, modelFallbackText, DEFAULT_MODEL_FALLBACK_TEMPLATE } from './modelFallback';
export type { ModelFallbackChannel } from './modelFallback';
export type { HostLocalPin, HostModelStreamInput, ModelFallbackEvent } from './hostModelStream';
// Hybrid's `run.local-success` predictor (the engine's ML task catalog): the ONE store port
// a host lends `createHostModelStream({ localSuccess })`, and the Web Storage adapter.
export { webStorageLocalSuccessStore, LOCAL_SKIP_CONFIDENCE, LOCAL_SKIP_EXPLORE } from './localSuccess/localSuccessRouter';
export type { LocalSuccessStore, LocalSuccessSnapshot } from './localSuccess/localSuccessRouter';
// Its head federates with the project's fleet through ONE port a host builds from its
// authed transport (`createLocalSuccessFederation`) and lends `createHostModelStream({ localSuccessFederation })`.
export { createLocalSuccessFederation } from './localSuccess/localSuccessFederation';
// E5: a host's explicit thumbs-up / thumbs-down on a chat's latest local reply — the
// `rating` verdict for the deferred local-success label (lever `e5_verified_local_label`).
export { submitLocalTurnVerdict } from './localSuccess/verifiedLocalLabel';
export type { LocalSuccessFederation, LocalSuccessFleetHead, LocalSuccessContribution } from './localSuccess/localSuccessFederation';
// The per-turn affect block, appraised on this device by Evermind's local limbic — the
// replacement for the per-turn `/api/limbic/block` call on every host.
export { personalitySetpoints, turnAffectBlock } from './limbicAffect';
export type { LimbicState } from './limbicAffect';
// THE inference mode (Local only · Hybrid · Specific) — `@builderforce/local-first` owns
// it; re-exported so the shared UI and every host read one contract.
export { INFERENCE_MODES, defaultInferenceMode, isInferenceMode } from '@builderforce/local-first';
export type { InferenceMode } from '@builderforce/local-first';
// Window fit: fit a transcript into the NEXT model's window with the
// `@seanhogg/builderforce-memory/handoff` packer — the run loop's gate, and the
// per-attempt `fit` a local-first host lends `createLocalFirstStream`.
export { contextWindowOf, resolveContextWindow } from './windowFit/modelWindow';
export type { ModelWindowSources, RunWindowSources } from './windowFit/modelWindow';
export { createHandoffFit, packForModel, toolSchemaTokens } from './windowFit/packForModel';
export type { HandoffFitOptions, WindowFitTrace, PackForModelInput, PackForModelResult } from './windowFit/packForModel';
export { localFallbackTrace, summarizeLocalFirstAttempt } from './localFirstTraces';
export type { LocalFirstAttemptSummary } from './localFirstTraces';
// The engines that run INSIDE the page (PRD 34): one `PageEngine` contract, one fetch shim
// that answers each engine's OpenAI chat route, and one model store the picker drives.
// Chrome's Prompt API model, WebLLM (lazy chunk) and our WebGPU `bfi` (host-vendored
// wasm) each implement it; `createPageEngineSet` composes them for a host. `promptApi` is
// the ONE detection of the Prompt API surface.
export {
  BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS,
  BROWSER_ENGINE_MODEL,
  createBrowserEngineProber,
  toPromptApiTurn,
} from './browserEngine';
export type { BrowserEngineProber } from './browserEngine';
export { PageEngineError } from './pageEngines/types';
export type { ChatCompletionChunk, ChatCompletionsRequest, PageEngine } from './pageEngines/types';
export { pageEnginesFetch, probePageEngines } from './pageEngines/fetchShim';
// Reaching a page engine across a boundary (editor host ↔ webview / worker, page ↔ Web Worker).
export {
  PAGE_ENGINE_REPLY_TYPES,
  PAGE_ENGINE_REQUEST_TYPES,
  isPageEngineReply,
  isPageEngineRequest,
  type PageEngineReply,
  type PageEngineRequest,
} from './pageEngines/remote/protocol';
export { servePageEngines, type PageEngineServerIo } from './pageEngines/remote/serve';
export {
  createPageEngineClient,
  type PageEngineClient,
  type PageEngineClientOptions,
  type PageEnginePort,
} from './pageEngines/remote/client';
export {
  ENGINE_WORKER_FATAL,
  ENGINE_WORKER_IDLE_MS,
  ENGINE_WORKER_INVALIDATE,
  createEngineWorker,
  isWasmTrap,
  serveEngineWorker,
  type EngineWorker,
  type EngineWorkerEndpoint,
  type EngineWorkerEvents,
  type EngineWorkerHandle,
  type EngineWorkerOptions,
} from './pageEngines/remote/engineWorker';
export {
  createBfiWorkerEngine,
  type BfiWorkerEngine,
  type BfiWorkerEngineOptions,
  type WorkerLike,
} from './pageEngines/bfiWorkerEngine';
export type { HfModelStore } from './pageEngines/hfModelStore';
export type { BfiEngineInstance, BfiEngineStatic, BfiModelInfo, BfiModule } from './pageEngines/bfiEngine';
export { deferredLocalModelStore } from './pageEngines/modelStore';
export type { LocalModelRow, LocalModelState, LocalModelStore } from './pageEngines/modelStore';
// How a picker lays that catalog out (curated rows by use, the rest behind "All models",
// unfit rows hidden) — the ONE rule brain-ui's `LocalModelList` renders in every host.
export { LOCAL_PICKER_GROUPS, localPickerView } from '@builderforce/local-inference';
export type { LocalPickerGroup, LocalPickerView } from '@builderforce/local-inference';
export { createPageEngineSet } from './pageEngines/pageEngineSet';
export { hasWebGPU } from './pageEngines/webgpu';
export { pageRuntimePin } from './pageEngines/pageRuntimePin';
export type { PageRuntimePin } from './pageEngines/pageRuntimePin';
export type { PageEngineSet, PageEngineSetOptions } from './pageEngines/pageEngineSet';
export {
  hasPromptApi,
  promptApiAvailability,
  promptApiFactory,
  promptApiInputQuota,
  promptApiMeasure,
  promptStreamDeltas,
} from './promptApi';
export type {
  PromptApiAvailability,
  PromptApiFactory,
  PromptApiMessage,
  PromptApiSession,
} from './promptApi';
// Does this shell call only READ? Shared by the read guard and a read-only sub-agent's gate.
export { isReadOnlyShellCall } from './readOnlyShell';
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
  UpstreamTurnEvidence,
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
export { BrainRequestError, brainRequestError, chatErrorAction, LOCAL_ENGINE_FAILURE_CODES, NO_LOCAL_MODEL, NO_SPECIFIC_MODEL, NOT_SIGNED_IN } from './chatError';
export type { ChatErrorAction, ChatErrorActionKind, LocalEngineFailureCode, PlatformRefusedCapability } from './chatError';

// Composer Effort → real request params (max_tokens + vendor-neutral reasoning
// intent) + the level's prose nudge. The ONE effort table: hosts render their
// menu from it and the request builder consumes it, so they cannot drift.
export { effortProfile, isEffort, reasoningForRun } from './effort';
export type { Effort, EffortProfile, ReasoningLevel, ReasoningIntent } from './effort';

// The composer's toggles → prompt directives. ONE compiler, both surfaces: the web and
// VS Code copies had drifted on the effort prose, on a redundant "think step by step"
// sentence, and on the NAME of the web-fetch tool (neither copy named a tool the model
// is actually given). See `composerDirectives.ts`.
export { buildComposerDirectives, WEB_FETCH_TOOL_NAME } from './composerDirectives';
export type { ComposerDirectiveOptions } from './composerDirectives';

// The human-in-the-loop approval gate. Shared because its central invariant — the
// auto-approve flag must be read through a REF so an in-flight run honours a mid-run
// toggle — is exactly what does not survive being hand-copied.
export { useToolConfirmationGate, localStorageConfirmationPersistence } from './useToolConfirmationGate';
export type {
  ToolConfirmationGate,
  ToolConfirmationGateOptions,
  ToolConfirmationPersistence,
} from './useToolConfirmationGate';

// Client-side image prep for vision messages (downscale → inline data URL)
export { prepareImageDataUrl } from './imagePrep';
export type { ImageEncodeDecision, ImagePrepOptions, PreparedImage } from './imagePrep';
// Attachments into a turn: prepare + upload, and the model-visible content (inlined text).
export { AttachmentRefusedError, MAX_INLINE_TEXT_BYTES } from './attachmentContent';
export { BRAIN_UPLOAD_PATH, BRAIN_UPLOAD_SIGN_PATH, brainUploadUrl, signedBrainFileUrl } from './uploadUrls';

// Project-Evermind memory hooks for the run loop (recall → learn → reconcile).
export { projectMemoryHooks } from './evermindMemory';
export type { AnswerOriginCost, EvermindRunHooks, MemoryAnswerOptions, MemoryFirstAnswer, MemorySurface, ProjectMemoryRequest } from './evermindMemory';
// The recall contract + memory block + reconcile rule are the Evermind module's; the
// Brain re-exports them so every host reaches the chat's memory surface in one place.
export { formatEvermindMemoryBlock, countReconciledMemories } from '@seanhogg/builderforce-memory/evermind';
export type { EvermindRecallResult, EvermindRecallItem } from '@seanhogg/builderforce-memory/evermind';

// The ON-DEVICE memory tier + the layering that puts it in front of the server one.
export { onDeviceMemoryHooks, composeEvermindHooks, ON_DEVICE_ANSWER_THRESHOLD } from './onDeviceMemory';
export type { OnDeviceAnswerStore } from './onDeviceMemory';
// The store loader that binds the port above to a real SSM runtime, partitioned by
// scope so two projects never share an answer. Hosts call this; they do not build one.
export { loadOnDeviceAnswerStore, resetOnDeviceStoresForTests } from './onDeviceStore';
export type { OnDeviceStoreScope } from './onDeviceStore';

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
// The pre-chat choices (mode, memory) and the ONE creation path that carries them.
export { useArmedNewChat } from './useArmedNewChat';
export type { ArmedNewChat } from './useArmedNewChat';
export { useBrainConversation } from './useBrainConversation';
export { subscribeToChatMessages } from './chatMessageSubscription';

// The /api/brain REST client, ONE implementation. The web app and the VS Code
// webview each used to carry their own method-for-method copy, already drifted on
// two return types — see brainRestPersistence.ts.
export { createBrainRestPersistence } from './brainRestPersistence';
export type { BrainRestInit, BrainRestOptions, BrainRestPersistence, BrainRestRequest } from './brainRestPersistence';
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
  stopBeforeStart,
  isRunning,
  subscribeRun,
  getRunSnapshot,
  getRunTrace,
  clearRunError,
  resolveRunConfirm,
  // A run's Stop, read by tools that wait (`wait_agents`) — and a message persisted
  // OUTSIDE the loop (a direction to a sub-agent) spliced into a chat's live view.
  runAbortSignal,
  appendRunMessage,
  // Teardown only — a headless harness reuses one chat id across scenarios, and the
  // store is a module-level singleton keyed by it.
  resetBrainRunStore,
  // ONE run store for every agent turn: a non-chat loop (a canvas turn) hosted in the
  // same cell — single-flight, Stop, the confirm gate, the live snapshot.
  startEngineRun,
} from './brainRunStore';
export type { BrainRunRequest, BrainRunSnapshot, BrainRunPersistence, BrainStreamFn, BrainRunEngine, RunEngineControl, RunKey, RunTurn } from './brainRunStore';
export type { AvoidedRunCall, RunOutcomeReport, RunPipelineSettings, RunStageModels } from './runStore/runTypes';
// PRD 35 E7: what a host's pre-turn BYO health check hands the run.
export type { ModelPreflightResult } from './runStore/modelPreflight';
export type { ServedRead } from './runStore/hostRunContext';
// The chat's tickets + run history, ONE reader for every host (panel adapter, VS Code context pack).
export { readChatRunHistory, readChatTicketLinks, type ChatStateGet } from './chatStateReads';
// PRD 35 E8: a host's note on a settled run's trace (e.g. "Memory is off — no facts written").
export { noteRunStep, type RunNoteStep } from './runStore/runNote';
export { useRunSnapshot } from './useRunSnapshot';
// A sub-agent is an ordinary run with an OWNER pointer (`runLineage.ts`), redirected
// mid-run through the same inbox any run has (`runSteering.ts`).
export { parseSubagentOrigin, SUBAGENT_OF_META_KEY } from './runLineage';
export type { RunLineage, SubagentOrigin } from './runLineage';
export { queueRunSteering, drainRunSteering, steerModelContent } from './runSteering';
export type { RunSteerMessage } from './runSteering';
// PRD 35 WS4: the Brain's surfaces adapted to the ONE agent — the ports over the run store
// and the policy data. An adapter (here, or the editor's `run/vscodeAdapter.ts`) builds ports
// and nothing else; the contract types come with them so a host names one import.
export { buildBrainRunPorts, brainRunPolicy, brainRunTask } from './run/webAdapter';
export type { BrainEntryPoint, BrainRunBinding } from './run/webAdapter';
export { runViaAgent } from './run/runViaAgent';
export type { ContextPack, RunPolicy, RunPorts, RunTask } from '@builderforce/agent-run';
export type { BrainRunOutcome } from './runOutcomeReport';
export { isCoderReask } from '@builderforce/run-policy';
// Planning ends in tasks: the `hand_off` tool, its executor, and the per-child chat report.
export {
  HAND_OFF_TOOL,
  HAND_OFF_TOOL_SPEC,
  parseHandOff,
  executeHandOff,
  canRunInParallel,
  childTaskBrief,
  planMessage,
} from './planHandoff';
export type { BriefContext, HandOffPlan, HandOffTask, HandOffPorts, HandOffOutcome } from './planHandoff';
// The run-driver seam: a host whose UI process is disposable (the VS Code webview)
// executes runs in a longer-lived process and mirrors them back with `applyRemoteRun`.
export { applyRemoteRun } from './brainRunStore';
// Code change tracking — what files a tool call changed, and placeholder annotations.
export { codeChangesOf } from './codeChanges';
export { placeholderAdvisory, placeholdersWritten } from './placeholderGuard';
export type { PlaceholderHit } from './placeholderGuard';
export { installRunDriver, getRunDriver, type BrainRunDriver } from './runDriver';
export { installStepDurability, type StepDurability, type StepOutgoingMessage } from './stepOutbox';
export { installIndexedDbStepDurability, type IndexedDbStepDurabilityOptions } from './indexedDbStepDurability';
// The model-visible transcript a run continues from (history minus step rows and stopped
// turns) — shared by the React hook and every non-React host that starts a run on history.
export { transcriptSeedOf } from './transcriptSeed';
// The ONE transcript summarizer bound to a run stream — folds, hand-off notes, Consolidate.
export { streamSummaryCompletion } from './transcriptSummarizer';
export type { SummaryStreamFn } from './transcriptSummarizer';

// Execution triage — capture the Brain run (LLM/tool/error trace) as a report.
export {
  buildBrainTriageReport,
  detectUnbackedWriteClaim,
  detectUnbackedTicketClaim,
  UNBACKED_WRITE_CLAIM_NOTICE,
  UNBACKED_TICKET_CLAIM_NOTICE,
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
  isTicketWriteTool,
} from './brainTriage';
export type { BrainTraceEvent, BuildBrainTriageOptions, BrainDiagnostics, BrainDiagnosticsContext, ByoUnresolvedEntry, ToolExposure } from './brainTriage';

// Filed vs STAFFED — did anybody end up running the work this run created? The signal
// that reads clean on every other diagnostic while twelve tickets sit with no agent.
export {
  staffingSummaryInTrace,
  formatStaffingSummary,
  formatDispatchRefusals,
  workFiledNotStaffedVerdict,
  isDispatchTool,
} from './staffingSummary';
export type { StaffingSummary, DispatchRefusal, PersonaSubagent } from './staffingSummary';

// Did the run GET ANYWHERE? Repetition / reach / effect / timing — the signals that
// separate "every turn succeeded and nothing got done" from a real context or model
// failure. Folded into the diagnostics verdict; exported for surfaces that show them
// on their own.
export { computeRunProgress, hasEditIntent, isMutationTool, BACK_TO_BACK_AT } from './runProgress';
export { formatRunProgress, runProgressVerdict, progressDuration } from './runProgressReport';
export type { RunProgress, RepeatedTarget, RepeatStreak } from './runProgress';

// Live, in-flight activity — what the run is doing RIGHT NOW, so a surface can animate
// the CURRENT step instead of only rendering settled ones.
export { activityTarget, toolActivity, shortenTarget, describeLiveStep, midRunNotice, formatBytes } from './runActivity';
export type { BrainRunActivity, BrainRunPhase } from './runActivity';
// The `composing` phase: a turn streaming a tool call's ARGUMENTS, which is invisible
// to any indicator that only watches text deltas.
export { createComposingActivity, toolCallArgBytes, utf8ByteLength } from './composingActivity';
export type { ComposingActivity, ComposingSink, ComposingOptions } from './composingActivity';

// Size budget for a copied triage report, so its END survives pasting.
export { createPayloadBudget } from './transcriptBudget';

// Did the run's change actually SHIP? The evidence a run holds first-hand when it
// pushed straight to the base branch — the case no merge webhook can ever see.
export { shippedToBaseBranch, parseGitShortStatus, dirtyPathsOf, BASE_BRANCHES } from './shipVerification';
export type { GitShortStatus } from './shipVerification';

// Loop guard: the per-run tally of which targets have been read, and the advisory the
// run loop attaches once a read starts circling. Exported for tests and for any surface
// that wants to report the same coverage picture.
export { ReadCoverage } from './readCoverage';
export { revisitAdvisory, withAdvisory, REVISIT_NUDGE_AT, REVISIT_HARD_AT } from '@builderforce/run-guards';
export type { ReadVisit, CachedRead } from '@builderforce/run-guards';
export { FailureTally, failureReason, repeatedFailureAdvisory, FAILURE_NUDGE_AT, FAILURE_HARD_AT } from '@builderforce/run-guards';
// What one tool result may cost the MODEL transcript, and how it is cut down: a generic
// head slice for list results, LINE-paged windows with an intact continuation offset for
// `read_file`. Exported so a host can size its own reads to the same budget.
export { trimToolResult, MAX_TOOL_RESULT_CHARS, READ_FILE_RESULT_CHARS } from './toolResultBudget';
export type { TrimmedToolResult, TrimOptions } from './toolResultBudget';
// The working transcript's token budget — the figure a triage reader needs to know a
// 90k-token prompt is the design working, not a window being outgrown.
export { HISTORY_TOKEN_BUDGET } from '@seanhogg/builderforce-memory/working';
// A stream that goes silent must END, not hang until the user presses Stop.
export { readWithIdleWatchdog, StreamIdleError, STREAM_IDLE_MS } from './streamIdleWatchdog';
export type { IdleWatchdogOptions, IdleWatchdogReader } from './streamIdleWatchdog';
export { stableStringify } from '@builderforce/agent-tools';
export type { PayloadBudget, PayloadBudgetOptions, PayloadBudgetStats } from './transcriptBudget';

// Durable tool/memory STEP rows — the reader for what the run loop persisted, so a
// reopened chat's timeline AND its triage diagnostics both see the steps the live
// in-memory trace no longer holds.
// Run-milestone / agent-dispatch ACTIVITY lines — the structured metadata contract both
// chat renderers drive their (localized) system line from, instead of showing the
// server's English sentence as an assistant bubble.
export {
  parseChatActivity,
  isActivityMessage,
  activityMessageCount,
  chatActivityText,
  activityIcon,
  activityTone,
  DEFAULT_CHAT_ACTIVITY_LABELS,
} from './chatActivity';
export type { ChatActivity, RunMilestoneActivity, AgentDispatchActivity, ChatActivityLabels, RunMilestonePhase } from './chatActivity';
export { stepSig, parseStepMessage, traceWithPersistedSteps } from './persistedSteps';
export type { PersistedStep } from './persistedSteps';
// The last turn's context fill — the composer's context meter (`conv.contextUsage`; the
// canvas reads its own run's messages + trace with `contextUsageOf`).
export { contextUsageOf } from './contextUsage';
export type { ContextUsage } from './contextUsage';

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

// The ask-user protocol, re-exported from `@builderforce/agent-loop` so a React host
// (and the shared transcript package layered on top of this one) reaches the ONE
// definition through the package it already depends on. The loop that PRODUCES a
// question and the transcript that RENDERS it must agree on the fence and on what
// counts as a renderable card, or the question is silently swallowed.
export {
  // The ONE number every surface stops on: consecutive failed tool calls. There is no
  // step cap. Re-exported for the same reason as the ask-user protocol below.
  DEFAULT_TOOL_FAILURE_STREAK,
  ASK_USER_TOOL,
  ASK_USER_TOOL_SPEC,
  askUserAnchorId,
  askUserBlock,
  coerceAskUserPayload,
  parseAskUser,
  selectPendingAskUser,
  serializeAskUser,
  stripAskUser,
  // The ONE durable step-row shape — a surface that keeps its own transcript (the
  // canvas) writes a failed turn as an error STEP, so the shared timeline draws it
  // as an error card, never as an assistant reply.
  stepRow,
} from '@builderforce/agent-loop';
export type { AskUserMessageLike, AskUserOption, AskUserPayload, AskUserToolSpec, PendingAskUser } from '@builderforce/agent-loop';

// Chat ⇄ work linking — the directive that ties identified work / code changes to
// the current chat, plus the predicates behind the "a code change is always tied to
// a ticket" backstop (reused by non-React hosts driving the run loop directly).
export {
  chatWorkLinkingDirective,
  isTicketRecordingTool,
  codeChangeFile,
  workItemLinkFromCreate,
  linkedTicketsToAdvance,
  linkedTicketsToComplete,
  TICKET_RECORDING_TOOLS,
  NOT_STARTED_TASK_STATUSES,
} from './chatWorkLinking';
export type { CreatedWorkItemLink, LinkedTicketToAdvance } from './chatWorkLinking';

// The LOCAL WORKSPACE TOOLSET — what a surface can do because it sits beside the
// user's files. Owns both "can this run change code" and the always-advertise list
// that stops relevance trimming from hiding the surface's own tools from it.
export {
  LOCAL_WORKSPACE_TOOLS,
  CODE_CHANGE_TOOLS,
  UNSCOPED_MUTATION_TOOLS,
  isLocalWorkspaceTool,
  isCodeChangeTool,
  isUnscopedMutationTool,
  isRepoPublishTool,
  canChangeCodeHere,
  canShipHere,
  localToolsIn,
  PREVIEW_REVIEW_TOOL,
  STUDIO_WORKSPACE_TOOLS,
  canReviewInPreview,
  studioToolsIn,
} from './localWorkspaceTools';

// SELF-REVIEW SHIP — in a local editor session the agent is its own change's reviewer:
// verify, review, commit, push, and the in_review ticket closes. Directive + loop gate.
export {
  selfReviewShipDirective,
  leftChangeUnshipped,
  unshippedChangeNudge,
  attemptedPublish,
  declinesShipping,
} from './selfReviewShip';
export type { UnshippedChangeInput } from './selfReviewShip';

// STOP HOOKS — the host's (workspace's) say over whether a run may end; bounded per run.
export { askStopHook, MAX_STOP_HOOK_ROUNDS } from './stopHooks';
export type { RunStopHook, RunStopInput } from './stopHooks';

// PREVIEW REVIEW — the Studio's twin: the agent verifies its change in the live preview,
// records a review quoting the measurements, and the reviewed tickets close.
export {
  previewReviewDirective,
  leftChangeUnreviewed,
  unreviewedChangeNudge,
  ticketsReviewedInPreview,
  declinesReview,
} from './previewReview';
export type { UnreviewedChangeInput } from './previewReview';

// Chat MODE — conversation (`chat`) vs execution (`work`). The single source for what
// a mode MEANS to the model, shared by the web Brain, the VS Code webview and the
// shared agent loop (migration 0409).
export {
  CHAT_MODES,
  NEW_CHAT_MODE,
  RESTING_CHAT_MODE,
  CHAT_MODE_ICON,
  isChatMode,
  normalizeChatMode,
  chatModeDirective,
  chatConversationDirective,
  chatWorkDirective,
  chatRosterFromParticipants,
} from './chatMode';
export type { ChatMode, ChatRosterAgent, ChatWorkDirectiveOptions } from './chatMode';

// Landing-page → auth → replay handoff
export { savePendingPrompt, takePendingPrompt } from './pendingPrompt';

// Chat consolidation markers (compress a long chat into a summary base context) — the
// memory package's, re-exported so every host reads them from one place.
export {
  CONSOLIDATION_META,
  CONSOLIDATION_MARKER_PREFIX,
  consolidationMetadata,
  consolidationMarkerContent,
  consolidationMarkerOf,
  isConsolidationMarker,
  lastConsolidationIndex,
  scopeToConsolidation,
} from '@seanhogg/builderforce-memory/working';
export type { ConsolidationMarkerMeta } from '@seanhogg/builderforce-memory/working';

// Directed messages (address a chat turn to a participant instead of the BRAIN)
export {
  ADDRESSED_TO_META_KEY,
  AUTHORED_BY_META_KEY,
  withDirectedMetadata,
  parseDirectedRecipients,
  parseMessageAuthor,
  isDirectedToParticipant,
  directedAgentRecipients,
  mentionRecipient,
  resolveRecipient,
  activeMentionToken,
  filterMentionCandidates,
} from './directedMessage';
export type { DirectedRecipient, DirectedGroup, RecipientChoice, MentionToken } from './directedMessage';

// Ticket tagging (#123) in chat messages
export { activeTicketToken, activeHashtagToken, filterTicketCandidates } from './directedMessage';
export type { ChatTicket, TicketToken, TicketTag } from './directedMessage';

// The tenant's assignable agent pool (owned + purchased + registered), one mapping
export {
  AGENT_POOL_PATHS,
  DEFAULT_AGENT_MODEL_SENTINEL,
  poolAgentsFrom,
  loadAgentPoolVia,
} from './agentPool';
export type { PoolAgent, PoolWorkforceAgentRow, PoolRegisteredAgentRow, PoolRequest } from './agentPool';

// Brain personas ("Acting as"): modality personas + Brain-assigned agents
export {
  PERSONA_MODALITY_IDS,
  MODALITY_PERSONAS,
  FILE_DELIVERY_RULE,
  DEFAULT_PERSONA,
  BRAIN_AGENT_ASSIGNMENTS_PATH,
  modalityPersonaChoice,
  agentPersonaChoice,
  personaModalityOf,
  personaAgentOf,
  agentPersonaPrompt,
  personaSystemPrompt,
  personaOverlay,
  personaModel,
  brainPersonaAgents,
  loadBrainPersonaAgentsVia,
} from './brainPersona';
export type { PersonaModalityId, ModalityPersona, BrainPersonaAgent, BrainPersonaChoice } from './brainPersona';

// Per-reply model/account provenance (the "which LLM / whose account" chip)
export {
  PROVENANCE_META_KEY,
  parseMessageProvenance,
  withProvenanceMetadata,
  asProvenanceAccount,
  isConnectedAccountUnused,
  lastServedModel,
  formatAssistantTranscriptHeading,
} from './provenance';
export type { MessageProvenance, ProvenanceAccount } from './provenance';

// Per-model / per-turn scorecard for copied diagnostics (aggregate + ordered turn log).
export { modelScorecard, formatModelScorecard, modelTurnLog, formatModelTurnLog } from './modelScorecard';
export type { ModelScore, ModelTurn } from './modelScorecard';

// A reply the user stopped mid-stream — kept, attributed, and never replayed to a model
export { STOPPED_TURN_META_KEY, STOPPED_TURN_STEP, stoppedTurnMetadata, isStoppedTurn, isStoppedBeforeStart, stoppedBeforeStartRow } from './stoppedTurn';
export type { StoppedTurnSource } from './stoppedTurn';

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
export { localRatingVerdict, ratedTurnContext, ratedTurnTool, withRating } from './turnRating';
export type { LocalRatingVerdict, RatableMessage, RatedTurnContext, MessageRatings } from './turnRating';

// The model a chat's last completion actually resolved to — what
// `builtin_session_current_model` is answered with, and what a host can show as
// "running on X". Keyed by chat, because runs are concurrent.
export { getLastResolvedModel, setLastResolvedModel, withObservedModel, forgetResolvedModels } from './lastResolvedModel';

// Shared data shapes
export type { BrainChat, BrainMessage, BrainModality, ChatInputAttachment, EvermindLearnOutcome, EvermindLearnTarget } from './types';
export { serverChatIdOf } from './types';
export { routingQueryForTurn, turnOptimizationDirective } from './turnOptimization';
export { STEP_MESSAGE_ROLE, isStepMessage, attachEvermindLearn, formatEvermindLearnStep } from './types';
export { isModelReply } from './modelReply';

// "Copy diagnostics" — pure serializer for the chat's identity + Evermind wiring state
export { formatChatDiagnostics, classifyModelFunding, allowanceState } from './chatDiagnostics';
export { formatSubagentDiagnostics, type SubagentDiagnosticsInput } from './subagentDiagnostics';
export { gatherChatDiagnostics } from './gatherChatDiagnostics';
// The same capture as DATA — versioned, persisted with the chat, and appended to the
// copied report so a paste carries both the prose and the machine-readable copy.
export {
  buildChatDiagnosticsReport,
  formatChatDiagnosticsReportJson,
  CHAT_DIAGNOSTICS_SCHEMA_VERSION,
} from './chatDiagnosticsReport';
export type {
  ChatDiagnosticsReport,
  ChatDiagnosticsProvenance,
  BuildChatDiagnosticsReportInput,
} from './chatDiagnosticsReport';

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
  withReadyPageModels,
  MODEL_CATEGORIES,
  DEFAULT_MODEL_CHOICE_LABELS,
  PROJECT_EVERMIND_MODEL_PREFIX,
  routingModeForSelection,
} from './modelChoice';
export type {
  ChatModelOptions,
  ChatModelSelection,
  ModelCategory,
  ModelChoiceLabels,
  ModelItem,
} from './modelChoice';
// The gateway's model catalogue — the ONE parser + entitlement rule every client reads
// it through (web lists, VS Code host + webview, Rovr).
export {
  EMPTY_GATEWAY_MODEL_OPTIONS,
  gatewayCanChooseModel,
  gatewayModelIdentity,
  gatewayModelWindows,
  gatewayPlanIsPaid,
  gatewayPlanModels,
  invalidateGatewayModelOptions,
  loadGatewayModelOptions,
} from './gatewayModels';
export type { GatewayJsonRequest, GatewayModelOptions, GatewayModelSurface } from './gatewayModels';
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
export type { ChatDiagnosticsData, ChatDiagnosticsEvermind, ChatDiagnosticsAccount, ChatDiagnosticsHistory, ChatDiagnosticsMeter, ChatDiagnosticsRun, ChatDiagnosticsRuns, AllowanceState } from './chatDiagnostics';
export type { ChatDiagnosticsSources, ChatDiagnosticsPlanSnapshot, ChatDiagnosticsModelSurface, ChatDiagnosticsEvermindHead, ChatDiagnosticsMessageLike } from './gatherChatDiagnostics';
// WHERE a linked work item opens — the ONE routing table shared by the web host's
// `router.push` and the VS Code host's external-URL open, so "Open" cannot mean two
// different destinations on two surfaces.
export {
  artifactRoutePath,
  pmoFocusValue,
  parsePmoFocus,
  pmoFocusDomId,
  PMO_FOCUS_PARAM,
  type ArtifactKind,
} from './artifactRoute';
// Which workspace roles may manage project settings (the Evermind console's write gate).
export { isManagerRole } from './workspaceRoles';
// UI (PRD 14 §136) — the embeddable one-line composer. Host-translated, router-free.
export { PromptInput, type PromptInputProps } from './ui/PromptInput';
export type { SavingsBreakdown, SavingsBySource, SavingsSourceKey, SpendBreakdown, SpendSavingsSummary } from './spendSavings';
export { USAGE_SURFACE_HEADER, USAGE_SURFACES, isUsageSurface, withUsageSurface, type UsageSurface } from './usageSurface';

// THE ONE turn door (steer → queue while running → send) and Stop, the ONE turn queue
// under it (moved from brain-ui, which re-exports it), and "the first message creates
// the chat" (single in-flight create + first-turn auto-title port).
export { useChatTurns } from './useChatTurns';
export { startsRun } from './userTurnRuns';
export type { ChatTurns, ChatTurnsOptions } from './useChatTurns';
export { useRunRefreshTick, RUN_REFRESH_MS } from './useRunRefreshTick';
export { useQueuedTurns } from './useQueuedTurns';
export type { QueuedItem, QueuedTurns, QueuedTurnsOptions } from './useQueuedTurns';
export { useChatCreation } from './useChatCreation';
export type { ChatCreation, ChatCreationOptions } from './useChatCreation';
