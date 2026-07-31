'use client';

/**
 * BrainProvider — the single injection seam for the brain core.
 *
 * The hooks (`useBrainChats`, `useBrainConversation`) and the streaming client
 * are framework- and app-agnostic. Everything app-specific (where the gateway
 * lives, how to get an auth token, how chats persist, how a modality maps to a
 * system prompt) is supplied here as config. builderforce.ai wires its tenant
 * JWT + `/api/brain` client; an external embed wires a relay token + its own
 * persistence. The core code never changes.
 */

import { createContext, useContext, useMemo } from 'react';
import type { BrainChat, BrainMessage } from './types';
import {
  streamChatCompletion,
  type BrainTransport,
  type StreamChatOptions,
  type StreamHandlers,
  type StreamChatResult,
} from './streamChatCompletion';

/**
 * Chat/message persistence the host provides. Mirrors the Builderforce
 * `/api/brain` client surface; any backend conforming to these signatures works.
 */
export interface BrainPersistenceAdapter {
  listChats(params?: { projectId?: string; limit?: number; offset?: number }): Promise<BrainChat[]>;
  getChat(id: number): Promise<BrainChat>;
  createChat(body: { title?: string; projectId?: number | null; capability?: string | null }): Promise<BrainChat>;
  updateChat(id: number, body: { title?: string; projectId?: number | null; visibility?: 'shared' | 'locked'; capability?: string | null }): Promise<BrainChat>;
  deleteChat(id: number): Promise<unknown>;
  summarizeChat(id: number): Promise<{ summary: string } | { error: string }>;
  getMessages(chatId: number, limit?: number): Promise<BrainMessage[]>;
  /** Subscribe to durable message invalidations for one chat. The callback carries
   * no data; the hook reconciles from persistence as the source of truth. */
  subscribeMessages?(chatId: number, onChanged: () => void): () => void;
  /** Advance the caller's unread high-water mark for a chat to `seq` (a message's
   * seq; omit to mark everything read). Called when a chat is OPEN/mounted so an
   * unread badge clears — on either surface, since it's the same server chat.
   * Optional: a guest/offline backend that has no unread concept simply omits it. */
  markChatRead?(chatId: number, seq?: number): Promise<unknown>;
  sendMessages(
    chatId: number,
    messages: Array<{ role: string; content: string; metadata?: string }>,
  ): Promise<BrainMessage[]>;
  setMessageFeedback(messageId: number, feedback: 'up' | 'down' | null): Promise<unknown>;
  /**
   * Ask an invited agent participant to reply — a chat-scoped run that answers AS
   * the addressed agent and returns the posted assistant turn (attributed to it via
   * metadata.authoredBy). Called after a user directs a message to an @agent.
   * Optional: when absent, directing to an agent just posts the turn (legacy).
   */
  requestAgentReply?(chatId: number, input: { agentRef: string; agentName?: string }): Promise<BrainMessage>;
  upload(file: File): Promise<{ key: string; name: string; type: string }>;
  uploadUrl(key: string): string;
  /**
   * Mint a short-lived, signature-authenticated public URL for an uploaded
   * object so an upstream LLM provider can fetch it without the tenant token.
   * Used for the rare image too large to inline as a data URL. Optional: when
   * absent, the conversation falls back to the (auth-scoped) text link.
   */
  signedUploadUrl?(key: string): Promise<string>;
}

export interface BrainConfig {
  /** Auth + endpoint for the streaming gateway. */
  transport: BrainTransport;
  /** Chat/message persistence backend. */
  persistence: BrainPersistenceAdapter;
  /** Map a modality string to its default system prompt. Defaults to a generic prompt. */
  resolveSystemPrompt?: (modality: string) => string;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are Brain, a helpful AI assistant. Be concise and use markdown when helpful.';

/** Resolved runtime: config plus a transport-bound streaming function. */
export interface BrainRuntime {
  transport: BrainTransport;
  persistence: BrainPersistenceAdapter;
  resolveSystemPrompt: (modality: string) => string;
  /** Stream a completion through the configured transport. */
  stream(
    opts: Omit<StreamChatOptions, 'transport'>,
    handlers?: StreamHandlers,
  ): Promise<StreamChatResult>;
}

const BrainConfigContext = createContext<BrainRuntime | null>(null);

export function BrainProvider({
  config,
  children,
}: {
  config: BrainConfig;
  children: React.ReactNode;
}) {
  const runtime = useMemo<BrainRuntime>(
    () => ({
      transport: config.transport,
      persistence: config.persistence,
      resolveSystemPrompt: config.resolveSystemPrompt ?? (() => DEFAULT_SYSTEM_PROMPT),
      stream: (opts, handlers) =>
        streamChatCompletion({ ...opts, transport: config.transport }, handlers),
    }),
    [config],
  );
  return <BrainConfigContext.Provider value={runtime}>{children}</BrainConfigContext.Provider>;
}

/** Consume the resolved brain runtime. Throws if no BrainProvider is mounted. */
export function useBrainConfig(): BrainRuntime {
  const ctx = useContext(BrainConfigContext);
  if (!ctx) throw new Error('useBrainConfig must be used within a BrainProvider');
  return ctx;
}
