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
  AssembledToolCall,
} from './streamChatCompletion';

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

// Ambient page context
export {
  BrainContextProvider,
  useBrainContext,
  useOptionalBrainContext,
} from './BrainContext';
export type { BrainContextValue, BrainPageContext } from './BrainContext';

// Conversation + chat-list hooks
export { useBrainChats } from './useBrainChats';
export type { UseBrainChats, UseBrainChatsOptions } from './useBrainChats';
export { useBrainConversation } from './useBrainConversation';
export type { UseBrainConversation, UseBrainConversationOptions } from './useBrainConversation';

// Cross-chat run indicators — which chats are executing / awaiting a confirm RIGHT
// NOW (the module-level agent loop keeps running across chat switches, so a host
// can light up the still-live conversations in a session list / dropdown).
export { subscribeRunStore, getGlobalRunState } from './brainRunStore';
export type { GlobalRunState } from './brainRunStore';

// Execution triage — capture the Brain run (LLM/tool/error trace) as a report.
export {
  buildBrainTriageReport,
  isFailedToolResult,
  isEvermindModel,
  modelsUsedInTrace,
  computeBrainDiagnostics,
  formatBrainDiagnostics,
} from './brainTriage';
export type { BrainTraceEvent, BuildBrainTriageOptions, BrainDiagnostics } from './brainTriage';

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

// Shared data shapes
export type { BrainChat, BrainMessage, BrainModality, ChatInputAttachment } from './types';
