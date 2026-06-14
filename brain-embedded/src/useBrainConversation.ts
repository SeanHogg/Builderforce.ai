'use client';

/**
 * The Brain's React binding: messages + send + the live view of the agent loop.
 *
 * The tool-call agent loop itself lives in {@link ./brainRunStore} (a
 * module-level singleton keyed by chatId), NOT in this hook — so a run survives
 * the unmount of the component that started it. When the Brain navigates the
 * user mid-run, the route-scoped panel unmounts and a different one mounts; both
 * subscribe to the same run cell, so the loop keeps streaming into whichever
 * Brain is on screen and a second instance can never spawn a duplicate loop.
 *
 * This hook: loads/persists the visible message list, mirrors the run snapshot
 * (running / streaming delta / error / pending confirmation) into render state,
 * and seeds + starts a run on send / auto-reply.
 *
 * Persistence note: only the user message and the FINAL assistant text are
 * persisted (the chat tables have no tool columns). Intermediate
 * assistant-tool-call turns and tool results live in the run store for the loop.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBrainConfig } from './config';
import type { BrainMessage, BrainModality, ChatInputAttachment } from './types';
import type { BrainToolSpec, ChatCompletionMessage, ContentPart } from './streamChatCompletion';
import { prepareImageDataUrl } from './imagePrep';
import { buildBrainTriageReport } from './brainTriage';
import {
  startRun,
  isRunning,
  subscribeRun,
  getRunSnapshot,
  getRunTrace,
  resolveRunConfirm,
} from './brainRunStore';

export interface UseBrainConversationOptions {
  chatId: number | null;
  modality?: BrainModality;
  /** Extra system-prompt context (e.g. an IDE's open file + content). */
  extraSystem?: string;
  /** Override the system prompt entirely (e.g. a fixed Brain Storm persona). */
  systemPrompt?: string;
  /** Override the model (e.g. run the Brain as a specific assigned agent). */
  model?: string;
  /** Tool specs from the page-action registry. */
  toolSpecs?: BrainToolSpec[];
  /** Dispatch a tool call to the registry. */
  runTool?: (name: string, args: unknown) => Promise<unknown>;
  /**
   * Pure predicate: return true to pause the loop for an explicit user
   * confirmation before the tool runs (the human-in-the-loop gate). The prompt
   * UI is driven by `pendingConfirm` + `resolveConfirm` on the return value, so
   * the gate survives a navigation that swaps which Brain panel is mounted.
   * Hosts typically gate only mutating tools (see BrainActions `isMutating`).
   * Omit to run every requested tool immediately.
   */
  needsConfirm?: (req: { name: string; args: unknown }) => boolean;
  /** Create-on-demand when sending without an active chat; returns the new chat id. */
  ensureChatId?: () => Promise<number | null>;
  /** Notify the host (chats hook) that this chat got new activity. */
  onActivity?: (chatId: number) => void;
}

export interface UseBrainConversation {
  messages: BrainMessage[];
  loadingMessages: boolean;
  sending: boolean;
  error: string;
  /** Live assistant delta buffer (rendered as a trailing bubble while streaming). */
  streamingText: string;
  copiedMessageId: number | null;
  feedbackMap: Record<number, 'up' | 'down'>;
  pendingAttachments: ChatInputAttachment[];
  uploading: boolean;
  send(text: string): Promise<void>;
  copyMessage(msg: BrainMessage): Promise<void>;
  submitFeedback(msg: BrainMessage, value: 'up' | 'down'): Promise<void>;
  attach(file: File): Promise<void>;
  removeAttachment(key: string): void;
  setError(msg: string): void;
  /** A tool call awaiting the user's Approve/Cancel decision (or null). */
  pendingConfirm: { name: string; args: unknown } | null;
  /** Resolve the pending confirmation. */
  resolveConfirm(ok: boolean): void;
  /**
   * True once the active chat has any recorded execution steps (LLM/tool/error)
   * — drives the "capture execution" affordance.
   */
  hasTrace: boolean;
  /**
   * Assemble a paste-able triage report of the active chat's execution — the LLM
   * steps, the full tool chain (args + results), intermediate assistant messages,
   * every error, and the visible transcript. `agentLabel` names the persona the
   * Brain ran as. Mirrors the host/cloud "Copy triage info" report.
   */
  buildTriageReport(agentLabel?: string): string;
}

export function useBrainConversation(options: UseBrainConversationOptions): UseBrainConversation {
  const { persistence, resolveSystemPrompt, stream } = useBrainConfig();
  const {
    chatId,
    modality = 'designer',
    extraSystem,
    systemPrompt,
    model,
    toolSpecs,
    runTool,
    needsConfirm,
    ensureChatId,
    onActivity,
  } = options;

  const [messages, setMessages] = useState<BrainMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [localSending, setLocalSending] = useState(false);
  const [localError, setLocalError] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<number, 'up' | 'down'>>({});
  const [pendingAttachments, setPendingAttachments] = useState<ChatInputAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const autoRepliedChatIdRef = useRef<number | null>(null);

  // Live view of the chat's run (owned by the module-level store). Re-read the
  // snapshot on every store emit; the snapshot identity is stable until it
  // actually changes, so this only re-renders when the run state moves.
  const [snapshot, setSnapshot] = useState(() => getRunSnapshot(chatId));
  useEffect(() => {
    setSnapshot(getRunSnapshot(chatId));
    if (chatId == null) return;
    return subscribeRun(chatId, () => setSnapshot(getRunSnapshot(chatId)));
  }, [chatId]);

  // Load messages whenever the active chat changes.
  useEffect(() => {
    let cancelled = false;
    if (chatId == null) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    setLocalError('');
    persistence
      .getMessages(chatId)
      .then((list) => {
        if (!cancelled) setMessages(list);
      })
      .catch((e) => {
        if (!cancelled) setLocalError(e instanceof Error ? e.message : 'Failed to load messages');
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => { cancelled = true; };
  }, [persistence, chatId]);

  // A run (possibly started in another, now-unmounted Brain instance) persisted
  // a new assistant message — splice it in without a refetch. Keyed on the
  // store's messagesEpoch so it fires once per completed turn for EVERY mounted
  // instance, not just the one that drove the loop.
  useEffect(() => {
    const msg = snapshot.lastAssistant;
    if (!msg) return;
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }, [snapshot.messagesEpoch, snapshot.lastAssistant]);

  // Derive feedback state from persisted message metadata.
  useEffect(() => {
    const map: Record<number, 'up' | 'down'> = {};
    for (const msg of messages) {
      if (!msg.metadata) continue;
      try {
        const meta = JSON.parse(msg.metadata) as { feedback?: 'up' | 'down' };
        if (meta.feedback === 'up' || meta.feedback === 'down') map[msg.id] = meta.feedback;
      } catch { /* ignore */ }
    }
    setFeedbackMap(map);
  }, [messages]);

  const resolvedSystemPrompt = systemPrompt ?? resolveSystemPrompt(modality);
  const fullSystemPrompt = extraSystem ? `${resolvedSystemPrompt}\n${extraSystem}` : resolvedSystemPrompt;

  /** Assemble the BrainRunRequest from the current options (captured at run start). */
  const buildRequest = useCallback(
    (seed?: ChatCompletionMessage[], userTurn?: string | ContentPart[]) => ({
      resolvedSystemPrompt: fullSystemPrompt,
      tools: toolSpecs && toolSpecs.length > 0 ? toolSpecs : undefined,
      model,
      runTool,
      needsConfirm,
      stream,
      persistence,
      onActivity,
      seed,
      userTurn,
    }),
    [fullSystemPrompt, toolSpecs, model, runTool, needsConfirm, stream, persistence, onActivity],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || localSending || isRunning(chatId)) return;

      let id = chatId;
      if (id == null) {
        id = (await ensureChatId?.()) ?? null;
        if (id == null) {
          setLocalError('Could not start a chat.');
          return;
        }
      }
      // Claim the auto-reply guard for this chat: a user-driven send must not be
      // re-answered by the trailing-user-message auto-reply effect.
      autoRepliedChatIdRef.current = id;

      const attachments = [...pendingAttachments];
      setPendingAttachments([]);
      setLocalSending(true);
      setLocalError('');

      // Persisted/display content stays text-only (the chat tables store a
      // string): every attachment shows as a markdown link the user can click.
      let displayContent = trimmed;
      if (attachments.length > 0) {
        const refs = attachments.map((a) => `[Attached: ${a.name}](${persistence.uploadUrl(a.key)})`).join('\n');
        displayContent = `${trimmed}\n\n${refs}`;
      }
      const metadata = attachments.length > 0 ? JSON.stringify({ attachments }) : undefined;

      // Model-visible content: inline images as `image_url` vision parts (the
      // gateway routes these to a vision model), keeping any non-image
      // attachments as text links. Without an image it stays a plain string.
      const imageAtts = attachments.filter((a) => a.imageUrl);
      let modelContent: string | ContentPart[] = displayContent;
      if (imageAtts.length > 0) {
        const nonImageRefs = attachments
          .filter((a) => !a.imageUrl)
          .map((a) => `[Attached: ${a.name}](${persistence.uploadUrl(a.key)})`)
          .join('\n');
        const textPart = [trimmed, nonImageRefs].filter(Boolean).join('\n\n');
        modelContent = [
          { type: 'text', text: textPart },
          ...imageAtts.map((a) => ({ type: 'image_url' as const, image_url: { url: a.imageUrl! } })),
        ];
      }

      try {
        const [userMsg] = await persistence.sendMessages(id, [{ role: 'user', content: displayContent, metadata }]);
        setMessages((prev) => [...prev, userMsg]);
        // Seed the rich transcript from the prior persisted history (the closure
        // `messages`, excluding the just-sent user turn), then append this turn.
        const seed: ChatCompletionMessage[] = messages.map((m) => ({
          role: m.role as ChatCompletionMessage['role'],
          content: m.content,
        }));
        await startRun(id, buildRequest(seed, modelContent));
      } catch (e) {
        setLocalError(e instanceof Error ? e.message : 'Send failed');
      } finally {
        setLocalSending(false);
      }
    },
    [persistence, chatId, localSending, pendingAttachments, messages, ensureChatId, buildRequest],
  );

  // Auto-reply when a chat loads with a trailing unanswered user message
  // (e.g. a chat seeded elsewhere and deep-linked into the Brain). Skipped when
  // a run for this chat is already in flight (the store is single-flight, so
  // this only guards against starting redundant work / a self re-answer).
  useEffect(() => {
    if (chatId == null || loadingMessages || localSending || messages.length === 0) return;
    if (isRunning(chatId)) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'user') return;
    if (autoRepliedChatIdRef.current === chatId) return;
    autoRepliedChatIdRef.current = chatId;
    setLocalError('');
    const seed: ChatCompletionMessage[] = messages.slice(0, -1).map((m) => ({
      role: m.role as ChatCompletionMessage['role'],
      content: m.content,
    }));
    void startRun(chatId, buildRequest(seed, last.content));
  }, [chatId, loadingMessages, localSending, messages, buildRequest]);

  const copyMessage = useCallback(async (msg: BrainMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMessageId(msg.id);
      setTimeout(() => setCopiedMessageId((cur) => (cur === msg.id ? null : cur)), 2000);
    } catch { /* ignore */ }
  }, []);

  const submitFeedback = useCallback(async (msg: BrainMessage, value: 'up' | 'down') => {
    const current = feedbackMap[msg.id];
    const next = current === value ? null : value;
    setFeedbackMap((prev) => {
      const copy = { ...prev };
      if (next) copy[msg.id] = next;
      else delete copy[msg.id];
      return copy;
    });
    try {
      await persistence.setMessageFeedback(msg.id, next);
    } catch { /* best-effort */ }
  }, [persistence, feedbackMap]);

  const attach = useCallback(async (file: File) => {
    setUploading(true);
    try {
      // Always upload the original so it persists + renders in chat history.
      const result = await persistence.upload(file);
      const attachment: ChatInputAttachment = { key: result.key, name: result.name, type: result.type };
      // For raster images, also resolve a model-visible source so the vision
      // model can actually see it: inline a downscaled data URL when it fits,
      // else fall back to a short-lived signed URL of the uploaded object.
      try {
        const prepared = await prepareImageDataUrl(file);
        if (prepared?.dataUrl) {
          attachment.imageUrl = prepared.dataUrl;
        } else if (prepared?.tooLarge && persistence.signedUploadUrl) {
          attachment.imageUrl = await persistence.signedUploadUrl(result.key);
        }
      } catch { /* non-fatal: fall back to the text-link path */ }
      setPendingAttachments((prev) => [...prev, attachment]);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [persistence]);

  const removeAttachment = useCallback((key: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.key !== key));
  }, []);

  const resolveConfirm = useCallback((ok: boolean) => {
    if (chatId != null) resolveRunConfirm(chatId, ok);
  }, [chatId]);

  const buildTriageReport = useCallback(
    (agentLabel?: string) =>
      buildBrainTriageReport({
        capturedAt: new Date().toISOString(),
        events: getRunTrace(chatId),
        messages,
        chatId,
        agentLabel,
        error: localError || snapshot.error,
      }),
    [chatId, messages, localError, snapshot.error],
  );

  return {
    messages,
    loadingMessages,
    sending: localSending || snapshot.running,
    error: localError || snapshot.error,
    streamingText: snapshot.streamingText,
    copiedMessageId,
    feedbackMap,
    pendingAttachments,
    uploading,
    send,
    copyMessage,
    submitFeedback,
    attach,
    removeAttachment,
    setError: setLocalError,
    pendingConfirm: snapshot.pendingConfirm,
    resolveConfirm,
    hasTrace: snapshot.hasTrace,
    buildTriageReport,
  };
}
