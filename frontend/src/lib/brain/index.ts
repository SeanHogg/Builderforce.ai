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
} from '@seanhogg/builderforce-brain-embedded';

// App-specific brain pieces (not part of the portable package).
export { brainConfig } from './runtime';
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
  buildPlatformCapabilities,
  type PlatformCapability,
  type PlatformActionContext,
} from './platformActions';
export { PLATFORM_BRAIN_SYSTEM_PROMPT } from './platformPrompt';
