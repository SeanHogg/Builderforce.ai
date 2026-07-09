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
 * Persistence note: the user message and EVERY assistant turn that produced
 * visible text are persisted — both a tool-call turn's narration and the final
 * answer — so each shows as its own durable bubble instead of being erased when
 * the next turn reuses the streaming buffer. Only the tool plumbing (the
 * `tool_calls` metadata and tool results) stays in-memory in the run store (the
 * chat tables have no tool columns); pure tool-call turns with no text persist
 * nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useBrainConfig } from './config';
import type { BrainMessage, BrainModality, ChatInputAttachment } from './types';
import type { BrainToolSpec, ChatCompletionMessage, ContentPart } from './streamChatCompletion';
import type { EvermindRunHooks } from './evermindMemory';
import { prepareImageDataUrl } from './imagePrep';
import { scopeToConsolidation } from './consolidation';
import { withDirectedMetadata, isDirectedToParticipant, type DirectedRecipient } from './directedMessage';
import { buildBrainTriageReport, type BrainTraceEvent } from './brainTriage';
import {
  startRun,
  stopRun,
  isRunning,
  subscribeRun,
  getRunSnapshot,
  getRunTrace,
  resolveRunConfirm,
  clearRunError,
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
  /**
   * Project-Evermind memory hooks, bound by the host to the active chat's project.
   * When set, a run recalls the project's learned memories before answering
   * (grounding the reply) and records recall/learn/reconcile steps in the trace.
   * Omit for a non-project chat.
   */
  evermind?: EvermindRunHooks;
}

export interface UseBrainConversation {
  messages: BrainMessage[];
  loadingMessages: boolean;
  /** Force a transcript refetch without changing the chat id (e.g. after a merge). */
  reloadMessages: () => void;
  sending: boolean;
  error: string;
  /** Live assistant delta buffer (rendered as a trailing bubble while streaming). */
  streamingText: string;
  copiedMessageId: number | null;
  feedbackMap: Record<number, 'up' | 'down'>;
  pendingAttachments: ChatInputAttachment[];
  uploading: boolean;
  /**
   * Persist + answer a user turn. Resolves `true` once the turn is safely
   * persisted and the run has started (the message can no longer be lost), or
   * `false` if it failed before persisting (e.g. the token expired mid-send) —
   * so a composer can restore the text the user typed instead of dropping it.
   */
  send(text: string, opts?: { addressedTo?: DirectedRecipient | null }): Promise<boolean>;
  /**
   * Stop the in-flight run for the active chat: aborts the streaming LLM request
   * and unwinds the agent loop (no error surfaced). No-op when nothing is
   * running. Pair with `sending` to drive a Stop button.
   */
  stop(): void;
  copyMessage(msg: BrainMessage): Promise<void>;
  submitFeedback(msg: BrainMessage, value: 'up' | 'down'): Promise<void>;
  attach(file: File): Promise<void>;
  removeAttachment(key: string): void;
  setError(msg: string): void;
  /**
   * Dismiss the current error banner. Clears BOTH the hook's local error and the
   * run cell's error (a failed LLM stream / tool loop sets the latter, which
   * `setError('')` alone can't reach) — so the user can always close the banner.
   */
  clearError(): void;
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
   * The live execution trace (LLM turns + tool calls + errors) for the active
   * chat, in order — updated AS THE RUN HAPPENS. Render it as the timeline's
   * tool/thinking/error steps; pair it with `messages` for the durable
   * user/assistant turns. Empty when the chat has no run this session.
   */
  trace: BrainTraceEvent[];
  /**
   * Connected providers the gateway could NOT use this run (e.g. an expired Claude
   * subscription that fell back to the shared pool). A mounted view renders a passive
   * "reconnect your account" banner off this; empty when everything resolved.
   */
  byoUnresolved: string[];
  /**
   * Assemble a paste-able triage report of the active chat's execution — the LLM
   * steps, the full tool chain (args + results), intermediate assistant messages,
   * every error, and the visible transcript. `agentLabel` names the persona the
   * Brain ran as; `surface` names where it ran (e.g. `VS Code (VSIX)`). Mirrors the
   * host/cloud "Copy triage info" report.
   */
  buildTriageReport(agentLabel?: string, surface?: string): string;
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
    evermind,
  } = options;

  const [messages, setMessages] = useState<BrainMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  // Bumped by reloadMessages() to force a transcript refetch without changing the
  // chat id — e.g. after another chat is merged INTO this one server-side.
  const [reloadNonce, setReloadNonce] = useState(0);
  const reloadMessages = useCallback(() => setReloadNonce((n) => n + 1), []);
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
  }, [persistence, chatId, reloadNonce]);

  // A run (possibly started in another, now-unmounted Brain instance) persisted
  // assistant messages — splice them in without a refetch. The store delivers
  // the FULL run-appended list (narration turns + final answer), not just the
  // latest, and we merge by id: React coalesces the rapid mid-run emits into one
  // render, so a "last value only" hand-off would drop the intermediate
  // narration turns and the next turn's stream would appear to erase them. Keyed
  // on messagesEpoch so it fires once per completed turn for EVERY mounted
  // instance, not just the one that drove the loop.
  useEffect(() => {
    const appended = snapshot.appended;
    if (appended.length === 0) return;
    setMessages((prev) => {
      const have = new Set(prev.map((m) => m.id));
      const fresh = appended.filter((m) => !have.has(m.id));
      return fresh.length === 0 ? prev : [...prev, ...fresh];
    });
  }, [snapshot.messagesEpoch, snapshot.appended]);

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
      evermind,
      seed,
      userTurn,
    }),
    [fullSystemPrompt, toolSpecs, model, runTool, needsConfirm, stream, persistence, onActivity, evermind],
  );

  const send = useCallback(
    async (text: string, opts?: { addressedTo?: DirectedRecipient | null }): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || localSending || isRunning(chatId)) return false;
      // A message addressed to a participant (an invited agent/human) is a chat
      // turn for THEM, not a directive for the BRAIN — persist it, but don't run
      // the agent loop. `null`/omitted means the BRAIN (existing behavior).
      const addressedTo = opts?.addressedTo ?? null;

      let id = chatId;
      if (id == null) {
        id = (await ensureChatId?.()) ?? null;
        if (id == null) {
          setLocalError('Could not start a chat.');
          return false;
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
      const metadata = withDirectedMetadata(addressedTo, attachments.length > 0 ? { attachments } : undefined);

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
        onActivity?.(id);
        // Addressed to a participant, not the BRAIN: the turn is posted to the
        // chat (visible to everyone) and the BRAIN loop stays idle. The auto-reply
        // guard was already claimed above, and the effect below also skips it, so
        // a later reload won't answer it either.
        if (addressedTo) {
          // An @agent participant actually answers: a chat-scoped run replies AS
          // that agent and posts an assistant turn attributed to it. A @human just
          // gets the posted turn (they'll be notified out-of-band).
          if (addressedTo.kind === 'agent' && persistence.requestAgentReply) {
            try {
              const reply = await persistence.requestAgentReply(id, { agentRef: addressedTo.ref, agentName: addressedTo.name });
              setMessages((prev) => [...prev, reply]);
              onActivity?.(id);
            } catch (e) {
              setLocalError(e instanceof Error ? e.message : 'The agent could not reply.');
            }
          }
          return true;
        }
        // Seed the rich transcript from the prior persisted history (the closure
        // `messages`, excluding the just-sent user turn), then append this turn.
        // Scoped to the last consolidation marker: a consolidated chat sends the
        // summary as its base context instead of the full (large) history.
        const seed: ChatCompletionMessage[] = scopeToConsolidation(messages).map((m) => ({
          role: m.role as ChatCompletionMessage['role'],
          content: m.content,
        }));
        await startRun(id, buildRequest(seed, modelContent));
        return true;
      } catch (e) {
        // Persisting the user turn failed (commonly an expired token) — the turn
        // was NOT saved. Restore the attachments too so the whole message can be
        // resent, and signal failure so the composer keeps the typed text.
        setPendingAttachments(attachments);
        setLocalError(e instanceof Error ? e.message : 'Send failed');
        return false;
      } finally {
        setLocalSending(false);
      }
    },
    [persistence, chatId, localSending, pendingAttachments, messages, ensureChatId, buildRequest, onActivity],
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
    // A trailing message addressed to a participant is NOT a directive for the
    // BRAIN — leave it unanswered (the participant owns the reply).
    if (isDirectedToParticipant(last)) return;
    if (autoRepliedChatIdRef.current === chatId) return;
    autoRepliedChatIdRef.current = chatId;
    setLocalError('');
    const seed: ChatCompletionMessage[] = scopeToConsolidation(messages.slice(0, -1)).map((m) => ({
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

  const clearError = useCallback(() => {
    setLocalError('');
    clearRunError(chatId);
  }, [chatId]);

  const stop = useCallback(() => {
    if (chatId != null) stopRun(chatId);
  }, [chatId]);

  const buildTriageReport = useCallback(
    (agentLabel?: string, surface?: string) =>
      buildBrainTriageReport({
        capturedAt: new Date().toISOString(),
        events: getRunTrace(chatId),
        messages,
        chatId,
        agentLabel,
        surface,
        configuredModel: model,
        error: localError || snapshot.error,
      }),
    [chatId, messages, localError, snapshot.error, model],
  );

  return {
    messages,
    loadingMessages,
    reloadMessages,
    sending: localSending || snapshot.running,
    error: localError || snapshot.error,
    streamingText: snapshot.streamingText,
    copiedMessageId,
    feedbackMap,
    pendingAttachments,
    uploading,
    send,
    stop,
    copyMessage,
    submitFeedback,
    attach,
    removeAttachment,
    setError: setLocalError,
    clearError,
    pendingConfirm: snapshot.pendingConfirm,
    resolveConfirm,
    hasTrace: snapshot.hasTrace,
    trace: snapshot.trace,
    /** Connected providers the gateway couldn't use this run (e.g. an expired Claude
     *  subscription) — a mounted view renders a passive "reconnect your account"
     *  banner off this. Empty when everything resolved. */
    byoUnresolved: snapshot.byoUnresolved,
    buildTriageReport,
  };
}
