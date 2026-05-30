'use client';

/**
 * The heart of the Brain: messages + send + the tool-call agent loop.
 *
 * Subsumes the message logic that was duplicated across the Brain Storm page
 * (`send` / auto-reply) and the IDE's `AIChat.sendMessage`. Standardizes on the
 * `brain` client for persistence and on `streamChatCompletion` for replies, and
 * adds the agentic loop: when the model requests tools, the registered handlers
 * run and their results are fed back until the model produces final text.
 *
 * Persistence note: only the user message and the FINAL assistant text are
 * persisted (the chat tables have no tool columns). Intermediate
 * assistant-tool-call turns and tool results live in-memory for the loop, so
 * message rendering stays exactly as before.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { brain, type BrainMessage } from '../builderforceApi';
import { getModality, type ProjectModality } from '../modality';
import {
  streamChatCompletion,
  type BrainToolSpec,
  type ChatCompletionMessage,
} from './streamChatCompletion';
import type { ChatInputAttachment } from '../../components/ChatInput';

/** Max agent-loop iterations before we stop chaining tool calls (runaway guard). */
const MAX_TOOL_ITERATIONS = 5;
/** How much history we send to the model. */
const HISTORY_WINDOW = 80;

export interface UseBrainConversationOptions {
  chatId: number | null;
  modality?: ProjectModality;
  /** Extra system-prompt context (e.g. the IDE's open file + content). */
  extraSystem?: string;
  /** Override the system prompt entirely (Brain Storm uses a fixed persona). */
  systemPrompt?: string;
  /** Tool specs from the page-action registry. */
  toolSpecs?: BrainToolSpec[];
  /** Dispatch a tool call to the registry. */
  runTool?: (name: string, args: unknown) => Promise<unknown>;
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

export function useBrainConversation(options: UseBrainConversationOptions): UseBrainConversation {
  const {
    chatId,
    modality = 'designer',
    extraSystem,
    systemPrompt,
    toolSpecs,
    runTool,
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

  // Load messages whenever the active chat changes.
  useEffect(() => {
    let cancelled = false;
    if (chatId == null) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    setError('');
    brain
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
  }, [chatId]);

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
    const base = systemPrompt ?? getModality(modality).brainSystemPrompt;
    return extraSystem ? `${base}\n${extraSystem}` : base;
  }, [systemPrompt, modality, extraSystem]);

  /**
   * Run the tool-call agent loop against a working message array and persist
   * the final assistant text to `id`. Shared by `send` and auto-reply.
   */
  const runAgentLoop = useCallback(
    async (id: number, history: BrainMessage[]) => {
      const working: ChatCompletionMessage[] = [
        { role: 'system', content: resolvedSystemPrompt },
        ...history.slice(-HISTORY_WINDOW).map((m) => ({
          role: m.role as ChatCompletionMessage['role'],
          content: m.content,
        })),
      ];

      const tools = toolSpecs && toolSpecs.length > 0 ? toolSpecs : undefined;

      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        setStreamingText('');
        const result = await streamChatCompletion(
          { messages: working, tools, tool_choice: tools ? 'auto' : undefined },
          { onTextDelta: (d) => setStreamingText((s) => s + d) },
        );

        if (result.toolCalls.length > 0 && runTool) {
          // Assistant requested tools: record the turn, run each, feed results back.
          working.push({
            role: 'assistant',
            content: result.text,
            tool_calls: result.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.args },
            })),
          });
          for (const tc of result.toolCalls) {
            const out = await runTool(tc.name, parseArgs(tc.args));
            working.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out ?? null) });
          }
          setStreamingText('');
          continue;
        }

        // Final text — persist and finish.
        const finalText = result.text.trim() || 'No response.';
        const [assistantMsg] = await brain.sendMessages(id, [{ role: 'assistant', content: finalText }]);
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingText('');
        onActivity?.(id);
        return;
      }
      // Loop exhausted without a final text answer.
      setStreamingText('');
      setError('The assistant kept calling tools without finishing. Try rephrasing.');
    },
    [resolvedSystemPrompt, toolSpecs, runTool, onActivity],
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

      const attachments = [...pendingAttachments];
      setPendingAttachments([]);
      setSending(true);
      setError('');

      let content = trimmed;
      if (attachments.length > 0) {
        const refs = attachments.map((a) => `[Attached: ${a.name}](${brain.uploadUrl(a.key)})`).join('\n');
        content = `${trimmed}\n\n${refs}`;
      }
      const metadata = attachments.length > 0 ? JSON.stringify({ attachments }) : undefined;

      try {
        const [userMsg] = await brain.sendMessages(id, [{ role: 'user', content, metadata }]);
        setMessages((prev) => [...prev, userMsg]);
        await runAgentLoop(id, [...messages, userMsg]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Send failed');
      } finally {
        setSending(false);
      }
    },
    [chatId, sending, pendingAttachments, messages, ensureChatId, runAgentLoop],
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
    runAgentLoop(chatId, messages)
      .catch((e) => setError(e instanceof Error ? e.message : 'Reply failed'))
      .finally(() => setSending(false));
  }, [chatId, loadingMessages, sending, messages, runAgentLoop]);

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
      await brain.setMessageFeedback(msg.id, next);
    } catch { /* best-effort */ }
  }, [feedbackMap]);

  const attach = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const result = await brain.upload(file);
      setPendingAttachments((prev) => [...prev, { key: result.key, name: result.name, type: result.type }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, []);

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
