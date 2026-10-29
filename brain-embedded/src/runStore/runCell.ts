/**
 * One chat's run CELL — the state a run lives in, hoisted out of React so it survives
 * the unmount of the panel that started it (see `brainRunStore.ts`). The shape and its
 * empty values only; the registry and every write live in `runCells.ts`.
 */

import type { BrainMessage } from '../types';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import type { BrainTraceEvent } from '../brainTriage';
import type { ChatErrorAction } from '../chatError';
import type { BrainRunActivity } from '../runActivity';
import type { CompactMemo } from '@seanhogg/builderforce-memory/working';
import { emptyRunUsage, type RunUsageTally } from '../memorySavings';
import type { BrainRunRequest, BrainRunSnapshot, RunTurn } from './runTypes';
import type { PendingGateOutcome } from './prefetchGate';
import type { RunClaim } from './runClaim';

/** The completion streaming right now — and, once the gateway names it, the model serving it. */
export interface LiveTurn {
  model?: string;
  account?: string;
}

/** What a user Stop cut off, held until the run unwinds and can persist it. */
export interface StoppedTurn {
  /** What the model had streamed when Stop was pressed. */
  text: string;
  source: LiveTurn;
  /** The `agent.stopped` step — already on the live trace, persisted with the reply. */
  event: BrainTraceEvent;
}

export interface RunCell {
  /** Rich working transcript (user + assistant tool-call turns + tool results). */
  transcript: ChatCompletionMessage[];
  /**
   * The earlier turns' tool work the transcript was seeded WITHOUT
   * ({@link BrainRunRequest.priorResearch}). Set when the transcript is seeded and kept
   * for the chat's later runs this session: the tool rows it summarises never enter
   * the transcript, so dropping it on the next run would lose them a second time.
   */
  priorResearch: string | null;
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
  /** The engine turn being narrated (see BrainRunSnapshot.turn). */
  turn: RunTurn | null;
  /**
   * Backstop bookkeeping for the current run (reset each {@link startRun}): whether a
   * workspace code-change tool succeeded, whether the model itself recorded a ticket
   * (from_delta / link / review), and the files it touched — so a code-changing run
   * that never linked its work gets a ticket minted for it. IDE-only in practice.
   */
  codeChanged: boolean;
  /** The model that made this run's code changes — what its outcome grades as a coder. */
  codeModel: string | null;
  /** This run's outcome idempotency key ({@link runOutcomeId}). */
  runId: string;
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
   * Index in `trace` of the CURRENT run's first event. The trace is a per-CHAT sliding
   * window that spans every run in the session, so any question about "what did THIS run
   * do" must be asked of {@link runTrace}, never of `trace` — reading the whole window let
   * an earlier run's push-to-main close a later run's unshipped ticket. An index, kept
   * true as the window splices from the front ({@link pushTrace}), rather than a start
   * timestamp: at millisecond resolution a run that starts in the same millisecond as
   * the previous run's last step inherited that step.
   */
  runTraceFrom: number;
  /**
   * Where THIS run's trace events are made durable — set by `startRun` for the run's
   * lifetime and cleared when it ends. Every event {@link pushTrace} records while it is
   * set becomes a step row, so the trace and its durable copy cannot drift: there is one
   * writer and one store. Null outside a run — a mirrored run (`applyRemoteRun`) is
   * persisted by the host that actually runs it, never twice.
   */
  persistStep: ((ev: BrainTraceEvent) => void) | null;
  /**
   * Cached compressed-memory of the transcript's older part. When the transcript exceeds
   * the working-transcript token budget (`HISTORY_TOKEN_BUDGET`, `@seanhogg/builderforce-memory/working`)
   * the loop SUMMARIZES `transcript[0, coveredEnd)` into this
   * note (instead of dropping it, which made a weak model re-read and thrash into "LOOP
   * EXHAUSTED") and sends every message from `coveredEnd` on verbatim. Re-folded
   * incrementally only once that remainder no longer fits (see `buildWorkingTranscript`).
   * Null until the first overflow / reset.
   */
  compactMemo: CompactMemo | null;
  /**
   * Which persisted message each known transcript entry is (transcript index → message
   * id): the seeded history and every run's user turn. A fold persists its note as an
   * auto consolidation marker that keeps from the first message it did not cover
   * (`foldKeepFromId`), so the next run — after a reload, on another surface — starts
   * from the note instead of summarizing the whole history again (`runFoldMarker.ts`).
   */
  transcriptAnchors: Array<{ index: number; id: number }>;
  /**
   * The lowest id of a persisted message this run's history holds that the cell's
   * transcript does NOT (another surface's turn, an @agent reply, a teammate's message —
   * persisted between runs, never seen by this cell). A fold's note cannot cover it, so
   * the marker keeps from no later than here. Undefined when the transcript holds it all.
   */
  unseenFromId: number | undefined;
  /** This run's summed usage — what its answer is cached with (`memorySavings.ts`). */
  runUsage: RunUsageTally;
  /** The model that last served a call in this chat — what a memory answer is priced
   *  against when this run has not called a model yet. Survives across runs. */
  lastServedModel: string | null;
  /** The PreFetch gate's last acted decision, settled (accepted / re-asked) by this
   *  chat's next request (`prefetchGate.ts`). Survives across runs. */
  pendingGate: PendingGateOutcome | null;
  /**
   * The completion in flight ({@link asLiveTurn}), null between completions. The only
   * record of which model a Stop cut off: an aborted stream never returns its result.
   */
  liveTurn: LiveTurn | null;
  /** The request this chat last ran with: what a turn handed to it later runs with (`continueChat.ts`). */
  lastRequest: BrainRunRequest | null;
  /**
   * How many times this chat was told to Stop - counted even when nothing was running. A turn
   * being made from direction (`continueChat.ts`) compares it with the count it started at: a
   * Stop pressed in between must not be outrun by a run that starts after it.
   */
  stopEpoch: number;
  /**
   * The claim on this chat's NEXT run (`runClaim.ts`): a continuation is being made - words saved, the
   * host's run-time parts prepared - and no other launch may take the chat meanwhile. The cell counts
   * as live while it is held, so a person's message steers into the claimed run instead of racing it.
   */
  claim: RunClaim | null;
  /** What the last Stop cut off, until the unwinding run persists it ({@link keepStoppedTurn}). */
  stoppedTurn: StoppedTurn | null;
  /** Cached immutable snapshot; identity changes only when something changed. */
  snapshot: BrainRunSnapshot;
}

export const EMPTY_SNAPSHOT: BrainRunSnapshot = {
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
  turn: null,
};

export function makeCell(): RunCell {
  return {
    transcript: [],
    priorResearch: null,
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
    turn: null,
    codeChanged: false,
    codeModel: null,
    runId: '',
    ticketRecorded: false,
    touchedFiles: [],
    deltaTicketId: null,
    deltaRecordedFiles: [],
    runTraceFrom: 0,
    persistStep: null,
    compactMemo: null,
    transcriptAnchors: [],
    unseenFromId: undefined,
    runUsage: emptyRunUsage(),
    lastServedModel: null,
    pendingGate: null,
    liveTurn: null,
    lastRequest: null,
    stopEpoch: 0,
    claim: null,
    stoppedTurn: null,
    snapshot: EMPTY_SNAPSHOT,
  };
}
