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
import { withProvenanceMetadata, type ProvenanceAccount } from './provenance';
import {
  formatEvermindMemoryBlock,
  countReconciledMemories,
  EVERMIND_LEARN_MIN_CHARS,
  type EvermindRunHooks,
  type EvermindRecallResult,
} from './evermindMemory';

/**
 * Build the provenance metadata for a persisted assistant turn from the stream
 * result — the resolved model + which account served it (`x-builderforce-account`,
 * captured as `result.account`). Returns `undefined` when the gateway reported no
 * account (older gateway / header not exposed), so the message simply carries no
 * provenance rather than a half-populated blob. Shared by both the mid-run
 * narration and the final-answer persist so the chip shows on every durable turn.
 */
function provenanceMetadata(result: StreamChatResult): string | undefined {
  const model = result.resolvedModel;
  const account = result.account;
  if (!model || (account !== 'own' && account !== 'shared' && account !== 'shared_byo_unused')) return undefined;
  return withProvenanceMetadata({ model, account: account as ProvenanceAccount });
}

/**
 * Max agent-loop iterations before we stop chaining tool calls (runaway guard).
 * Each iteration is one model turn and can batch several tool calls, but models
 * commonly emit one call per turn — so the cap must be high enough for real bulk
 * operations (e.g. "link 50 tickets to their epics, archive 18 duplicates") to
 * complete instead of dying with "kept calling tools without finishing".
 */
const MAX_TOOL_ITERATIONS = 25;
/** How much history we send to the model (message-count ceiling). */
const HISTORY_WINDOW = 80;
/**
 * Token budget for the working transcript sent to the model each turn. This is
 * the real backstop against the "Brain dies after several executions" failure:
 * message-count windowing (HISTORY_WINDOW) alone does NOT bound context, because
 * a single `tasks.list` tool result can be tens of thousands of tokens. We
 * estimate tokens (≈4 chars/token) and drop the oldest turns — after the
 * user-turn anchor — until the working set fits. Sized well under the smallest
 * pool model's window so a mid-run gateway failover to a smaller model can't
 * 413. See {@link windowed}.
 */
const HISTORY_TOKEN_BUDGET = 24_000;
/**
 * Per-tool-result cap (chars) for what we put into the MODEL transcript. The
 * full result is still recorded in the trace (for the timeline + triage copy);
 * only the copy the model re-reads every turn is trimmed. A `tasks.list`
 * returning 352 full rows is what filled the window and killed the run — the
 * model gets a truncated head plus a marker telling it to narrow the query.
 */
const MAX_TOOL_RESULT_CHARS = 6_000;

/** Cheap token estimate from a char count — chars/4, the gateway's heuristic. */
function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/** Estimated tokens for one chat message (content + any tool-call payloads). */
function messageTokens(m: ChatCompletionMessage): number {
  let chars = typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length;
  if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  return estimateTokens(chars) + 4; // +4 for role/framing overhead
}

/**
 * Trim a tool result to what the model transcript can afford. Returns the
 * (possibly truncated) string to store as the tool message plus diagnostics
 * (original byte size + whether it was truncated) for the trace. Large results
 * get a head slice and an explicit marker so the model knows data was elided and
 * can re-call the tool with a narrower filter/limit instead of assuming it saw
 * everything.
 */
function trimToolResult(out: unknown): { content: string; bytes: number; truncated: boolean } {
  const full = JSON.stringify(out ?? null);
  const bytes = full.length;
  if (bytes <= MAX_TOOL_RESULT_CHARS) return { content: full, bytes, truncated: false };
  // If the result is an array, tell the model how many items were dropped — that
  // is the signal it needs to add a `limit`/`status`/`projectId` filter.
  const itemNote = Array.isArray(out)
    ? ` The full result had ${out.length} items; re-call this tool with a narrower filter (e.g. status, projectId, or limit) to see specific ones.`
    : ' The full result was large; re-call with a narrower query if you need the elided fields.';
  const head = full.slice(0, MAX_TOOL_RESULT_CHARS);
  const content = `${head}\n…[truncated ${bytes - MAX_TOOL_RESULT_CHARS} of ${bytes} chars to protect the context window.${itemNote}]`;
  return { content, bytes, truncated: true };
}
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
  /**
   * Project-Evermind memory hooks (bound to the active chat's project by the
   * host). When present, the loop recalls learned memories before answering,
   * injects them into the system prompt, and records recall/learn/reconcile
   * steps into the trace so the chat SHOWS the project memory being used. Omit
   * for a non-project chat (nothing memory-related happens).
   */
  evermind?: EvermindRunHooks;
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
  /**
   * Abort handle for the run currently in flight. Created fresh in `startRun` and
   * used to (a) cancel the streaming LLM fetch and (b) let the loop unwind
   * cleanly when the user hits Stop. Null while idle. A fresh controller per run
   * means a stale aborted one never bleeds into the next run.
   */
  abort: AbortController | null;
  /** Cached immutable snapshot; identity changes only when something changed. */
  snapshot: BrainRunSnapshot;
}

const cells = new Map<number, RunCell>();

/**
 * Global run-store listeners — notified on ANY cell change (not one chat's), so a
 * view can render a CROSS-CHAT indicator of which OTHER chats are live without
 * subscribing to every chat individually. Fired from {@link emit} alongside the
 * per-cell listeners.
 */
const storeListeners = new Set<() => void>();

/**
 * A snapshot of which chats are live right now, split by whether they are actively
 * executing (`running`) or paused on a human-in-the-loop confirm (`awaiting` — the
 * actionable one: the loop cannot proceed until the user answers). The two lists
 * are disjoint (an awaiting chat is omitted from `running`).
 */
export interface GlobalRunState {
  running: number[];
  awaiting: number[];
}

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
    abort: null,
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
  // Cross-chat subscribers (the dropdown / session-list indicators) see every
  // change too, so a run starting/finishing/pausing in a NON-mounted chat still
  // updates the "which chats are live" view.
  for (const l of storeListeners) l();
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
 * The text of the most recent user turn in a transcript — the query the Evermind
 * recall runs against. A vision turn is `ContentPart[]`; we pull its text parts
 * (the image bytes aren't a recall query). Returns '' when there is no text.
 */
function latestUserText(convo: ChatCompletionMessage[]): string {
  for (let i = convo.length - 1; i >= 0; i--) {
    const m = convo[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content.trim();
    if (Array.isArray(m.content)) {
      return m.content
        .map((p) => (p && typeof p === 'object' && 'text' in p && typeof p.text === 'string' ? p.text : ''))
        .join(' ')
        .trim();
    }
    return '';
  }
  return '';
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
  return tokenBounded(w);
}

/**
 * Enforce the token budget on an already message-count-windowed slice. Drops the
 * OLDEST turns first, then re-anchors on a user turn (a strict vendor like
 * Gemini rejects a window that doesn't start on `user`, and dropping a turn can
 * orphan a `tool` result whose `assistant` tool-call fell off the front — so we
 * also drop leading `tool`/`assistant` turns after trimming). The most recent
 * user turn is never dropped: correctness over the budget when a single turn is
 * itself oversized (its tool results are already per-result trimmed on the way
 * into the transcript, so this is rare).
 */
function tokenBounded(w: ChatCompletionMessage[]): ChatCompletionMessage[] {
  let total = w.reduce((sum, m) => sum + messageTokens(m), 0);
  if (total <= HISTORY_TOKEN_BUDGET) return w;
  // The last user turn's index — never trim past it.
  const lastUser = w.map((m) => m.role).lastIndexOf('user');
  let start = 0;
  while (total > HISTORY_TOKEN_BUDGET && start < lastUser) {
    total -= messageTokens(w[start]!);
    start += 1;
  }
  let trimmed = w.slice(start);
  // Re-anchor: never begin on a tool result or an assistant tool-call turn whose
  // partner was just dropped.
  while (trimmed.length > 1 && trimmed[0].role !== 'user') trimmed = trimmed.slice(1);
  return trimmed;
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

/**
 * Subscribe to ANY run-state change across all chats (a run starting, finishing,
 * or pausing on a confirm — in any chat, mounted or not). Returns an unsubscribe
 * fn. Pair with {@link getGlobalRunState} to render a cross-chat live indicator.
 */
export function subscribeRunStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

/**
 * Which chats are live right now, split into actively-executing (`running`) and
 * paused-on-a-confirm (`awaiting`). Disjoint: a chat paused on a confirm is in
 * `awaiting` only. Recomputed from the current cells on each call — cheap (a scan
 * of the bounded cell map); callers debounce via a stable key of the two lists.
 */
export function getGlobalRunState(): GlobalRunState {
  const running: number[] = [];
  const awaiting: number[] = [];
  for (const [id, cell] of cells) {
    if (cell.pendingConfirm) awaiting.push(id);
    else if (cell.running) running.push(id);
  }
  return { running, awaiting };
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

/**
 * Stop a chat's in-flight run. Aborts the streaming LLM request (which rejects
 * the in-flight `stream()` — the loop treats an aborted signal as a clean exit,
 * surfacing no error) and resolves any paused human-in-the-loop confirmation as
 * declined so a loop waiting on the gate can also unwind. Records a `stopped`
 * trace step for triage. No-op if nothing is running for this chat.
 *
 * `running` flips to false when `runLoop` unwinds and `startRun`'s `finally`
 * fires; we emit here too so the Stop is reflected immediately.
 */
export function stopRun(chatId: number): void {
  const c = cells.get(chatId);
  if (!c || !c.running) return;
  c.abort?.abort();
  if (c.confirmResolver) {
    const resolve = c.confirmResolver;
    c.confirmResolver = null;
    c.pendingConfirm = null;
    resolve(false);
  }
  c.streamingText = '';
  // pushTrace emits, so subscribers see both the trace step and the cleared
  // streaming buffer in one go.
  pushTrace(c, { ts: nowIso(), category: 'message', label: 'agent.stopped', result: 'Stopped by user.' });
}

/**
 * Clear a chat's surfaced run error so the UI's error banner can be dismissed.
 * The error lives on the run cell (set when the LLM stream / tool loop threw),
 * so the hook's local `setError('')` can't reach it — this is the store-side
 * companion `clearError()` calls. No-op when there's no cell or no error.
 */
export function clearRunError(chatId: number | null): void {
  if (chatId == null) return;
  const c = cells.get(chatId);
  if (!c || !c.error) return;
  c.error = '';
  emit(c);
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
  // Fresh abort handle for this run, so Stop can cancel the LLM stream and unwind
  // the loop (a stale, already-aborted controller never bleeds into a new run).
  c.abort = new AbortController();

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
    // A user-initiated Stop aborts the stream mid-flight; that's a clean exit,
    // not an error to surface. (runLoop already returns on an aborted signal, so
    // this guards the rare throw that races the abort.)
    if (!c.abort?.signal.aborted) c.error = e instanceof Error ? e.message : 'Reply failed';
  } finally {
    c.running = false;
    c.streamingText = '';
    c.abort = null;
    emit(c);
  }
}

async function runLoop(chatId: number, c: RunCell, req: BrainRunRequest): Promise<void> {
  const { resolvedSystemPrompt, tools: toolSpecs, model, runTool, needsConfirm, stream, persistence, onActivity, evermind } = req;
  const convo = c.transcript;
  const tools = toolSpecs && toolSpecs.length > 0 ? toolSpecs : undefined;

  // Evermind recall — before the FIRST turn, ask the project's self-learning model
  // which learned memories are relevant to this request. When it returns some, we
  // (a) record a visible `recall` step and (b) inject them into the system prompt
  // so the recall actually GROUNDS the answer (not just a UI badge). Best-effort:
  // a non-project chat / unavailable recall / thrown fetch just skips it.
  let systemPrompt = resolvedSystemPrompt;
  let recalled: EvermindRecallResult | null = null;
  if (evermind?.recall) {
    const query = latestUserText(convo);
    if (query) {
      try {
        recalled = await evermind.recall(query);
      } catch {
        recalled = null;
      }
      if (recalled?.seeded && recalled.items.length > 0) {
        const block = formatEvermindMemoryBlock(recalled.items);
        if (block) {
          systemPrompt = `${systemPrompt}\n\n${block}`;
          pushTrace(c, {
            ts: nowIso(),
            category: 'recall',
            label: 'evermind.recall',
            args: { query, version: recalled.version },
            result: { count: recalled.items.length, version: recalled.version, mode: recalled.mode, items: recalled.items },
          });
        }
      }
    }
  }

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    // User hit Stop between turns (or after a tool call) — unwind cleanly.
    if (c.abort?.signal.aborted) return;
    c.streamingText = '';
    emit(c);
    const working: ChatCompletionMessage[] = [
      { role: 'system', content: systemPrompt },
      ...windowed(convo),
    ];
    const llmStart = nowMs();
    let result;
    try {
      result = await stream(
        { messages: working, tools, tool_choice: tools ? 'auto' : undefined, model, signal: c.abort?.signal },
        { onTextDelta: (d) => { c.streamingText += d; emit(c); } },
      );
    } catch (e) {
      // Aborting the fetch rejects the stream — that's a user Stop, exit quietly
      // (no error trace, no error message).
      if (c.abort?.signal.aborted) return;
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
    // Silent-downgrade detection: the gateway can fail over mid-run to a
    // different (often smaller-window) model than we requested. That's a prime
    // context-exhaustion symptom, so surface it as its own warning step instead
    // of leaving it buried in the model field — the diagnostics block counts it.
    const resolved = result.resolvedModel ?? model ?? 'default';
    const requested = model ?? 'default';
    if (requested !== 'default' && resolved !== 'default' && resolved !== requested) {
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: 'llm.model_downgrade',
        args: { requestedModel: requested, model: resolved, step: iter },
        result: `Gateway answered with ${resolved} instead of the requested ${requested} (failover) — a smaller context window can truncate long transcripts.`,
      });
    }
    pushTrace(c, {
      ts: nowIso(),
      category: 'llm',
      label: 'llm.complete',
      durationMs: nowMs() - llmStart,
      // `model` is the model the gateway ACTUALLY used (resolved), falling back to
      // what we requested when the gateway didn't report one. `requestedModel`
      // keeps the caller's ask (empty/'default' ⇒ gateway auto-selects) so triage
      // can tell "what I asked for" from "what answered".
      args: {
        model: resolved,
        requestedModel: requested,
        step: iter,
        toolCalls: result.toolCalls.length,
        // Which account served the turn + any connected-BYO provider the gateway
        // could NOT resolve — so triage tells "ran on the shared pool despite a
        // connected Claude account (expired?)" apart from "nothing connected".
        account: result.account,
        byoUnresolved: result.byoUnresolved,
      },
      // Structured diagnostics fields — the A-vs-B triage reads these directly.
      usage: result.usage,
      finishReason: result.finishReason,
      textChars: result.text.length,
      result: `${result.toolCalls.length} tool call(s) · ${result.text.length} chars · finish: ${result.finishReason ?? '—'}${result.usage?.prompt != null ? ` · prompt ${result.usage.prompt} tok` : ''}`,
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
        const meta = provenanceMetadata(result);
        const [narrationMsg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: result.text, ...(meta ? { metadata: meta } : {}) }]);
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
          // Errors are small; push as-is (trimming a short error would only add noise).
          convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) });
          pushTrace(c, { ts: nowIso(), category: 'tool', label: tc.name, durationMs: nowMs() - toolStart, args, result: out, isError: true });
          continue;
        }
        // The MODEL transcript gets a size-capped copy so a big list result can't
        // flood the context window; the TRACE keeps the full result (bounded by
        // MAX_TRACE_EVENTS) for the timeline + triage copy, plus the pre-trim byte
        // size and a truncation flag the diagnostics block reads.
        const trimmedOut = trimToolResult(out ?? null);
        convo.push({ role: 'tool', tool_call_id: tc.id, content: trimmedOut.content });
        pushTrace(c, {
          ts: nowIso(),
          category: 'tool',
          label: tc.name,
          durationMs: nowMs() - toolStart,
          args,
          result: out ?? null,
          isError: isFailedToolResult(out),
          resultBytes: trimmedOut.bytes,
          truncated: trimmedOut.truncated,
        });
      }
      continue;
    }

    // Final text — record in the transcript, persist, broadcast to mounted views.
    const finalText = result.text.trim() || 'No response.';
    convo.push({ role: 'assistant', content: finalText });
    const finalMeta = provenanceMetadata(result);
    const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: finalText, ...(finalMeta ? { metadata: finalMeta } : {}) }]);
    c.streamingText = '';
    recordAppended(c, assistantMsg);
    emit(c);

    // Evermind learning + reconciliation steps. When the project is CONNECTED and
    // the answer clears the teach floor, the server contributes this turn to the
    // project's Evermind (brainRoutes → learnFromBrainTurn); surface that as a
    // `learn` step, and — when the answer restates recalled memories — a
    // `reconcile` step (write-through: the turn updates those learnings). This
    // mirrors the server gate so the step shows exactly when a contribution lands.
    if (recalled?.seeded && recalled.mode === 'connected' && finalText.trim().length >= EVERMIND_LEARN_MIN_CHARS) {
      pushTrace(c, {
        ts: nowIso(),
        category: 'learn',
        label: 'evermind.learn',
        result: { version: recalled.version, queued: true },
      });
      const reconciled = countReconciledMemories(recalled.items, finalText);
      if (reconciled > 0) {
        pushTrace(c, {
          ts: nowIso(),
          category: 'reconcile',
          label: 'evermind.reconcile',
          result: { count: reconciled, version: recalled.version },
        });
      }
    }

    onActivity?.(chatId);
    return;
  }

  // Loop exhausted without a final text answer. Rather than drop the whole run with
  // "kept calling tools without finishing", force ONE final completion WITHOUT tools so
  // the model MUST answer in prose using what it already gathered — the same "always
  // speak" guarantee the server-side addressed-agent loop gives (BrainService.agentReply).
  // A run that spent its tool budget then returns a useful summary instead of an error;
  // we only surface the loop-exhausted error if THIS closing turn is also empty. This
  // does not depend on which model answered, so it also rescues a weak auto-selected
  // model that looped without converging.
  c.streamingText = '';
  if (!c.abort?.signal.aborted) {
    const closeStart = nowMs();
    try {
      const working: ChatCompletionMessage[] = [
        { role: 'system', content: systemPrompt },
        ...windowed(convo),
        {
          role: 'user',
          content:
            'You have reached your tool-call budget for this turn. Do NOT call any more tools. Answer the user now, in prose, using what you have already gathered — summarise your findings and state plainly anything you could not finish.',
        },
      ];
      const closing = await stream(
        // No `tools` → the model can't call another tool and must produce text.
        { messages: working, model, signal: c.abort?.signal },
        { onTextDelta: (d) => { c.streamingText += d; emit(c); } },
      );
      pushTrace(c, {
        ts: nowIso(),
        category: 'llm',
        label: 'llm.complete',
        durationMs: nowMs() - closeStart,
        args: { model: closing.resolvedModel ?? model ?? 'default', requestedModel: model ?? 'default', step: MAX_TOOL_ITERATIONS, toolCalls: 0, forcedFinish: true, account: closing.account, byoUnresolved: closing.byoUnresolved },
        usage: closing.usage,
        finishReason: closing.finishReason,
        textChars: closing.text.length,
        result: `forced final synthesis (tool budget reached) · ${closing.text.length} chars · finish: ${closing.finishReason ?? '—'}`,
      });
      const closingText = closing.text.trim();
      if (closingText) {
        convo.push({ role: 'assistant', content: closingText });
        const meta = provenanceMetadata(closing);
        const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: closingText, ...(meta ? { metadata: meta } : {}) }]);
        c.streamingText = '';
        recordAppended(c, assistantMsg);
        emit(c);
        onActivity?.(chatId);
        return;
      }
    } catch (e) {
      // A user Stop during the closing turn exits quietly; any other failure falls
      // through to the loop-exhausted error below (the run still ends, just noisier).
      if (c.abort?.signal.aborted) return;
    }
  }
  if (c.abort?.signal.aborted) return;

  c.streamingText = '';
  pushTrace(c, {
    ts: nowIso(),
    category: 'error',
    label: 'agent.loop',
    result: `Loop exhausted after ${MAX_TOOL_ITERATIONS} tool iterations (a forced final answer without tools also came back empty)`,
    isError: true,
  });
  c.error = 'The assistant kept calling tools without finishing. Try rephrasing.';
  emit(c);
}
