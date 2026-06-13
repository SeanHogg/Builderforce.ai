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

// MCP-style client action registry (the extension contract)
export {
  BrainActionsProvider,
  useBrainActions,
  useRegisterBrainActions,
} from './BrainActionsContext';
export type { BrainAction, BrainActionsContextValue } from './BrainActionsContext';

// Bridge server-side (tenant-registered) MCP extensions into the client loop.
export { useMcpExtensions } from './useMcpExtensions';

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

// Landing-page → auth → replay handoff
export { savePendingPrompt, takePendingPrompt } from './pendingPrompt';

// Shared data shapes
export type { BrainChat, BrainMessage, BrainModality, ChatInputAttachment } from './types';
