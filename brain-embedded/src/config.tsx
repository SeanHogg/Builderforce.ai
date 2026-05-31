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
  createChat(body: { title?: string; projectId?: number | null }): Promise<BrainChat>;
  updateChat(id: number, body: { title?: string; projectId?: number | null }): Promise<BrainChat>;
  deleteChat(id: number): Promise<unknown>;
  summarizeChat(id: number): Promise<{ summary: string } | { error: string }>;
  getMessages(chatId: number, limit?: number): Promise<BrainMessage[]>;
  sendMessages(
    chatId: number,
    messages: Array<{ role: string; content: string; metadata?: string }>,
  ): Promise<BrainMessage[]>;
  setMessageFeedback(messageId: number, feedback: 'up' | 'down' | null): Promise<unknown>;
  upload(file: File): Promise<{ key: string; name: string; type: string }>;
  uploadUrl(key: string): string;
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
