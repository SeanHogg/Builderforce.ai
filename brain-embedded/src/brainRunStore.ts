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
import { getRunDriver } from './runDriver';
import type {
  BrainToolSpec,
  ChatCompletionMessage,
  CompletionMetadata,
  ContentPart,
  StreamChatOptions,
  StreamHandlers,
  StreamChatResult,
} from './streamChatCompletion';
import type { ReasoningIntent } from './effort';
import { isFailedToolResult, type BrainTraceEvent } from './brainTriage';
import { chatErrorAction, type ChatErrorAction } from './chatError';
import { withProvenanceMetadata, type ProvenanceAccount } from './provenance';
import { selectToolsForTurn } from './selectTools';
import { routerToolSpecs, isRouterTool, handleRouterCall } from './toolRouter';
import { setLastResolvedModel, withObservedModel, forgetResolvedModels } from './lastResolvedModel';
import { isTicketRecordingTool, codeChangeFile, workItemLinkFromCreate, linkedTicketsToAdvance, linkedTicketsToComplete, isReadOnlyPlatformTool } from './chatWorkLinking';
import { isCodeChangeTool, canChangeCodeHere, localToolsIn, memoryToolsIn } from './localWorkspaceTools';
import { shippedToBaseBranch } from './shipVerification';
import { toolActivity, activityTarget, type BrainRunActivity } from './runActivity';
import { ReadCoverage, revisitAdvisory, withAdvisory } from './readCoverage';
import { FailureTally, failureReason, repeatedFailureAdvisory } from './repeatedFailure';
import { trimToolResult } from './toolResultBudget';
import { chatModeDirective, normalizeChatMode, type ChatMode } from './chatMode';
import { routingQueryForTurn, turnOptimizationDirective } from './turnOptimization';
import {
  shouldRecoverStalledTurn,
  isExhaustedStall,
  stallShape,
  stallRecoveryNudge,
  stallExhaustedNotice,
  modelFailoverNotice,
  chooseStallFailover,
  MAX_ANNOUNCEMENT_RECOVERIES,
  MAX_MODEL_FAILOVERS,
  toolNamesMentionedIn,
  isContinuationDirective,
  promisesUnfinishedWork,
  continuationDirective,
} from '@builderforce/agent-stall';
import { runAgentLoop, openAiChatCodec, ASK_USER_TOOL, ASK_USER_TOOL_SPEC, askUserBlock, splitVendorReasoning, canonicalReasoningText, type LoopHooks, type LoopPorts, type LoopTurn } from '@builderforce/agent-loop';
import {
  formatEvermindMemoryBlock,
  countReconciledMemories,
  type EvermindRunHooks,
  type EvermindRecallResult,
  type MemoryFirstAnswer,
} from './evermindMemory';

/**
 * Build the provenance metadata for a persisted assistant turn from the stream
 * result — the resolved model + which account served it (`x-builderforce-account`,
 * captured as `result.account`).
 *
 * The MODEL alone is enough to record. An older gateway (or a CORS setup that
 * doesn't expose the account header) reports no account, and requiring one used to
 * throw away the model with it — leaving a turn with no attribution at all, which
 * is exactly when a user asking "why is this answer so bad?" needs it most.
 * Shared by both the mid-run narration and the final-answer persist so the chip
 * shows on every durable turn.
 */
function provenanceMetadata(result: StreamChatResult): string | undefined {
  const model = result.resolvedModel;
  if (!model) return undefined;
  const a = result.account;
  const account: ProvenanceAccount | undefined =
    a === 'own' || a === 'shared' || a === 'shared_byo_unused' ? a : undefined;
  return withProvenanceMetadata({ model, ...(account ? { account } : {}) });
}

// Announced-but-untaken tool call detection lives in `@builderforce/agent-stall` —
// the on-prem/cloud agent loop hits the identical failure and shares the heuristic,
// the per-run budget and the re-prompt wording from there.

// There is NO tool-iteration ceiling on a run. A chat turn ends when the model answers,
// when the user stops it, or when its tool calls keep FAILING — the kernel's
// consecutive-failure breaker (`DEFAULT_TOOL_FAILURE_STREAK` in `@builderforce/agent-loop`)
// is the only limit, and it is the same one on every surface. The step ceiling this
// replaced (25 here, 40 on the native participant, 6 on the server reply) cut off exactly
// the runs it should not have: a review of forty ticket branches, a rename across a
// repository, "assign these to the agents and merge them" — long because the work was
// long, not because the model was stuck. A stuck run announces itself by failing.

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
// The per-result cap on what the MODEL transcript carries for one tool result (the trace
// keeps the full result) lives in `toolResultBudget.ts`: a generic head slice for list
// results, and LINE-paged windows with an intact continuation offset for `read_file`.

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
  /** Hard-pin a deliberate user-selected model. */
  modelStrict?: boolean;
  /** Explicit routing choice when no model is pinned. */
  routingMode?: 'auto' | 'byo_pool';
  /**
   * Pick the next model to try when the current one has burned its whole stall budget
   * without emitting a single tool call — i.e. re-prompting it is spent and only a
   * DIFFERENT model can finish the request.
   *
   * The loop is deliberately surface-agnostic here: the host holds the cached
   * `/llm/v1/models` surface and answers with `nextFallbackModel(surface, tried)`, so
   * the ordering (own account + tool-calling pool first) lives in ONE shared function
   * rather than in each host. Return undefined — or omit the callback — to keep the
   * previous behaviour: stop and explain, instead of switching.
   *
   * `tried` holds every model already attempted this run, requested and resolved.
   */
  pickFallbackModel?: (tried: readonly string[]) => string | undefined;
  runTool?: (name: string, args: unknown) => Promise<unknown>;
  /** Pure predicate: true → pause the loop for an explicit user confirmation. */
  needsConfirm?: (req: { name: string; args: unknown }) => boolean;
  stream: BrainStreamFn;
  /**
   * `max_tokens` for this run's completions — the composer's Effort level (see
   * `effort.ts`). Absent keeps `streamChatCompletion`'s 4096 default.
   */
  maxTokens?: number;
  /**
   * Vendor-neutral reasoning intent for this run (the composer's Thinking toggle,
   * at the Effort level's intensity). Absent ⇒ no `reasoning` key on the wire.
   * Applies to the MODEL-FACING turns only — the internal transcript summarizer
   * is a mechanical compaction, never a "think harder" job.
   */
  reasoning?: ReasoningIntent;
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
  /**
   * The conversation's MODE (migration 0409) — whether this run is a CONVERSATION
   * (`chat`: read, reason, answer) or an EXECUTION (`work`: create + staff + link the
   * ticket, then dispatch an agent to run it). Decides which directive is folded into
   * the system prompt; see `chatMode.ts`.
   *
   * Optional, and absent means `work`: hosts that predate the mode (the VS Code
   * webview, any embed) keep the always-execute behaviour they shipped with rather
   * than silently losing their ticket lineage.
   */
  chatMode?: ChatMode;
}

/** Live, observable snapshot of a chat's run (what the hook renders). */
export interface BrainRunSnapshot {
  running: boolean;
  streamingText: string;
  error: string;
  /**
   * What the user can DO about {@link error}, when the failure was actionable —
   * an expired session (reconnect), a plan that doesn't cover the request
   * (upgrade), or billing that needs a card (validate_card). Derived ONCE here
   * from the thrown error's structured gateway fields via {@link chatErrorAction},
   * so a mounted view renders the right button without re-parsing error prose.
   * Null when nothing but dismissing applies.
   */
  errorAction: ChatErrorAction | null;
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
   * What the run is doing RIGHT NOW — the in-flight step, published as it is
   * ENTERED rather than when it settles. The `trace` records a step only once it
   * has completed, which is the wrong moment for a progress indicator: a search
   * that takes a minute emits nothing at all until it is over, so a working agent
   * and a hung one look identical. Null while idle. See `runActivity.ts`.
   */
  activity: BrainRunActivity | null;
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
  /** Actionable verdict for {@link error} — see BrainRunSnapshot.errorAction. */
  errorAction: ChatErrorAction | null;
  pendingConfirm: { name: string; args: unknown } | null;
  confirmResolver: ((ok: boolean) => void) | null;
  appended: BrainMessage[];
  messagesEpoch: number;
  listeners: Set<() => void>;
  /** A pending coalesced repaint for streamed tokens — see {@link emitStreaming}. */
  emitTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Abort handle for the run currently in flight. Created fresh in `startRun` and
   * used to (a) cancel the streaming LLM fetch and (b) let the loop unwind
   * cleanly when the user hits Stop. Null while idle. A fresh controller per run
   * means a stale aborted one never bleeds into the next run.
   */
  abort: AbortController | null;
  /** The in-flight step (see BrainRunSnapshot.activity). Null while idle. */
  activity: BrainRunActivity | null;
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
   * The ticket this run opened for its own code change, the MOMENT it made the first
   * one — not at the end.
   *
   * Traceability that only happens in the `finally` block is traceability that a long
   * run does not get: the finally is skipped on a user Stop, and never reached at all
   * if the surface is closed or reloaded mid-run. A measured run edited files for
   * thirteen hours and ended with nothing on the board, because the one moment it would
   * have recorded anything was a moment it never reached. Opening the ticket on the
   * FIRST edit means the work is visible and linked to the chat from the first edit
   * onward, whatever happens to the rest of the turn; the end-of-run pass then attaches
   * the remaining files to THIS id rather than minting a second ticket.
   */
  deltaTicketId: number | null;
  /** Files already attached to {@link deltaTicketId}, so the settle pass only sends what
   *  is new (and sends nothing when the first edit was the only one). */
  deltaRecordedFiles: string[];
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
  errorAction: null,
  pendingConfirm: null,
  messagesEpoch: 0,
  appended: [],
  hasTrace: false,
  trace: [],
  activity: null,
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
    errorAction: null,
    pendingConfirm: null,
    confirmResolver: null,
    appended: [],
    messagesEpoch: 0,
    listeners: new Set(),
    emitTimer: null,
    abort: null,
    activity: null,
    byoUnresolved: [],
    providerCap: [],
    codeChanged: false,
    ticketRecorded: false,
    touchedFiles: [],
    deltaTicketId: null,
    deltaRecordedFiles: [],
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

/**
 * How long streamed tokens may accumulate before the mounted views repaint.
 * A frame's worth: a reply arrives as hundreds of deltas a second, and a repaint
 * per delta — every subscriber of the cell plus every cross-chat subscriber of
 * the store — was the hottest path in the loop. Nobody can read faster than a
 * frame, so nothing is lost by drawing once per frame.
 */
const STREAM_EMIT_MS = 32;

/** Repaint soon, coalescing every delta that lands in the meantime. Any direct
 *  `emit` before the frame flushes it first, so a phase change never trails
 *  the text it belongs to. */
function emitStreaming(c: RunCell): void {
  if (c.emitTimer) return;
  c.emitTimer = setTimeout(() => {
    c.emitTimer = null;
    emit(c);
  }, STREAM_EMIT_MS);
}

/** Re-derive the cached snapshot and notify subscribers. */
function emit(c: RunCell): void {
  if (c.emitTimer) {
    clearTimeout(c.emitTimer);
    c.emitTimer = null;
  }
  c.snapshot = {
    running: c.running,
    streamingText: c.streamingText,
    error: c.error,
    errorAction: c.errorAction,
    pendingConfirm: c.pendingConfirm,
    messagesEpoch: c.messagesEpoch,
    appended: c.appended,
    hasTrace: c.trace.length > 0,
    trace: c.trace,
    activity: c.activity,
    byoUnresolved: c.byoUnresolved,
    providerCap: c.providerCap,
  };
  for (const l of c.listeners) l();
  // Cross-chat subscribers (the dropdown / session-list indicators) see every
  // change too, so a run starting/finishing/pausing in a NON-mounted chat still
  // updates the "which chats are live" view.
  for (const l of storeListeners) l();
}

/**
 * Publish the in-flight step. Called on ENTRY to each phase — the whole point is
 * that the user sees the step while it runs, not after. Emits so every mounted
 * surface repaints; the value is small and phase changes are rare relative to
 * token deltas, so this costs nothing measurable.
 */
function setActivity(c: RunCell, activity: BrainRunActivity | null): void {
  c.activity = activity;
  emit(c);
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
 * Persist a step DURABLY so it survives a reload — the in-memory `trace` alone
 * vanishes on remount, which is why steps used to disappear from a reopened chat.
 * Stored as a `role:'tool'` message whose metadata carries the step payload
 * (`{ kind:'step', ... }`); the timeline reconstructs the node from it (see
 * timelineModel.buildSettledTimeline) and the triage diagnostics reconstruct the
 * trace event from it (see persistedSteps.traceWithPersistedSteps).
 *
 * The DIAGNOSTICS scalars ride along verbatim: the pre-trim `resultBytes` and the
 * `truncated` flag on a tool step (so the "which tool flooded the window" signal
 * isn't lost to the 4 KB result cap below), and `usage` / `finishReason` /
 * `textChars` on an `llm` turn. Without them a reloaded chat's diagnostics could
 * only report a byte floor and no tokens at all.
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
    // Diagnostics scalars — tiny, and the whole point of keeping the row.
    ...(ev.resultBytes != null ? { resultBytes: ev.resultBytes } : {}),
    ...(ev.truncated ? { truncated: true } : {}),
    ...(ev.usage ? { usage: ev.usage } : {}),
    ...(ev.finishReason != null ? { finishReason: ev.finishReason } : {}),
    ...(ev.textChars != null ? { textChars: ev.textChars } : {}),
    ...(ev.ttftMs != null ? { ttftMs: ev.ttftMs } : {}),
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

/**
 * ONE ticket per run: point the model's own `from_delta` call at the ticket this run
 * already opened, by filling in the `taskId` it left out.
 *
 * The run opens a delta ticket on its first edit; the model, following the same
 * directive from the other end, frequently records the delta as well. Left alone that
 * is TWO tickets for one change — worse on the board than the missing ticket the whole
 * mechanism exists to prevent. `from_delta` already takes `taskId` to attach instead of
 * mint, and the directive already tells the model to pass it; this is the deterministic
 * form of that advice. An explicit `taskId` from the model always wins — it may know a
 * better ticket than the one we minted.
 *
 * Mutates in place because that is where the dispatcher reads its arguments from.
 * Exported for the unit test; a no-op for every other tool.
 */
export function attachDeltaToRunTicket(toolName: string, args: unknown, deltaTicketId: number | null): void {
  if (toolName !== 'builtin_tickets_from_delta' || deltaTicketId == null) return;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return;
  const bag = args as Record<string, unknown>;
  if (bag.taskId == null) bag.taskId = deltaTicketId;
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
/**
 * The text of the most recent ASSISTANT turn — the counterpart to
 * {@link latestUserText}. Read as a pair to decide whether a bare directive
 * ("Fix") is a continuation of a proposal the previous turn left unfinished.
 * Walks backwards because the working transcript also carries `tool` rows and the
 * loop's own injected turns, so position alone does not identify a reply.
 */
function lastAssistantText(convo: ChatCompletionMessage[]): string {
  for (let i = convo.length - 1; i >= 0; i -= 1) {
    const m = convo[i];
    if (m.role === 'assistant') return typeof m.content === 'string' ? m.content.trim() : '';
  }
  return '';
}

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

/**
 * Is a transcript message still part of what the model sees? False once auto-compaction
 * has folded it into the memory note, or the drop-oldest window has let it fall off the
 * front. Deliberately conservative: it judges against the CURRENT transcript (which has
 * grown since the last working set was built), so it can only ever call a message gone a
 * turn early — a needless replay costs tokens, a stub for a vanished result costs the run.
 */
function stillInWorkingContext(c: RunCell, anchor: unknown): boolean {
  const convo = c.transcript;
  const idx = convo.indexOf(anchor as ChatCompletionMessage);
  if (idx < 0) return false;
  if (c.compactMemo) return idx >= compactTailStart(convo, COMPACT_TAIL_TURNS);
  return windowed(convo).includes(convo[idx]!);
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
      // A compaction note is a UTILITY completion: a bounded answer with no thinking.
      // Left unset, it inherited the run's full output ceiling and, on a thinking-
      // capable model, the run's reasoning depth — the most expensive way to write a
      // paragraph the user never sees. ~1.2k tokens holds a dense memory of any
      // middle this loop compacts (the tail is 8 turns; the middle is summarised
      // afresh at most once per 8 new turns).
      maxTokens: 1_200,
      reasoning: { level: 'off' },
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
  forgetResolvedModels();
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
  const driver = getRunDriver();
  if (driver) return driver.stop(chatId);
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
  // Nothing is in flight any more. Cleared here as well as in startRun's finally
  // so the indicator disappears the instant Stop is pressed, rather than when the
  // aborted loop finally unwinds.
  c.activity = null;
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
  const driver = getRunDriver();
  if (driver) return driver.clearError(chatId);
  const c = cells.get(chatId);
  if (!c || !c.error) return;
  c.error = '';
  c.errorAction = null;
  emit(c);
}

/**
 * Ask the human about one tool call and wait for the answer — the ONE way a pending
 * confirmation is raised on a chat's run cell.
 *
 * It exists as a function rather than as four lines inside the tool loop because the
 * loop is no longer the only thing that needs to ask. A sub-agent delegated by a run
 * executes in its own nested loop, and a child that could not reach this channel was a
 * child that could only ever read — which is why local delegation was investigation-only
 * until this became callable from outside.
 *
 * The resolver lives on the CELL, so whichever Brain instance is mounted answers it —
 * including one that navigated in after the question was asked. Answered by
 * {@link resolveRunConfirm}; a Stop unwinds it as a decline so nothing waits forever.
 *
 * Returns false immediately when the run for this chat is driven by ANOTHER process
 * (a run driver is installed): the confirming UI belongs to whoever owns the loop, and
 * a caller here has no channel to it. Declining is the safe answer — the action simply
 * does not happen.
 */
export function requestRunConfirm(
  chatId: number,
  req: { name: string; args: unknown },
  opts?: { step?: number },
): Promise<boolean> {
  if (getRunDriver()) return Promise.resolve(false);
  const c = getCell(chatId);
  return new Promise<boolean>((resolve) => {
    c.pendingConfirm = { name: req.name, args: req.args };
    c.confirmResolver = resolve;
    // Waiting on a HUMAN, not on us. The indicator must stop animating as though work
    // is happening — nothing advances until the user answers.
    c.activity = {
      ...toolActivity(req.name, req.args, opts?.step ?? c.activity?.step ?? 0, Date.now()),
      phase: 'awaiting',
    };
    emit(c);
  });
}

/** Resolve a pending human-in-the-loop confirmation. No-op if none is pending. */
export function resolveRunConfirm(chatId: number, ok: boolean): void {
  const driver = getRunDriver();
  if (driver) return driver.confirm(chatId, ok);
  const c = cells.get(chatId);
  if (!c || !c.confirmResolver) return;
  const resolve = c.confirmResolver;
  c.confirmResolver = null;
  c.pendingConfirm = null;
  emit(c);
  resolve(ok);
}

/**
 * Mirror a run that is executing in ANOTHER process into this store's cell, so every
 * local reader — the conversation hook, the timeline, `getGlobalRunState` — sees it
 * exactly as it would see an in-process run. The only writer of a cell that no local
 * loop owns; a locally running cell is never overwritten (the local loop is the
 * truth for it). `trace` is taken as sent: the remote side decides how much of its
 * bounded trace to ship (see the VS Code host's delta relay).
 */
export function applyRemoteRun(chatId: number, snapshot: BrainRunSnapshot): void {
  const c = getCell(chatId);
  if (c.abort) return; // an in-process loop owns this cell
  c.running = snapshot.running;
  c.streamingText = snapshot.streamingText;
  c.error = snapshot.error;
  c.errorAction = snapshot.errorAction;
  c.pendingConfirm = snapshot.pendingConfirm;
  c.messagesEpoch = snapshot.messagesEpoch;
  c.appended = snapshot.appended;
  c.trace = snapshot.trace;
  c.activity = snapshot.activity;
  c.byoUnresolved = snapshot.byoUnresolved;
  c.providerCap = snapshot.providerCap;
  emit(c);
}

/**
 * Start (or no-op join) the agent loop for a chat. Single-flight per chat: if a
 * run is already in flight the call returns immediately, so a second mounted
 * Brain instance can never spawn a duplicate loop. The claim is synchronous
 * (set before any await), so two callers in the same tick can't both pass it.
 */
export async function startRun(chatId: number, req: BrainRunRequest): Promise<void> {
  // A host whose UI process cannot be trusted to outlive the run (see `runDriver.ts`)
  // executes it elsewhere; this store then only MIRRORS that run via applyRemoteRun.
  const driver = getRunDriver();
  if (driver) return driver.start(chatId, req);
  const c = getCell(chatId);
  if (c.running) return; // already running elsewhere — never double-fire
  c.running = true;
  c.error = '';
  c.errorAction = null;
  c.streamingText = '';
  c.byoUnresolved = []; // fresh per run — a reconnected account clears the banner
  c.providerCap = [];   // fresh per run — a topped-up account clears the banner
  // Fresh backstop bookkeeping per run (see the finally block below).
  c.codeChanged = false;
  c.ticketRecorded = false;
  c.touchedFiles = [];
  c.deltaTicketId = null;
  c.deltaRecordedFiles = [];
  // Fresh abort handle for this run, so Stop can cancel the LLM stream and unwind
  // the loop (a stale, already-aborted controller never bleeds into a new run).
  c.abort = new AbortController();
  // Show something the instant the run is accepted. Between here and the first
  // token the surface would otherwise have nothing at all to render.
  c.activity = { phase: 'starting', startedAt: Date.now(), step: 0 };

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
    if (!c.abort?.signal.aborted) {
      c.error = e instanceof Error ? e.message : 'Reply failed';
      // Keep the gateway's structured entitlement verdict (402 needs-a-card /
      // needs-a-plan, 401 expired session) attached to the surfaced error, so
      // the banner can offer the fix instead of only naming the problem.
      c.errorAction = chatErrorAction(e);
    }
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
    // Post-run work is still work: minting and advancing tickets are real calls that
    // take real time. Announce the phase so the surface doesn't go blank-but-busy.
    if (!aborted && c.codeChanged && req.projectId != null && req.runTool) {
      c.activity = { phase: 'finishing', startedAt: Date.now(), step: 0 };
      emit(c);
    }
    // The ticket itself was already opened on the run's first edit (see the tool loop),
    // so this pass ATTACHES whatever was touched afterwards to that same ticket — and
    // still mints one in the case the opening call failed. It is skipped on a Stop, but
    // a stopped run is no longer the case where nothing gets recorded.
    if (!aborted && c.codeChanged && req.projectId != null && req.runTool && (!c.ticketRecorded || c.deltaTicketId != null)) {
      await recordCodeChangeTicket(chatId, c, req, 'settle').catch(() => { /* never fail the run on the backstop */ });
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
    // And if the run MERGED its change to the base branch, the review lane is moot —
    // the code is live. Runs last, after the mint above, so a ticket this run created
    // and then shipped is completed rather than left at 50% forever. Gated on real
    // evidence of a push that landed, not on the run merely having touched files.
    if (!aborted && c.codeChanged && req.projectId != null && req.runTool && shippedToBaseBranch(c.trace)) {
      await completeShippedTickets(chatId, c, req).catch(() => { /* never fail the run on the backstop */ });
    }
    // The run is over: nothing is in flight, so no indicator may claim otherwise.
    // Cleared LAST, after the backstops above, so `finishing` stays visible for them.
    c.activity = null;
    emit(c);
  }
}

/**
 * Record this run's code change as a work delta on the board, linked to the chat.
 *
 * ONE function for both moments it happens, because they are the same act with a
 * different `taskId`:
 *
 *  - `open` fires on the FIRST successful code-change tool call, mints the ticket, and
 *    remembers its id on the cell. This is what makes the guarantee survive a run that
 *    never finishes — a Stop, a closed webview, a thirteen-hour turn the user gives up
 *    on. Traceability recorded only in a `finally` block is traceability an abandoned
 *    run does not get, and an abandoned run is precisely the one whose changes are on
 *    disk with nothing on the board to explain them.
 *  - `settle` fires after the run and attaches whatever else was touched to the SAME
 *    ticket by passing `taskId`, so the second call never mints a duplicate. It also
 *    covers the case where the `open` call failed (no id, so it mints then).
 *
 * Best-effort throughout: records a durable tool step so the auto-capture is visible on
 * the timeline, and never throws.
 */
async function recordCodeChangeTicket(
  chatId: number,
  c: RunCell,
  req: BrainRunRequest,
  phase: 'open' | 'settle',
): Promise<void> {
  if (!req.runTool || req.projectId == null) return;
  const known = new Set(c.deltaRecordedFiles);
  const files = c.touchedFiles.filter((f) => !known.has(f)).slice(0, 50);
  // Nothing new to say about a ticket that already exists — don't spend a call on it.
  if (phase === 'settle' && c.deltaTicketId != null && files.length === 0) return;
  const attachTo = c.deltaTicketId;
  const summary = files.length
    ? `Code change (${files.length} file${files.length === 1 ? '' : 's'}) from Brain chat #${chatId}`
    : `Code change from Brain chat #${chatId}`;
  const toolStart = nowMs();
  const args = {
    projectId: req.projectId,
    summary,
    detail:
      attachTo != null
        ? 'Auto-captured: further files changed by the same chat, attached to the ticket this run opened.'
        : 'Auto-captured: this chat changed code without recording a ticket, so the platform minted one to keep the work visible on the board and linked to the conversation.',
    files,
    kind: 'improvement',
    modality: 'ide',
    chatId,
    ...(attachTo != null ? { taskId: attachTo } : {}),
  };
  let out: unknown;
  try {
    out = await req.runTool('builtin_tickets_from_delta', args);
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!isFailedToolResult(out)) {
    c.deltaRecordedFiles = [...c.deltaRecordedFiles, ...files];
    // Only a MINT yields an id to attach to; an attach returns the same ticket, so
    // reading the id back off either result is correct and keeps this one branch.
    const id = (out as { id?: unknown } | null)?.id;
    if (c.deltaTicketId == null && typeof id === 'number') c.deltaTicketId = id;
    // The model's own from_delta/link call is what `ticketRecorded` tracks; a mint we
    // performed satisfies the same guarantee, so the settle pass must not mint again.
    c.ticketRecorded = true;
  }
  pushDurableStep(c, chatId, req.persistence, {
    ts: nowIso(),
    category: 'tool',
    label: 'builtin_tickets_from_delta',
    durationMs: nowMs() - toolStart,
    args: { ...args, auto: true, phase },
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
 * Close the loop `tickets.from_delta` has always promised and never delivered.
 *
 * A delta ticket opens in `in_review` — "the code exists but has not landed yet" —
 * and its tool description tells the model it "completes automatically once merged
 * and deployed". Nothing completed it. The intended completer was a GitHub merge
 * webhook, which cannot fire for a change pushed straight to the base branch with no
 * pull request, so those tickets sat at 50% on the board permanently.
 *
 * When THIS run pushed to a base branch and verified it landed
 * ({@link shippedToBaseBranch}), the run holds first-hand evidence the work shipped,
 * and is the only thing that ever will. Best-effort and fail-closed: an ambiguous
 * trace leaves the ticket exactly where it was.
 */
async function completeShippedTickets(chatId: number, c: RunCell, req: BrainRunRequest): Promise<void> {
  if (!req.runTool) return;
  let listed: unknown;
  try {
    listed = await req.runTool('builtin_chats_list_tickets', { chatId });
  } catch {
    return; // can't read the links — nothing to complete
  }
  for (const t of linkedTicketsToComplete(listed)) {
    const id = Number(t.ref);
    if (!Number.isInteger(id)) continue;
    const toolStart = nowMs();
    let out: unknown;
    try {
      out = await req.runTool('builtin_tasks_update', { id, status: 'done' });
    } catch (e) {
      out = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    pushDurableStep(c, chatId, req.persistence, {
      ts: nowIso(),
      category: 'tool',
      label: 'builtin_tasks_update',
      durationMs: nowMs() - toolStart,
      // The REASON rides on the step: a ticket that closed itself must say what
      // closed it, or the board's history reads as an unexplained status change.
      args: { id, status: 'done', auto: true, reason: 'shipped-to-base-branch' },
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

/**
 * A turn's text in the CANONICAL reasoning shape: one closed `<think>` block, then the
 * answer.
 *
 * Every site in this module that persists model text goes through it. The loop used to
 * store whatever the vendor emitted, and that is how a whole reply — a question the run
 * was blocked on — reached the transcript inside an UNCLOSED block: every reader
 * downstream needs the closing tag to recognise reasoning, so without it the scratchpad
 * IS the message as far as the transcript, the answer cache and Evermind learning are
 * concerned. Normalizing at the point of persistence means nothing later depends on a
 * model closing its own tag.
 *
 * A reasoning-only turn stays reasoning-only — the block is simply closed. The
 * transcript decides what to show for one of those, and only it can: whether the reply
 * is stranded depends on whether the RUN is over (see `strandedReplyKey`).
 */
function canonicalTurnText(text: string): string {
  const { content, reasoning } = splitVendorReasoning({ content: text });
  return canonicalReasoningText(content, reasoning);
}

async function runLoop(chatId: number, c: RunCell, req: BrainRunRequest): Promise<void> {
  const { resolvedSystemPrompt, tools: toolSpecs, model, modelStrict, routingMode, pickFallbackModel, runTool, needsConfirm, stream, persistence, onActivity, evermind, maxTokens, reasoning } = req;
  const convo = c.transcript;
  // The catalog the model is shown, PLUS the conversational `ask_user` tool.
  //
  // `ask_user` is injected here rather than registered as a host action because it is
  // not an action: nothing executes it. It is a way for the run to END — the loop
  // intercepts the call as terminal and replies with the question (see
  // `beforeToolCalls`). Injected only where a tool call can be made at all, because on
  // a surface with no tool runner an advertised tool is a trap: the model's call would
  // be discarded and the question lost.
  //
  // Before this, only the server-side reply loop offered it, so a question asked in the
  // editor's chat could only ever arrive as prose — while that very surface rendered
  // `<QuestionCard>` / `<PendingQuestionBanner>` for a block nothing could produce.
  //
  // Gated on the host ALREADY having a catalog, not merely on having a runner. An
  // empty catalog is a FAULT SIGNAL — "zero tools advertised" is how a failed tenant
  // tool load is told apart from a model that simply declined to act — and injecting
  // one tool into it would report a broken catalog as a working one.
  const canAskUser = !!runTool && (toolSpecs?.length ?? 0) > 0;
  const catalog = canAskUser ? [...(toolSpecs ?? []), ASK_USER_TOOL_SPEC] : toolSpecs;
  const allTools = catalog && catalog.length > 0 ? catalog : undefined;
  // Tools this run has actually called — pinned into every later turn's selection
  // so a multi-step task never loses a tool it is mid-way through using.
  const usedTools = new Set<string>();
  // Caller provenance for the gateway's audit emit — this is what makes the
  // DEFAULT agent's turn show WHICH MODEL served it in the activity log (the
  // server no-ops without a chat id). Built once and shared by every
  // model-facing turn of this run. Deliberately NOT passed to the transcript
  // summarizer (`summarizeMiddle`): that is mechanical compaction, not a reply,
  // and auditing it would double-count the turn.
  // Conversation or execution (0409). Resolved once here because BOTH the usage
  // metadata below and the system-prompt directive further down need it, and they must
  // never disagree about which mode this run was.
  const runMode = normalizeChatMode(req.chatMode ?? 'work');
  const metadata: CompletionMetadata = {
    chatId,
    guestTurnId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    guestTurnInput: latestUserText(convo),
    mode: runMode,
    ...(req.projectId != null ? { projectId: req.projectId } : {}),
  };

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

  // Memory-first short-circuit: if the project's OWN memory can answer this request —
  // an exact-repeat Q&A cache hit, or its Evermind SSM (opt-in) — adopt that answer and
  // SKIP the paid model entirely. This is the token-reduction core: for a repeated or
  // learned question we spend zero model tokens. Opt-in + best-effort — a host that
  // doesn't inject `answer`, a non-project chat, or a miss falls straight through to the
  // normal loop below. Only attempted on the run's FIRST turn (no tool results yet).
  //
  // `toolsAvailable` is passed through HONESTLY (it is what this run can actually
  // call) because it decides how far memory is allowed to pre-empt the model: with
  // tools in play the server may only replay a cached answer, never generate a fresh
  // one from the Evermind SSM — the SSM cannot call a tool, so letting it answer
  // stranded any request whose answer lives behind one.
  if (evermind?.answer && !c.abort?.signal.aborted) {
    const query = latestUserText(convo);
    if (query) {
      let memAnswer: MemoryFirstAnswer | null = null;
      try {
        memAnswer = await evermind.answer(query, { toolsAvailable: !!allTools && allTools.length > 0 });
      } catch { memAnswer = null; }
      const finalText = canonicalTurnText(memAnswer?.text ?? '');
      if (finalText) {
        convo.push({ role: 'assistant', content: finalText });
        const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: finalText }]);
        c.streamingText = '';
        recordAppended(c, assistantMsg);
        // Visible on the timeline: memory answered, the LLM was skipped.
        pushDurableStep(c, chatId, persistence, {
          ts: nowIso(),
          category: 'recall',
          label: memAnswer!.source === 'evermind' ? 'evermind.answer' : 'memory.answer',
          args: { query },
          result: {
            source: memAnswer!.source,
            skippedLlm: true,
            ...(memAnswer!.evermindVersion != null ? { version: memAnswer!.evermindVersion } : {}),
            // WHICH head served it — a project can target several, so without this a
            // memory hit from a sibling IDE build's Evermind is indistinguishable from
            // the chat project's own.
            ...(memAnswer!.evermindProjectId != null ? { evermindProjectId: memAnswer!.evermindProjectId } : {}),
          },
        });
        emit(c);
        onActivity?.(chatId);
        return;
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

  // Bind this run to the conversation's MODE (migration 0409).
  //
  // WORK: tell the model its chatId, that work it identifies or code it changes must
  // become a ticket LINKED to this chat, and that it must dispatch an agent to run it.
  // This is the enabler the chat-scoped + from_delta tools need — without the id they
  // are advertised but the model has no chatId to pass.
  //
  // CHAT: answer the question; do not mint board work as a side effect of answering.
  //
  // Injected here (with the guaranteed-resolved id) so it rides BOTH the web Brain and
  // the VS Code webview Brain, mirroring the server-side @agent reply loop
  // (BrainService.agentReply). `chatMode` is optional and defaults to WORK so any host
  // that has not adopted the mode yet keeps the behaviour it shipped with.
  // The tools this host advertised for the run, by name. Resolved once: it answers both
  // "may this session change code itself" (below) and "which local tools must never be
  // trimmed away" (the selection pin further down), and those two must see one catalog.
  const catalogToolNames = (req.tools ?? []).map((t) => t.function.name);
  // WORK mode's ordering depends on what THIS surface can do: an IDE run holding the
  // workspace tools should make a small change itself rather than hire a cloud agent to
  // make it, while a web run (no file tools) can only ever get code changed by
  // dispatching. Derived from the run's own advertised tools, so no host declares its
  // capability separately — and a host that gains or loses the file tools stays
  // consistent with the post-run backstop, which reads the same set.
  const canEditHere = canChangeCodeHere(catalogToolNames);
  systemPrompt = `${systemPrompt}\n\n${chatModeDirective(runMode, chatId, { canEditHere })}\n\n${turnOptimizationDirective()}`;

  // A bare "Fix" / "do it" / "go ahead" has no subject of its own — it points at the
  // proposal in the previous assistant turn. Read as a fresh, contextless request it
  // is genuinely ambiguous, and the model then does the reasonable-looking thing: it
  // asks what to fix, while the answer sits one message above it in the same
  // transcript. The user has to re-explain something they already said, and the turn
  // produced nothing.
  //
  // Resolved HERE rather than left to the model to notice, because the connection is
  // structural and cheap to verify — a contentless directive landing directly on a
  // turn that promised unfinished work — and because a model that misreads it burns a
  // whole turn asking.
  // The user's OWN request for this run, captured once. Every later read of the
  // transcript would find the loop's own recovery nudge instead — and the handoff gate
  // below asks "did the USER ask for a change?", a question a nudge cannot answer.
  const userRequest = latestUserText(convo);
  if (isContinuationDirective(userRequest) && promisesUnfinishedWork(lastAssistantText(convo))) {
    systemPrompt = `${systemPrompt}\n\n${continuationDirective()}`;
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'turn.continuation_resolved',
      result: "The user's bare directive was resolved against the previous turn's unfinished proposal, so the run carries that proposal out instead of asking what to fix.",
    });
  }

  // What this run has already read. Two guards, one tally (see `readCoverage.ts`):
  // an EXACT repeat of a successful read-only call — same tool, same arguments —
  // returns an "already returned above" stub instead of re-fetching + re-injecting
  // the payload; and a target re-read at SHIFTING offsets gets an advisory once it
  // starts circling. Both are invalidated together, and only for what a later
  // mutation actually touched — never wiped wholesale by an unrelated call.
  const readCoverage = new ReadCoverage();
  // What this run has already FAILED at (see `repeatedFailure.ts`). The read guards
  // above deliberately record only SUCCESSES, so an identical failing call — the same
  // `git_status` answered with the same remedy three times, the same platform read
  // answered 502 twice — got no pushback at all and could repeat until the budget was
  // gone. The first retry stays free; from the second the model reads the count and the
  // error it already has, and the moves that remain.
  const failures = new FailureTally();
  /**
   * Record a failed call and return the advisory the MODEL should read with it, or null
   * while a retry is still reasonable. The intervention is its own trace step — exactly
   * as the revisit guard's is — so triage can see the loop was fought rather than
   * inferring it from the repetition.
   */
  const failureAdvisoryFor = (name: string, args: unknown, out: unknown, step: number): string | null => {
    const attempts = failures.record(name, args);
    const advisory = repeatedFailureAdvisory(name, attempts, failureReason(out));
    if (advisory) {
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: 'tools.repeat_failure_guard',
        args: { step, tool: name, attempts },
        result: advisory,
      });
    }
    return advisory;
  };
  // Bounded counter for the announced-but-never-made tool call recovery below, so a
  // model that keeps narrating instead of acting cannot spin the loop. Not one-shot:
  // a model that stalls once frequently stalls again on the very next turn, and
  // spending the single retry on the first stall left the user holding the SECOND
  // promise. The stall budget (`agent-stall`) bounds these recoveries on its own — a
  // run has no iteration ceiling to fall back on.
  let announcementRecoveries = 0;
  // The model this run is CURRENTLY talking to, and every model it has already tried.
  // Both change when a model burns its whole stall budget without emitting a single
  // tool call: re-prompting such a model is spent, so the run fails over to another
  // one rather than handing the user a promise (see the failover branch below).
  let activeModel = model;
  const triedModels: string[] = [];
  let modelFailovers = 0;
  // The user's ACTUAL request for this run, resolved once. Every turn's tool
  // selection scores against this and nothing else — see the `query` note below.
  const requestQuery = routingQueryForTurn(convo);
  // Tool names the resolved system prompt tells the model to call. Always advertised.
  //
  // This only catches `builtin_*` / `mcp__*` identifiers, which is the right pattern
  // for a catalog tool named in prose but blind to the LOCAL workspace tools —
  // `run_command`, `read_file`, `edit_file` and the rest carry no such prefix. The IDE
  // persona names every one of them ("use run_command for git … to commit, push, and
  // open a PR") and pinned none, so on the turn that asked for a commit `run_command`
  // scored zero against "commit the change and push to main", missed the 64-tool cut,
  // and the agent reported that the tool its own prompt had promised did not exist —
  // then burned 78 calls and 44 minutes looking for it.
  //
  // Those tools are not one domain among many that a query may be relevant to; they are
  // what this surface IS. Every one the host advertised is pinned, so relevance can
  // never decide whether the agent may touch the workspace it is sitting in. On a
  // surface without them (the web Brain) the intersection is empty and nothing changes.
  const alwaysAdvertised = [
    ...toolNamesMentionedIn(systemPrompt),
    ...localToolsIn(catalogToolNames),
    // The project-memory pair (recall before re-reading; remember what was learned) is
    // the cheapest tool in the catalog and the first one relevance would drop.
    ...memoryToolsIn(catalogToolNames),
    // Asking the user is never off-topic: it is how the run stops when it cannot
    // proceed, so relevance against the request must not be what decides whether the
    // agent is allowed to ask. Its one schema is also the cheapest in the catalog.
    ...(canAskUser ? [ASK_USER_TOOL] : []),
  ];

  // Evermind learning + reconciliation provenance for a completed turn. Extracted so
  // BOTH the normal final-answer branch AND the breaker-stopped forced-final
  // synthesis branch emit identical memory provenance — a forced-final answer still
  // persists server-side (its `assistantMsg` carries the truthful `evermindLearn`), so
  // it must show the same `learn`/`reconcile` steps + answer-cache write as any other.
  // The server reports the TRUTHFUL learn outcome on the persisted assistant message
  // (`evermindLearn`) — the same `learnFromBrainTurn` gate it actually applies — so the
  // `learn` step shows exactly when the server contributed. The `reconcile` step stays
  // client-side: which of the RECALLED memories this answer restated (write-through).
  const emitEvermindLearnReconcile = (assistantMsg: BrainMessage | undefined, finalText: string): void => {
    const learn = assistantMsg?.evermindLearn;
    if (learn?.learned) {
      pushDurableStep(c, chatId, persistence, {
        ts: nowIso(),
        category: 'learn',
        label: 'evermind.learn',
        // `targets` carries the per-Evermind breakdown (a project can fan out to many)
        // so the timeline can name each by id; the renderer falls back to `version` alone.
        result: { version: learn.version, queued: true, ...(learn.targets ? { targets: learn.targets } : {}) },
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
      // mystery again. `too-short` is mundane (a one-line turn) and intentionally not surfaced.
      pushDurableStep(c, chatId, persistence, {
        ts: nowIso(),
        category: 'learn',
        label: 'evermind.learn',
        result: { version: learn.version, skipped: true, reason: learn.reason, ...(learn.targets ? { targets: learn.targets } : {}) },
      });
    }

    // Remember this (question → answer) so an exact repeat short-circuits next time
    // (see the memory-first block at loop start) — the write half of the cache. Only
    // caches genuine model answers; the server guards length + skips trivial ones.
    // Best-effort, fire-and-forget — never delays or fails the reply.
    if (evermind?.cacheAnswer) {
      const q = latestUserText(convo);
      if (q) { void Promise.resolve(evermind.cacheAnswer(q, finalText)).catch(() => { /* best-effort */ }); }
    }
  };

  // ── THE loop ────────────────────────────────────────────────────────────────
  // The model→tools→model skeleton lives ONCE in `@builderforce/agent-loop` — the same
  // kernel the cloud engine, the creation canvas and the on-prem runtime drive.
  // Everything the Brain does differently — per-turn tool selection and the router,
  // the confirm gate, read de-duplication and the loop guards, stall recovery and
  // model failover, the timeline — is a hook or a port closing over this run's state.
  // Nothing below iterates.
  type StreamResult = Awaited<ReturnType<typeof stream>>;
  /** Per-turn facts BOTH the tool path and the final-answer path read, carried on the turn. */
  interface TurnMeta { result: StreamResult; resolved: string; requested: string; advertised: number; advertisedNames: Set<string> }
  const metaOf = (turn: LoopTurn): TurnMeta => turn.meta as TurnMeta;
  // The tool row's content: a STRING payload was already budgeted by `trimToolResult`
  // in dispatch (advisory attached after the cut); anything else is a small stub or
  // error object the model should read whole.
  const codec = openAiChatCodec<ChatCompletionMessage>((r) => (typeof r.data === 'string' ? r.data : JSON.stringify(r.data)));
  /** A replayed read waits for its row to be pushed so the cache can anchor to it. */
  let pendingReplay: { name: string; args: unknown; result: unknown } | null = null;
  /** What dispatch learned about the call it just ran — for the durable step + the read cache. */
  let pendingRun: { out: unknown; toolStart: number; isReadTool: boolean; threw: boolean; bytes?: number; truncated?: boolean } | null = null;

  /**
   * Commit a turn's text as THE reply of this run: into the model transcript, into
   * the durable message list (carrying the turn's provenance), and into the mounted
   * views. Returns the persisted message so the caller can hang the Evermind
   * learn/reconcile provenance off it.
   *
   * Shared by the two ways a run settles — the ordinary no-tool-calls final answer
   * and a TERMINAL `ask_user` question — because a question is a reply: it must be
   * attributed, learned from and broadcast exactly like any other, or the surface
   * that renders it loses the provenance chip and the memory steps for that turn.
   */
  const settleReply = async (rawText: string, result: StreamResult) => {
    const text = canonicalTurnText(rawText);
    convo.push({ role: 'assistant', content: text });
    const meta = provenanceMetadata(result);
    const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: text, ...(meta ? { metadata: meta } : {}) }]);
    c.streamingText = '';
    recordAppended(c, assistantMsg);
    return assistantMsg;
  };

  const hooks: LoopHooks<ChatCompletionMessage> = {
    beforeToolCalls: async (_ctx, turn, calls) => {
      const { result } = metaOf(turn);
      // `ask_user` is TERMINAL: the agent is blocked on the user's decision, so the run
      // settles here and the reply carries any lead-in prose plus the canonical
      // ```ask-user block the transcript renders as a clickable card. Without this the
      // editor's chat advertised a question it could never deliver — the card and the
      // "Answer needed" banner were wired on the surface with nothing able to produce
      // one, so every question arrived as prose the reader could only re-type.
      // Malformed args fall through to the prose path below, so a question is never
      // swallowed by its own formatting.
      const askCall = calls.find((tc) => tc.name === ASK_USER_TOOL);
      if (askCall) {
        let block: string | null = null;
        try { block = askCall.malformed ? null : askUserBlock(askCall.args); } catch { block = null; }
        const lead = result.text.trim();
        const reply = block ? (lead ? `${lead}\n\n${block}` : block) : lead;
        if (reply) {
          const assistantMsg = await settleReply(reply, result);
          emit(c);
          emitEvermindLearnReconcile(assistantMsg, reply);
          onActivity?.(chatId);
          return { action: 'stop', ok: true, output: reply };
        }
        // A bare malformed call with no prose: let it dispatch, where `beforeDispatch`
        // answers with the corrective result telling the model how to retry.
      }
      // Commit this turn's visible narration as its OWN permanent message block
      // before we clear the streaming buffer for the next iteration. Without
      // this, the narration only lived in the transient `streamingText` bubble,
      // and the next turn's stream reused that same bubble — erasing what the
      // user just read. Each turn that says something now gets a durable block;
      // empty (pure tool-call) turns persist nothing.
      const narration = canonicalTurnText(result.text);
      if (narration) {
        const meta = provenanceMetadata(result);
        const [narrationMsg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: narration, ...(meta ? { metadata: meta } : {}) }]);
        recordAppended(c, narrationMsg);
      }
      c.streamingText = '';
      emit(c);
      return undefined;
    },

    beforeDispatch: async (rawCall, ctx) => {
      const iter = ctx.step;
      pendingReplay = null;
      pendingRun = null;
      // Router calls resolve against the in-memory catalog FIRST. `find`/`describe`
      // are answered locally (no network, no host dispatch); `invoke` unwraps to the
      // real tool and then falls through to the normal path below — so a routed call
      // still passes the confirm gate, the read-dedupe, the audit step and the
      // auto-link, exactly like a directly-advertised one.
      let call = rawCall;
      if (isRouterTool(call.name)) {
        const routed = handleRouterCall(allTools ?? [], call.name, call.args);
        if ('result' in routed) {
          pushDurableStep(c, chatId, persistence, {
            ts: nowIso(),
            category: 'tool',
            label: call.name,
            args: call.args,
            result: routed.result,
          });
          return { result: { data: routed.result } };
        }
        const routedArgs = routed.dispatch.args ?? {};
        call = { ...call, name: routed.dispatch.name, args: routedArgs, raw: { ...call.raw, name: routed.dispatch.name, arguments: JSON.stringify(routedArgs) } };
        pushTrace(c, {
          ts: nowIso(),
          category: 'message',
          label: 'tools.routed',
          args: { step: iter, via: rawCall.name },
          result: `Called ${call.name} through the tool router (it was not advertised directly this turn).`,
        });
      }
      // `ask_user` never reaches the host's tool runner — it is not a workspace action,
      // and `beforeToolCalls` has already settled every WELL-FORMED question as the
      // run's reply. Reached only when the args were malformed AND the model wrote no
      // prose to fall back on, so the answer is a corrective result: the call is not
      // left unanswered, and the model is told exactly how to retry.
      if (call.name === ASK_USER_TOOL) {
        return { result: { data: { error: 'ask_user needs { question, options:[{label}] } with 2+ options. Retry or answer in prose.' } } };
      }
      const args = call.args;
      // ONE ticket per run. The run opens its own delta ticket on the first edit
      // (see below), and the model — following the same directive, from the other
      // end — often records the delta too. Left alone that is two tickets for one
      // change, which is worse on the board than the missing ticket this all exists
      // to prevent. `from_delta` already takes `taskId` to attach rather than mint,
      // so the model's call is pointed at the ticket the run has: the deterministic
      // form of the advice the directive gives it in prose.
      attachDeltaToRunTicket(call.name, args, c.deltaTicketId);
      // Human-in-the-loop gate: pause for an explicit confirm when the host's
      // predicate says so. The resolver lives on the cell, so whichever Brain
      // instance is mounted (even after a navigation swapped it) can answer.
      if (needsConfirm && needsConfirm({ name: call.name, args })) {
        const ok = await requestRunConfirm(chatId, { name: call.name, args }, { step: iter });
        if (!ok) {
          const declined = { cancelled: true, reason: 'User declined this action.' };
          pushDurableStep(c, chatId, persistence, { ts: nowIso(), category: 'tool', label: call.name, args, result: declined });
          return { result: { data: declined } };
        }
      }
      // Read-dedupe: suppress an EXACT repeat of a read-only file/search OR read-only
      // platform call (its result is already above). Any other call invalidates what
      // it could have changed — and ONLY that (see `ReadCoverage.invalidate`): an edit
      // forgets its own file, a platform write forgets the platform reads, a git status
      // forgets nothing. The old set was cleared wholesale by every non-read call, so
      // one ticket write re-armed a full re-read of every file in the run.
      if (isDedupableRead(call.name)) {
        if (readCoverage.isRepeat(call.name, args)) {
          // The stub below is only honest while the earlier result is still in the
          // WORKING context. Once auto-compaction has summarized it away, "it is
          // above you" points at nothing — the model reads that as "I lack the
          // file", asks again, gets the stub again, and circles (chat #101: five
          // stubbed re-reads of one file, zero edits). So the run keeps what each
          // read returned and, when the carrying message has left the window,
          // RE-SERVES it from memory: no disk read, no lie, and the model can act.
          const cached = readCoverage.cachedResult(call.name, args);
          if (cached && !stillInWorkingContext(c, cached.anchor)) {
            const replayNote = `Replayed from this run's read cache: this exact ${call.name} call succeeded earlier in the run, but its result was compressed out of the working context, so here it is again — served from memory, not re-read. Act on it now; do not request it again.`;
            // A replay is still the model going back to the same target, so it
            // counts as a visit and carries the circling advisory when it earns one.
            const visit = readCoverage.record(call.name, args);
            const target = visit ? activityTarget(args) : undefined;
            const revisit = visit && target ? revisitAdvisory(call.name, target, visit) : null;
            const replayed = trimToolResult(call.name, cached.result ?? null, { advisory: revisit ? `${replayNote}\n\n${revisit}` : replayNote });
            pendingReplay = { name: call.name, args, result: cached.result };
            pushTrace(c, {
              ts: nowIso(),
              category: 'tool',
              label: call.name,
              args,
              result: { replayed: true, note: replayNote },
              resultBytes: replayed.bytes,
              truncated: replayed.truncated,
            });
            return { result: { data: replayed.content } };
          }
          const stub = {
            note: `Duplicate ${call.name} call — identical arguments to an earlier call this turn, whose result is already in the conversation above. Reuse that result instead of re-reading; do not repeat it (this saves context and avoids looping).`,
          };
          pushTrace(c, { ts: nowIso(), category: 'tool', label: call.name, args, result: stub });
          return { result: { data: stub } };
        }
      } else {
        readCoverage.invalidate(call.name, args);
      }
      return call === rawCall ? undefined : { rewrite: call };
    },

    afterDispatch: (call, _result, row) => {
      if (pendingReplay) {
        // Keep the replayed read anchored to the message that now carries it.
        readCoverage.cacheResult(pendingReplay.name, pendingReplay.args, { result: pendingReplay.result, anchor: row });
        pendingReplay = null;
        return undefined;
      }
      const run = pendingRun;
      pendingRun = null;
      // Router answers, declined confirms and dedupe stubs carry no run of their own.
      if (!run) return undefined;
      const args = call.args;
      if (run.threw) {
        pushDurableStep(c, chatId, persistence, { ts: nowIso(), category: 'tool', label: call.name, durationMs: nowMs() - run.toolStart, args, result: run.out, isError: true });
        return undefined;
      }
      // Keep what a successful read returned, anchored to the message that carries
      // it, so an exact repeat can be replayed once compaction removes that message.
      if (run.isReadTool && !isFailedToolResult(run.out)) readCoverage.cacheResult(call.name, args, { result: run.out ?? null, anchor: row });
      pushDurableStep(c, chatId, persistence, {
        ts: nowIso(),
        category: 'tool',
        label: call.name,
        durationMs: nowMs() - run.toolStart,
        args,
        result: run.out ?? null,
        isError: isFailedToolResult(run.out),
        resultBytes: run.bytes,
        truncated: run.truncated,
      });
      // Pin this tool into every later turn's selection — a multi-step task must
      // never lose a tool it is mid-way through using.
      usedTools.add(call.name);
      return undefined;
    },

    onNoToolCalls: async (ctx, turn) => {
      const iter = ctx.step;
      const { result, resolved, advertised, advertisedNames } = metaOf(turn);
      // The model ended the turn without acting — it ANNOUNCED a call it never made
      // ("Calling the tool now." → finish: stop, 0 tool calls), said nothing at all, or
      // HANDED the remaining commands to the user to run. Accepting any of those as a
      // final answer strands the user with a promise, a blank, or homework instead of a
      // result. Nudge and let the loop run another turn — bounded to
      // MAX_ANNOUNCEMENT_RECOVERIES per run so a model that keeps narrating can't spin.
      //
      // `availableToolNames` + `requestText` are what let the HANDOFF shape fire: it is a
      // stall only where this run could have run the commands itself AND the user asked
      // for a change. The request is the one captured before the loop — `latestUserText`
      // here would return the loop's own nudge from the previous iteration.
      const stallInput = {
        text: result.text,
        toolCallCount: result.toolCalls.length,
        availableToolCount: toolSpecs?.length ?? 0,
        recoveriesUsed: announcementRecoveries,
        availableToolNames: [...advertisedNames],
        requestText: userRequest,
      };
      const shape = stallShape(stallInput);
      if (runTool && shouldRecoverStalledTurn(stallInput)) {
        announcementRecoveries += 1;
        const lastChance = announcementRecoveries >= MAX_ANNOUNCEMENT_RECOVERIES;
        // Keep what the user already watched stream in, as its own durable block —
        // same treatment a narration-before-tool-calls turn gets.
        const narration = canonicalTurnText(result.text);
        if (narration) {
          const meta = provenanceMetadata(result);
          const [narrationMsg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: narration, ...(meta ? { metadata: meta } : {}) }]);
          recordAppended(c, narrationMsg);
        }
        convo.push({ role: 'assistant', content: result.text });
        convo.push({ role: 'user', content: stallRecoveryNudge(lastChance, shape) });
        // Durable: "the loop caught this and re-prompted" is a fact a triage report must
        // still carry after a reload. Live-only, a reopened chat showed nine narrating
        // turns and no sign the loop had ever fought back. The SHAPE rides along, because
        // "re-prompted" alone cannot tell a reader whether the model narrated a call it
        // never made or wrote the user a correct list of commands to go run.
        pushDurableStep(c, chatId, persistence, {
          ts: nowIso(),
          category: 'message',
          label: shape === 'handed-off' ? 'loop.recover_handed_off_work' : 'loop.recover_announced_tool_call',
          args: { step: iter, attempt: announcementRecoveries, of: MAX_ANNOUNCEMENT_RECOVERIES, advertisedTools: advertised, shape },
          result: shape === 'handed-off'
            ? `Model ended by telling the user to run the commands itself holds tools for — re-prompted to run them (${announcementRecoveries}/${MAX_ANNOUNCEMENT_RECOVERIES}).`
            : `Model announced a tool call without making one — re-prompted (${announcementRecoveries}/${MAX_ANNOUNCEMENT_RECOVERIES}).`,
        });
        c.streamingText = '';
        emit(c);
        return { action: 'continue' };
      }

      // Final text — record in the transcript, persist, broadcast to mounted views.
      const finalText = result.text.trim() || 'No response.';
      const assistantMsg = await settleReply(finalText, result);

      // This model spent its whole recovery budget still DESCRIBING calls instead of
      // making them — or still handing them to the user. Re-prompting it again is spent — the only remedy that works is a
      // different model, so the run switches to one itself rather than handing the user
      // a promise and telling them to go pick one (the "it doesn't execute, it just
      // dies" report). Bounded by MAX_MODEL_FAILOVERS: a run that has burned two models
      // stops and says so rather than walking the catalog on the tenant's money.
      if (runTool && isExhaustedStall(stallInput)) {
        // The SHARED decision — record both the asked-for and the resolved model (a
        // gateway auto-select run pinned nothing, so `resolved` is the only id that
        // identifies the model to skip), check the budget, pick a different route. The
        // server-side addressed-reply loop calls the same function.
        const next = chooseStallFailover({
          activeModel,
          resolvedModel: resolved,
          tried: triedModels,
          failoversUsed: modelFailovers,
          pick: pickFallbackModel,
        });
        if (next) {
          modelFailovers += 1;
          pushDurableStep(c, chatId, persistence, {
            ts: nowIso(),
            category: 'message',
            label: 'loop.model_failover',
            args: { step: iter, from: resolved, to: next, attempt: modelFailovers, of: MAX_MODEL_FAILOVERS },
            result: modelFailoverNotice(resolved, next, shape),
          });
          activeModel = next;
          // The new model starts with a full stall budget — the old one's failures say
          // nothing about this one, and carrying the count over would give it no chance.
          announcementRecoveries = 0;
          convo.push({ role: 'user', content: stallRecoveryNudge(false, shape) });
          c.streamingText = '';
          emit(c);
          return { action: 'continue' };
        }
        const notice = stallExhaustedNotice(resolved, triedModels, shape);
        pushDurableStep(c, chatId, persistence, {
          ts: nowIso(),
          category: 'error',
          label: 'loop.stall_unrecovered',
          args: { step: iter, model: resolved, attempts: announcementRecoveries, tried: triedModels, advertisedTools: advertised, shape },
          result: notice,
          isError: true,
        });
        c.error = notice;
      }
      emit(c);

      emitEvermindLearnReconcile(assistantMsg, finalText);

      onActivity?.(chatId);
      return { action: 'stop', ok: true, output: finalText };
    },
  };

  const ports: LoopPorts<ChatCompletionMessage> = {
    complete: async (ctx) => {
      const iter = ctx.step;
      c.streamingText = '';
      emit(c);
      // Auto-compact BEFORE the turn: summarize the older middle into a memory note
      // when the transcript exceeds the token budget (instead of silently dropping it
      // and making the model thrash into "LOOP EXHAUSTED"). Falls back to the
      // drop-oldest window when no summarizer is reachable.
      const working = await buildWorkingTranscript(c, systemPrompt, stream, activeModel);
      // User hit Stop while compacting — the kernel reports it as `cancelled` (the
      // run's signal is the one it watches) and the run unwinds quietly.
      if (c.abort?.signal.aborted) throw new Error('run stopped');
      const llmStart = nowMs();
      // Time-to-first-token: stamped on the FIRST streamed delta of this turn so
      // the timeline's "Thought for Xs" reflects latency-to-first-token, not the
      // whole turn. Stays undefined for a pure tool-call / empty turn.
      let firstTokenAt: number | undefined;
      let result: StreamResult;
      // Advertise a RELEVANT subset rather than the whole catalog. ~300 tool
      // definitions push most providers past the point where they reliably emit any
      // tool call at all (observed: 308 tools → three consecutive turns with zero
      // calls), besides dominating the prompt budget. No-ops for small catalogs.
      const selection = selectToolsForTurn(allTools, {
        // The REQUEST, captured once before the loop — never "the latest user message".
        // The loop pushes its own `role:'user'` turns (the stall-recovery nudge, the
        // tool-budget close-out), so reading the newest one re-rolled the advertised
        // set from text WE wrote: after one recovery the query became "…made zero tool
        // calls… answer using its result…", which scores `key_results`/`dashboards`/
        // `incidents` and drops the ticket tools the user actually asked for. The tool
        // the model was told to call then genuinely did not exist, and it narrated.
        // Holding the request steady also keeps the advertised set STABLE across turns
        // — a tool must not vanish between one turn and the next.
        query: requestQuery,
        pinned: usedTools,
        // Tools the SYSTEM PROMPT instructs the model to call (e.g. the chat↔ticket
        // directive names `builtin_chats_list_tickets`) are never optional: telling a
        // model to call a tool we then decline to advertise is the exact contradiction
        // that produces a narrated call. Derived from the prompt text, so a directive
        // edit can never silently desync from this list — plus the local workspace
        // tools, which the prompt names in prose the pattern cannot see.
        required: alwaysAdvertised,
      });
      // The ROUTER rides along whenever selection actually trimmed something, so the
      // tools that missed the cut stay REACHABLE instead of silently ceasing to exist.
      // Three fixed schemas buy back the whole catalog; see toolRouter.ts.
      const advertised = selection.trimmed
        ? [...selection.tools, ...routerToolSpecs(allTools?.length ?? 0)]
        : selection.tools;
      const tools = advertised.length > 0 ? advertised : undefined;
      // What the model could actually call THIS turn. Kept as a set so the turn can
      // answer, at the only point that knows both halves, "did it narrate a tool it was
      // never shown?" — see `narratedUnadvertised` below.
      const advertisedNames = new Set(advertised.map((t) => t.function.name));
      if (selection.trimmed) {
        pushTrace(c, {
          ts: nowIso(),
          category: 'message',
          label: 'tools.selected',
          args: { step: iter },
          result: `${selection.tools.length} of ${selection.available} tools advertised this turn (relevance-selected; ${usedTools.size} pinned from earlier calls)`,
        });
      }
      // The completion is open and no token has arrived yet — the phase that used to
      // be indistinguishable from a hang. It flips to `writing` on the first delta.
      setActivity(c, { phase: 'thinking', startedAt: Date.now(), step: iter });
      try {
        result = await stream(
          { messages: working, tools, tool_choice: tools ? 'auto' : undefined, model: activeModel, modelStrict: !!activeModel && modelStrict, routingMode, maxTokens, reasoning, metadata, signal: c.abort?.signal },
          {
            onTextDelta: (d) => {
              c.streamingText += d;
              if (firstTokenAt === undefined) {
                firstTokenAt = nowMs();
                // First token: the reply is visibly forming, so the indicator stops
                // claiming the model is still thinking. A PHASE change, so it repaints
                // now (one repaint carrying the first token too); every later delta
                // is text only and coalesces into a frame.
                c.activity = { phase: 'writing', startedAt: Date.now(), step: iter };
                emit(c);
                return;
              }
              emitStreaming(c);
            },
          },
        );
      } catch (e) {
        // Aborting the fetch rejects the stream — that's a user Stop; the kernel
        // reports it as `cancelled` (no error trace, no error message).
        if (c.abort?.signal.aborted) throw e;
        pushTrace(c, {
          ts: nowIso(),
          category: 'error',
          label: 'llm.complete',
          durationMs: nowMs() - llmStart,
          args: { model: activeModel ?? 'default', step: iter },
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
      const resolved = result.resolvedModel ?? activeModel ?? 'default';
      const requested = activeModel ?? 'default';
      // Record what ACTUALLY served this turn so `builtin_session_current_model` can
      // report the exact model (an MCP call is a separate request and can't see it).
      // Keyed by CHAT: runs are concurrent on a host that owns them, so one slot would
      // let this chat's tool call answer with the model that served a different one.
      setLastResolvedModel(chatId, result.resolvedModel);
      if (requested !== 'default' && resolved !== 'default' && resolved !== requested) {
        pushTrace(c, {
          ts: nowIso(),
          category: 'message',
          label: 'llm.model_downgrade',
          args: { requestedModel: requested, model: resolved, step: iter },
          result: `Gateway answered with ${resolved} instead of the requested ${requested} (failover) — a smaller context window can truncate long transcripts.`,
        });
      }
      // Tool names this turn WROTE OUT as prose while emitting no structured call, that
      // were never advertised to it. Computed here because this is the only place that
      // holds BOTH the turn's text and the exact set the turn was offered — after the
      // fact a reader can only see the catalog total, which is why "the model is broken,
      // pick another one" was the standing (and sometimes wrong) verdict for a run whose
      // real fault was that the tool it was told to call had been selected away. Cheap:
      // a handful of strings, and empty on every healthy turn.
      const narratedUnadvertised =
        result.toolCalls.length === 0
          ? toolNamesMentionedIn(result.text).filter((n) => !advertisedNames.has(n))
          : [];
      // DURABLE, not just live: an `llm` turn carries the token usage, finish reason
      // and resolved model the A-vs-B triage runs on. Kept in memory only, a chat
      // copied after a reload reported `Turns: 0` / "Tokens: not reported" and could
      // never separate context exhaustion from model degradation. The payload is a
      // handful of scalars — no transcript text — so the row stays small.
      pushDurableStep(c, chatId, persistence, {
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
          // How many tools the turn was actually OFFERED, out of the whole catalog.
          // A zero here is the difference between "the model refused to act" and "it had
          // nothing to act with" — previously unanswerable from a copied report, which
          // only ever carried the registry-wide total.
          advertisedTools: advertised.length,
          catalogTools: allTools?.length ?? 0,
          ...(narratedUnadvertised.length ? { narratedUnadvertised } : {}),
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
      const meta: TurnMeta = { result, resolved, requested, advertised: advertised.length, advertisedNames };
      // A host that advertised tools but cannot run them gets the turn as a final
      // answer — a tool call nobody can execute is not a tool call.
      const toolCalls = runTool
        ? result.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.args }))
        : [];
      return { content: result.text, toolCalls, meta };
    },

    dispatch: async (call, ctx) => {
      const iter = ctx.step;
      const args = call.args;
      const isReadTool = isDedupableRead(call.name);
      const toolStart = nowMs();
      // Name the tool AND what it is working on, before it runs. This is the
      // step that most often takes tens of seconds, and the one the trace could
      // never show until it was already over.
      setActivity(c, toolActivity(call.name, args, iter, Date.now()));
      // Unreachable: the model port advertises no tool calls without a runner.
      if (!runTool) throw new Error('tool call without a tool runner');
      let out: unknown;
      try {
        // The ONE place a tool call is told which model is serving THIS chat (see
        // `lastResolvedModel.ts`). Applied here rather than in a relay because this is
        // the only layer that knows both the conversation and the call — which is what
        // makes it work on every surface, instead of only the one relay that had a copy.
        out = await runTool(call.name, withObservedModel(chatId, call.name, args));
      } catch (e) {
        const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        out = { ok: false, error: message };
        // A throw is a failure like any other: the same call thrown three times is a
        // loop, not persistence, and the model needs to be told so on the result it
        // reads. The DURABLE step keeps the untouched error.
        const repeat = failureAdvisoryFor(call.name, args, out, iter);
        pendingRun = { out, toolStart, isReadTool, threw: true };
        // Errors are small; push as-is (trimming a short error would only add noise).
        return { data: repeat ? withAdvisory(out, repeat) : out, isError: true };
      }
      // Backstop bookkeeping (see startRun's finally): a successful workspace
      // file-change marks the run as code-changing (and remembers the file), while
      // the model recording its own delta/link/review clears the need for the
      // auto-capture. A failed call above returned out, so this counts successes.
      if (isCodeChangeTool(call.name)) {
        const first = !c.codeChanged;
        c.codeChanged = true;
        const f = codeChangeFile(args);
        if (f && !c.touchedFiles.includes(f)) c.touchedFiles.push(f);
        // OPEN THE TICKET NOW, on the first edit — not in the `finally`, which a
        // Stop skips and a closed/reloaded surface never reaches. One call per run,
        // and from here on the work is on the board and linked to this chat whatever
        // becomes of the rest of the turn.
        if (first && !c.ticketRecorded && req.projectId != null && req.runTool) {
          await recordCodeChangeTicket(chatId, c, req, 'open').catch(() => { /* never fail the run on the backstop */ });
        }
      }
      if (isTicketRecordingTool(call.name)) c.ticketRecorded = true;
      // Deterministic traceability: whenever this turn CREATED a work item via an
      // MCP create tool (task/epic/gap, objective, spec, portfolio, initiative),
      // tie it to THIS conversation right now — instead of relying on the model to
      // remember the advisory builtin_chats_link_ticket call (which it often skips,
      // leaving the item created but orphaned from the chat). Fires the same shared
      // link tool the model would, tied to the run's resolved chatId.
      await autoLinkCreatedItem(chatId, c, persistence, runTool, call.name, out);
      // The MODEL transcript gets a size-capped copy so a big list result can't
      // flood the context window; the TRACE keeps the full result (bounded by
      // MAX_TRACE_EVENTS) for the timeline + triage copy, plus the pre-trim byte
      // size and a truncation flag the diagnostics block reads.
      // LOOP GUARD. A read that keeps circling the same target gets an advisory
      // attached to the copy the MODEL sees — the only moment it can act on the
      // fact that it is going round. The trace keeps the untouched result (the
      // timeline must show what the tool actually returned), and the intervention
      // is recorded as its own step so triage can see the loop was fought rather
      // than inferring it from the repetition alone.
      let advisory: string | null = null;
      if (isFailedToolResult(out)) {
        // The OTHER loop the guards missed. `readCoverage` records successes only, by
        // design — a failed read has no result above to reuse, so a retry must not be
        // stubbed. That left an identical FAILING call with no pushback whatsoever:
        // the same `git_status` answered with the same "pass `repo`" remedy three
        // times, the same platform read answered 502 twice, the model repeating itself
        // each time. The first retry is still free; the second says so.
        advisory = failureAdvisoryFor(call.name, args, out, iter);
      } else {
        // It worked — earlier failures of this exact call were transient after all.
        failures.clear(call.name, args);
        if (isReadTool) {
          // Recording a SUCCESSFUL read is also what arms the exact-repeat stub for it;
          // a failed read is not recorded, so it can be retried.
          const visit = readCoverage.record(call.name, args);
          const target = visit ? activityTarget(args) : undefined;
          advisory = visit && target ? revisitAdvisory(call.name, target, visit) : null;
          if (advisory) {
            pushTrace(c, {
              ts: nowIso(),
              category: 'message',
              label: 'tools.revisit_guard',
              args: { step: iter, tool: call.name, target, visits: visit!.count },
              result: advisory,
            });
          }
        }
      }
      // Trimmed to the transcript budget with the advisory attached AFTER the cut, so
      // the budget can never delete the guard — and a `read_file` is paged by LINE with
      // its continuation offset intact, instead of sliced mid-line with the paging
      // fields (which sit after the content) thrown away. See `toolResultBudget.ts`.
      const trimmedOut = trimToolResult(call.name, out ?? null, { advisory });
      pendingRun = { out, toolStart, isReadTool, threw: false, bytes: trimmedOut.bytes, truncated: trimmedOut.truncated };
      return { data: trimmedOut.content, isError: isFailedToolResult(out) };
    },
  };

  const loop = await runAgentLoop<ChatCompletionMessage>({
    messages: convo,
    codec,
    ports,
    hooks,
    signal: c.abort?.signal,
    // No step cap. The kernel's consecutive-tool-failure breaker is the run's only
    // limit — see the note above `HISTORY_WINDOW`.
    budget: {},
  });
  // A settled reply (the final-answer hook stopped the loop) or a user Stop ends the
  // run here; only a TRIPPED failure breaker falls through to the forced synthesis below.
  if (loop.finished || loop.cancelled) return;

  // The breaker stopped the run: its last N tool calls all failed and it never wrote a
  // final answer. Rather than drop the whole run with "kept calling tools without
  // finishing", force ONE final completion WITHOUT tools so the model MUST answer in
  // prose using what it already gathered — the same "always speak" guarantee the
  // server-side addressed-agent loop gives (BrainService.agentReply). The user then
  // reads WHAT kept failing and what is needed, instead of an error; we only surface
  // the loop error if THIS closing turn is also empty. This does not depend on which
  // model answered, so it also rescues a weak auto-selected model that thrashed.
  const streak = loop.failureStreak;
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
            `This turn was stopped because your last ${streak} tool calls all failed. Do NOT call any more tools. Answer the user now, in prose, using what you have already gathered — say what you completed, quote what the failing calls answered, and state plainly what is blocking you and what you need (a different argument, a permission, a decision) so the next turn can succeed.`,
        },
      ];
      let closeFirstTokenAt: number | undefined;
      const closing = await stream(
        // No `tools` → the model can't call another tool and must produce text.
        { messages: working, model: activeModel, modelStrict: !!activeModel && modelStrict, routingMode, maxTokens, reasoning, metadata, signal: c.abort?.signal },
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
        args: { model: closing.resolvedModel ?? activeModel ?? 'default', requestedModel: activeModel ?? 'default', step: loop.step, toolCalls: 0, forcedFinish: true, failureStreak: streak, account: closing.account, byoUnresolved: closing.byoUnresolved },
        usage: closing.usage,
        finishReason: closing.finishReason,
        textChars: closing.text.length,
        result: `forced final synthesis (${streak} consecutive tool failures stopped the run) · ${closing.text.length} chars · finish: ${closing.finishReason ?? '—'}`,
      });
      const closingText = canonicalTurnText(closing.text);
      if (closingText) {
        convo.push({ role: 'assistant', content: closingText });
        const meta = provenanceMetadata(closing);
        const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: closingText, ...(meta ? { metadata: meta } : {}) }]);
        c.streamingText = '';
        recordAppended(c, assistantMsg);
        emit(c);
        // A forced-final answer still contributed server-side — emit the same memory
        // provenance (learn/reconcile steps + answer cache) as the normal branch.
        emitEvermindLearnReconcile(assistantMsg, closingText);
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
    result: `Stopped after ${streak} consecutive failed tool calls over ${loop.step} steps (a forced final answer without tools also came back empty)`,
    isError: true,
  });
  c.error = `The assistant's last ${streak} tool calls all failed and it gave no answer. Read the failing steps above, then try again with what they ask for.`;
  emit(c);
}
