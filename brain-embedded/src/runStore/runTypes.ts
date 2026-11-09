/**
 * The run store's public contracts — what a host hands a run ({@link BrainRunRequest})
 * (what it observes is in `runSnapshotTypes.ts`). Types only.
 */

import type { BrainMessage } from '../types';
import type { BrainToolSpec, ChatCompletionMessage, ContentPart, StreamChatOptions, StreamHandlers, StreamChatResult } from '../streamChatCompletion';
import type { ReasoningIntent } from '../effort';
import type { BrainRunOutcome } from '../runOutcomeReport';
import type { RunOutcomeRequest } from '@builderforce/learned-routing';
import type { RunStopHook } from '../stopHooks';
import type { RunLineage } from '../runLineage';
import type { ChatMode, ChatRosterAgent } from '../chatMode';
import type { EvermindRunHooks } from '../evermindMemory';
import type { RunWindowSources } from '../windowFit/modelWindow';
import type { OnDeviceTasks } from '../onDevice/onDeviceTasks';
import type { RunKnowledgeLog } from '@builderforce/agent-tools';
import type { ServedRead } from './hostRunContext';
import type { PrefetchPort } from '@builderforce/prefetch';
import type { ModelPreflightResult } from '@builderforce/agent-run';
import type { CheckRecord, EvidencePolicy, OutgoingFile, ReviewVerdict } from '@builderforce/run-guards';

/** The verifier port every deterministic run gate reads (PRD 45 §4.4). */
export interface VerifierPort {
  /** Fast tier, ≤ 3 s: language-server diagnostics for exactly these files. Null = unavailable. */
  diagnostics(absPaths: readonly string[]): Promise<CheckRecord | null>;
  /** Full tier for these files: owning packages' typecheck + targeted tests + repo guards. Cached by (path, hash, check). */
  full(absPaths: readonly string[]): Promise<ReadonlyMap<string, readonly CheckRecord[]>>;
}

/** The git port: the host reads the REAL commits, never the model's claims. */
export interface GitPort {
  /** Files in commits not yet on upstream plus the HEAD tree's bytes for each path. */
  outgoing(repo: string): Promise<{ files: OutgoingFile[]; diffHash: string; baseBranch: boolean }>;
}

/** The reviewer port: OD-1, one review sub-run by a model that did not author the change. */
export interface ReviewerPort {
  review(input: { repo: string; diff: string; evidence: string; authorModels: readonly string[] }): Promise<ReviewVerdict | { refused: string }>;
}

/**
 * What a run cell is keyed by. A CHAT's run is keyed by its chat id (a number — the
 * key every chat surface, run driver and the cross-chat {@link GlobalRunState} speak).
 * A run that is not a chat's — a canvas session's turn, hosted through
 * `startEngineRun` — takes a string key (`canvas:<sessionId>`), so it shares the store's
 * single-flight claim, Stop, confirmation gate and live snapshot without being mistaken
 * for a chat.
 */
export type RunKey = number | string;

/** The surfaces a run comes in through - a telemetry label. */
export type RunEntryPoint = 'vscode' | 'web' | 'rovr';

/** Streaming fn shape (matches BrainRuntime.stream). */
export type BrainStreamFn = (
  opts: Omit<StreamChatOptions, 'transport'>,
  handlers?: StreamHandlers,
) => Promise<StreamChatResult>;

/** Persistence subset the loop needs (matches BrainPersistenceAdapter). */
export interface BrainRunPersistence {
  sendMessages(
    chatId: number,
    messages: Array<{ role: string; content: string; metadata?: string; eventKey?: string }>,
  ): Promise<BrainMessage[]>;
  /** Optional read-back: lets a late write ask whether the chat has moved on (`continueChat.ts`'s stopped answer). */
  getMessages?(chatId: number, limit?: number): Promise<BrainMessage[]>;
}

/** Everything a single run needs, captured at start time (survives navigation). */
export interface BrainRunRequest {
  resolvedSystemPrompt: string;
  /**
   * The run's record of what it did and read (`@builderforce/agent-tools`
   * `run-knowledge`). A host that commits the run's code map at the end passes its own
   * so there is ONE record per run; omitted, the loop keeps one for the per-turn ledger.
   */
  knowledge?: RunKnowledgeLog;
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
  /**
   * Where the window-fit gate learns the window of the model a request is about to ask
   * for (`windowFit/`): the host's gateway catalog as `cloud` (`gatewayModelWindows`)
   * and its live local runtimes as `probes`. A failover onto a smaller cloud model is
   * packed for that model only when the catalog says how small it is. Omit and only the
   * shipped local catalog answers — a cloud move keeps the working budget.
   */
  windowSources?: RunWindowSources;
  /**
   * The host's on-device task port (PRD 42 · C2). The run's summaries — the compaction
   * fold and the hand-off note — ask it FIRST, whatever model the run is pinned to; on
   * `null` they run through `stream` as before. Omit and nothing changes.
   */
  onDeviceTasks?: OnDeviceTasks;
  /** `signal` is passed for a call the person's steer may interrupt (a foreground
   *  command); otherwise the host lends the call the run's own Stop. */
  runTool?: (name: string, args: unknown, signal?: AbortSignal) => Promise<unknown>;
  /**
   * The host's LIVE-CHILDREN port (the agent's `FinishPorts.liveChildren`): the block reason while sub-agents THIS run
   * started are still working, or null when none is. Bound, it holds every end of the run - the `finish` tool and a prose
   * answer alike - until their reports are in (`run/brainFinish.ts`). Unbound, the owner could end with children still
   * working, and each late report then woke it into a new run with no ask of its own (chats #60338, #61651).
   */
  liveChildren?: () => Promise<string | null>;
  /** Pure predicate: true → pause the loop for an explicit user confirmation. */
  needsConfirm?: (req: { name: string; args: unknown }) => boolean;
  /**
   * Auto-answer resolver for the conversational `ask_user` tool — the counterpart to
   * {@link needsConfirm}, which only gates DISPATCHED tool calls. `ask_user` is terminal:
   * without this the run settles on the question and waits for a human click. When the
   * run is about to settle on a well-formed question AND this returns a non-null string,
   * the run treats the string as the user's answer: it persists the question as
   * narration, appends the answer as the next USER turn, and CONTINUES. Return null (or
   * omit) to let the question settle and render the card exactly as when Auto is off.
   * Hosts in Auto mode pass the shared gate's `answerQuestion`, which reads the same
   * live ref as `needsConfirm`, so a mid-run toggle is honoured.
   */
  answerQuestion?: (question: import('@builderforce/agent-loop').AskUserPayload) => string | null;
  /**
   * PRD 45 §4.4 — the deterministic ship-gate ports. EVERY gate is inert unless its
   * port is bound: the web Brain and the parity harness bind none and are unchanged.
   */
  verifier?: VerifierPort;
  git?: GitPort;
  reviewer?: ReviewerPort;
  /** The evidence policy the ship gates enforce — policy is data (PRD 45 §4.3). Defaults to DEFAULT_EVIDENCE_POLICY. */
  evidencePolicy?: EvidencePolicy;
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
  /**
   * What earlier turns of this chat already READ and DID, as a system-prompt block
   * (`priorResearch.ts`) — the counterpart to {@link seed}, which cannot carry tool
   * results (an orphaned tool message 400s strict vendors). Applied only when the run
   * seeds its transcript from history; a transcript still in memory already holds the
   * real tool rows. Without it a "continue" after a reload started its research over.
   */
  priorResearch?: string | null;
  /** The user turn that triggered this run, appended to the transcript. */
  userTurn?: string | ContentPart[];
  /** The persisted message id behind each {@link seed} entry, in order (`transcriptSeedOf`). */
  seedIds?: number[];
  /** The persisted message id of {@link userTurn}. With {@link seedIds} it lets a fold
   *  record which persisted messages its note covers (`runFoldMarker.ts`). */
  userTurnMessageId?: number;
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
   * Terms the host adds to the Evermind recall query (PRD 35 E2): the focus files the
   * request names and their top headings, from the host's context pack. Recall then
   * searches with the request PLUS the code it is about, never the bare sentence.
   * Awaited once before the first turn; a throw or an empty string recalls as before.
   */
  recallHint?: () => Promise<string | undefined>;
  /**
   * The host's per-run TASK CONTEXT (PRD 35 E2 — its context pack). Unlike
   * {@link augmentSystemPrompt}, it ALWAYS rides the volatile per-turn block after the
   * history (never the cached system prefix), whatever `b1_stable_prefix` says: it is
   * large and changes every run. Awaited once before the first turn; best-effort.
   */
  turnContext?: () => Promise<string | undefined>;
  /**
   * Files the host already SERVED the model whole in {@link turnContext} (the pack's
   * inlined focus files). Recorded as reads in the run's read coverage, so a `read_file`
   * of one is an exact repeat / covered window, not a second read. Best-effort.
   */
  servedReads?: () => Promise<readonly ServedRead[] | undefined>;
  /**
   * The host's deterministic-first PREFETCH port (`@builderforce/prefetch`): its action
   * registry, one executor per action and the gate's ports. Consulted once before the
   * first turn (`prefetchGate.ts`), ahead of the memory-first answer and outside its
   * replay gate: an ANSWER action settles the run with no model call ("where is X
   * defined?" from the symbol index); PREFETCH actions add their output to the volatile
   * per-turn block. Absent ⇒ the run proceeds as before.
   */
  prefetch?: PrefetchPort;
  /**
   * Record a model call the run AVOIDED — a PreFetch ANSWER — beside the host's usage
   * ledger (the device ledger's `deterministic` saving, priced at `model` for a median
   * turn). Omit and nothing is recorded. Best-effort.
   */
  recordAvoidedCall?: (call: AvoidedRunCall) => Promise<unknown> | void;
  /**
   * The host's MODEL PREFLIGHT (PRD 35 E7): its BYO health check, awaited once before
   * the first turn. Unresolved accounts are seeded into the run's BYO banner state and
   * recorded as `model.preflight`, so the user hears it before any work. Best-effort.
   */
  modelPreflight?: () => Promise<ModelPreflightResult | undefined>;
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
  /**
   * The agents INVITED INTO this chat, which is the platform's record of who the human
   * wants on this work. Folded into the WORK directive: naming them saves the model a
   * discovery call it had no reason to spend, and a non-empty roster inverts the
   * do-it-here ordering so the invited agents get dispatched rather than watched
   * (see `chatMode.ts`). Absent or empty leaves the prior behaviour exactly as it was —
   * a host that does not know the roster must not accidentally assert there is none, so
   * an UNRESOLVED roster and an EMPTY one are both simply "nobody named here".
   */
  chatRoster?: readonly ChatRosterAgent[];
  /**
   * Report a settled code-changing run's outcome to learned routing (the host POSTs it
   * to `/llm/v1/run-outcome`). Omit and nothing is reported. Best-effort: a rejection is
   * swallowed and never affects the run.
   */
  reportOutcome?: (outcome: BrainRunOutcome) => Promise<unknown>;
  /**
   * Told the uniform §8.2 record (PRD 35) of a run that made no coder grade, once, when a run ends: the entry point, the counts,
   * `routingSignal: false` (the door records it and routing never learns from it). The host posts it to the same door. It is its own port so
   * that {@link reportOutcome} keeps doing exactly what it always has: the same runs, the same `source`, the same fields. A run
   * with a grade reports through `reportOutcome` alone, the §8.2 telemetry riding on it as optional fields. One report per run.
   */
  reportRunRecord?: (record: RunOutcomeRequest) => Promise<unknown>;
  /**
   * The host's STOP HOOK (`stopHooks.ts`) — asked each time the run is about to end; a
   * returned instruction holds it for another turn (bounded per run). The VS Code host
   * feeds it from the workspace's committed `.builderforce/hooks.json`. Omit for none.
   */
  onStop?: RunStopHook;
  /**
   * The SERVER chat this run's server-addressed work names (PRD 36) — the gateway's
   * `metadata.chatId`, the model's chatId, the ticket backstops' links, the prompt-cache
   * key. Omitted ⇒ the run's chat id IS a server chat (a host whose persistence is the
   * server: the web Brain, the canvas). `null` ⇒ the chat lives only on this machine
   * and is not bound: no chat id leaves it, and the chat-scoped backstops stand down.
   * A host with a local store always passes it, bound or not.
   */
  serverChatId?: number | null;
  /**
   * The local chat's stable client id (a uuid) — rides the gateway metadata for
   * diagnostics only (`clientChatId`); the server never resolves it to a chat.
   */
  clientChatId?: string;
  /**
   * This run has an OWNER — it is a sub-agent another run spawned (`runLineage.ts`).
   * Nothing about the loop changes: the run keeps its own key (its own transcript, Stop
   * and approval prompt) while everything it persists or asks the server about goes to
   * the root chat, attributed to the child. Absent for a top-level run.
   */
  lineage?: RunLineage;
  /**
   * The model each working phase asks for when the run holds no model of its own
   * (`@builderforce/run-policy` `phaseModels`): the host's stage models instead of one
   * model pinned to the whole run. `verify` also overrides a pin, as the review model.
   */
  phaseModels?: RunStageModels;
  /**
   * Route this run's pipeline (`runStore/pipelineRoute.ts`): decided ONCE, before turn
   * 1 — `quick` starts in `code` on {@link RunPipelineSettings.quickModel} with no plan
   * phase and no verify stage; `full` is the plan → code → verify pipeline. Absent ⇒
   * the run is not routed (every run takes the full pipeline, nothing is recorded).
   */
  pipeline?: RunPipelineSettings;
  /**
   * The run's spend cap in USD (`runStore/runSpendBudget.ts`): checked before every turn
   * against what the run's calls cost so far; the run stops with a contained outcome at
   * the cap and the model is warned at 80%. Absent or 0 = no cap.
   */
  maxRunBudgetUsd?: number;
  /**
   * The surface the run came in through - the label its uniform outcome row carries. Telemetry only:
   * nothing branches on it.
   */
  entryPoint?: RunEntryPoint;
  /**
   * Told once, at run end, how the run ended and under which run id its calls were
   * recorded (`runEndOutcome.ts`) — the host stores it beside its usage ledger for the
   * pipeline route report. Also told, on the chat's NEXT request, whether a PreFetch
   * decision made in the run was accepted (`gateAccepted`, the report's gate accuracy).
   * Omit and nothing is reported. Best-effort.
   */
  recordRunOutcome?: (end: RunOutcomeReport) => Promise<unknown> | void;
}

/** One report about a run's end (`outcome`) or its PreFetch decision (`gateAccepted`). */
export interface RunOutcomeReport {
  runId: string;
  outcome?: RunEndOutcome;
  /** The PreFetch decision this run made was accepted (the next request did not re-ask). */
  gateAccepted?: boolean;
}

/** A model call a PreFetch ANSWER stood in for (`recordAvoidedCall`). */
export interface AvoidedRunCall {
  source: 'deterministic';
  /** The registry action that answered. */
  actionId: string;
  /** The run id (`metadata.guestTurnId`) — what the usage ledger groups a run's rows by. */
  runId?: string;
  /** The model the turn would have run on, when known. */
  model?: string;
  /** The median turn's tokens the avoided call is estimated at (`MEDIAN_TURN_TOKENS`). */
  promptTokens: number;
  completionTokens: number;
}

/** How a run ended. */
export type RunEndOutcome = 'succeeded' | 'failed' | 'stopped' | 'budget-contained';

/** The host's per-phase models — absent phase ⇒ the gateway orders by role. */
export type RunStageModels = Partial<Record<'plan' | 'code' | 'verify', string>>;

/** How a host wants its runs routed between the full pipeline and a quick pass. */
export interface RunPipelineSettings {
  /** `auto` routes on the score; `always` keeps every run on the full pipeline. */
  routing: 'auto' | 'always';
  /** P(full) at or above which a run takes the full pipeline. Default 0.5. */
  threshold?: number;
  /** The model a quick run codes on. Absent ⇒ the code model, else the gateway's order. */
  quickModel?: string;
}
