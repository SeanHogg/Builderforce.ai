/** Barrel for the shared Brain layer (logic, contexts, and the streaming client). */

export {
  streamChatCompletion,
  type BrainToolSpec,
  type ChatCompletionMessage,
  type StreamHandlers,
  type StreamChatOptions,
  type StreamChatResult,
  type AssembledToolCall,
} from './streamChatCompletion';

export {
  BrainActionsProvider,
  useBrainActions,
  useRegisterBrainActions,
  type BrainAction,
  type BrainActionsContextValue,
} from './BrainActionsContext';

export {
  BrainContextProvider,
  useBrainContext,
  useOptionalBrainContext,
  type BrainContextValue,
  type BrainPageContext,
} from './BrainContext';

export { useBrainChats, type UseBrainChats, type UseBrainChatsOptions } from './useBrainChats';
export {
  useBrainConversation,
  type UseBrainConversation,
  type UseBrainConversationOptions,
} from './useBrainConversation';

export {
  generatePrd,
  savePrd,
  generateTasks,
  saveTasks,
  type GeneratedTasks,
} from './projectArtifacts';
