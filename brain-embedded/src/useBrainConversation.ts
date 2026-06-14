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
import type { BrainToolSpec, ChatCompletionMessage, ContentPart } from './streamChatCompletion';
import { prepareImageDataUrl } from './imagePrep';
import { buildBrainTriageReport, isFailedToolResult, type BrainTraceEvent } from './brainTriage';

/**
 * Max agent-loop iterations before we stop chaining tool calls (runaway guard).
 * Each iteration is one model turn and can batch several tool calls, but models
 * commonly emit one call per turn — so the cap must be high enough for real bulk
 * operations (e.g. "link 50 tickets to their epics, archive 18 duplicates") to
 * complete instead of dying with "kept calling tools without finishing".
 */
const MAX_TOOL_ITERATIONS = 25;
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
  // Per-chat execution trace: every LLM step, tool call (args + result + timing),
  // intermediate assistant message, and error the agent loop produces. Accumulates
  // across turns for the session (like the transcript) so "capture execution"
  // reports the whole run, not just the last turn. `traceVersion` re-renders the
  // capture affordance as steps land (the ref mutation alone wouldn't).
  const traceRef = useRef<Map<number, BrainTraceEvent[]>>(new Map());
  const [traceVersion, setTraceVersion] = useState(0);
  const pushTrace = useCallback((id: number, ev: BrainTraceEvent) => {
    const list = traceRef.current.get(id) ?? [];
    list.push(ev);
    traceRef.current.set(id, list);
    setTraceVersion((v) => v + 1);
  }, []);

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
  const startUserTurn = useCallback((id: number, priorHistory: BrainMessage[], userContent: string | ContentPart[]) => {
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
        const llmStart = Date.now();
        let result;
        try {
          result = await stream(
            { messages: working, tools, tool_choice: tools ? 'auto' : undefined, model },
            { onTextDelta: (d) => setStreamingText((s) => s + d) },
          );
        } catch (e) {
          // Capture the completion failure in the trace before it bubbles to the
          // caller's catch — otherwise the run is invisible to "capture execution".
          pushTrace(id, {
            ts: new Date().toISOString(),
            category: 'error',
            label: 'llm.complete',
            durationMs: Date.now() - llmStart,
            args: { model: model ?? 'default', step: iter },
            result: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
            isError: true,
          });
          throw e;
        }
        pushTrace(id, {
          ts: new Date().toISOString(),
          category: 'llm',
          label: 'llm.complete',
          durationMs: Date.now() - llmStart,
          args: { model: model ?? 'default', step: iter, toolCalls: result.toolCalls.length },
          result: `${result.toolCalls.length} tool call(s) · ${result.text.length} chars · finish: ${result.finishReason ?? '—'}`,
        });
        // Intermediate assistant text (the model's reasoning before a tool call).
        if (result.text.trim()) {
          pushTrace(id, {
            ts: new Date().toISOString(),
            category: 'message',
            label: 'agent.message',
            args: { step: iter },
            result: result.text,
          });
        }

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
              pushTrace(id, {
                ts: new Date().toISOString(),
                category: 'tool',
                label: tc.name,
                args,
                result: { cancelled: true, reason: 'User declined this action.' },
              });
              continue;
            }
            const toolStart = Date.now();
            let out: unknown;
            try {
              out = await runTool(tc.name, args);
            } catch (e) {
              // A thrown tool error becomes a recoverable result the model can see
              // and revise against (matching the decline path) — and is recorded
              // as an error so it surfaces in the captured triage report. Without
              // this the throw aborted the turn and lost which tool/args failed.
              const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
              out = { ok: false, error: message };
              convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
              pushTrace(id, {
                ts: new Date().toISOString(),
                category: 'tool',
                label: tc.name,
                durationMs: Date.now() - toolStart,
                args,
                result: out,
                isError: true,
              });
              continue;
            }
            convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out ?? null) });
            pushTrace(id, {
              ts: new Date().toISOString(),
              category: 'tool',
              label: tc.name,
              durationMs: Date.now() - toolStart,
              args,
              result: out ?? null,
              isError: isFailedToolResult(out),
            });
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
      const exhausted = 'The assistant kept calling tools without finishing. Try rephrasing.';
      pushTrace(id, {
        ts: new Date().toISOString(),
        category: 'error',
        label: 'agent.loop',
        result: `Loop exhausted after ${MAX_TOOL_ITERATIONS} tool iterations`,
        isError: true,
      });
      setError(exhausted);
    },
    [persistence, stream, resolvedSystemPrompt, toolSpecs, runTool, confirmTool, onActivity, model, pushTrace],
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
        const text = [trimmed, nonImageRefs].filter(Boolean).join('\n\n');
        modelContent = [
          { type: 'text', text },
          ...imageAtts.map((a) => ({ type: 'image_url' as const, image_url: { url: a.imageUrl! } })),
        ];
      }

      try {
        const [userMsg] = await persistence.sendMessages(id, [{ role: 'user', content: displayContent, metadata }]);
        setMessages((prev) => [...prev, userMsg]);
        // `messages` (closure) is the prior persisted history, excluding the
        // just-sent user turn — seed from it once, then append this turn (rich
        // multimodal content when images are present, so the model keeps seeing
        // them on later turns of the same session).
        startUserTurn(id, messages, modelContent);
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
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [persistence]);

  const removeAttachment = useCallback((key: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.key !== key));
  }, []);

  // Capture the active chat's execution as a paste-able triage report. Read off
  // `traceVersion` so it re-derives as the loop records steps.
  const activeTrace = chatId != null ? (traceRef.current.get(chatId) ?? []) : [];
  const hasTrace = activeTrace.length > 0;
  void traceVersion; // dependency marker — see traceRef note above
  const buildTriageReport = useCallback(
    (agentLabel?: string) =>
      buildBrainTriageReport({
        capturedAt: new Date().toISOString(),
        events: chatId != null ? (traceRef.current.get(chatId) ?? []) : [],
        messages,
        chatId,
        agentLabel,
        error,
      }),
    [chatId, messages, error],
  );

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
    hasTrace,
    buildTriageReport,
  };
}
