/**
 * Barrel for the shared Brain layer.
 *
 * The core (streaming client, contexts, MCP action registry, conversation/chat
 * hooks, pending-prompt handoff) now lives in the embeddable npm package
 * @seanhogg/builderforce-brain-embedded and is re-exported here so existing
 * app imports (`@/lib/brain`) keep working. The app-specific wiring is in
 * `runtime.ts` (the BrainProvider config) and `projectArtifacts.ts` (PRD/Tasks
 * generation, which depends on the app's specs/tasks APIs and stays host-owned).
 */

export {
  streamChatCompletion,
  BrainActionsProvider,
  useBrainActions,
  useRegisterBrainActions,
  BrainContextProvider,
  useBrainContext,
  useOptionalBrainContext,
  useBrainChats,
  useBrainConversation,
  savePendingPrompt,
  takePendingPrompt,
  BrainProvider,
  useBrainConfig,
  useMcpExtensions,
  buildBrainTriageReport,
  isFailedToolResult,
  isStepMessage,
  mentionRecipient,
  resolveRecipient,
} from '@seanhogg/builderforce-brain-embedded';

export type {
  BrainToolSpec,
  ChatCompletionMessage,
  StreamHandlers,
  StreamChatOptions,
  StreamChatResult,
  AssembledToolCall,
  BrainTransport,
  BrainAction,
  BrainActionsContextValue,
  BrainContextValue,
  BrainPageContext,
  UseBrainChats,
  UseBrainChatsOptions,
  UseBrainConversation,
  UseBrainConversationOptions,
  BrainConfig,
  BrainRuntime,
  BrainPersistenceAdapter,
  BrainChat,
  BrainMessage,
  BrainModality,
  ChatInputAttachment,
  BrainTraceEvent,
  BuildBrainTriageOptions,
  DirectedRecipient,
  RecipientChoice,
} from '@seanhogg/builderforce-brain-embedded';

// App-specific brain pieces (not part of the portable package).
export { useOpenProjectChat } from './openProjectChat';
export { brainConfig } from './runtime';
export { guestBrainConfig, guestMessageAuthor, GUEST_ROOM_CHAT_ID } from './guestRuntime';
export {
  generatePrd,
  savePrd,
  generateTasks,
  saveTasks,
  type GeneratedTasks,
} from './projectArtifacts';

// Platform-action layer: the Brain's "MCP for every capability" registry +
// the platform co-pilot persona that drives it.
export {
  buildPlatformActions,
  type PlatformActionContext,
} from './platformActions';
export { PLATFORM_BRAIN_SYSTEM_PROMPT, BRAIN_AUTO_APPROVE_DIRECTIVE, buildComposerDirectives, WEB_FETCH_TOOL_NAME, type BrainEffort } from './platformPrompt';

// Chat capabilities: what the chat is making (document / slides / site / game …).
export {
  capabilitiesForSurface,
  getBrainCapability,
  type BrainCapabilityId,
  type BrainCapabilityDef,
  type BrainCapabilitySurface,
} from './capabilities';

// Chat MODE: is this conversation a CONVERSATION (`chat`) or an EXECUTION (`work`)?
// Re-exported from the model-facing package alongside the UI-only work-option catalogue,
// so a surface imports one thing rather than reaching into two.
export {
  CHAT_MODES,
  NEW_CHAT_MODE,
  RESTING_CHAT_MODE,
  CHAT_MODE_ICON,
  isChatMode,
  normalizeChatMode,
  workOptions,
  type ChatMode,
  type WorkOptionId,
  type WorkOptionDef,
} from './chatModes';
export { extractCsv, exportFilenameStem, replyHasArtifact } from './messageExport';

// Model-authored "next step" buttons parsed out of a Brain reply.
export { parseSuggestedActions, type SuggestedAction, type ParsedSuggestedActions } from './suggestedActions';

// Turns typed while a run is in flight — held and flushed on the run's falling
// edge, so no composer has to disable itself while the agent is working.
export { useQueuedTurns, type QueuedTurns } from './useQueuedTurns';

// Brain → data-view refresh bus: mutating platform actions announce writes here
// so the page rendering that data (e.g. the Tasks board) can refetch live.
export {
  BRAIN_DATA_CHANGED_EVENT,
  dispatchBrainDataChanged,
  onBrainDataChanged,
  type BrainDataChangedEvent,
} from './brainDataEvent';
