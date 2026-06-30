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
/**
 * Memory bounds. Run cells are session-lived (the transcript IS the cross-turn
 * grounding), so without a cap a long session touching many chats grows the
 * module-level `Map` without limit. We keep at most {@link MAX_CELLS} cells,
 * evicting the least-recently-used **idle** ones (never an in-flight run or a
 * cell a mounted view is subscribed to); a re-visited evicted chat just rebuilds
 * its cell and reloads visible history from persistence — the same grounding
 * loss as a page reload. Per-cell, the trace and the live-append buffer are also
 * capped so a single marathon chat can't grow unbounded either.
 */
const MAX_CELLS = 50;
const MAX_TRACE_EVENTS = 500;
const MAX_APPENDED = 50;

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
  /**
   * The live execution trace (LLM turns + tool calls + errors), in order. The
   * same array `getRunTrace` returns — exposed on the snapshot so a mounted view
   * (e.g. the timeline transcript) can render each step AS IT HAPPENS. The
   * snapshot object identity changes on every `emit` (including every
   * `pushTrace`), so consumers re-render even though the array reference is
   * stable; they read it fresh each render. Bounded by {@link MAX_TRACE_EVENTS}.
   */
  trace: BrainTraceEvent[];
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
  trace: [],
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
  const existing = cells.get(chatId);
  if (existing) {
    // Refresh LRU recency: re-insert so this chat moves to the most-recent end
    // (Map preserves insertion order, which we use as the eviction queue).
    cells.delete(chatId);
    cells.set(chatId, existing);
    return existing;
  }
  const c = makeCell();
  cells.set(chatId, c);
  evictIdleCells(chatId);
  return c;
}

/**
 * Evict least-recently-used cells over the cap, skipping any that are still
 * running, have a mounted subscriber, or are `protectId` (the cell we just
 * created and are about to return — its subscriber attaches right after, so it
 * must not be evicted out from under the mounting view). Iterates oldest-first
 * via the Map's insertion order. When everything in range is protected the store
 * is allowed to exceed the cap rather than drop live state.
 */
function evictIdleCells(protectId: number): void {
  if (cells.size <= MAX_CELLS) return;
  for (const [id, cell] of cells) {
    if (cells.size <= MAX_CELLS) break;
    if (id === protectId || cell.running || cell.listeners.size > 0) continue;
    cells.delete(id);
  }
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
    trace: c.trace,
  };
  for (const l of c.listeners) l();
}

function pushTrace(c: RunCell, ev: BrainTraceEvent): void {
  c.trace.push(ev);
  // Bound a single run's trace so a long tool-chain can't grow without limit.
  if (c.trace.length > MAX_TRACE_EVENTS) c.trace.splice(0, c.trace.length - MAX_TRACE_EVENTS);
  emit(c);
}

/**
 * Record a freshly-persisted assistant message for live splice-in and bump the
 * epoch. The buffer is capped to the most recent {@link MAX_APPENDED}: any older
 * entries were already merged into mounted views (merge is id-keyed), and a
 * late-mounting view loads full history from persistence — so trimming is safe
 * and keeps a marathon chat's cell bounded. (Cap ≫ a single run's max turns, so
 * nothing is ever trimmed before delivery within one run.)
 */
function recordAppended(c: RunCell, msg: BrainMessage): void {
  const next = [...c.appended, msg];
  c.appended = next.length > MAX_APPENDED ? next.slice(next.length - MAX_APPENDED) : next;
  c.messagesEpoch += 1;
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
 * model. Slicing the last N can leave the window starting on an `assistant`
 * tool-call turn or an orphaned `tool` result (whose owning call fell off the
 * front). That payload is invalid for strict vendors: Gemini rejects a request
 * whose conversation does not begin with a user turn — surfaced as the cascade
 * `[googleai] 400 INVALID_ARGUMENT` after a long tool-loop crossed the window
 * boundary (it succeeded for ~20 steps, then 400'd once the triggering user
 * turn slid out of the last-N slice). So anchor the window at a user turn.
 *
 * If the last-N slice contains no user turn (a tool loop longer than the
 * window), fall back to the most recent user turn in the FULL transcript and
 * keep everything after it — correctness over the size cap, and bounded by the
 * run's max iterations anyway.
 */
export function windowed(convo: ChatCompletionMessage[]): ChatCompletionMessage[] {
  let w = convo.slice(-HISTORY_WINDOW);
  while (w.length > 0 && w[0].role !== 'user') w = w.slice(1);
  if (w.length === 0) {
    const lastUser = convo.map((m) => m.role).lastIndexOf('user');
    w = lastUser >= 0 ? convo.slice(lastUser) : convo.slice();
  }
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

/** Number of run cells currently retained in memory (diagnostics/tests). */
export function getRunStoreSize(): number {
  return cells.size;
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
          // An empty `arguments` string is not valid JSON; strict vendors (Gemini)
          // reject it. Normalize a no-arg call to an empty object.
          function: { name: tc.name, arguments: tc.args && tc.args.trim() ? tc.args : '{}' },
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
        recordAppended(c, narrationMsg);
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
    recordAppended(c, assistantMsg);
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
