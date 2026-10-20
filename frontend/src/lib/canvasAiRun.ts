import type { BrainAction, BrainTraceEvent, ChatMode, ChatCompletionMessage, resolveBrainStream, turnInterruption } from '@seanhogg/builderforce-brain-embedded';
import { reduceRunPolicy, type RunPolicyEvent, type RunPolicyState } from '@builderforce/run-policy';
import type { CanvasNotices } from '@/lib/canvasNotices';
import type { CanvasRunShaping } from '@/lib/canvasAiTurnBudget';
import type { CanvasPhase } from '@/lib/canvasPhases';
import type { CanvasConfirmAction } from '@/lib/canvasAiToolExecution';
import type { CanvasUnansweredOutcome } from '@/lib/canvasAiTurnTail';
import type { CanvasEvermindPort } from '@/lib/canvasAiEvermind';

/**
 * The Creation Canvas turn's contracts — what a surface hands `runCreationCanvasAi`
 * ({@link CanvasAiOptions}), what it reports per completion ({@link CanvasAiCompletion}),
 * and the ONE turn state ({@link CanvasRun}) the loop's ports and hooks share
 * (`canvasModelPort.ts`, `canvasToolPort.ts`, `canvasNoToolCalls.ts`,
 * `canvasProviderRecovery.ts`), so a counter or a flag can never exist twice.
 */

export type CanvasAiOptions = {
  prompt: string;
  /** Stable across every agent/model iteration caused by one composer submit. */
  guestTurnId?: string;
  /** Original composer text when this is an internal specialist/synthesis call. */
  guestTurnInput?: string;
  canvasSnapshot: string;
  persistence: 'local' | 'server';
  canvasActions: BrainAction[];
  /**
   * Every sentence this turn can return that the MODEL did not write, already in the
   * viewer's language. Required, not defaulted: an English fallback here would be a
   * second source for text the catalogs own, and the notices reach the user as Brain
   * speaking (see `lib/canvasNotices.ts`).
   */
  notices: CanvasNotices;
  model?: string;
  modelStrict?: boolean;
  routingMode?: 'auto' | 'byo_pool';
  /** The session's chosen phase (`canvasPhases`) — the arc stage the gateway nudges its
   *  role/cost ordering by. Absent when the session has not chosen one. */
  arcStage?: CanvasPhase;
  /** The composer's Effort and Thinking (see `canvasTurnShape`). Absent ⇒ the canvas's
   *  long-standing ceiling and `reasoning: low`. */
  runShaping?: CanvasRunShaping;
  /** Uses the same persisted mode as the canonical Brain: mutating tenant tools run
   * without an additional browser confirmation and canvas proposals auto-apply. */
  autoApprove?: boolean;
  evermind?: CanvasEvermindPort;
  onTrace?: (event: BrainTraceEvent) => void;
  /** Session diagnostics hook. Contains routing facts only; never prompt text,
   * credentials, or provider response bodies. */
  onCompletion?: (completion: CanvasAiCompletion) => void;
  /** Models that already proved unable to execute a Canvas command in this
   * session. An explicitly selected rejected model must not be invoked again. */
  disabledModels?: readonly string[];
  onModelDisabled?: (model: string) => void;
  /** Fired when a command-stalled model is replaced by a model that already
   * demonstrated tool calling earlier in the same turn. */
  onModelFallback?: (model: string) => void;
  /**
   * Fired when the string this function returns is a RUNTIME NOTICE rather than
   * something the model actually said — the turn produced no answer, executed no
   * command, or died on a tool error.
   *
   * The surface needs this to keep the notice OUT of the session transcript. Storing
   * it as an assistant message is what let one failed turn poison every turn after it:
   * the next request carried "I couldn't prepare any canvas changes from that request"
   * as an example assistant reply, and a free model reproduced it verbatim instead of
   * answering (2026-08-12, ui 2026.7.210).
   */
  onUnanswered?: (outcome: CanvasUnansweredOutcome) => void;
  /** Awaitable in-app approval. Mutating tenant actions are refused when this is
   * absent; the runner must never fall back to a browser-native prompt. */
  confirmAction?: CanvasConfirmAction;
  /** Session-owned transcript. The Canvas is the chat, so prior turns must travel with
   * every request just as they do in the standalone Brain surface. */
  conversation?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  onText?: (text: string) => void;
  /** Optional invited Canvas agent identity. The same bounded Canvas tool loop is
   * used, but the turn is authored from this specialist's configured perspective
   * instead of the session's coordinating Brain. */
  participant?: {
    ref: string;
    name: string;
    instructions?: string;
  };
  /**
   * The session's MODE (migration 0409) — `chat` (author on the canvas and answer) or
   * `work` (turn the conclusion into a tracked, dispatched ticket). Defaults to `chat`,
   * so a canvas turn never opens board work unless the user armed Work.
   */
  mode?: ChatMode;
  /** The canonical project this session is bound to, when it has one. Work mode needs
   *  it to file the ticket somewhere; absent, the model is told to ask for one. */
  projectId?: number | null;
  /**
   * Interrupts the turn — the composer's Stop button. Aborts the in-flight model
   * stream and is re-checked between loop iterations and between tool calls, so a
   * stopped run cannot spend another round-trip or run another tool after the user
   * has said stop. The rejection is always a {@link CanvasRunAbortedError}, so the
   * surface can tell "the user stopped this" apart from "the turn failed".
   */
  signal?: AbortSignal;
};

export interface CanvasAiCompletion {
  at: string;
  iteration: number;
  requestedModel: string | null;
  resolvedModel: string | null;
  resolvedVendor: string | null;
  account: string | null;
  routingMode: 'auto' | 'byo_pool';
  toolsAdvertised: number;
  toolCalls: string[];
  finishReason: string | null;
}

/** ONE canvas turn's state. Fields above `finalText` are fixed once the turn starts. */
export interface CanvasRun {
  options: CanvasAiOptions;
  notices: CanvasNotices;
  /** The turn's request transcript — system messages and directives are appended. */
  messages: ChatCompletionMessage[];
  /** Where each round trip runs (the Brain's own stream). */
  stream: ReturnType<typeof resolveBrainStream>;
  guestTurnId: string;
  actions: BrainAction[];
  byName: Map<string, BrainAction>;
  /** The user asked Canvas to create or update something (`requestsCanvasMutation`). */
  mutationRequested: boolean;
  /** Tools the system prompt names — always advertised. */
  requiredTools: Set<string>;
  /** Labels this session's transcript uses, so a copied `Brain: ` prefix can be
   *  recognised and removed without touching an answer that legitimately opens with
   *  a colon. */
  speakerLabels: string[];
  requestedPages: number | null;
  /** The answer, or the notice that it claims a change the turn never made. */
  verified: (answer: string) => string;
  /** Settle on `answer`, handing it to Evermind's best-effort learn path first. */
  finish: (answer: string) => Promise<string>;
  /** Every await boundary a stopped turn must not cross. */
  throwIfStopped: () => void;
  /** Tools this turn has called so far — pinned through per-turn selection so a
   *  multi-step task never loses a tool mid-flight. */
  toolsUsedThisTurn: Set<string>;
  /** The app files this turn wrote — named in the out-of-steps notice, which is all the
   *  next turn's transcript keeps of this one. */
  changedFiles: Set<string>;

  finalText: string;
  /** A tool this turn STAGED (`proposed: true`) or COMMITTED (`applied: true`) a canvas
   *  change — see `toolOutcomeChangedCanvas`. */
  canvasChanged: boolean;
  executiveRequestRecoveryUsed: boolean;
  /** Act-now escalations spent on a model that answered in prose instead of calling a
   *  canvas tool. Two: the first re-states the command, the second runs with research
   *  and board re-reads already withdrawn and tells it why prose is not an artifact. */
  mutationRecoveries: number;
  /** The same ladder for a build turn that provisioned a workspace and tried to end
   *  without writing a file of the app (`BUILD_NOT_AUTHORED_DIRECTIVE`). */
  buildAuthoringRecoveries: number;
  degenerateAnswerRecoveryUsed: boolean;
  interruptedTurnRecoveries: number;
  /** The loop stopped on a `failed` rung — the turn was ABANDONED, not finished — so a
   *  board change it made is partial work, never "added to the canvas". */
  abandonedMidTurn: boolean;
  authoringDirectiveIssued: boolean;
  narrowSearches: number;
  lastToolError: string;
  /**
   * The most recent real thing the model SAID this turn — non-empty, not an echo of an
   * earlier reply. Held across iterations because the recovery paths deliberately clear
   * `finalText` before continuing, and one of them then gives up: without this, an
   * answer the model actually produced is unrecoverable by the time the loop ends.
   */
  lastSpokenAnswer: string;
  /** THE model hand-off policy's state — advanced only through {@link reportToPolicy}. */
  policy: RunPolicyState;
  /** Provider failures this turn had to route around — silent, broken or looping
   *  streams, resets — in total, for the tail's "the provider failed" verdict. */
  providerFailures: number;
  documentWords: number | null;
  documentWordCountExact: boolean;
  /** The answer a turn SETTLED on inside the loop (a `finish(...)` return), or null
   *  when the loop stopped without one and the tail decides what the user gets. */
  settled: string | null;
  /** Whether THIS round-trip ran in the reserved authoring phase — set per turn by the
   *  model port, read by dispatch to refuse research calls. */
  authoringOnly: boolean;
  /** How the LAST completion ended, read by dispatch so a call whose arguments never
   *  parsed is refused with the reason that matches — cut off, or mis-encoded. */
  lastTurnInterruption: ReturnType<typeof turnInterruption>;
  /** Set when dispatch discarded an unusable call this round, so the follow-up
   *  directive is pushed once per round rather than once per call. */
  discardedCallThisRound: boolean;
  /** Set once the turn calls any build tool (`CANVAS_BUILD_TOOLS`): it is working inside
   *  an app, so it gets the code output ceiling and the code step budget from then on. */
  workspaceTurn: boolean;
  /** Set once a workspace write commits: the turn has BUILT something, which is what the
   *  tail and the build-not-authored recovery read. */
  buildTurn: boolean;
  /** Set once a file of the app itself is written (`CANVAS_BUILD_FILE_WRITE_TOOLS`) — the
   *  difference between a build turn that delivered an app and one that only seeded the
   *  starter template. */
  buildAuthored: boolean;
  /** Set once a response is cut off at the output ceiling. Re-sending the same
   *  artifact under the same ceiling truncates identically (measured: one consolidated
   *  document, five identical cut-offs in a row), so the rest of the turn gets the
   *  wider ceiling. Widened once; never narrowed back. */
  truncatedOnce: boolean;
}

/** Report an event to the run policy; the new state is the turn's. */
export function reportToPolicy(run: CanvasRun, event: RunPolicyEvent): RunPolicyState {
  return (run.policy = reduceRunPolicy(run.policy, event));
}
