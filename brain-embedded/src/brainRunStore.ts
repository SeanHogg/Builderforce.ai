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
import { chatWorkLinkingDirective, isCodeChangeTool, isTicketRecordingTool, codeChangeFile, workItemLinkFromCreate, linkedTicketsToAdvance, isReadOnlyPlatformTool } from './chatWorkLinking';
import {
  formatEvermindMemoryBlock,
  countReconciledMemories,
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

/** Read-only, idempotent LOCAL file/search tools whose exact-repeat call within a run is
 *  suppressed (the result is already in context). Read-only PLATFORM (`builtin_*`) tools
 *  are covered separately by {@link isReadOnlyPlatformTool} — together they are the
 *  `isDedupableRead` set. Deliberately narrow — only tools that observe and can't mutate,
 *  so a stubbed repeat never hides a real change (a mutation clears the dedupe set anyway;
 *  see {@link runLoop}). */
const DEDUP_READ_TOOLS = new Set(['read_file', 'search_code', 'list_files']);

/** A tool whose identical-args repeat within a run is safe to suppress: a local file/search
 *  tool OR a read-only platform tool. This is the fix for the "Brain re-checks the same
 *  roster / tickets / tasks every turn until it burns the iteration cap" loop — previously
 *  ONLY the 3 local file tools deduped, and any platform (MCP) call both went un-deduped
 *  AND wiped the cache, so repeated `builtin_*_list`/`_assignees` calls re-ran every turn. */
const isDedupableRead = (name: string): boolean => DEDUP_READ_TOOLS.has(name) || isReadOnlyPlatformTool(name);

/** Fold a `x-builderforce-byo-unresolved` header value (comma-separated providers)
 *  into the run cell's accumulated set, updating the snapshot only when it grows so a
 *  mounted banner appears the moment a connected account is found unusable. */
function accrueByoUnresolved(c: RunCell, raw: string | undefined): void {
  if (!raw) return;
  const before = c.byoUnresolved.length;
  const next = new Set(c.byoUnresolved);
  for (const p of raw.split(',').map((s) => s.trim()).filter(Boolean)) next.add(p);
  if (next.size !== before) c.byoUnresolved = [...next];
}

/** Fold a `x-builderforce-provider-cap` header value (comma-separated providers)
 *  into the run cell's accumulated set, updating only when it grows so the banner
 *  appears the moment a BYO provider's usage cap is hit. */
function accrueProviderCap(c: RunCell, raw: string | undefined): void {
  if (!raw) return;
  const before = c.providerCap.length;
  const next = new Set(c.providerCap);
  for (const p of raw.split(',').map((s) => s.trim()).filter(Boolean)) next.add(p);
  if (next.size !== before) c.providerCap = [...next];
}
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
   * The chat's project. Enables the post-run "a code change is always tied to a
   * ticket" backstop: when an IDE run changed code but never recorded a ticket, the
   * loop mints one via `builtin_tickets_from_delta` for THIS project, linked to the
   * chat. Omit (or null) for a non-project chat / the web Brain (which has no file
   * tools, so the backstop never fires there anyway).
   */
  projectId?: number | null;
  /**
   * Project-Evermind memory hooks (bound to the active chat's project by the
   * host). When present, the loop recalls learned memories before answering,
   * injects them into the system prompt, and records recall/learn/reconcile
   * steps into the trace so the chat SHOWS the project memory being used. Omit
   * for a non-project chat (nothing memory-related happens).
   */
  evermind?: EvermindRunHooks;
  /**
   * Optional per-turn system-prompt augmentation — the LIMBIC parity seam.
   *
   * Called once at loop start (alongside Evermind recall) with the latest user
   * text; a non-empty return is appended to the system prompt with a leading
   * `\n\n`. This lets a host inject a per-turn dynamic block (e.g. a limbic /
   * affective state fetched from the gateway) that the synchronous
   * `resolvedSystemPrompt` resolver cannot produce. Best-effort: a throw is
   * swallowed and the turn proceeds without the augmentation, exactly like a
   * failed Evermind recall.
   */
  augmentSystemPrompt?: (userText: string) => Promise<string | undefined>;
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
  /**
   * Providers the tenant CONNECTED but the gateway could NOT resolve on any turn of
   * this run (from `x-builderforce-byo-unresolved`) — e.g. a connected Claude
   * subscription whose token expired, so the run silently used the shared pool
   * instead of the tenant's own Opus. A mounted view shows a passive "reconnect your
   * account" banner off this, so the degrade is visible WITHOUT copying triage. Empty
   * when everything resolved (or nothing is connected).
   */
  byoUnresolved: string[];
  /**
   * BYO providers whose key hit a usage/capacity cap on any turn of this run
   * (from `x-builderforce-provider-cap`) — e.g. the tenant's Anthropic key hit its
   * monthly spend limit, or Meta MUSE quota was exhausted. A mounted view shows a
   * "manage your API keys" banner so the user knows to top up or switch providers.
   * Accumulated across turns; reset fresh each run. Empty when no cap was hit.
   */
  providerCap: string[];
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
  /** Connected-but-unresolved BYO providers accumulated across this run's turns. */
  byoUnresolved: string[];
  /** BYO providers that hit a capacity/usage cap accumulated across this run's turns. */
  providerCap: string[];
  /**
   * Backstop bookkeeping for the current run (reset each {@link startRun}): whether a
   * workspace code-change tool succeeded, whether the model itself recorded a ticket
   * (from_delta / link / review), and the files it touched — so a code-changing run
   * that never linked its work gets a ticket minted for it. IDE-only in practice.
   */
  codeChanged: boolean;
  ticketRecorded: boolean;
  touchedFiles: string[];
  /**
   * Cached compressed-memory of the run's older turns. When the transcript exceeds
   * {@link HISTORY_TOKEN_BUDGET} the loop SUMMARIZES the bulky middle (instead of
   * dropping it, which made a weak model re-read and thrash into "LOOP EXHAUSTED"),
   * and memoizes the note here so the growing prefix is summarized at most once per
   * overflow rather than every iteration. Null until the first overflow / reset.
   */
  compactMemo: { note: string; atLen: number } | null;
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
  byoUnresolved: [],
  providerCap: [],
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
    byoUnresolved: [],
    providerCap: [],
    codeChanged: false,
    ticketRecorded: false,
    touchedFiles: [],
    compactMemo: null,
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
    byoUnresolved: c.byoUnresolved,
    providerCap: c.providerCap,
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

/** Cap on the persisted step RESULT (chars). The live trace keeps the full result;
 *  only the durable copy is bounded so a big tool payload can't bloat the row. */
const STEP_RESULT_CAP = 4_000;

/**
 * Persist a tool / memory step DURABLY so it survives a reload — the in-memory
 * `trace` alone vanishes on remount, which is why tool + memory steps used to
 * disappear from a reopened chat. Stored as a `role:'tool'` message whose metadata
 * carries the step payload (`{ kind:'step', ... }`); the timeline reconstructs the
 * node from it (see timelineModel.buildSettledTimeline).
 *
 * Deliberately NOT recorded into the live message list (no recordAppended): the live
 * view already shows the step from `trace`, and the seed builders exclude `role:'tool'`
 * so a persisted step never re-enters the model transcript (an orphaned tool message
 * 400s strict vendors). Fire-and-forget — durability must never block or fail the run.
 */
function persistStep(chatId: number, persistence: BrainRunPersistence, ev: BrainTraceEvent): void {
  let result: unknown = ev.result ?? null;
  try {
    const s = JSON.stringify(result);
    if (s.length > STEP_RESULT_CAP) result = `${s.slice(0, STEP_RESULT_CAP)}…[${s.length - STEP_RESULT_CAP} more chars]`;
  } catch {
    result = String(result);
  }
  const metadata = JSON.stringify({
    kind: 'step',
    category: ev.category,
    label: ev.label,
    args: ev.args ?? null,
    result,
    isError: ev.isError ?? false,
    ...(ev.durationMs != null ? { durationMs: ev.durationMs } : {}),
    ts: ev.ts,
  });
  void persistence.sendMessages(chatId, [{ role: 'tool', content: '', metadata }]).catch(() => {
    /* best-effort durability — the live trace already showed the step */
  });
}

/** {@link pushTrace} + {@link persistStep}: record a tool/memory step both live (trace)
 *  and durably (persisted), so it shows during the run AND survives a reload. */
function pushDurableStep(c: RunCell, chatId: number, persistence: BrainRunPersistence, ev: BrainTraceEvent): void {
  pushTrace(c, ev);
  persistStep(chatId, persistence, ev);
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
// Auto-compaction — summarize the bulky MIDDLE instead of dropping it.
//
// `tokenBounded` above keeps the request inside the model window by DROPPING the
// oldest turns. That never 413s, but it silently LOSES context — which made a weak
// model re-read files and thrash until it burned the tool-iteration cap ("LOOP
// EXHAUSTED", the chat #50 failure). When a summarizer is available we instead
// compress the older turns into ONE concise memory note (the same pattern the cloud
// coding loop uses server-side via compactMessages), so the model keeps working from
// a distilled memory and converges. Falls back to `tokenBounded` (drop) when no
// summarizer is reachable, so correctness never depends on the extra LLM call.
// ---------------------------------------------------------------------------

/** Recent turns kept verbatim ahead of the compressed memory note. */
export const COMPACT_TAIL_TURNS = 8;

/** Start index of the recent tail that never orphans a `tool` result: take the last
 *  `tailTurns` messages, then walk FORWARD off any leading `tool` message (whose
 *  paired assistant tool-call turn sits in the summarized middle). Pure/testable. */
export function compactTailStart(convo: ChatCompletionMessage[], tailTurns: number): number {
  let start = Math.max(0, convo.length - tailTurns);
  while (start < convo.length && convo[start]!.role === 'tool') start += 1;
  return start;
}

/**
 * Index of the MOST RECENT user turn to re-inject verbatim ahead of the tail — the
 * ACTIVE directive — or -1 when the latest user turn is already inside the tail (so it
 * needs no re-injection). This is the fix for the "reverts to the opening request"
 * failure: compaction used to pin the FIRST user turn as the run anchor, so in a chat
 * with several successive instructions the model kept re-anchoring on the stale
 * opening message (chat #55: it re-ran the initial "self-diagnostic" and abandoned the
 * live "create the gap and fix the code" order — twice). The current instruction is
 * always the LATEST user turn, never the first, so that is what must survive verbatim.
 * Pure/testable.
 */
export function pinnedDirectiveIndex(convo: ChatCompletionMessage[], tailTurns: number): number {
  const tailStart = compactTailStart(convo, tailTurns);
  const lastUser = convo.map((m) => m.role).lastIndexOf('user');
  return lastUser >= 0 && lastUser < tailStart ? lastUser : -1;
}

/** The middle span [start,end) to summarize: the whole history before the recent tail.
 *  Every earlier user turn is captured in the memo (in prose); the LATEST directive is
 *  additionally re-injected verbatim by {@link assembleCompacted}, so anchoring never
 *  drifts to a stale opening request. Pure/testable. */
export function compactMiddleRange(convo: ChatCompletionMessage[], tailTurns: number): { start: number; end: number } {
  return { start: 0, end: compactTailStart(convo, tailTurns) };
}

/**
 * Assemble the working transcript from a compressed-memory `note`: system + the memory
 * note + the ACTIVE user directive re-injected verbatim (the most recent user turn,
 * when it fell outside the tail) + the recent tail (verbatim, tool-pairing safe via
 * {@link compactTailStart}). Pure so partitioning is unit-tested; the note text comes
 * from the async summarizer.
 *
 * The directive sits immediately before the tail — the most-recent pre-tail position —
 * so the model reads it as the CURRENT instruction, not a stale opening task the memo
 * also mentions. Pinning the FIRST user turn here (the previous behavior) is exactly
 * what made a multi-instruction chat revert to its opening request and ignore the live
 * order.
 */
export function assembleCompacted(
  systemPrompt: string,
  convo: ChatCompletionMessage[],
  note: string,
  tailTurns: number,
): ChatCompletionMessage[] {
  const tailStart = compactTailStart(convo, tailTurns);
  const out: ChatCompletionMessage[] = [{ role: 'system', content: systemPrompt }];
  out.push({ role: 'assistant', content: note });
  const directiveIdx = pinnedDirectiveIndex(convo, tailTurns);
  if (directiveIdx >= 0) out.push(convo[directiveIdx]!);
  out.push(...convo.slice(tailStart));
  return out;
}

/** Render a slice of the transcript to a compact text the summarizer compresses. */
function renderForSummary(msgs: ChatCompletionMessage[]): string {
  return msgs
    .map((m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      const calls = m.tool_calls?.length
        ? ` [called: ${m.tool_calls.map((t) => t.function?.name).filter(Boolean).join(', ')}]`
        : '';
      return `${m.role}${calls}: ${content}`;
    })
    .join('\n\n');
}

/** Client-side summarizer built from the injected `stream` transport: one no-tools
 *  completion that compresses an in-progress agent transcript into a dense memory.
 *  Returns null on any failure/empty so the caller falls back to drop-oldest. */
async function summarizeMiddle(
  stream: BrainStreamFn,
  model: string | undefined,
  msgs: ChatCompletionMessage[],
  signal: AbortSignal | undefined,
): Promise<string | null> {
  if (msgs.length === 0) return null;
  try {
    const res = await stream({
      messages: [
        {
          role: 'system',
          content:
            'You compress an in-progress AI agent transcript into a concise MEMORY the agent keeps working from. Capture: the CURRENT outstanding instruction from the user (the most recent user message is authoritative — earlier requests it supersedes are history, not the active task), concrete facts/answers discovered, tool results that matter (ids, paths, values), decisions made, and what still remains to do. Be information-dense; drop pleasantries. No preamble.',
        },
        { role: 'user', content: renderForSummary(msgs) },
      ],
      model,
      signal,
    });
    const out = (res.text ?? '').trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Build the working transcript for a turn. Under budget → the existing message-count
 * + drop-oldest window (a no-op when it fits). Over budget → summarize the older
 * middle into a memoized memory note and keep the recent tail verbatim; a visible
 * `context.compacted` step is recorded so the chat SHOWS the compression. Re-summarizes
 * at most once per {@link COMPACT_TAIL_TURNS} new turns (memoized on the cell), and
 * falls back to drop-oldest if the summarizer is unavailable.
 */
async function buildWorkingTranscript(
  c: RunCell,
  systemPrompt: string,
  stream: BrainStreamFn,
  model: string | undefined,
): Promise<ChatCompletionMessage[]> {
  const convo = c.transcript;
  const total = convo.reduce((sum, m) => sum + messageTokens(m), 0);
  if (total <= HISTORY_TOKEN_BUDGET) {
    c.compactMemo = null; // back under budget — a later overflow summarizes afresh
    return [{ role: 'system', content: systemPrompt }, ...windowed(convo)];
  }
  const stale = !c.compactMemo || convo.length - c.compactMemo.atLen >= COMPACT_TAIL_TURNS;
  let note = c.compactMemo?.note ?? null;
  if (stale) {
    const { start, end } = compactMiddleRange(convo, COMPACT_TAIL_TURNS);
    const middle = convo.slice(start, end);
    const summary = await summarizeMiddle(stream, model, middle, c.abort?.signal);
    if (summary != null) {
      note = `Compressed memory of ${middle.length} earlier step(s):\n${summary}`;
      c.compactMemo = { note, atLen: convo.length };
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: 'context.compacted',
        args: { droppedMessages: middle.length },
        result: `Compressed ${middle.length} earlier step(s) into a memory to stay within the context window.`,
      });
      emit(c);
    }
  }
  if (note == null) {
    // Summarizer unavailable/failed → preserve the proven drop-oldest behavior.
    return [{ role: 'system', content: systemPrompt }, ...windowed(convo)];
  }
  return assembleCompacted(systemPrompt, convo, note, COMPACT_TAIL_TURNS);
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
  c.byoUnresolved = []; // fresh per run — a reconnected account clears the banner
  c.providerCap = [];   // fresh per run — a topped-up account clears the banner
  // Fresh backstop bookkeeping per run (see the finally block below).
  c.codeChanged = false;
  c.ticketRecorded = false;
  c.touchedFiles = [];
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
    const aborted = c.abort?.signal.aborted ?? false;
    c.running = false;
    c.streamingText = '';
    c.abort = null;
    // Guarantee a code change is tied to a ticket: if this run CHANGED code (an IDE
    // file tool succeeded) but never itself recorded/linked one, mint a ticket now
    // via from_delta, tied to this chat — so an edit is never invisible or unlinked.
    // Best-effort and IDE-only (the web Brain has no file tools → codeChanged stays
    // false). Skipped on a user Stop. Runs before the final emit so the auto-recorded
    // step is part of the settled run.
    if (!aborted && c.codeChanged && !c.ticketRecorded && req.projectId != null && req.runTool) {
      await recordCodeChangeTicket(chatId, c, req).catch(() => { /* never fail the run on the backstop */ });
    }
    // Keep the board honest about STATUS: if this run CHANGED code, advance any
    // task/epic/gap linked to this chat that is still sitting in a not-started lane
    // (backlog/todo/ready) to in_progress — so "started work on a ticket but never
    // moved it off backlog" can't happen silently. Independent of the from_delta
    // backstop above (that MINTS a ticket; this ADVANCES existing linked ones), and
    // runs after it so a freshly-minted review-status ticket is never touched.
    // Gated on a project (like the from_delta backstop) — an IDE code-change run always
    // has one; a project-less chat has no board to reconcile.
    if (!aborted && c.codeChanged && req.projectId != null && req.runTool) {
      await advanceLinkedTickets(chatId, c, req).catch(() => { /* never fail the run on the backstop */ });
    }
    emit(c);
  }
}

/**
 * Post-run backstop for the "a code change is always tied to a ticket" guarantee.
 * Calls the shared platform tool `builtin_tickets_from_delta` (via the run's own
 * `runTool` dispatcher, so it rides the same gateway MCP relay the model uses),
 * passing the chatId so the minted ticket is linked to this conversation. Records a
 * durable tool step so the auto-capture is visible on the timeline. Never throws.
 */
async function recordCodeChangeTicket(chatId: number, c: RunCell, req: BrainRunRequest): Promise<void> {
  if (!req.runTool || req.projectId == null) return;
  const files = c.touchedFiles.slice(0, 50);
  const summary = files.length
    ? `Code change (${files.length} file${files.length === 1 ? '' : 's'}) from Brain chat #${chatId}`
    : `Code change from Brain chat #${chatId}`;
  const toolStart = nowMs();
  let out: unknown;
  try {
    out = await req.runTool('builtin_tickets_from_delta', {
      projectId: req.projectId,
      summary,
      detail:
        'Auto-captured: this chat changed code without recording a ticket, so the platform minted one to keep the work visible on the board and linked to the conversation.',
      files,
      kind: 'improvement',
      modality: 'ide',
      chatId,
    });
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  pushDurableStep(c, chatId, req.persistence, {
    ts: nowIso(),
    category: 'tool',
    label: 'builtin_tickets_from_delta',
    durationMs: nowMs() - toolStart,
    args: { projectId: req.projectId, summary, files, auto: true, chatId },
    result: out ?? null,
    isError: isFailedToolResult(out),
  });
}

/**
 * Post-run backstop for the "a ticket you WORKED reflects that on the board" guarantee.
 * Lists the tickets linked to this chat (via the run's own `runTool` dispatcher, so it
 * rides the same gateway MCP relay the model uses), and for every task/epic/gap still in
 * a not-started lane (see {@link linkedTicketsToAdvance}) advances it to `in_progress`
 * with `builtin_tasks_update`. This closes the reported gap where the agent started work
 * on linked bug tickets but left them in backlog. Best-effort per ticket, records a
 * durable step so the auto-advance is visible on the timeline, never throws.
 */
async function advanceLinkedTickets(chatId: number, c: RunCell, req: BrainRunRequest): Promise<void> {
  if (!req.runTool) return;
  let listed: unknown;
  try {
    listed = await req.runTool('builtin_chats_list_tickets', { chatId });
  } catch {
    return; // can't read the links — nothing to advance
  }
  const toAdvance = linkedTicketsToAdvance(listed);
  for (const t of toAdvance) {
    const id = Number(t.ref);
    if (!Number.isInteger(id)) continue;
    const toolStart = nowMs();
    let out: unknown;
    try {
      out = await req.runTool('builtin_tasks_update', { id, status: 'in_progress' });
    } catch (e) {
      out = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    pushDurableStep(c, chatId, req.persistence, {
      ts: nowIso(),
      category: 'tool',
      label: 'builtin_tasks_update',
      durationMs: nowMs() - toolStart,
      args: { id, status: 'in_progress', auto: true, reason: 'worked-ticket-off-backlog' },
      result: out ?? null,
      isError: isFailedToolResult(out),
    });
  }
}

/**
 * Deterministic chat↔work link for an item a create tool just produced. If `out` is
 * the result of a recognised create tool (see {@link workItemLinkFromCreate}), fire
 * the shared `builtin_chats_link_ticket` tool — via the run's own dispatcher so it
 * rides the same gateway MCP relay the model uses — so the new Epic / task / OKR /
 * spec is tied to this conversation for traceability. Idempotent (re-linking is a
 * no-op update), best-effort (never fails the run), and recorded as a durable step so
 * the auto-link is visible on the timeline. Marks the run as having recorded a ticket
 * so the from_delta backstop stays quiet.
 */
async function autoLinkCreatedItem(
  chatId: number,
  c: RunCell,
  persistence: BrainRunPersistence,
  runTool: (name: string, args: unknown) => Promise<unknown>,
  toolName: string,
  out: unknown,
): Promise<void> {
  const link = workItemLinkFromCreate(toolName, out);
  if (!link) return;
  const toolStart = nowMs();
  let result: unknown;
  try {
    result = await runTool('builtin_chats_link_ticket', {
      chatId,
      kind: link.kind,
      ref: link.ref,
      linkType: link.linkType,
    });
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!isFailedToolResult(result)) c.ticketRecorded = true;
  pushDurableStep(c, chatId, persistence, {
    ts: nowIso(),
    category: 'tool',
    label: 'builtin_chats_link_ticket',
    durationMs: nowMs() - toolStart,
    args: { chatId, kind: link.kind, ref: link.ref, linkType: link.linkType, auto: true },
    result: result ?? null,
    isError: isFailedToolResult(result),
  });
}

/**
 * Framework-free entry point for the Brain agent loop — a documented alias of
 * {@link startRun}. A non-React host (e.g. the native VS Code chat participant)
 * drives a run by calling `runBrainLoop(chatId, req)` and observing it with
 * {@link subscribeRun} + {@link getRunSnapshot} / {@link getRunTrace}, without
 * pulling in the React hook. Same single-flight semantics as `startRun`.
 */
export { startRun as runBrainLoop };

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
          pushDurableStep(c, chatId, persistence, {
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

  // Per-turn system-prompt augmentation (the LIMBIC parity seam). Fetched once
  // at loop start with the latest user text; a non-empty return is appended to
  // the system prompt. Best-effort — a throw just skips it, exactly like the
  // Evermind recall above.
  if (req.augmentSystemPrompt) {
    try {
      const extra = await req.augmentSystemPrompt(latestUserText(convo));
      if (typeof extra === 'string' && extra.trim()) {
        systemPrompt = `${systemPrompt}\n\n${extra}`;
      }
    } catch {
      // ignore — proceed without the augmentation
    }
  }

  // Bind this run's work to the conversation: tell the model its chatId and that
  // work it identifies or code it changes must become a ticket LINKED to this chat.
  // This is the enabler the chat-scoped + from_delta tools need — without the id
  // they are advertised but the model has no chatId to pass. Injected here (with the
  // guaranteed-resolved id) so it rides BOTH the web Brain and the VS Code webview
  // Brain, mirroring the server-side @agent reply loop (BrainService.agentReply).
  systemPrompt = `${systemPrompt}\n\n${chatWorkLinkingDirective(chatId)}`;

  // Read-only tool calls whose (name+args) exactly repeat within a run return a
  // "already returned above" stub instead of re-fetching + re-injecting the full
  // payload — the context bloat that let a weak model thrash into exhaustion (one
  // file was read 3+ times in the reported run). Any NON-read tool clears the set:
  // a write/edit/delete (or any side-effecting call) can change what a re-read would
  // see, so a read after a mutation is never suppressed. Only successful reads cache.
  const readDedupe = new Set<string>();

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    // User hit Stop between turns (or after a tool call) — unwind cleanly.
    if (c.abort?.signal.aborted) return;
    c.streamingText = '';
    emit(c);
    // Auto-compact BEFORE the turn: summarize the older middle into a memory note
    // when the transcript exceeds the token budget (instead of silently dropping it
    // and making the model thrash into "LOOP EXHAUSTED"). Falls back to the
    // drop-oldest window when no summarizer is reachable.
    const working = await buildWorkingTranscript(c, systemPrompt, stream, model);
    if (c.abort?.signal.aborted) return;
    const llmStart = nowMs();
    // Time-to-first-token: stamped on the FIRST streamed delta of this turn so
    // the timeline's "Thought for Xs" reflects latency-to-first-token, not the
    // whole turn. Stays undefined for a pure tool-call / empty turn.
    let firstTokenAt: number | undefined;
    let result;
    try {
      result = await stream(
        { messages: working, tools, tool_choice: tools ? 'auto' : undefined, model, signal: c.abort?.signal },
        { onTextDelta: (d) => { if (firstTokenAt === undefined) firstTokenAt = nowMs(); c.streamingText += d; emit(c); } },
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
    // Surface a connected-but-unresolved BYO account for a live banner (and reset
    // clears it when the account is reconnected). Emit happens with the trace below.
    accrueByoUnresolved(c, result.byoUnresolved);
    // Surface any BYO provider usage cap so the user knows to manage their keys.
    accrueProviderCap(c, result.providerCap);
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
      ttftMs: firstTokenAt !== undefined ? firstTokenAt - llmStart : undefined,
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
            pushDurableStep(c, chatId, persistence, { ts: nowIso(), category: 'tool', label: tc.name, args, result: { cancelled: true, reason: 'User declined this action.' } });
            continue;
          }
        }
        // Read-dedupe: suppress an EXACT repeat of a read-only file/search OR read-only
        // platform call (its result is already above), and invalidate the cache on any
        // other (possibly mutating) tool so a read AFTER a change is never suppressed.
        const isReadTool = isDedupableRead(tc.name);
        const dedupeKey = `${tc.name}:${tc.args ?? ''}`;
        if (isReadTool) {
          if (readDedupe.has(dedupeKey)) {
            const stub = {
              note: `Duplicate ${tc.name} call — identical arguments to an earlier call this turn, whose result is already in the conversation above. Reuse that result instead of re-reading; do not repeat it (this saves context and avoids looping).`,
            };
            convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(stub) });
            pushTrace(c, { ts: nowIso(), category: 'tool', label: tc.name, args, result: stub });
            continue;
          }
        } else {
          readDedupe.clear();
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
          pushDurableStep(c, chatId, persistence, { ts: nowIso(), category: 'tool', label: tc.name, durationMs: nowMs() - toolStart, args, result: out, isError: true });
          continue;
        }
        // Backstop bookkeeping (see startRun's finally): a successful workspace
        // file-change marks the run as code-changing (and remembers the file), while
        // the model recording its own delta/link/review clears the need for the
        // auto-capture. A failed call above `continue`d out, so this counts successes.
        if (isCodeChangeTool(tc.name)) {
          c.codeChanged = true;
          const f = codeChangeFile(args);
          if (f && !c.touchedFiles.includes(f)) c.touchedFiles.push(f);
        }
        if (isTicketRecordingTool(tc.name)) c.ticketRecorded = true;
        // Deterministic traceability: whenever this turn CREATED a work item via an
        // MCP create tool (task/epic/gap, objective, spec, portfolio, initiative),
        // tie it to THIS conversation right now — instead of relying on the model to
        // remember the advisory builtin_chats_link_ticket call (which it often skips,
        // leaving the item created but orphaned from the chat). Fires the same shared
        // link tool the model would, tied to the run's resolved chatId.
        if (runTool) await autoLinkCreatedItem(chatId, c, persistence, runTool, tc.name, out);
        // The MODEL transcript gets a size-capped copy so a big list result can't
        // flood the context window; the TRACE keeps the full result (bounded by
        // MAX_TRACE_EVENTS) for the timeline + triage copy, plus the pre-trim byte
        // size and a truncation flag the diagnostics block reads.
        const trimmedOut = trimToolResult(out ?? null);
        convo.push({ role: 'tool', tool_call_id: tc.id, content: trimmedOut.content });
        pushDurableStep(c, chatId, persistence, {
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
        // Cache only a SUCCESSFUL read so a failed read can be retried.
        if (isReadTool && !isFailedToolResult(out)) readDedupe.add(dedupeKey);
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

    // Evermind learning + reconciliation steps. The server reports the TRUTHFUL learn
    // outcome for this turn on the persisted assistant message (`evermindLearn`) — the
    // same `learnFromBrainTurn` gate it actually applies — so the `learn` step shows
    // exactly when the server contributed. This replaces the old client-side heuristic
    // (which both false-positived, and false-negatived for a connected-but-EMPTY Evermind
    // where recall seeded nothing yet the first contribution still lands). The
    // `reconcile` step stays client-side: which of the RECALLED memories this answer
    // restated (write-through — the turn updates those learnings).
    const learn = assistantMsg?.evermindLearn;
    if (learn?.learned) {
      pushDurableStep(c, chatId, persistence, {
        ts: nowIso(),
        category: 'learn',
        label: 'evermind.learn',
        result: { version: learn.version, queued: true },
      });
      const reconciled = recalled?.items ? countReconciledMemories(recalled.items, finalText) : 0;
      if (reconciled > 0) {
        pushDurableStep(c, chatId, persistence, {
          ts: nowIso(),
          category: 'reconcile',
          label: 'evermind.reconcile',
          result: { count: reconciled, version: learn.version },
        });
      }
    } else if (learn && learn.reason && learn.reason !== 'too-short') {
      // The turn did NOT feed the Evermind, for a project-level reason the user can act
      // on (chat not attached to a project / not seeded / frozen). Surface it as an
      // EXPLAINED muted step so "Connected, yet nothing learned" is never a silent
      // mystery again — the same defect that sent the last debugging session in circles.
      // `too-short` is mundane (a one-line turn) and intentionally not surfaced.
      pushDurableStep(c, chatId, persistence, {
        ts: nowIso(),
        category: 'learn',
        label: 'evermind.learn',
        result: { version: learn.version, skipped: true, reason: learn.reason },
      });
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
      let closeFirstTokenAt: number | undefined;
      const closing = await stream(
        // No `tools` → the model can't call another tool and must produce text.
        { messages: working, model, signal: c.abort?.signal },
        { onTextDelta: (d) => { if (closeFirstTokenAt === undefined) closeFirstTokenAt = nowMs(); c.streamingText += d; emit(c); } },
      );
      accrueByoUnresolved(c, closing.byoUnresolved);
      accrueProviderCap(c, closing.providerCap);
      pushTrace(c, {
        ts: nowIso(),
        category: 'llm',
        label: 'llm.complete',
        durationMs: nowMs() - closeStart,
        ttftMs: closeFirstTokenAt !== undefined ? closeFirstTokenAt - closeStart : undefined,
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
