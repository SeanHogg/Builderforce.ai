'use client';

/**
 * Module-level Brain run engine — the agent tool-loop, hoisted OUT of React so a
 * run survives the unmount of the component that started it.
 *
 * Why this exists: the Brain UI (BrainPanel) is mounted per-route — the full
 * page `/brainstorm`, the IDE-embedded panel, the floating drawer. When the
 * Brain navigates the user mid-run (a `navigate_to` tool call), the route-scoped
 * panel unmounts. Previously the loop's state (rich transcript, trace, streaming
 * delta, the human-in-the-loop confirm resolver) lived in that component's refs,
 * so the run was orphaned: its React state updates went nowhere, the freshly
 * mounted instance lost all grounding, and — worst — it re-answered the trailing
 * user message, spawning a SECOND concurrent loop (duplicate writes).
 *
 * The fix: one run per chat lives here, keyed by chatId, single-flight. Any
 * mounted Brain instance subscribes to its chat's cell and renders the live run;
 * a second instance that tries to start the same chat is a no-op. Every turn
 * that produces visible text — both intermediate tool-call narration and the
 * final answer — is persisted as its own message; mounted instances pick each
 * one up via `messagesEpoch`, so a turn's narration is a durable block instead
 * of transient streaming text the next turn overwrites. The confirm gate also
 * lives here, so a navigation that swaps which panel is mounted can still
 * resolve a pending confirmation.
 *
 * This module owns NO React — `useBrainConversation` is the thin binding.
 */

import type { BrainMessage } from './types';
import type {
  BrainToolSpec,
  ChatCompletionMessage,
  ContentPart,
  StreamChatOptions,
  StreamHandlers,
  StreamChatResult,
} from './streamChatCompletion';
import { isFailedToolResult, type BrainTraceEvent } from './brainTriage';

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

/** Streaming fn shape (matches BrainRuntime.stream). */
export type BrainStreamFn = (
  opts: Omit<StreamChatOptions, 'transport'>,
  handlers?: StreamHandlers,
) => Promise<StreamChatResult>;

/** Persistence subset the loop needs (matches BrainPersistenceAdapter). */
export interface BrainRunPersistence {
  sendMessages(
    chatId: number,
    messages: Array<{ role: string; content: string; metadata?: string }>,
  ): Promise<BrainMessage[]>;
}

/** Everything a single run needs, captured at start time (survives navigation). */
export interface BrainRunRequest {
  resolvedSystemPrompt: string;
  tools?: BrainToolSpec[];
  model?: string;
  runTool?: (name: string, args: unknown) => Promise<unknown>;
  /** Pure predicate: true → pause the loop for an explicit user confirmation. */
  needsConfirm?: (req: { name: string; args: unknown }) => boolean;
  stream: BrainStreamFn;
  persistence: BrainRunPersistence;
  onActivity?: (chatId: number) => void;
  /** Seed the rich transcript from prior persisted history (first turn only). */
  seed?: ChatCompletionMessage[];
  /** The user turn that triggered this run, appended to the transcript. */
  userTurn?: string | ContentPart[];
}

/** Live, observable snapshot of a chat's run (what the hook renders). */
export interface BrainRunSnapshot {
  running: boolean;
  streamingText: string;
  error: string;
  pendingConfirm: { name: string; args: unknown } | null;
  /** Bumped whenever a new assistant message is persisted. */
  messagesEpoch: number;
  /**
   * Every assistant message this run has persisted, in order (narration turns +
   * the final answer). Delivered as a list — not a single "last" value — so a
   * mounted view merges them all by id even when React coalesces the rapid
   * mid-run emits into one render and never sees the intermediate snapshots.
   */
  appended: BrainMessage[];
  hasTrace: boolean;
}

interface RunCell {
  /** Rich working transcript (user + assistant tool-call turns + tool results). */
  transcript: ChatCompletionMessage[];
  trace: BrainTraceEvent[];
  running: boolean;
  streamingText: string;
  error: string;
  pendingConfirm: { name: string; args: unknown } | null;
  confirmResolver: ((ok: boolean) => void) | null;
  appended: BrainMessage[];
  messagesEpoch: number;
  listeners: Set<() => void>;
  /** Cached immutable snapshot; identity changes only when something changed. */
  snapshot: BrainRunSnapshot;
}

const cells = new Map<number, RunCell>();

const EMPTY_SNAPSHOT: BrainRunSnapshot = {
  running: false,
  streamingText: '',
  error: '',
  pendingConfirm: null,
  messagesEpoch: 0,
  appended: [],
  hasTrace: false,
};

function makeCell(): RunCell {
  return {
    transcript: [],
    trace: [],
    running: false,
    streamingText: '',
    error: '',
    pendingConfirm: null,
    confirmResolver: null,
    appended: [],
    messagesEpoch: 0,
    listeners: new Set(),
    snapshot: EMPTY_SNAPSHOT,
  };
}

function getCell(chatId: number): RunCell {
  let c = cells.get(chatId);
  if (!c) {
    c = makeCell();
    cells.set(chatId, c);
  }
  return c;
}

/** Re-derive the cached snapshot and notify subscribers. */
function emit(c: RunCell): void {
  c.snapshot = {
    running: c.running,
    streamingText: c.streamingText,
    error: c.error,
    pendingConfirm: c.pendingConfirm,
    messagesEpoch: c.messagesEpoch,
    appended: c.appended,
    hasTrace: c.trace.length > 0,
  };
  for (const l of c.listeners) l();
}

function pushTrace(c: RunCell, ev: BrainTraceEvent): void {
  c.trace.push(ev);
  emit(c);
}

function nowMs(): number {
  return typeof Date !== 'undefined' ? Date.now() : 0;
}

function nowIso(): string {
  return typeof Date !== 'undefined' ? new Date().toISOString() : '';
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Drop all run state. For tests/teardown only — there's no per-chat eviction in
 * normal operation (transcripts are session-lived grounding, as before).
 */
export function resetBrainRunStore(): void {
  cells.clear();
}

/** Subscribe to a chat's run state. Returns an unsubscribe fn. */
export function subscribeRun(chatId: number, listener: () => void): () => void {
  const c = getCell(chatId);
  c.listeners.add(listener);
  return () => {
    c.listeners.delete(listener);
  };
}

/** Current snapshot (referentially stable until something changes). */
export function getRunSnapshot(chatId: number | null): BrainRunSnapshot {
  if (chatId == null) return EMPTY_SNAPSHOT;
  return (cells.get(chatId)?.snapshot) ?? EMPTY_SNAPSHOT;
}

export function isRunning(chatId: number | null): boolean {
  return chatId != null && (cells.get(chatId)?.running ?? false);
}

/** The accumulated execution trace for a chat (for the capture/triage report). */
export function getRunTrace(chatId: number | null): BrainTraceEvent[] {
  if (chatId == null) return [];
  return cells.get(chatId)?.trace ?? [];
}

/** Resolve a pending human-in-the-loop confirmation. No-op if none is pending. */
export function resolveRunConfirm(chatId: number, ok: boolean): void {
  const c = cells.get(chatId);
  if (!c || !c.confirmResolver) return;
  const resolve = c.confirmResolver;
  c.confirmResolver = null;
  c.pendingConfirm = null;
  emit(c);
  resolve(ok);
}

/**
 * Start (or no-op join) the agent loop for a chat. Single-flight per chat: if a
 * run is already in flight the call returns immediately, so a second mounted
 * Brain instance can never spawn a duplicate loop. The claim is synchronous
 * (set before any await), so two callers in the same tick can't both pass it.
 */
export async function startRun(chatId: number, req: BrainRunRequest): Promise<void> {
  const c = getCell(chatId);
  if (c.running) return; // already running elsewhere — never double-fire
  c.running = true;
  c.error = '';
  c.streamingText = '';

  // Seed the rich transcript from prior persisted history the FIRST time we
  // touch this chat this session, then append the triggering user turn — done
  // here (inside the single-flight claim) so a racing send + auto-reply can't
  // both append the user turn to the transcript.
  if (req.seed && c.transcript.length === 0) c.transcript = req.seed.slice();
  if (req.userTurn !== undefined) c.transcript.push({ role: 'user', content: req.userTurn });
  emit(c);

  try {
    await runLoop(chatId, c, req);
  } catch (e) {
    c.error = e instanceof Error ? e.message : 'Reply failed';
  } finally {
    c.running = false;
    c.streamingText = '';
    emit(c);
  }
}

async function runLoop(chatId: number, c: RunCell, req: BrainRunRequest): Promise<void> {
  const { resolvedSystemPrompt, tools: toolSpecs, model, runTool, needsConfirm, stream, persistence, onActivity } = req;
  const convo = c.transcript;
  const tools = toolSpecs && toolSpecs.length > 0 ? toolSpecs : undefined;

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    c.streamingText = '';
    emit(c);
    const working: ChatCompletionMessage[] = [
      { role: 'system', content: resolvedSystemPrompt },
      ...windowed(convo),
    ];
    const llmStart = nowMs();
    let result;
    try {
      result = await stream(
        { messages: working, tools, tool_choice: tools ? 'auto' : undefined, model },
        { onTextDelta: (d) => { c.streamingText += d; emit(c); } },
      );
    } catch (e) {
      pushTrace(c, {
        ts: nowIso(),
        category: 'error',
        label: 'llm.complete',
        durationMs: nowMs() - llmStart,
        args: { model: model ?? 'default', step: iter },
        result: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        isError: true,
      });
      throw e;
    }
    pushTrace(c, {
      ts: nowIso(),
      category: 'llm',
      label: 'llm.complete',
      durationMs: nowMs() - llmStart,
      args: { model: model ?? 'default', step: iter, toolCalls: result.toolCalls.length },
      result: `${result.toolCalls.length} tool call(s) · ${result.text.length} chars · finish: ${result.finishReason ?? '—'}`,
    });
    if (result.text.trim()) {
      pushTrace(c, { ts: nowIso(), category: 'message', label: 'agent.message', args: { step: iter }, result: result.text });
    }

    if (result.toolCalls.length > 0 && runTool) {
      convo.push({
        role: 'assistant',
        content: result.text,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.args },
        })),
      });
      // Commit this turn's visible narration as its OWN permanent message block
      // before we clear the streaming buffer for the next iteration. Without
      // this, the narration only lived in the transient `streamingText` bubble,
      // and the next turn's stream reused that same bubble — erasing what the
      // user just read. Each turn that says something now gets a durable block;
      // empty (pure tool-call) turns persist nothing.
      const narration = result.text.trim();
      if (narration) {
        const [narrationMsg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: result.text }]);
        c.appended = [...c.appended, narrationMsg];
        c.messagesEpoch += 1;
      }
      c.streamingText = '';
      emit(c);
      for (const tc of result.toolCalls) {
        const args = parseArgs(tc.args);
        // Human-in-the-loop gate: pause for an explicit confirm when the host's
        // predicate says so. The resolver lives on the cell, so whichever Brain
        // instance is mounted (even after a navigation swapped it) can answer.
        if (needsConfirm && needsConfirm({ name: tc.name, args })) {
          const ok = await new Promise<boolean>((resolve) => {
            c.pendingConfirm = { name: tc.name, args };
            c.confirmResolver = resolve;
            emit(c);
          });
          if (!ok) {
            convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ cancelled: true, reason: 'User declined this action.' }) });
            pushTrace(c, { ts: nowIso(), category: 'tool', label: tc.name, args, result: { cancelled: true, reason: 'User declined this action.' } });
            continue;
          }
        }
        const toolStart = nowMs();
        let out: unknown;
        try {
          out = await runTool(tc.name, args);
        } catch (e) {
          const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          out = { ok: false, error: message };
          convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
          pushTrace(c, { ts: nowIso(), category: 'tool', label: tc.name, durationMs: nowMs() - toolStart, args, result: out, isError: true });
          continue;
        }
        convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out ?? null) });
        pushTrace(c, { ts: nowIso(), category: 'tool', label: tc.name, durationMs: nowMs() - toolStart, args, result: out ?? null, isError: isFailedToolResult(out) });
      }
      continue;
    }

    // Final text — record in the transcript, persist, broadcast to mounted views.
    const finalText = result.text.trim() || 'No response.';
    convo.push({ role: 'assistant', content: finalText });
    const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: finalText }]);
    c.streamingText = '';
    c.appended = [...c.appended, assistantMsg];
    c.messagesEpoch += 1;
    emit(c);
    onActivity?.(chatId);
    return;
  }

  // Loop exhausted without a final text answer.
  c.streamingText = '';
  pushTrace(c, {
    ts: nowIso(),
    category: 'error',
    label: 'agent.loop',
    result: `Loop exhausted after ${MAX_TOOL_ITERATIONS} tool iterations`,
    isError: true,
  });
  c.error = 'The assistant kept calling tools without finishing. Try rephrasing.';
  emit(c);
}
