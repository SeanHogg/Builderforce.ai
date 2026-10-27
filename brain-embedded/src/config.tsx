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
import type { BrainChat, BrainMessage, ChatInputAttachment } from './types';
import type { ImagePrepOptions } from './imagePrep';
import { streamChatCompletion, type BrainTransport } from './streamChatCompletion';
import type { BrainStreamFn } from './brainRunStore';
import type { LocalRatingVerdict } from './turnRating';

/**
 * Chat/message persistence the host provides. Mirrors the Builderforce
 * `/api/brain` client surface; any backend conforming to these signatures works.
 */
export interface BrainPersistenceAdapter {
  listChats(params?: { projectId?: string; limit?: number; offset?: number }): Promise<BrainChat[]>;
  getChat(id: number): Promise<BrainChat>;
  createChat(body: { title?: string; originalRequest?: string | null; projectId?: number | null; capability?: string | null; mode?: string | null }): Promise<BrainChat>;
  updateChat(id: number, body: { title?: string; originalRequest?: string | null; projectId?: number | null; visibility?: 'shared' | 'locked'; capability?: string | null; mode?: string | null; memoryEnabled?: boolean; isArchived?: boolean }): Promise<BrainChat>;
  deleteChat(id: number): Promise<unknown>;
  /**
   * Archive a chat — put it away rather than remove it. Distinct from
   * `deleteChat` on purpose: the local-first adapter's `deleteChat` tombstones
   * the row, and routing Archive through it is what made "archive" a destroy.
   * The server's archive happens to be the same `DELETE` route as its delete
   * (it sets `isArchived`); a local adapter archives by marking the row, not by
   * tombstoning it.
   */
  archiveChat(id: number): Promise<unknown>;
  summarizeChat(id: number): Promise<{ summary: string } | { error: string }>;
  getMessages(chatId: number, limit?: number): Promise<BrainMessage[]>;
  /**
   * Bind a LOCAL chat to a server chat now, when signed in (PRD 36) — for a
   * server-addressed action on a chat that has not run yet (linking the ticket the chat
   * was opened for). Resolves the server id, or undefined while the chat stays local.
   * Omitted by an adapter whose chats ARE server chats.
   */
  bindChat?(chatId: number): Promise<number | undefined>;
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
  /**
   * Record this viewer's thumb on one assistant reply (null clears it).
   *
   * `context` carries what the TRANSCRIPT knows and the server would otherwise have
   * to reconstruct — chiefly which MCP tool the rated turn executed. The server
   * joins it to the model on the reply's provenance and files a durable
   * `llm_action_ratings` row, so the press teaches the learned router which model is
   * good at which kind of work rather than only colouring a button.
   */
  setMessageFeedback(
    messageId: number,
    feedback: 'up' | 'down' | null,
    context?: {
      toolName?: string | null;
      /** E5: set only when the press judges the chat's LATEST reply. A host whose model
       *  stream runs in another realm (the VS Code extension host) hands it to
       *  `submitLocalTurnVerdict` there; servers ignore it. */
      localVerdict?: LocalRatingVerdict | null;
    },
  ): Promise<unknown>;
  /**
   * Ask an invited agent participant to reply — a chat-scoped run that answers AS
   * the addressed agent and returns the posted assistant turn (attributed to it via
   * metadata.authoredBy). Called after a user directs a message to an @agent.
   * Optional: when absent, directing to an agent just posts the turn (legacy).
   */
  requestAgentReply?(chatId: number, input: { agentRef: string; agentName?: string }): Promise<BrainMessage>;
  upload(file: File): Promise<{ key: string; name: string; type: string }>;
  /**
   * Record a file the model receives INLINE (a picture sent as a data URL) without sending
   * it anywhere — the attachment exists for this conversation, but no platform copy is
   * made of what the model never needs to fetch. Optional: when absent, such a file is
   * {@link upload}ed like any other (the web, whose uploads are its record).
   */
  keepLocal?(file: File): Promise<{ key: string; name: string; type: string }>;
  uploadUrl(key: string): string;
  /**
   * Mint a short-lived, signature-authenticated public URL for an uploaded
   * object so an upstream LLM provider can fetch it without the tenant token.
   * Used for the rare image too large to inline as a data URL. Optional: when
   * absent, the conversation falls back to the (auth-scoped) text link.
   */
  signedUploadUrl?(key: string): Promise<string>;
  /**
   * The model-facing text of the attachments this host can READ (text files, an editor's
   * "Add context"), already compressed (prose only) and fitted to the turn's mention
   * budget, with the keys it covered — those attachments reach the model as their text
   * instead of as a link. Null (or absent) ⇒ every attachment stays a link, which is
   * right for a host whose links the model can read (the web's uploads).
   */
  inlineAttachments?(attachments: readonly ChatInputAttachment[]): Promise<InlinedAttachments | null>;
}

/** What {@link BrainPersistenceAdapter.inlineAttachments} answers. */
export interface InlinedAttachments {
  /** The fenced blocks, '' when nothing could be inlined. */
  text: string;
  /** The attachment keys `text` covers. */
  keys: string[];
}

export interface BrainConfig {
  /** Auth + endpoint for the streaming gateway. */
  transport: BrainTransport;
  /** Chat/message persistence backend. */
  persistence: BrainPersistenceAdapter;
  /** Map a modality string to its default system prompt. Defaults to a generic prompt. */
  resolveSystemPrompt?: (modality: string) => string;
  /**
   * The streaming fn every Brain turn runs through. Omitted = the shared streamer over
   * {@link BrainConfig.transport}. A host supplies one to change WHERE turns run without
   * forking the hooks — builderforce.ai serves tool-free turns on the browser's own model
   * first (`createLocalFirstStream`). A call that must reach a NAMED cloud model (a model
   * comparison) uses `transport` directly and never passes through here.
   */
  stream?: BrainStreamFn;
  /** How attached pictures are prepared for a vision turn (long-edge cap, first quality).
   *  Omitted = the defaults (`imagePrep.ts`); the editor passes its `builderforce.images.*`. */
  imagePrep?: ImagePrepOptions;
}

/**
 * The streaming fn a config resolves to — the host's own, else the shared streamer over
 * its transport. The ONE resolution: BrainProvider and any surface that streams from a
 * config outside React (the canvas turn loop) read it here, so they cannot disagree on
 * where a turn runs.
 */
export function resolveBrainStream(config: Pick<BrainConfig, 'transport' | 'stream'>): BrainStreamFn {
  return config.stream ?? ((opts, handlers) => streamChatCompletion({ ...opts, transport: config.transport }, handlers));
}

const DEFAULT_SYSTEM_PROMPT =
  'You are Brain, a helpful AI assistant. Be concise and use markdown when helpful.';

/** Resolved runtime: config plus a transport-bound streaming function. */
export interface BrainRuntime {
  transport: BrainTransport;
  persistence: BrainPersistenceAdapter;
  resolveSystemPrompt: (modality: string) => string;
  /** Stream a completion — the config's own stream, else the configured transport. */
  stream: BrainStreamFn;
  /** {@link BrainConfig.imagePrep}, as configured. */
  imagePrep?: ImagePrepOptions;
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
      stream: resolveBrainStream(config),
      ...(config.imagePrep ? { imagePrep: config.imagePrep } : {}),
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
