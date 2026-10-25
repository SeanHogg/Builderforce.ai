/**
 * The run store's public contracts — what a host hands a run ({@link BrainRunRequest})
 * and what it observes ({@link BrainRunSnapshot}, {@link GlobalRunState}). Types only.
 */

import type { BrainMessage } from '../types';
import type { BrainToolSpec, ChatCompletionMessage, ContentPart, StreamChatOptions, StreamHandlers, StreamChatResult } from '../streamChatCompletion';
import type { ReasoningIntent } from '../effort';
import type { BrainTraceEvent } from '../brainTriage';
import type { ChatErrorAction } from '../chatError';
import type { BrainRunOutcome } from '../runOutcomeReport';
import type { RunStopHook } from '../stopHooks';
import type { RunLineage } from '../runLineage';
import type { BrainRunActivity } from '../runActivity';
import type { ChatMode, ChatRosterAgent } from '../chatMode';
import type { EvermindRunHooks } from '../evermindMemory';
import type { RunWindowSources } from '../windowFit/modelWindow';
import type { RunKnowledgeLog } from '@builderforce/agent-tools';

/**
 * What a run cell is keyed by. A CHAT's run is keyed by its chat id (a number — the
 * key every chat surface, run driver and the cross-chat {@link GlobalRunState} speak).
 * A run that is not a chat's — a canvas session's turn, hosted through
 * `startEngineRun` — takes a string key (`canvas:<sessionId>`), so it shares the store's
 * single-flight claim, Stop, confirmation gate and live snapshot without being mistaken
 * for a chat.
 */
export type RunKey = number | string;

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
   * (e.g. the timeline transcript) can render each step AS IT HAPPENS. Each
   * `pushTrace` publishes a NEW array (copy-on-write), so a consumer may key a
   * memo or effect on it. Bounded by {@link MAX_TRACE_EVENTS}.
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
  /**
   * The engine-hosted turn being narrated ({@link RunTurn}) — null for chat runs, while
   * idle, and from the instant Stop is pressed: a surface stops saying "working" at once
   * while `running` stays true until the aborted loop has actually unwound.
   */
  turn: RunTurn | null;
}

/**
 * An engine-hosted turn as its surfaces narrate it. Held on the CELL rather than by the
 * component that started it, so a remounted surface still has the elapsed clock and
 * Stop still records against the turn.
 */
export interface RunTurn {
  /** The id the host correlates the turn by (`RunEngineControl.correlate`), once known. */
  id: string | null;
  /** Wall-clock start (ms). */
  startedAt: number;
}

/**
 * A snapshot of which CHATS (numeric run keys) are live right now, split by whether they are actively
 * executing (`running`) or paused on a human-in-the-loop confirm (`awaiting` — the
 * actionable one: the loop cannot proceed until the user answers). The two lists
 * are disjoint (an awaiting chat is omitted from `running`).
 */
export interface GlobalRunState {
  running: number[];
  awaiting: number[];
}
