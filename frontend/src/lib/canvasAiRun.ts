import type { BrainAction, BrainTraceEvent, ChatMode, ChatCompletionMessage, resolveBrainStream } from '@seanhogg/builderforce-brain-embedded';
import type { RunOutcomeRow } from '@builderforce/agent-run';
import type { CanvasNotices } from '@/lib/canvasNotices';
import type { CanvasRunShaping } from '@/lib/canvasAiTurnBudget';
import type { CanvasPhase } from '@/lib/canvasPhases';
import type { CanvasConfirmAction } from '@/lib/canvasAiToolExecution';
import type { CanvasUnansweredOutcome } from '@/lib/canvasAiTurnTail';
import type { CanvasEvermindPort } from '@/lib/canvasAiEvermind';

/**
 * The Creation Canvas turn's contracts — what a surface hands `runCreationCanvasAi`
 * ({@link CanvasAiOptions}), what it reports per completion ({@link CanvasAiCompletion}),
 * and the ONE turn state ({@link CanvasRun}) the canvas's ports share
 * (`canvasModelPort.ts`, `canvasPlatformTools.ts`, `canvasDelivery.ts`), so a counter or
 * a flag can never exist twice.
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
  /** The host's PORT for the run's uniform outcome row (PRD 35 §8.2; `entryPoint: 'canvas'`), once, when the run settles. The run does no network I/O: the host sends it (see `canvasRunOutcome.ts`). */
  onOutcome?: (row: RunOutcomeRow) => void;
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
  /** The turn's explicit routing, or `'account'` when it sent none — the gateway then
   *  applied the ACCOUNT's cloud funding order (never recorded as `'auto'`, which it isn't). */
  routingMode: 'auto' | 'byo_pool' | 'account';
  toolsAdvertised: number;
  toolCalls: string[];
  finishReason: string | null;
}

/**
 * ONE canvas turn's FACTS — what the turn has done to the board and what it has said.
 *
 * The run's POLICY is not here: the model hand-off, the re-statement ladder and the
 * tool-selection live in `@builderforce/agent-run`. The three canvas ports read and write
 * these facts (`canvasModelPort.ts` the transport, `canvasPlatformTools.ts` the board's
 * tools, `canvasDelivery.ts` what the turn still owes), so a counter or a flag can never
 * exist twice. Fields above `finalText` are fixed once the turn starts.
 */
export interface CanvasRun {
  options: CanvasAiOptions;
  notices: CanvasNotices;
  /** The turn's opening rows — the system blocks, the conversation and the user's request. */
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
  /** The app files this turn wrote — named in the out-of-steps notice, which is all the
   *  next turn's transcript keeps of this one. */
  changedFiles: Set<string>;

  /** The text of the completion in flight (or the last one, when it called no tool). */
  finalText: string;
  /** A tool this turn STAGED (`proposed: true`) or COMMITTED (`applied: true`) a canvas
   *  change — see `toolOutcomeChangedCanvas`. */
  canvasChanged: boolean;
  /** The run was ABANDONED mid-turn (no model left to route a provider failure to), so a
   *  board change it made is partial work, never "added to the canvas". */
  abandonedMidTurn: boolean;
  narrowSearches: number;
  lastToolError: string;
  /**
   * The most recent real thing the model SAID this turn — non-empty, not an echo of an
   * earlier reply. Held across iterations because the re-statements deliberately drop the
   * reply they answer, and the ladder can then give up: without this, an answer the model
   * actually produced is unrecoverable by the time the run ends.
   */
  lastSpokenAnswer: string;
  /** Provider failures this turn had to route around — silent, broken or looping
   *  streams, resets — in total, for the tail's "the provider failed" verdict. */
  providerFailures: number;
  documentWords: number | null;
  documentWordCountExact: boolean;
  /** Set once the turn calls any build tool (`CANVAS_BUILD_TOOLS`): it is working inside
   *  an app, so it gets the code output ceiling from then on. */
  workspaceTurn: boolean;
  /** Set once a workspace write commits: the turn has BUILT something, which is what the
   *  tail and the build-not-authored rung read. */
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
  /** How the LAST completion ended (the vendor's own spelling), for the interruption trace. */
  lastFinishReason: string | null;
  /** What a LOOPING model said before it looped — delivered when no model is left. */
  loopKept: string;
  /** A provider error the policy does not route around (a refusal): the runner rethrows it as it is. */
  fatal: unknown;
}
