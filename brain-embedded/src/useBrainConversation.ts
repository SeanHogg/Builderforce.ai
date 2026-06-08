'use client';

/**
 * The heart of the Brain: messages + send + the tool-call agent loop.
 *
 * Persistence and the streaming client are injected via BrainProvider. When the
 * model requests tools, the registered handlers run and their results are fed
 * back until the model produces final text.
 *
 * Persistence note: only the user message and the FINAL assistant text are
 * persisted (the chat tables have no tool columns). Intermediate
 * assistant-tool-call turns and tool results live in-memory for the loop, so
 * message rendering stays exactly as before.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBrainConfig } from './config';
import type { BrainMessage, BrainModality, ChatInputAttachment } from './types';
import type { BrainToolSpec, ChatCompletionMessage } from './streamChatCompletion';

/** Max agent-loop iterations before we stop chaining tool calls (runaway guard). */
const MAX_TOOL_ITERATIONS = 5;
/** How much history we send to the model. */
const HISTORY_WINDOW = 80;

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
   * Confirm a tool call before it runs (the human-in-the-loop gate). Return
   * false to skip the call — a `{ cancelled: true }` result is fed back to the
   * model so it can adjust. Omit to run every requested tool immediately.
   * Hosts typically gate only mutating tools (see BrainActions `isMutating`).
   */
  confirmTool?: (req: { name: string; args: unknown }) => Promise<boolean>;
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
}

function parseArgs(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Trim the in-memory transcript to the history window before sending it to the
 * model. Slicing can orphan a leading `tool` message whose owning assistant
 * `tool_calls` turn fell off the front — the gateway rejects a tool result that
 * doesn't follow its call — so drop any such leading tool messages.
 */
function windowed(convo: ChatCompletionMessage[]): ChatCompletionMessage[] {
  let w = convo.slice(-HISTORY_WINDOW);
  while (w.length > 0 && w[0].role === 'tool') w = w.slice(1);
  return w;
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
    confirmTool,
    ensureChatId,
    onActivity,
  } = options;

  const [messages, setMessages] = useState<BrainMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<number, 'up' | 'down'>>({});
  const [pendingAttachments, setPendingAttachments] = useState<ChatInputAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const autoRepliedChatIdRef = useRef<number | null>(null);
  // Rich in-memory transcript per chat: the FULL working message list (user +
  // assistant tool-call turns + tool results + assistant text), keyed by chat
  // id. The chat tables only persist user + final-assistant text, so without
  // this the next turn would rebuild from text-only history and lose every
  // entity id / tool result the model resolved in the prior turn — causing it
  // to conflate records across turns (e.g. write company B's name onto company
  // A). The transcript carries that grounding forward for the session lifetime.
  const transcriptRef = useRef<Map<number, ChatCompletionMessage[]>>(new Map());

  // Load messages whenever the active chat changes.
  useEffect(() => {
    let cancelled = false;
    if (chatId == null) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    setError('');
    persistence
      .getMessages(chatId)
      .then((list) => {
        if (!cancelled) setMessages(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load messages');
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => { cancelled = true; };
  }, [persistence, chatId]);

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

  const resolvedSystemPrompt = useMemo(() => {
    const base = systemPrompt ?? resolveSystemPrompt(modality);
    return extraSystem ? `${base}\n${extraSystem}` : base;
  }, [resolveSystemPrompt, systemPrompt, modality, extraSystem]);

  /**
   * Seed a chat's rich transcript from persisted (text-only) history the FIRST
   * time we touch it this session, then append the new user turn. Prior turns
   * can only carry text (the chat tables have no tool columns), but every turn
   * from here on accumulates its full tool-call context in-memory. A no-op seed
   * on later turns means the rich, forward-accumulated transcript always wins.
   */
  const startUserTurn = useCallback((id: number, priorHistory: BrainMessage[], userContent: string) => {
    let convo = transcriptRef.current.get(id);
    if (!convo) {
      convo = priorHistory.map((m) => ({
        role: m.role as ChatCompletionMessage['role'],
        content: m.content,
      }));
      transcriptRef.current.set(id, convo);
    }
    convo.push({ role: 'user', content: userContent });
  }, []);

  /**
   * Run the tool-call agent loop against the chat's rich transcript and persist
   * the final assistant text to `id`. Shared by `send` and auto-reply. The
   * caller must have appended the triggering user turn via `startUserTurn`.
   */
  const runAgentLoop = useCallback(
    async (id: number) => {
      // The transcript accumulates the assistant tool-call turns + tool results
      // in place, so it carries forward to the next turn (the whole fix).
      const convo = transcriptRef.current.get(id) ?? [];
      transcriptRef.current.set(id, convo);

      const tools = toolSpecs && toolSpecs.length > 0 ? toolSpecs : undefined;

      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        setStreamingText('');
        const working: ChatCompletionMessage[] = [
          { role: 'system', content: resolvedSystemPrompt },
          ...windowed(convo),
        ];
        const result = await stream(
          { messages: working, tools, tool_choice: tools ? 'auto' : undefined, model },
          { onTextDelta: (d) => setStreamingText((s) => s + d) },
        );

        if (result.toolCalls.length > 0 && runTool) {
          // Assistant requested tools: record the turn, run each, feed results back.
          convo.push({
            role: 'assistant',
            content: result.text,
            tool_calls: result.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.args },
            })),
          });
          for (const tc of result.toolCalls) {
            const args = parseArgs(tc.args);
            // Human-in-the-loop gate: let the host veto (e.g. mutating tools)
            // before anything runs. A declined call returns a recoverable result
            // so the model can revise instead of the action silently happening.
            if (confirmTool && !(await confirmTool({ name: tc.name, args }))) {
              convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ cancelled: true, reason: 'User declined this action.' }) });
              continue;
            }
            const out = await runTool(tc.name, args);
            convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out ?? null) });
          }
          setStreamingText('');
          continue;
        }

        // Final text — record in the transcript, persist, and finish.
        const finalText = result.text.trim() || 'No response.';
        convo.push({ role: 'assistant', content: finalText });
        const [assistantMsg] = await persistence.sendMessages(id, [{ role: 'assistant', content: finalText }]);
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingText('');
        onActivity?.(id);
        return;
      }
      // Loop exhausted without a final text answer.
      setStreamingText('');
      setError('The assistant kept calling tools without finishing. Try rephrasing.');
    },
    [persistence, stream, resolvedSystemPrompt, toolSpecs, runTool, confirmTool, onActivity, model],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      let id = chatId;
      if (id == null) {
        id = (await ensureChatId?.()) ?? null;
        if (id == null) {
          setError('Could not start a chat.');
          return;
        }
      }
      // Claim the auto-reply guard for this chat: a user-driven send must not be
      // re-answered by the trailing-user-message auto-reply effect (which exists
      // only for chats seeded elsewhere and deep-linked in).
      autoRepliedChatIdRef.current = id;

      const attachments = [...pendingAttachments];
      setPendingAttachments([]);
      setSending(true);
      setError('');

      let content = trimmed;
      if (attachments.length > 0) {
        const refs = attachments.map((a) => `[Attached: ${a.name}](${persistence.uploadUrl(a.key)})`).join('\n');
        content = `${trimmed}\n\n${refs}`;
      }
      const metadata = attachments.length > 0 ? JSON.stringify({ attachments }) : undefined;

      try {
        const [userMsg] = await persistence.sendMessages(id, [{ role: 'user', content, metadata }]);
        setMessages((prev) => [...prev, userMsg]);
        // `messages` (closure) is the prior persisted history, excluding the
        // just-sent user turn — seed from it once, then append this turn.
        startUserTurn(id, messages, content);
        await runAgentLoop(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Send failed');
      } finally {
        setSending(false);
      }
    },
    [persistence, chatId, sending, pendingAttachments, messages, ensureChatId, runAgentLoop, startUserTurn],
  );

  // Auto-reply when a chat loads with a trailing unanswered user message
  // (e.g. a chat seeded elsewhere and deep-linked into the Brain).
  useEffect(() => {
    if (chatId == null || loadingMessages || sending || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'user') return;
    if (autoRepliedChatIdRef.current === chatId) return;
    autoRepliedChatIdRef.current = chatId;
    setSending(true);
    setError('');
    // Seed from everything before the trailing user message, then append it.
    startUserTurn(chatId, messages.slice(0, -1), last.content);
    runAgentLoop(chatId)
      .catch((e) => setError(e instanceof Error ? e.message : 'Reply failed'))
      .finally(() => setSending(false));
  }, [chatId, loadingMessages, sending, messages, runAgentLoop, startUserTurn]);

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
      const result = await persistence.upload(file);
      setPendingAttachments((prev) => [...prev, { key: result.key, name: result.name, type: result.type }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [persistence]);

  const removeAttachment = useCallback((key: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.key !== key));
  }, []);

  return {
    messages,
    loadingMessages,
    sending,
    error,
    streamingText,
    copiedMessageId,
    feedbackMap,
    pendingAttachments,
    uploading,
    send,
    copyMessage,
    submitFeedback,
    attach,
    removeAttachment,
    setError,
  };
}
