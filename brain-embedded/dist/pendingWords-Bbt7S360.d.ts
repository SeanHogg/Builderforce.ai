import { L as LocalRuntimeId, b as LocalEndpoint, a as LocalRuntimeProbe, c as LocalModel } from './probe-BF7uUc_H.js';
import { ChatErrorAction } from './chatError.js';
import { EvermindRecallResult } from '@seanhogg/builderforce-memory/evermind';
import { ConsolidateOptions, ConsolidatedMemory } from '@seanhogg/builderforce-memory/working';

/**
 * The SPENT vs SAVED contract — the shape the api's `spendSavingsSummary` produces, on
 * every chat (`chat.spend`) and on the consumption snapshot (`spendSavings`, 30 days).
 * Declared ONCE, here: the api builds it, brain-embedded re-exports it to every surface
 * (web, editor, Rovr) and the shared UI in brain-ui renders it — no hand-copied twin to
 * drift. The fold that produces it (`fold.ts`) and the cost rule it prices with
 * (`cost.ts`) live here too, so a device folding its own usage (PRD 36) runs the same
 * arithmetic as the api.
 */
/**
 * Which surface drove a usage row — the usage ledger's `surface` column (varchar(16)).
 * Set on every row so metering can apply the BYO exemption (own-machine on-prem/VSIX
 * BYO usage is free; every other surface's BYO is charged) and so spend is reported
 * by where it happened.
 *   • web      → the web app (Brain chat, dashboards) or an unattributed call.
 *   • vsix     → the VS Code extension (own machine).
 *   • on_prem  → a self-hosted agent host (own machine).
 *   • cloud    → a cloud agent run (Durable Object / container) on our infra.
 *   • sdk      → a direct SDK/API caller.
 *   • rovr     → the Rovr Chrome side panel.
 * Declared once here: the api records it, brain-embedded's memory hooks send it.
 */
declare const USAGE_SURFACES: readonly ["web", "vsix", "on_prem", "cloud", "sdk", "rovr"];
type UsageSurface = (typeof USAGE_SURFACES)[number];
/** True when `raw` names one of the {@link USAGE_SURFACES}. */
declare function isUsageSurface(raw: unknown): raw is UsageSurface;
/** The header a client tags its gateway calls with, so the ledger knows the surface. */
declare const USAGE_SURFACE_HEADER = "x-builderforce-surface";
/** Where a saving came from. `recall_overhead` is the one COST (negative `usd`).
 *  `local_model` is a call a model on the person's own machine served: what the same
 *  tokens would have cost on the conversation's paid route. `deterministic` is a turn a
 *  deterministic action answered with no model (the PreFetch gate's ANSWER, the api's
 *  deterministic step) — an avoided call, estimated at a median turn. */
type SavingsSourceKey = 'prompt_cache' | 'memory_answer' | 'evermind_answer' | 'response_cache' | 'context_trim' | 'recall_overhead' | 'local_model' | 'deterministic';
interface SpendBreakdown {
    /** What the platform billed (plan / overflow / premium). */
    platformUsd: number;
    /** Own-key (BYO) calls priced at list — what the person's provider charged. */
    yourKeyUsd: number;
    totalUsd: number;
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    /** Tokens on models with no catalog price (counted, not valued). */
    unpricedTokens: number;
    requests: number;
    /** Priced on the device from the release's bundled price list, not recorded by the
     *  platform — shown as an estimate (≈). Absent on every platform figure. */
    estimated?: boolean;
}
interface SavingsBySource {
    source: SavingsSourceKey;
    usd: number;
    tokens: number;
    events: number;
    estimated: boolean;
}
interface SavingsBreakdown {
    /** Recorded figures + the provider prompt cache. */
    measuredUsd: number;
    /** Character estimates, net of what recall added. */
    estimatedUsd: number;
    netUsd: number;
    tokensSaved: number;
    bySource: SavingsBySource[];
}
interface SpendSavingsSummary {
    spend: SpendBreakdown;
    saved: SavingsBreakdown;
    /** Net saved ÷ (spent + net saved); null when nothing was spent or saved. */
    savedPct: number | null;
}

/**
 * Shared data shapes for the brain core. These define the contract the host
 * persistence adapter conforms to — they mirror the Builderforce `/api/brain`
 * payloads but are owned here so the package has no dependency on the app.
 */

/** A brain chat (conversation) record. */
interface BrainChat {
    id: number;
    title: string;
    projectId: number | null;
    /** Where the chat was created (e.g. 'brainstorm' | 'ide' | 'project'). */
    origin?: string;
    /**
     * What this chat is MAKING — a capability id from the host's registry
     * ('document' | 'slides' | 'dataviz' | 'spreadsheet' | 'website' | 'design' |
     * 'mobile' | 'animation' | 'game3d'). Shapes the system prompt and the export
     * format. `null`/absent = no capability. Opaque here: the package stores and
     * forwards it, the host owns the catalogue.
     */
    capability?: string | null;
    /**
     * The user's FIRST prompt in this chat (migration 1245), kept as asked and shown
     * on the linked ticket so the origin text survives past the auto-title. Written once
     * by the first-turn seam. Absent/null on an older server and on any chat whose first
     * turn predates the capture — absence is a valid state, so hosts render nothing.
     */
    originalRequest?: string | null;
    /**
     * What this chat is FOR — `'chat'` (a conversation: read, reason, answer) or
     * `'work'` (an execution: create, staff and link the ticket, then dispatch an agent
     * to run it). Migration 0409. Absent on a host/server that predates the column;
     * {@link normalizeChatMode} resolves that to the default.
     */
    mode?: string | null;
    createdAt: string;
    updatedAt: string;
    /**
     * Linked-ticket rollup from GET /api/brain/chats. Present when the chat has
     * at least one linked work item; used by the conversation picker so a chat
     * that still has open tickets reads as `67% · title` instead of title-only.
     * Absent on older servers.
     */
    ticketCount?: number;
    ticketProgressPct?: number | null;
    /**
     * The per-chat Memory switch (1228): whether this conversation recalls from and
     * writes back to the project's memory. A property of the conversation, so every
     * surface reads one value. Absent on an older server ⇒ on (the column default).
     */
    memoryEnabled?: boolean;
    /**
     * Whether the conversation is ARCHIVED — hidden from the default chat list
     * (`GET /api/brain/chats` filters `is_archived = false`) and offered no Archive
     * action by the row menu, since there is nothing left to archive. Absent on an older
     * server ⇒ not archived (the column default), the same convention as
     * {@link BrainChat.memoryEnabled}. Set it back to `false` to restore the chat.
     */
    isArchived?: boolean;
    /**
     * What this conversation cost and what memory saved it — attached by the api to
     * every chat payload beside the ticket rollup. Null/absent until it has usage.
     * A LOCAL chat (PRD 36) carries its own, folded on the device from its run usage
     * ledger, merged with the server's figure once the chat is bound.
     */
    spend?: SpendSavingsSummary | null;
    /**
     * The SERVER chat a local chat is bound to (PRD 36) — a projection of the local
     * store's mapping, never stored on the chat row. `id` on a local chat is a view key
     * that never leaves the machine; every server-addressed call (the ticket rail, the
     * gateway's chat attribution, run context, the model's chatId) uses this, or is not
     * made. Absent on a server chat (its `id` IS the server id) and on an unbound one.
     */
    serverId?: number;
}
/**
 * The id a server-addressed call names for `chat`: its bound server id on a local
 * chat, its own id on a server chat, null on a local chat that is not bound — in which
 * case the call is not made.
 */
declare function serverChatIdOf(chat: Pick<BrainChat, 'id' | 'origin' | 'serverId'> | null | undefined): number | null;
/**
 * Truthful, server-reported outcome of the project-Evermind LEARN gate for a
 * just-persisted assistant turn: whether the server WILL contribute this turn to the
 * project's Evermind (the same gate `learnFromBrainTurn` applies — project-scoped +
 * seeded + connected head) and the head version it contributes to. The run loop uses
 * it to render a TRUTHFUL `learn` step, replacing the old client-side heuristic guess
 * (which both false-positived and, for a connected-but-empty Evermind, false-negatived).
 */
/** Per-Evermind learn result — mirrors the api `EvermindTargetOutcome`. A surface's
 *  project can fan out to MANY Everminds (its own head + the IDE builds grouped under
 *  it); each is named BY ID so the operator can triage which one did/didn't learn. */
interface EvermindLearnTarget {
    /** The Evermind-bearing project id (the build's storage project, or the surface project). */
    projectId: number;
    /** Immutable version ref `evermind/project/<t>/<p>/v<version>`; null when unseeded. */
    ref: string | null;
    version: number;
    name: string;
    learned: boolean;
    reason: 'not-attached' | 'not-seeded' | 'frozen' | 'too-short' | null;
}
interface EvermindLearnOutcome {
    learned: boolean;
    version: number;
    /**
     * When `learned` is false, WHY the turn wasn't contributed — mirrors the api's
     * `BrainLearnSkipReason` so the run loop can render an EXPLAINED (muted) skip step
     * instead of silently showing nothing. Absent/null when the turn was contributed.
     *   `not-attached` chat isn't bound to a project · `not-seeded` no base model yet ·
     *   `frozen` Evermind is read-only · `too-short` no teachable assistant text ·
     *   `memory-off` the chat's Memory switch is off (silent, like `too-short`).
     */
    reason?: 'not-attached' | 'not-seeded' | 'frozen' | 'too-short' | 'memory-off' | null;
    /**
     * Per-Evermind breakdown WITH IDs — present when the chat is project-attached. A
     * project can target 0, 1, or many Everminds; this names each so "which Evermind
     * (didn't) learn" is triageable instead of a single ambiguous "this project".
     */
    targets?: EvermindLearnTarget[];
}
/** A single message within a chat. */
interface BrainMessage {
    id: number;
    role: string;
    content: string;
    metadata: string | null;
    seq: number;
    createdAt: string;
    /**
     * Transient (NOT persisted, NOT returned by getMessages): the learn-gate outcome
     * the send-messages response computed for THIS turn, attached to the returned
     * assistant message so the run loop can render a truthful learn step. Absent on
     * loaded/historical messages and on non-assistant turns.
     */
    evermindLearn?: EvermindLearnOutcome;
}
/**
 * The message role used for durable tool/memory STEP rows the agent loop persists
 * (so a reload can reconstruct the timeline steps — the live trace is in-memory only).
 * These rows are NOT conversation turns: their `content` is empty and the payload
 * lives in `metadata` (`{ kind:'step', … }`). The timeline reconstructs them into
 * tool/recall/learn/reconcile nodes; every OTHER consumer that treats the message
 * list as a dialogue (the model seed, a summary/PRD transcript, a plain bubble list)
 * must exclude them via {@link isStepMessage}.
 */
declare const STEP_MESSAGE_ROLE = "tool";
/** True when a persisted message is a durable tool/memory STEP row (role ===
 *  {@link STEP_MESSAGE_ROLE}) rather than a user/assistant conversation turn. */
declare function isStepMessage(m: {
    role: string;
}): boolean;
/**
 * Attach the send-messages response's TRUTHFUL learn-gate {@link EvermindLearnOutcome}
 * (transient — never persisted, never returned by getMessages) onto the assistant
 * turn(s) a `POST /chats/:id/messages` just persisted, so the Brain run loop renders a
 * `learn` step (or an EXPLAINED muted skip step, via {@link EvermindLearnOutcome.reason})
 * exactly when the server contributed — instead of a client-side guess.
 *
 * The ONE shared implementation every persistence adapter (web app + VS Code webview)
 * calls, so the two can't drift: a divergence here silently disables the learn/skip step
 * on one surface — the VSIX regression that made "Connected, yet nothing learned" an
 * unexplained mystery again while the web app showed it correctly. Generic over the
 * message shape so each surface's own `BrainMessage` type flows through unchanged.
 */
declare function attachEvermindLearn<M extends {
    role: string;
}>(messages: M[], outcome: EvermindLearnOutcome | null | undefined): M[];
/**
 * Render a one-line, plain-text status for a learn-gate {@link EvermindLearnOutcome} —
 * the non-React equivalent of the timeline's learn/skip step, for a host that streams
 * Markdown (the native VS Code `@builderforce` chat participant) rather than mounting
 * the `<BrainTimeline>`. Returns null when there's nothing worth surfacing (no outcome,
 * or a mundane `too-short` turn), so learning is VISIBLE on every surface, not just the
 * ones that render the timeline. Keep the skip phrasing in sync with brain-ui's
 * `learnSkipReason` labels.
 */
declare function formatEvermindLearnStep(outcome: EvermindLearnOutcome | null | undefined): string | null;
/** An uploaded attachment reference attached to an outgoing message. */
interface ChatInputAttachment {
    key: string;
    name: string;
    type: string;
    /**
     * Model-visible image source for vision turns — a `data:` URL (inlined small
     * images) or a short-lived signed public URL (large images). Present only for
     * raster images; when set, the attachment becomes an `image_url` content part
     * the vision model can actually see, instead of a plain text link.
     */
    imageUrl?: string;
}
/**
 * Modality is a free-form string in the core (e.g. 'designer' | 'video' | 'llm').
 * The host maps it to a system prompt via `BrainConfig.resolveSystemPrompt`.
 */
type BrainModality = string;

/**
 * The SINGLE source of truth for the composer's "Effort" control.
 *
 * Effort used to be prose-only (a system-prompt nudge), so picking Quick vs
 * Thorough changed nothing measurable about the request. It now drives THREE
 * things, and every consumer — the UI that describes an effort level to the
 * user, and the request builder that puts it on the wire — reads them from
 * here, so the numbers can never drift apart:
 *
 *   1. `maxTokens`  → the request's `max_tokens` (previously a hardcoded 4096
 *                     for every turn regardless of effort).
 *   2. `reasoningLevel` → the level sent when the Thinking toggle is ON.
 *   3. the system-prompt nudge (kept — but no longer the ONLY effect).
 *
 * ── Why the wire field is VENDOR-NEUTRAL ────────────────────────────────────
 * The client must NOT emit vendor-specific reasoning params. The gateway's
 * `reasoningCapability.ts` is the one conservative registry mapping a model id
 * to the CORRECT vendor param (Anthropic `thinking` for bare `claude-*` only;
 * OpenAI `reasoning_effort` for o-series/gpt-5; everything else dropped), and a
 * blanket Anthropic `thinking` sent to a strict OpenAI-compatible coder 400s the
 * whole run. The client frequently does not even know the model — the picker's
 * default is "auto (let the gateway choose)".
 *
 * So we send INTENT ONLY (`reasoning: { level }`) and the gateway maps it
 * against the model it actually RESOLVED. {@link ReasoningLevel} deliberately
 * uses the same member names as the server's `AgentThinkLevel` union so the
 * gateway can feed it straight into `reasoningParamsForModel` with no second
 * translation table.
 *
 * `balanced` + Thinking OFF is the neutral default and produces a request
 * byte-identical to the pre-change one (max_tokens 4096, no `reasoning` key).
 */
/** How hard the model should work on the next turn — the composer's `/` menu. */
type Effort = 'quick' | 'balanced' | 'thorough';
/**
 * Vendor-neutral reasoning intent. Member names match the server's
 * `AgentThinkLevel` (from `@builderforce/agent-tools`) so the gateway maps them
 * without translating. Intentionally NOT imported from that package: this SDK
 * is published standalone and dependency-free.
 */
type ReasoningLevel = 'off' | 'low' | 'medium' | 'high';
/** The vendor-neutral reasoning field carried on the wire. */
interface ReasoningIntent {
    level: ReasoningLevel;
}
/** Everything one effort level decides. */
interface EffortProfile {
    effort: Effort;
    /** `max_tokens` for the completion — the answer-length/cost lever. */
    maxTokens: number;
    /** The level sent as `reasoning.level` when Thinking is ON. */
    reasoningLevel: Exclude<ReasoningLevel, 'off'>;
    /**
     * The extended-thinking token budget the gateway's registry maps
     * `reasoningLevel` to. Mirrors `THINK_BUDGET_TOKENS` in
     * `api/src/application/llm/reasoningCapability.ts` (low 2048 / medium 8192 /
     * high 16384). DISPLAY ONLY — never sent, so the client cannot drift the
     * server's actual budget; it exists so the menu can tell the user what the
     * toggle really costs.
     */
    thinkingBudgetTokens: number;
    /**
     * The system-prompt nudge for this level, or '' for the neutral default.
     * Kept alongside the real params (belt and braces for models whose family the
     * server registry drops the reasoning param for).
     */
    directive: string;
}
/** The profile for an effort level. Unknown/absent input falls back to `balanced`. */
declare function effortProfile(effort: Effort | undefined): EffortProfile;
/** Is this a known effort level? Guards a persisted/user-supplied string. */
declare function isEffort(value: unknown): value is Effort;
/**
 * The vendor-neutral reasoning intent for a run, or `undefined` when Thinking is
 * OFF — in which case the caller omits the field entirely and the request stays
 * byte-identical to one from before this feature existed.
 */
declare function reasoningForRun(o: {
    effort: Effort;
    thinking: boolean;
}): ReasoningIntent | undefined;

/**
 * LOCAL FIRST — the ordered attempts for one call: capable on-device model(s), then the
 * cloud gateway.
 *
 * "Capable" is decided from what the runtime REPORTED, conservatively:
 *  - a TOOL turn goes only to a model the runtime says can take tools; unknown is no.
 *    A model that ignores `tools` answers an agent turn with prose about calling one —
 *    that is not a failure the failover can see, so it must never be attempted;
 *  - a model whose reported context window cannot hold the prompt plus the expected
 *    completion is skipped. An UNREPORTED window is not disqualifying: an overflow there
 *    is an HTTP error from the runtime, which the failover does see and recovers from.
 *
 * Only `onDevice` runtimes take part, in the registry's `automaticRank` — our engines
 * first, a third-party server (Ollama, FreeToken) last. `kimi-code` is locally dispatched
 * but hosted, so it is reachable by an explicit pin and never by local-first. Pure.
 */

/**
 * The slice of `@builderforce/workload`'s `WorkloadProfile` this plan reads. Structural
 * on purpose: a `WorkloadProfile` is assignable to it, and the package stays free of
 * the workload package's own dependency graph — it is bundled into the editor's webview
 * and a browser extension, where that graph would have to be resolved too.
 */
interface LocalFirstWorkload {
    /** The call carries tools (an agent turn). */
    agentic: boolean;
    inputTokens: number;
    outputTokens: number;
}
type LocalFirstAttempt = {
    kind: 'local';
    /** Full `local/<runtime>/<model>` ref — what a trace and a provenance chip show. */
    ref: string;
    provider: LocalRuntimeId;
    /** The bare id the runtime knows. */
    model: string;
    endpoint: LocalEndpoint;
} | {
    kind: 'cloud';
    /** The host's cloud choice; undefined = let the gateway route. */
    model?: string;
};
/**
 * A connected subscription this host calls ITSELF because its provider refuses our cloud
 * (Kimi Code — registry `accountProvider`). Hybrid tries it after this device and before
 * the cloud, the way the gateway leads with the tenant's other connected accounts.
 */
type LocalFirstAccount = Omit<Extract<LocalFirstAttempt, {
    kind: 'local';
}>, 'kind'>;

/**
 * Run a local-first plan: each attempt in order, falling over to the next when one fails
 * BEFORE the user saw anything, and recording every attempt so a trace shows which
 * served.
 *
 * The rule that makes the failover transparent rather than merely automatic is
 * COMMITMENT. The moment an attempt has streamed output to the user (a text delta, a
 * tool-call fragment) it owns the turn: replaying the turn elsewhere would show the user
 * two answers spliced together, so a failure after that point is rethrown, not retried.
 * Before it, a failure — refused connection, HTTP error, a runtime that rejects the
 * model, an empty answer — is invisible, and the next attempt runs as if it were first.
 *
 * A Stop is never failed over: an aborted signal rethrows whatever the attempt threw.
 * Transport-agnostic: the host supplies `run`, so the same rule drives the editor's
 * transport seam and a browser extension's.
 */

type LocalFirstOutcome = 'served' | 'failed' | 'refused';
interface LocalFirstAttemptRecord {
    attempt: LocalFirstAttempt;
    outcome: LocalFirstOutcome;
    /** Why it did not serve (`failed`: the error's message; `refused`: an empty answer). */
    detail?: string;
}

/**
 * Did the run actually GET ANYWHERE?
 *
 * The A-vs-B triage in `brainTriage.ts` answers "why did a turn come back
 * empty / degraded". It has no vocabulary at all for the failure this module
 * names: a run where every single turn succeeded — no errors, no truncation, no
 * empty finishes — and the agent still accomplished nothing, because it spent
 * its whole budget re-reading the same file at overlapping offsets and re-running
 * searches it had already run. That run scores clean on every existing signal,
 * so the verdict falls through to whichever context/degradation heuristic happens
 * to trip: a 33k-token prompt peak reports "CONTEXT EXHAUSTION" and sends the
 * reader off to shrink the transcript, when the transcript was never the problem.
 *
 * The signals here are structural and cheap to compute, and they are the ones a
 * human reads the transcript to find:
 *
 *  - **Repetition** — the same call made twice, and the same TARGET read over and
 *    over. Seven reads of one 566-line CSS file is not research, it is a loop.
 *  - **Reach** — how many distinct things the run touched, against how many calls
 *    it made. A run with 26 calls over 3 distinct targets is spinning; one with
 *    26 calls over 22 targets is working.
 *  - **Effect** — whether an edit-shaped REQUEST produced any successful mutation.
 *    "Reduce the height of the box" that ends with zero writes did not fail
 *    halfway; it never started.
 *  - **Time** — where the wall clock went (model vs tools), and the slowest step.
 *    A minute inside one search is a fact about our tools, not about the model.
 *
 * Pure over the recorded trace + visible messages, exactly like `brainTriage.ts`,
 * so every copy surface computes the identical block.
 */

/** One target the run went back to more than once. */
interface RepeatedTarget {
    /** `tool:subject`, e.g. `read_file:LandingCanvasHero.module.css`. */
    label: string;
    count: number;
}
/**
 * The same call made again IMMEDIATELY — back to back, with no other tool call in
 * between. The exact-duplicate counter above catches a call repeated anywhere in
 * the run; this catches the tighter and more damning shape: `git_status` → same
 * error → `git_status` → same error → `git_status`. Nothing was learned between
 * the attempts because nothing else was tried.
 */
interface RepeatStreak {
    /** The tool name, e.g. `git_status`. */
    label: string;
    /** Consecutive identical calls, including the first. */
    count: number;
    /** How many of those calls failed — a streak of failures is a stall on a known
     *  error; a streak of successes is a stall on an answer it already has. */
    failed: number;
}

declare function isMutationTool(name: string): boolean;
/**
 * Whether the run was asked to CHANGE something. Reads the user turns only — the
 * assistant's own restatement of the task would make this trivially self-fulfilling.
 * Uses the first user turn (the request) plus any later one, since a follow-up can
 * turn a question into a task.
 *
 * The per-message predicate is `asksForChange` from `@builderforce/agent-stall`: the
 * SERVER needs the identical judgement to decide whether an answer may be replayed
 * from cache (a change request must never be), so it cannot live here.
 */
declare function hasEditIntent(messages: BrainMessage[]): boolean;
/** One run of a multi-run chat, in the per-run line (`runProgressReport.ts`). */
interface RunSummary {
    ask: string;
    turns: number;
    calls: number;
    cacheAnswered: number;
    mutationsSucceeded: number;
    spinning: boolean;
}
interface RunProgress {
    /** Tool calls whose label AND arguments exactly repeated an earlier call. */
    duplicateCalls: number;
    /** Of every call, those the read cache answered without running (see {@link isCacheAnswered}). */
    cacheAnswered: number;
    /**
     * Every run in the chat, oldest first — empty for a single-run trace. The figures above
     * are the LATEST run's: a chat's trace spans every run in it (see `runSlices.ts`).
     */
    runs: RunSummary[];
    /**
     * The longest run of CONSECUTIVE identical calls, or null when no call was ever
     * repeated back to back. See {@link RepeatStreak}.
     */
    longestStreak: RepeatStreak | null;
    /** How many distinct back-to-back streaks (two or more in a row) the run had. */
    streaks: number;
    /**
     * True when some call was repeated {@link BACK_TO_BACK_AT} or more times in a
     * row. Unlike `spinning` this needs no minimum run size — three identical calls
     * in a row is a stall in a 3-call run as surely as in a 300-call one.
     */
    stuckOnCall: boolean;
    /** Targets hit more than once, most-repeated first. */
    repeatedTargets: RepeatedTarget[];
    /** Distinct targets the run touched (calls with no discernible target excluded). */
    distinctTargets: number;
    /** Calls that named a target — the denominator `distinctTargets` is measured against. */
    targetedCalls: number;
    /**
     * Share of targeted calls that revisited a target already visited. 0 = every call
     * broke new ground; 0.8 = four calls in five went back over old ground.
     */
    revisitRatio: number;
    /** Mutation-tool calls attempted, and how many returned a success. */
    mutationsAttempted: number;
    mutationsSucceeded: number;
    /** True when the user asked for a CHANGE (see {@link hasEditIntent}). */
    editIntent: boolean;
    /**
     * The headline finding: an edit-shaped request, real work performed, and NOT ONE
     * successful mutation to show for it. This is the verdict the pasted report was
     * missing — the run was not starved of context, it never acted.
     */
    noEffect: boolean;
    /**
     * True when the run's calls are dominated by revisits — it is going back over
     * ground it has already covered rather than advancing. Requires enough calls to
     * be meaningful (a 3-call run that read one file twice is not a loop).
     */
    spinning: boolean;
    /** Wall-clock span of the recorded run, first step to last (ms). */
    wallClockMs: number;
    /**
     * Time inside that span the run was WAITING rather than working (ms): the user
     * between two messages, or an `ask_user` answer. A chat's trace spans every message
     * in it, so without this a follow-up sent hours later reported "191m wall clock ·
     * 8m in the model", which reads as three hours lost inside the run.
     */
    idleMs: number;
    /** Measured time inside model completions / inside tools (ms). */
    modelMs: number;
    toolMs: number;
    /** The single slowest step, whatever kind — usually the one worth fixing. */
    slowestStep: {
        label: string;
        ms: number;
    } | null;
}
/**
 * Compute the progress/repetition picture for a recorded trace. Pure. A chat's trace is
 * cut into its runs; the picture is the LATEST run's, and `runs` names every one so the
 * run that actually spun is visible.
 */
declare function computeRunProgress(events: BrainTraceEvent[], messages?: BrainMessage[]): RunProgress;

/**
 * Which model did what: the per-model half of the Brain diagnostics.
 *
 * An auto-routed run is served by more than one model (the planner, the coder, a
 * failover after a stall), and the report used to name them only as a set:
 * "Models used: qwen3.8-max, grok-4.5". A run where one of them never made a single
 * tool call read exactly like a run where both worked, so "why isn't Grok working"
 * could not be answered from a copied report at all. This scores each model on the
 * turns it actually served, from the `llm` steps the run loop records.
 *
 * Pure over the recorded trace, like `brainTriage.ts` and `runProgress.ts`, so every
 * copy surface renders the identical lines.
 *
 * The ordered {@link modelTurnLog} answers a question the aggregate scorecard cannot:
 * "which specific outputs were Grok rambling?" — each `llm.complete` in run order,
 * with its model, toolCalls, and (when the vendor reported it) raw upstream calls.
 *
 * NOTE: clearer diagnostics do NOT fix Grok tool calling. A run whose client is
 * ahead of the gateway (e.g. client 2026.9.63 / API 2026.9.32) still lacks the
 * Responses adapter on the production API until that deploy lands.
 */

/** What one model did across the turns it served. */
interface ModelScore {
    model: string;
    /** Completions this model answered. */
    turns: number;
    /** Structured tool calls it emitted across them. */
    toolCalls: number;
    /** Turns that produced text and no tool call: a final answer, or a narrated step. */
    textOnlyTurns: number;
    /**
     * Turns whose text still held tool-call markup that no inline dialect lifted. The
     * model tried to call a tool and the parser missed it, so the call never ran.
     */
    unliftedMarkupTurns: number;
    /** Completions against this model that failed outright. */
    failures: number;
    /**
     * Turns the USER stopped while this model was streaming — the reader's own verdict
     * that it had gone wrong (looping, narrating, counting). The one failure the model
     * never reports itself, so without this a run ended by Stop named no culprit at all.
     */
    stopped: number;
    /**
     * Turns whose vendor reported its RAW response (`upstreamFunctionCalls` recorded) —
     * the Responses vendors (Grok, Codex) do. Zero means the fields below say nothing.
     */
    upstreamReportedTurns: number;
    /** Structured function calls those raw responses carried, before any translation. */
    upstreamFunctionCalls: number;
    /** Of those, calls the gateway rebuilt from the final frame rather than the stream. */
    upstreamRecovered: number;
    /** Reported turns where the vendor returned MORE calls than reached the loop. */
    adapterLossTurns: number;
}
/** Score every model that served (or failed) a turn, first-seen order. */
declare function modelScorecard(events: BrainTraceEvent[]): ModelScore[];
/**
 * Render the scorecard as report lines. Emitted when it says something the "Models
 * used" line does not: more than one model served the run, some turn wrote call
 * markup the parser missed, a returned call never reached the loop, or the user
 * stopped a model mid-stream.
 */
declare function formatModelScorecard(scores: ModelScore[]): string[];
/** One `llm.complete` (or failed completion) in run order — the per-output half of the scorecard. */
interface ModelTurn {
    /** 1-based index across this run's completions. */
    index: number;
    /** Model that answered (resolved). */
    model: string;
    /** What was requested when it differed from {@link model} (failover / downgrade). */
    requestedModel?: string;
    toolCalls: number;
    /** True when the turn produced text and no tool call. */
    textOnly: boolean;
    /** Present when the vendor reported its raw response (Responses vendors). */
    upstreamFunctionCalls?: number;
    upstreamRecovered?: number;
    /**
     * UTF-8 bytes of tool-call ARGUMENTS the turn emitted. The missing half of a long
     * turn: `16. xai-oauth/grok-4.6 · 1 tool call(s) · 202509ms` gave no clue that those
     * 202 seconds were a 21 KB `write_file` call being streamed a fragment at a time.
     */
    argBytes?: number;
    /** Completion tokens the gateway reported for the turn — the other reason a turn is long. */
    completionTokens?: number;
    durationMs?: number;
    /** Completions that failed outright. */
    failed?: boolean;
    /** Call markup present that no dialect lifted. */
    unliftedCallMarkup?: boolean;
    /** The role the turn asked the gateway for — `plan`, `code`, `verify`, `chat`. */
    role?: string;
    /** Models the gateway tried and left before this one (`model:status kind`). */
    failovers?: string;
}
/**
 * Every `llm.complete` in first-seen order — including failures — so a pasted report
 * attributes each output without reconstructing from the aggregate "Per model" counts.
 */
declare function modelTurnLog(events: BrainTraceEvent[]): ModelTurn[];
/**
 * Ordered per-turn model/toolCalls log. Emitted whenever the run had at least one
 * named completion — the scorecard aggregates; this lists each output so a multi-model
 * run is attributable without counting.
 */
declare function formatModelTurnLog(turns: ModelTurn[]): string[];

/**
 * Which model served each ROLE, and how the run moved from analysis to code.
 *
 * The per-model scorecard says what each model did; it cannot say that every `code`
 * turn was answered by the model that planned, or that analysis never ended. Chat #6
 * read as "MiniMax: 899 turns" while the real story was 778 `plan` turns, 262 `code`
 * turns on the same Flash model, 198 analysis→code re-asks that changed nothing and
 * zero `hand_off` calls. These lines tell that story from the recorded trace.
 *
 * Pure over the trace, like `modelScorecard.ts`, so every copy surface renders the same.
 */

interface RoleRouting {
    role: string;
    turns: number;
    /** Turns per model that served this role, most first. */
    models: Array<{
        model: string;
        turns: number;
    }>;
    /** Gateway failovers seen on this role's turns, most first (`model:status kind`). */
    failovers: Array<{
        failover: string;
        turns: number;
    }>;
}
interface RoutingByRole {
    roles: RoleRouting[];
    /** Analysis → code re-asks (`llm.role_handoff`). */
    coderReasks: number;
    /** Explicit `hand_off` calls the planner made. */
    handOffs: number;
    /** Times the analysis budget forced the hand-off turn (`loop.hand_off_due`). */
    handOffsForced: number;
    /** Times analysis ended without a hand-off once the budget was spent. */
    planBudgetsSpent: number;
}

/**
 * staffingSummary — "work was filed; is anybody actually running it?"
 *
 * Measured on chat #113: a Work-mode run made 141 tool calls, filed 12 tickets
 * (epics + tasks) and staffed NOBODY. Its `kanban.coordinate`,
 * `kanban.materialize_work_items` and `kanban.assess_resource` calls all came back
 * `403 manager role required`, nothing compensated, and every other diagnostic signal
 * read clean — no exhaustion, no truncation, no narrated calls, tokens fine. The report
 * a user copied said the run was healthy, because by every signal we measured it was:
 * twelve successful creates and a wall of green tool steps.
 *
 * The missing fact is structural, not statistical: filing work and STARTING it are two
 * different outcomes, and a report that counts tool calls cannot tell them apart. This
 * module counts the second one — how many dispatch/coordination attempts were made, how
 * many of them actually put someone on the work, which ones were refused and why, and
 * whether any slice the Brain did itself was done in a real team agent's persona (a
 * `spawn_agent` carrying `as_agent`). From those four numbers the verdict falls out:
 * a ticket with nobody on it has not started, however many calls it took to create.
 *
 * Pure over the recorded trace, like the rest of `brainTriage`, so the web report, the
 * VS Code transcript and the persisted JSON report all state the same thing.
 */

/** True when this tool call was an attempt to put somebody on the work. */
declare function isDispatchTool(label: string): boolean;
/** One `spawn_agent` delegation that ran in a named team agent's persona. */
interface PersonaSubagent {
    /** The agent the parent asked for, exactly as it passed it (`as_agent`). */
    agent: string;
    /** The delegation's own label, so a reader can see WHAT that persona was given. */
    label: string;
    /** Whether the child came back with an answer. */
    ok: boolean;
}
/** One refused staffing attempt: which tool, and the reason it gave. */
interface DispatchRefusal {
    label: string;
    message: string;
}
/**
 * What this run FILED versus what it STAFFED. Every field is a count of observed trace
 * steps — nothing here is inferred from prose.
 */
interface StaffingSummary {
    /**
     * Board work items this run filed — created or linked. Counted with the SAME predicate
     * {@link isTicketWriteTool} that the unbacked-ticket-claim honesty check uses, so
     * "what counts as filing work" is one list in one place rather than two that drift.
     * (An Epic is a `tasks.create` with `taskType: "epic"`, so it is counted here too.)
     */
    ticketsCreated: number;
    /** Calls that tried to put somebody on work — see {@link isDispatchTool}. */
    dispatchAttempts: number;
    /** Of those, the ones that actually did: no error, and any `autoRun.dispatched` true. */
    dispatched: number;
    /** The refused ones, with the reason each gave (this is where `403 manager role required` lands). */
    dispatchRefusals: DispatchRefusal[];
    /** Delegations carrying `as_agent` — work the Brain did HERE, in a team agent's persona. */
    personaSubagents: PersonaSubagent[];
    /**
     * The one-word answer:
     *  - `no-work-filed`     — nothing was filed and nothing was staffed; there is no gap.
     *  - `staffed`           — somebody (or some persona) is on the work.
     *  - `filed-not-staffed` — work exists, and nobody was even ASKED to run it.
     *  - `staffing-refused`  — somebody was asked and the platform said no.
     */
    verdict: 'no-work-filed' | 'staffed' | 'filed-not-staffed' | 'staffing-refused';
}
/** Derive the staffing picture from a recorded trace. Pure — no clock, no I/O. */
declare function staffingSummaryInTrace(events: BrainTraceEvent[]): StaffingSummary;
/**
 * The refusals, grouped by reason with counts — "manager role required ×5" rather than
 * the same sentence printed five times. Five identical refusals are ONE fact about the
 * run, and spelling them out individually buries it.
 */
declare function formatDispatchRefusals(refusals: readonly DispatchRefusal[]): string;
/**
 * The "Likely cause" sentence for a run that filed work and staffed nobody. Lives here,
 * beside the numbers it quotes, so `brainTriage` reaches it in one call rather than
 * growing a second copy of this reasoning.
 */
declare function workFiledNotStaffedVerdict(s: StaffingSummary): string;
/**
 * Render the staffing picture as report lines (empty when the run neither filed nor
 * staffed anything — a plain question does not need a staffing paragraph).
 */
declare function formatStaffingSummary(s: StaffingSummary, opts?: {
    sessionShipped?: number;
}): string[];

/**
 * What the run is doing RIGHT NOW — the live activity value.
 *
 * The trace records steps once they have COMPLETED, which is exactly the wrong
 * moment for a progress indicator: a `search_code` that takes 67 seconds emits
 * nothing at all until it is over, so the user sits in front of a static
 * "Thinking…" line for a minute with no way to tell a working agent from a hung
 * one. This module is the other half — the in-flight phase, published as it is
 * entered and cleared when the run ends, so a surface can render the CURRENT
 * step (which tool, on what, for how long) instead of only the settled past.
 *
 * Pure data + pure derivation: no React, no DOM, no clock of its own (callers
 * pass `startedAt`), so the web app, the VS Code webview and any future surface
 * render the same activity from the same value.
 */
/**
 * The phase a run is in. Ordered roughly as a turn moves through them, though a
 * run loops back to `thinking` for every iteration of the agent loop.
 *
 * - `starting`  — the run was accepted; the first completion hasn't opened yet.
 * - `thinking`  — a completion is open and no token has arrived (this is the
 *                 phase that used to look identical to a hang).
 * - `writing`   — tokens are streaming; the reply is visibly forming.
 * - `composing` — the model is emitting a TOOL CALL's arguments; `label` is the tool
 *                 name and `bytes` the argument bytes received so far. The run loop
 *                 only ever watched text deltas, so a turn that streamed a 21 KB
 *                 `write_file` call showed "streaming the reply" and then nothing at
 *                 all for three minutes (chat #113) — indistinguishable from a hang
 *                 while the model was in fact working the whole time.
 * - `tool`      — a tool call is executing. Carries which one and on what.
 * - `awaiting`  — paused on a human-in-the-loop confirm; the loop cannot advance
 *                 until the user answers, so this must NOT read as "busy".
 * - `finishing` — the answer is delivered and the run is doing its post-run work
 *                 (minting the ticket for a code change, advancing linked tickets).
 *                 Real calls that take real time, and previously showed nothing.
 */
type BrainRunPhase = 'starting' | 'thinking' | 'writing' | 'composing' | 'tool' | 'awaiting' | 'finishing';
/** A live, in-flight step. `null` on the snapshot means the run is idle. */
interface BrainRunActivity {
    phase: BrainRunPhase;
    /** The tool being executed or composed (`composing` / `tool` / `awaiting` phases). */
    label?: string;
    /**
     * Bytes of tool-call ARGUMENTS received so far (`composing` phase only). The one
     * number that separates "the model is writing a large file" from "the stream died":
     * it climbs, visibly, for every second the phase lasts.
     */
    bytes?: number;
    /**
     * The concrete THING being worked on, derived from the call's arguments — a
     * file path, a search query, a record id. "Reading LandingCanvasHero.module.css"
     * tells a user the agent is making progress; "Running a tool" does not.
     */
    detail?: string;
    /** Epoch ms when this phase began. The renderer ticks its own elapsed clock off it. */
    startedAt: number;
    /** 1-based agent-loop iteration, so a long run shows it is still advancing. */
    step: number;
}
/**
 * Shorten a target for a one-line indicator. A path elides from the LEFT (the
 * basename is what identifies it); anything else elides from the right.
 */
declare function shortenTarget(value: string, max?: number): string;
/**
 * Derive the human "on what" for a live tool step from its arguments. Returns
 * undefined when the call has no recognizable target — the indicator then names
 * the tool alone rather than inventing a subject for it.
 */
declare function activityTarget(args: unknown): string | undefined;
/** Build the live activity for a tool step about to execute. */
declare function toolActivity(label: string, args: unknown, step: number, startedAt: number): BrainRunActivity;
/**
 * Human-readable byte size — `812 B`, `12.4 KB`. THE size formatter for this package:
 * the triage report's tool-result sizes, the turn log's argument bytes and the live
 * composing indicator all render a size the same way, so a reader who learns to read
 * "21.1 KB" in one place reads the same number in the other two.
 */
declare function formatBytes(bytes: number): string;
/**
 * One English clause describing an in-flight step, for a copied triage report —
 * "running `search_code` on frontend/src (67s so far, loop step 4)".
 *
 * Report prose, deliberately NOT localized: a triage capture is pasted into an issue
 * or handed to an engineer, and it is a single artifact in one language by design —
 * the same reason every other line in that report is English. The LIVE indicator, which
 * a user reads in their own editor, is fully localized; see `LiveActivity.tsx`.
 *
 * Shared by both copy surfaces (the web triage report and the VS Code transcript) so a
 * mid-run capture describes itself identically wherever it was taken.
 */
declare function describeLiveStep(step: BrainRunActivity, capturedAtMs: number): string;
/**
 * The mid-run banner both copy surfaces emit. One sentence, one place: the fact that a
 * report was taken mid-flight has to be stated identically everywhere, or a reader who
 * learns to look for it on one surface will not find it on the other.
 */
declare function midRunNotice(activity: BrainRunActivity | null | undefined, capturedAtMs: number): string;

/**
 * Brain execution triage — capture the Brain's run (LLM steps, tool chain,
 * intermediate assistant messages, and errors) as a single paste-able report.
 *
 * This mirrors the "Copy triage info" report the Observability/Logs view emits
 * for host & cloud agents, but for the in-browser Brain agent loop. The loop
 * (useBrainConversation) records a BrainTraceEvent per step; this module turns
 * the recorded trace + the visible conversation into one report a user can drop
 * straight into a bug report.
 */

/** One step of the Brain agent loop, recorded as it runs. */
interface BrainTraceEvent {
    /** ISO timestamp of when the step completed. */
    ts: string;
    /**
     * Category, matching the host/cloud triage vocabulary:
     * - `llm`       — a streamed completion (model, step, tool-call count)
     * - `tool`      — a client action the model invoked (args + result)
     * - `message`   — assistant text emitted on a turn
     * - `error`     — a thrown exception or a tool result that failed
     * - `recall`    — the project Evermind recalled learned memories before answering
     * - `learn`     — the turn was contributed back to the project Evermind
     * - `reconcile` — the turn superseded (updated) recalled memories (write-through)
     */
    category: 'llm' | 'tool' | 'message' | 'error' | 'recall' | 'learn' | 'reconcile';
    /** Display label — the tool name, or `llm.complete` / `agent.message`. */
    label: string;
    /** Wall-clock duration of the step, when measured. */
    durationMs?: number;
    /**
     * `llm` steps: time-to-first-token (ms) — the delay from issuing the
     * completion request to the FIRST streamed text delta of the turn. Undefined
     * when no token arrived (a pure tool-call / empty turn). The timeline uses it
     * for the "Thought for Xs" thinking node so it reflects latency-to-first-token
     * rather than the full-turn duration.
     */
    ttftMs?: number;
    /** Tool arguments / completion request summary. */
    args?: unknown;
    /** Tool result / completion summary / error message. */
    result?: unknown;
    /** True when this step represents a failure (thrown, or `{ ok: false }`). */
    isError?: boolean;
    /** `llm` steps: token usage the gateway reported for this completion. */
    usage?: {
        prompt?: number;
        completion?: number;
        total?: number;
    };
    /** `llm` steps: OpenAI finish_reason (`stop` | `length` | `tool_calls` | …). */
    finishReason?: string | null;
    /** `llm` steps: length of the assistant text this turn produced. */
    textChars?: number;
    /**
     * `tool` steps: byte length of the FULL result the tool returned, before any
     * transcript trimming — so a diagnostics reader sees which tool flooded the
     * context even though the model only ever saw a truncated copy.
     */
    resultBytes?: number;
    /** `tool` steps: true when the result sent to the model was truncated. */
    truncated?: boolean;
    /**
     * True when this event was RECONSTRUCTED from a durable step row rather than
     * recorded live this session (see `persistedSteps.traceWithPersistedSteps`).
     * Diagnostics uses it to tell a fully-observed run from a partially-recovered
     * one, so mismatched coverage is labelled instead of silently averaged in.
     */
    recovered?: boolean;
}
/**
 * Did a tool result represent a failure?
 *
 * Tool results in this codebase signal failure by SHAPE, not prose: the platform
 * actions return `{ ok: false }` or `{ error: "<message>" }` (the tenant guard,
 * the dispatcher's unknown-capability, a thrown handler). We inspect that shape
 * instead of regex-scanning the whole stringified payload — the old
 * `\b(error|failed|exception)\b` scan misfired on any legit data that merely
 * CONTAINED the word "error" (e.g. a task titled "Fix login error", an audit
 * row, a search result), mis-marking a successful run as ERROR in the report.
 *
 * For a STRING result we only flag an embedded `{ ok: false }` / `"error":`
 * envelope (a stringified error object), never a free-text occurrence of the
 * word — a plain-string success like `"done"` or `"No errors found"` is not a
 * failure.
 */
declare function isFailedToolResult(result: unknown): boolean;
/** THE honesty-flag lines, shared by every copy surface so they cannot drift apart. */
declare const UNBACKED_WRITE_CLAIM_NOTICE = "\u26A0 UNBACKED WRITE CLAIM \u2014 an assistant turn claimed it saved/updated a file, but no file-write tool (write_file / edit_file / attachments.write / project_files.save) succeeded in this run. The file was NOT modified.";
declare const UNBACKED_TICKET_CLAIM_NOTICE = "\u26A0 UNBACKED TICKET CLAIM \u2014 an assistant turn claimed it created/filed/linked a ticket or gap, but no create/link tool (tasks.create / chats.link_ticket / tickets.from_delta) succeeded in this run. Nothing was filed or linked to the chat.";
/** Did this tool call FILE board work (create or link)? THE predicate — the honesty check
 *  below and `staffingSummary.ts` both read it, so "what counts as filing work" is one list. */
declare function isTicketWriteTool(label: string): boolean;
/**
 * Structural honesty check for the "it said it updated the file but didn't" failure:
 * an assistant message that CLAIMS a file/attachment write while NO file-write tool
 * call succeeded in the run. Pure over the recorded trace + visible messages, so the
 * web report and the VS Code transcript flag it identically. The Brain system prompt
 * tells the model not to fake a save; this makes a violation visible in every triage
 * capture (and is reusable by a run-loop guard).
 */
declare function detectUnbackedWriteClaim(events: BrainTraceEvent[], messages: BrainMessage[]): boolean;
/**
 * The ticket twin of {@link detectUnbackedWriteClaim}: an assistant turn that CLAIMS it
 * created/filed/linked a ticket, gap, or task while NO create/link tool call succeeded
 * this run — the "it said it linked the gap to the chat, but the chat shows no link"
 * failure. The run loop links a REAL create deterministically (autoLinkCreatedItem), so
 * a claim with no successful create/link tool means nothing was actually filed or
 * linked. Pure over the recorded trace + visible messages, so both copy surfaces flag
 * it identically.
 */
declare function detectUnbackedTicketClaim(events: BrainTraceEvent[], messages: BrainMessage[]): boolean;
/**
 * The "it doesn't execute, it just dies" signature: an assistant turn that NARRATES a
 * tool call — announcing it in prose, or writing the bare call as text — while the run
 * recorded ZERO tool steps.
 *
 * This is a model fault, not a user one: the agent loop only runs structured
 * `toolCalls` (plus the inline dialects `xmlToolCalls` lifts), so a model that writes
 * its intent as plain text achieves nothing. Without this detector the triage block
 * scores such a run "healthy" (no errors, no truncation, no context pressure), which
 * is exactly backwards.
 *
 * Deliberately reuses `announcesUntakenAction` — the SAME detector the run loop gates
 * its stall recovery on. Diagnostics that disagreed with the loop about what counts as
 * a stall would be worse than none: a report could call a run healthy while the loop
 * had spent three recovery turns on it.
 *
 * Pure over the merged trace + visible messages, so both copy surfaces flag it
 * identically.
 */
declare function detectAnnouncedButUnmadeToolCall(events: BrainTraceEvent[], messages: BrainMessage[]): boolean;
/** How many times this run re-prompted a model that announced a call without making one. */
declare function stallRecoveriesInTrace(events: BrainTraceEvent[]): number;
/** How many times this run switched MODELS because one wouldn't emit tool calls. */
declare function modelFailoversInTrace(events: BrainTraceEvent[]): number;
/** True when the stall survived every recovery AND every failover this run. */
declare function stallUnrecoveredInTrace(events: BrainTraceEvent[]): boolean;
/** Tool-catalog exposure for a run, read off the `llm` turns the loop records. */
interface ToolExposure {
    /** Tools advertised on the LAST measured turn (what the model could call at the end). */
    lastTurn: number | null;
    /** Fewest tools advertised on any measured turn — a zero here explains everything. */
    min: number | null;
    /** Size of the whole registered catalog the selection drew from. */
    catalog: number | null;
}
/**
 * How many tools the model was actually OFFERED, per turn, versus how many exist.
 *
 * The registry-wide total is not the same question: a turn that was handed ZERO tools
 * and a turn that was handed sixty-four and ignored them produce byte-identical reports,
 * and only one of them is the model's fault. The loop records the real per-turn number
 * and this reads it back. Nulls when the run predates the field.
 *
 * This is now the SINGLE source of the per-turn figure: the chat-diagnostics header used
 * to render a ceiling derived from the registry size while the Diagnostics block below it
 * rendered this measurement, so one report answered one question two ways. Both lines
 * read this function now (via `gatherChatDiagnostics`).
 */
declare function toolExposureInTrace(events: BrainTraceEvent[]): ToolExposure;
/**
 * Tools the model WROTE OUT by name on a turn that made no call, which it had never been
 * advertised — recorded per-turn by the run loop (only it holds both halves).
 *
 * This is the signal that separates two failures the old report collapsed into one
 * "the model won't emit tool calls, try another":
 *   - the model narrated a tool it COULD see  ⇒ genuinely a model/provider fault;
 *   - the model narrated a tool it could NOT see ⇒ our per-turn tool selection dropped
 *     the tool the prompt told it to call, and no model can emit a call for a function
 *     it was never given. Swapping models does nothing.
 * De-duplicated, first-seen order.
 */
declare function narratedUnadvertisedInTrace(events: BrainTraceEvent[]): string[];
/** One turn the memory-first short-circuit answered — the LLM was never called. */
interface MemoryAnsweredTurn {
    /** `evermind` = the project's SSM GENERATED the reply; `qa-cache` = a stored answer was replayed;
     *  `symbol-index` = the host answered "where is X defined?" from its definition index;
     *  `deterministic` = another PreFetch ANSWER action (named by {@link actionId}). */
    source: 'evermind' | 'qa-cache' | 'symbol-index' | 'deterministic';
    /** The PreFetch action that answered (`deterministic` source only). */
    actionId?: string;
    /** Evermind head version that served it (evermind source only). */
    version?: number;
    /** WHICH project's Evermind served it — a project can target several heads. */
    projectId?: number;
}
/**
 * An `evermind/…` (or project-/tenant-pinned) model id means a tenant's own
 * Evermind artifact answered the turn rather than a stock pool model. Matches the
 * `evermind/` vendor prefix and the `project_evermind:` / `tenant_model:` pin refs.
 */
declare function isEvermindModel(model: string): boolean;
/**
 * The distinct models the gateway ACTUALLY used across a run, read from the `llm`
 * trace events (brainRunStore records the resolved model in `args.model`). First-
 * seen order, so a mid-run failover swap stays visible. The placeholder `default`
 * (caller pinned nothing ⇒ gateway auto-selected, and it reported no model) is
 * dropped so it never masquerades as a real model id. A user Stop counts too: the
 * model it cut off streamed, even though that turn never completed.
 */
declare function modelsUsedInTrace(events: BrainTraceEvent[]): string[];
/**
 * Which account served the run, from the `account` the loop recorded per `llm`
 * step (the gateway's `x-builderforce-account`). Last-seen wins so a mid-run swap
 * is reflected. Undefined when the gateway reported none. Values: `own` (tenant's
 * connected frontier account) · `shared` (shared pool, nothing connected) ·
 * `shared_byo_unused` (shared pool DESPITE a connected account).
 */
declare function accountUsedInTrace(events: BrainTraceEvent[]): string | undefined;
/**
 * Connected-BYO providers the gateway could NOT resolve on any turn (from
 * `x-builderforce-byo-unresolved`) — e.g. a connected Claude subscription whose
 * token expired, so the run silently used the shared pool instead of the tenant's
 * own Opus. Union across turns, first-seen order. Empty when everything resolved.
 * This is the signal that turns a mysterious weak-model run into "reconnect your
 * Claude account" — the exact context a "should have used Opus" triage lacked.
 */
declare function byoUnresolvedInTrace(events: BrainTraceEvent[]): string[];
/** One connected-but-unresolved provider + WHY (the gateway encodes `provider:reason`
 *  in `x-builderforce-byo-unresolved`, e.g. `anthropic:revoked`). `reason` is '' when the
 *  gateway sent a bare provider (older gateway). */
interface ByoUnresolvedEntry {
    provider: string;
    reason: string;
}
/** Parse the run's `provider:reason` unresolved entries into structured form. Accepts the
 *  bare-provider form too (reason ''), so an older gateway still renders. */
declare function parseByoUnresolved(entries: readonly string[]): ByoUnresolvedEntry[];
/** An actionable hint for a {@link ByoUnresolvedEntry} reason — the SINGLE source both the
 *  triage report and the live webview banner render, so "what do I do about it" never drifts. */
declare function byoReasonHint(reason: string): string;
/** A one-line summary of an unresolved provider: `anthropic (revoked): <hint>`. */
declare function byoUnresolvedSummary(entry: ByoUnresolvedEntry): string;
/**
 * The model + account provenance header lines, derived from the trace. The SINGLE
 * source both copy surfaces use (the web {@link buildBrainTriageReport} and the VS
 * Code `transcript.ts`) so "which surface / model / account served this, and was a
 * connected account left unused" is rendered identically — no drift, no surface
 * missing the account/BYO context (the "vsix copy missing info" gap). `surface`
 * names WHERE the run happened (e.g. `VS Code (VSIX)` / `Web`); omit when unknown.
 */
declare function formatBrainProvenance(events: BrainTraceEvent[], opts?: {
    configuredModel?: string;
    surface?: string;
}): string[];
/**
 * Structured run diagnostics derived from the trace — the numbers a reader needs
 * to tell WHY a Brain run died, without eyeballing a wall of JSON.
 *
 * The two failure modes we discriminate:
 *  - **context-exhaustion** (case A): prompt tokens climb turn over turn (big
 *    tool dumps in the transcript), the gateway fails over to a smaller-window
 *    model, and a turn ends on `finish_reason: length` or empty. The context
 *    starved the model.
 *  - **model-degradation** (case B): a tenant Evermind/SSM model answered and a
 *    turn came back empty/failed while token counts stayed LOW — the model
 *    itself produced nothing, not the context.
 */
interface BrainDiagnostics {
    turns: number;
    toolCalls: number;
    errors: number;
    loopExhausted: boolean;
    /** True when at least one llm step reported token usage. */
    tokensMeasured: boolean;
    /** Largest prompt-token count seen on any single turn. */
    promptTokenPeak: number;
    /** Sum of completion tokens across turns. */
    completionTokenTotal: number;
    /** Prompt tokens on the LAST turn (the one nearest any overflow). */
    lastPromptTokens: number;
    /** Total bytes of tool results returned this run (pre-trim). */
    toolResultBytes: number;
    /** Count of tool results trimmed to the per-result budget before hitting the model —
     *  LOSSY cuts only; a paged `read_file` window is counted in {@link pagedReadWindows}.
     *  A trim is the budget WORKING: it is evidence of pressure, never of a failure. */
    truncatedToolResults: number;
    /** `read_file` results handed over as one window of a larger file, with the offset
     *  that continues it. The budget working as designed, not lost context. */
    pagedReadWindows: number;
    /** The single largest tool result (label + pre-trim bytes). */
    largestToolResult: {
        label: string;
        bytes: number;
    } | null;
    /**
     * The steps that FAILED, most recent first — label plus the message the tool
     * actually returned. `Errors: 1` on its own tells a reader that something went
     * wrong and nothing about what, so the only way to act on it was to scroll the
     * whole transcript hunting for the failure. Capped, because a run that fails
     * repeatedly should not push everything else out of the report.
     */
    errorSteps: {
        label: string;
        message: string;
        model?: string;
    }[];
    /** Distinct models that actually answered, first-seen order. */
    modelsUsed: string[];
    /** What each of those models did with the turns it served — see `modelScorecard.ts`. */
    modelScores: ModelScore[];
    /** Each `llm.complete` in run order — which model produced which output. */
    modelTurns: ModelTurn[];
    /** Which model served each role, and how analysis ended — see `routingByRole.ts`. */
    routing?: RoutingByRole;
    /** Distinct Evermind/SSM artifacts among them. */
    evermindUsed: string[];
    /** Turns where the resolved model differed from what was requested. */
    downgradeEvents: number;
    /** Turns that ended on `length` or produced empty text. */
    emptyOrLengthFinishes: number;
    /**
     * True when a turn NARRATED a tool call ("I'll call the tool…", `builtin_…`) while
     * the run made none — the model isn't emitting structured `toolCalls`, so nothing
     * ever executes. See {@link detectAnnouncedButUnmadeToolCall}.
     */
    announcedUnmadeToolCall: boolean;
    /** How many times the loop re-prompted a model that announced a call without making one. */
    stallRecoveries: number;
    /** How many times the loop switched MODELS after one burned its whole stall budget. */
    modelFailovers: number;
    /** True when the stall survived every recovery and every failover — the run gave up. */
    stallUnrecovered: boolean;
    /** A tool step ran after the last re-prompt — see {@link stallRecoveredInTrace}. */
    stallRecovered: boolean;
    /** Models whose stream broke mid-turn and were retried on another — see {@link streamRetriesInTrace}. */
    streamRetries: string[];
    /** How many tools the model was offered on the last measured turn (null ⇒ not recorded). */
    advertisedToolsLastTurn: number | null;
    /** Fewest tools offered on any measured turn — a 0 explains a whole run by itself. */
    advertisedToolsMin: number | null;
    /** Size of the registered catalog the per-turn selection drew from. */
    catalogTools: number | null;
    /**
     * Tools the model named in prose on a call-less turn that it was never advertised.
     * Non-empty means the request was impossible as framed — see
     * {@link narratedUnadvertisedInTrace}.
     */
    narratedUnadvertisedTools: string[];
    /**
     * Turns the memory-first short-circuit answered WITHOUT calling a model (see
     * {@link memoryAnswersInTrace}). A run made only of these has no turns, no tokens
     * and no tool calls — the exact shape of a "the model won't call tools" run, which
     * is why it must be named rather than left to inference.
     */
    memoryAnswers: MemoryAnsweredTurn[];
    /**
     * True when tool steps were RECOVERED from durable history but no `llm` turn
     * covers them — i.e. the chat predates durable turn records (or was reopened),
     * so the turn/token figures describe only this session while the tool figures
     * describe the whole conversation. Reported so the two aren't read as one run's
     * totals: "Turns: 2 · Tool calls: 44" is nonsense unless the mismatch is named.
     */
    turnCoveragePartial: boolean;
    /**
     * Repetition / reach / effect / timing for the run — see `runProgress.ts`. This
     * is what separates "every turn succeeded and nothing got done" from a genuine
     * context or model failure, and it is the only signal that fires on the most
     * common real-world stall: an agent re-reading one file until its budget is gone.
     */
    progress: RunProgress;
    /**
     * The run showed context PRESSURE (a big prompt, trimmed tool results) but nothing was
     * cut short by it — no truncated turn, no downgrade, no exhausted loop, no failed
     * completion. Reported as an advisory line so the numbers are still visible, while the
     * verdict stays whatever the rest of the run says (usually `healthy`).
     */
    contextPressureOnly: boolean;
    /**
     * What this run FILED versus what it STAFFED — see `staffingSummary.ts`. The signal
     * that separates "twelve tickets and a hundred green tool calls" from "somebody is
     * actually working on it": every other field here can read clean on a run that left
     * every ticket it created with nobody on it.
     */
    staffing: StaffingSummary;
    /**
     * Successful writes, commits and pushes this session made itself. A non-zero count
     * means "0 dispatched" is not "nobody is running the work" — the session did it.
     */
    sessionShipped: number;
    /** Evermind + project-facts usage recorded in the trace. See {@link memoryUsageInTrace}. */
    memoryUsage: MemoryUsageSummary;
    /**
     * Build/runtime failures the run's LAST diagnostics read still reported — the app the
     * run was working on was broken when it stopped looking. 0 when no read reported any,
     * or a later read came back clean. See {@link unresolvedAppFailuresInTrace}.
     */
    unresolvedAppFailures: number;
    /**
     * Best-effort verdict — the header a triager reads first. `healthy` is distinct
     * from `inconclusive`: the former means there is no failure to explain, the
     * latter that there IS one but the signals don't separate A from B. Collapsing
     * both into "inconclusive" made a clean run read as an unsolved problem.
     *
     * `tool-calls-not-emitted` outranks the rest: a run that narrated its calls did
     * nothing at all, and every other signal on it reads clean.
     *
     * `no-tools-advertised` and `tool-not-advertised` outrank even that, because they are
     * OUR fault rather than the model's, and the remedy ("pick a different model") that
     * `tool-calls-not-emitted` prescribes is actively wrong for them.
     *
     * `no-progress` sits above `context-exhaustion` and `model-degradation` for the same
     * reason: a run that re-read one file until its budget was gone will ALSO show a high
     * prompt peak and truncated tool results, so the context signals fire — but they are a
     * CONSEQUENCE of the loop, and acting on them (shrink the transcript, swap the model)
     * changes nothing. The loop has to be named first or it is never seen.
     *
     * `work-filed-not-staffed` sits LAST among the causes, above only `healthy`/`inconclusive`:
     * it is a verdict about the run's OUTCOME, not its mechanics, so any genuine exhaustion,
     * model fault or narrated-call failure explains the missing dispatch better and outranks it.
     */
    likelyCause: 'memory-answered' | 'no-tools-advertised' | 'tool-not-advertised' | 'tool-calls-not-emitted' | 'no-progress' | 'context-exhaustion' | 'model-degradation' | 'app-errors-unresolved' | 'work-filed-not-staffed' | 'inconclusive' | 'healthy';
}
/**
 * Derive {@link BrainDiagnostics} from a recorded trace. Pure — no clock, no I/O
 * — so both the web report and the VS Code transcript compute the identical
 * block from the same events (single source of truth for A-vs-B triage).
 *
 * `messages` is the visible conversation. It is optional only so older callers keep
 * compiling; without it the narrated-tool-call verdict can't be reached, so every
 * surface should pass it.
 */
interface BrainDiagnosticsContext {
    /**
     * True when the run was STILL EXECUTING at the moment the report was captured.
     * The trace cannot know this — it only holds settled steps — yet it changes how
     * every "and then nothing happened" signal should be read: a run captured
     * mid-flight has not failed to write the file, it has not reached the write yet.
     * Without it, copying a report while the agent is working reports the agent as
     * broken.
     */
    running?: boolean;
}
/** What this run asked of BuilderForce memory, from the trace — not the project's inventory. */
interface MemoryUsageSummary {
    /** Evermind recall steps, including a recorded miss (count 0). */
    evermindRecalls: number;
    /** Items those recalls returned. */
    evermindItems: number;
    /** Prompt tokens the injected recall block added, when the step recorded them. */
    evermindPromptTokens: number;
    learnSteps: number;
    reconcileSteps: number;
    /** `recall_facts` calls — the shared project-facts store. */
    factsRead: number;
    /** `remember_fact` calls. */
    factsWritten: number;
}
declare function computeBrainDiagnostics(events: BrainTraceEvent[], requestedModel?: string, messages?: BrainMessage[], ctx?: BrainDiagnosticsContext): BrainDiagnostics;
/**
 * Render {@link BrainDiagnostics} as transcript lines. Shared by both copy
 * surfaces so the "Diagnostics" block is identical on web and in VS Code. Emits
 * a leading `--- Diagnostics ---` header and returns the lines (caller joins).
 */
declare function formatBrainDiagnostics(d: BrainDiagnostics): string[];
interface BuildBrainTriageOptions {
    /** ISO capture time (caller supplies it so the module stays clock-free). */
    capturedAt: string;
    /** The trace recorded by the agent loop for the active chat. */
    events: BrainTraceEvent[];
    /** The visible conversation, included as a transcript section. */
    messages?: BrainMessage[];
    /** The chat being captured. */
    chatId?: number | null;
    chatTitle?: string;
    /** The persona / agent the Brain ran as. */
    agentLabel?: string;
    /** The model this surface was CONFIGURED with (empty ⇒ gateway auto-selects).
     *  Distinct from what actually answered, which is derived from the trace. */
    configuredModel?: string;
    /** Where the run happened (e.g. `VS Code (VSIX)` / `Web`), for provenance. */
    surface?: string;
    /** The current top-level error surfaced to the user, if any. */
    error?: string;
    /**
     * True when the run was STILL EXECUTING at capture time. The trace cannot know it,
     * and it changes how every "and then nothing happened" signal reads: a report taken
     * mid-flight describes an UNFINISHED run, not a failed one.
     */
    running?: boolean;
    /** The in-flight step at capture time (which tool, on what, since when). */
    activity?: BrainRunActivity | null;
}
/**
 * Assemble the Brain triage report. Same shape as the host/cloud report:
 * header → errors-first → full event log → derived log lines → transcript.
 */
declare function buildBrainTriageReport(opts: BuildBrainTriageOptions): string;

/**
 * The timeline step the Brain run loop records when a LOCAL-FIRST turn did not end
 * where it started — an on-device model was tried and the turn fell over to the next
 * attempt (usually the cloud gateway).
 *
 * The served model already reaches the provenance chip as the turn's `resolvedModel`
 * (`local/<runtime>/<model>` for a local answer). What would otherwise be invisible is
 * the fallback itself: "why did this turn go to the cloud when I have Synapse running?"
 * must have an answer in a copied diagnostics report and a reopened chat. Same shape and
 * category as the other `llm.*` self-reports (see `runPolicyTraces.ts`). Pure: the
 * caller stamps `ts`.
 *
 * Attempts are carried as SUMMARIES (`target` + outcome), never as the plan's attempts:
 * those hold the runtime endpoint, and its bearer must never reach a persisted step.
 */

/** One attempt as a trace may record it — no endpoint, no credential. */
interface LocalFirstAttemptSummary {
    /** `local/<runtime>/<model>` for a local attempt; `gateway` (or the cloud model) otherwise. */
    target: string;
    outcome: LocalFirstAttemptRecord['outcome'];
    detail?: string;
}
/** Project a runner record onto what a trace may hold. */
declare function summarizeLocalFirstAttempt(record: LocalFirstAttemptRecord): LocalFirstAttemptSummary;
/**
 * The `llm.local_fallback` step for a turn's attempts, or null when the first attempt
 * served (nothing fell over, so there is nothing to explain).
 */
declare function localFallbackTrace(ts: string, step: number, attempts: readonly LocalFirstAttemptSummary[] | undefined): BrainTraceEvent | null;

/**
 * The single tool-capable, streaming chat-completion client for the Brain.
 *
 * Targets the OpenAI-compatible gateway `POST {baseUrl}/llm/v1/chat/completions`
 * with `stream: true`, forwards `tools`/`tool_choice`, and surfaces BOTH text
 * deltas and `tool_calls` deltas to the caller.
 *
 * Unlike the in-app original, auth and error mapping are injected via a
 * `BrainTransport` (baseUrl + getToken + onUnauthorized + mapError) so the same
 * client works for builderforce.ai (tenant JWT) and external embeds (a
 * short-lived relay token) without importing any app code.
 *
 * Tool names are kept flat snake_case by convention (no dots), so the gateway's
 * tool-name sanitizer is a no-op and streamed `tool_calls` names round-trip
 * unchanged.
 *
 * Some models emit tool calls inline in the *text* stream as `<tool_call>…`
 * markup instead of native `tool_calls` deltas. {@link XmlToolCallFilter} lifts
 * those into the same structured shape (so they actually execute) and strips the
 * markup from the visible text — see `xmlToolCalls.ts`.
 */

/** Injected auth + endpoint config. Built once by BrainProvider from BrainConfig.transport. */
interface BrainTransport {
    /** Gateway base URL, e.g. https://api.builderforce.ai (no trailing slash). */
    baseUrl: string;
    /** Returns the current bearer token (tenant JWT or embed relay token), or null. */
    getToken: () => string | null;
    /** Called on a 401 so the host can clear the session / redirect. */
    onUnauthorized?: (res: Response, hadToken: boolean) => void;
    /** Map a non-OK response to a typed Error (e.g. plan-limit handling). */
    mapError?: (res: Response) => Promise<Error>;
    /** Default model when a call doesn't specify one. */
    defaultModel?: string;
    /**
     * Optional networking override. When set, the streaming request is performed
     * through this instead of the global `fetch`. It MUST resolve to a `Response`
     * whose `body` is a readable stream of the raw SSE bytes (same contract as
     * `fetch`). Hosts that can't reach the gateway directly from the UI context
     * (e.g. a VS Code webview, where a `vscode-webview://` origin is CORS-blocked)
     * inject a fetch that proxies the call through their privileged side. Defaults
     * to the global `fetch` for the browser/web app.
     */
    fetch?: (input: string, init: RequestInit) => Promise<Response>;
    /**
     * `openai`: the transport reaches a provider's plain OpenAI route, not the gateway
     * (`localTransport`). The gateway-only fields — `strict`, `routingMode`,
     * `excludeModels`, `role`, `arcStage`, `reasoning`, `metadata` — are never sent: the
     * gateway strips them before any vendor (`STANDARD_BODY_FIELDS`), and a provider may
     * reject them outright (Kimi Code 400s `metadata` with numeric values). Absent =
     * the gateway.
     */
    wire?: 'gateway' | 'openai';
    /** The provider chooses sampling per model, so no `temperature` is sent — Kimi K3
     *  accepts only `1` and 400s our default (the runtime registry's `providerSampling`). */
    providerSampling?: boolean;
}
/** OpenAI function-tool spec (the `tools[]` entries sent to the model). */
interface BrainToolSpec {
    type: 'function';
    function: {
        name: string;
        description: string;
        /** JSON Schema for the function arguments. */
        parameters: Record<string, unknown>;
    };
}
/** A plain-text content part (OpenAI multimodal `content[]` shape). */
interface TextContentPart {
    type: 'text';
    text: string;
}
/**
 * An image content part. `url` is either a `data:` URI (inlined, the common
 * case after client-side downscaling) or a short-lived signed public URL the
 * upstream provider can fetch. The gateway's shape router detects these and
 * floats a vision-capable model to the head of the cascade.
 */
interface ImageUrlContentPart {
    type: 'image_url';
    image_url: {
        url: string;
        detail?: 'low' | 'high' | 'auto';
    };
}
type ContentPart = TextContentPart | ImageUrlContentPart;
/** A message in the working array — supports assistant tool-call turns and tool results. */
interface ChatCompletionMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    /**
     * Plain string for the overwhelming majority of turns. A `ContentPart[]` is
     * used only when a user turn carries images (vision): the gateway forwards
     * the array untouched and routes to a vision model. Persistence stays
     * text-only — the rich array lives in the in-memory transcript so the model
     * keeps seeing the image on later turns.
     */
    content: string | ContentPart[];
    /** Present on an assistant turn that requested tools. */
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
    /** Present on a tool-result message, linking it to the call. */
    tool_call_id?: string;
}
interface StreamHandlers {
    onTextDelta?(delta: string): void;
    /** Fired per streamed tool-call fragment; accumulate by `index`. */
    onToolCallDelta?(index: number, partial: {
        id?: string;
        name?: string;
        argsFragment?: string;
    }): void;
    onDone?(finishReason: string | null): void;
    /**
     * Fired ONCE, the moment the gateway names the model serving this stream (its
     * `x-builderforce-model` header, else the first chunk's `model`) — long before the
     * result exists. A caller whose stream is cut short (a user Stop aborts the fetch, so
     * no result is ever returned) otherwise never learns which model it was watching.
     */
    onModel?(model: string, account: string | undefined): void;
    /**
     * Fired before each wait when the gateway could not be reached at all (the connection
     * never opened — `retryOnConnectFailure`). The request is sent again after `delayMs`;
     * a caller uses this to show that the run is waiting on the network, not hung.
     */
    onConnectRetry?(attempt: number, delayMs: number, reason: string): void;
}
/**
 * Caller-supplied provenance for a completion, forwarded to the gateway as the
 * request body's `metadata` object. Every field is optional; the server treats a
 * missing `chatId` as "not chat traffic" and records nothing.
 */
interface CompletionMetadata {
    /** The SERVER Brain chat this completion is serving — the audit emit's switch. Never a
     *  local chat's view key (PRD 36): an unbound local chat leaves it out. */
    chatId?: number;
    /** The local chat's client id (a uuid), for diagnostics only — the server never
     *  resolves it to a chat. */
    clientChatId?: string;
    /** The chat's project, when it has one (scopes the audit row). */
    projectId?: number;
    /** Stable identifier of the answering agent. Defaults server-side to `brain-default`. */
    agentRef?: string;
    /** Display name of the answering agent. Defaults server-side to `Brain`. */
    agentName?: string;
    /** One user submit. Reused by every model iteration in that submit so guest
     * metering charges the user action once, not once per tool-loop completion. */
    guestTurnId?: string;
    /** Original text the user submitted. Internal specialist/tool prompts retain
     * this value so the gateway can verify the turn even when their prompts differ. */
    guestTurnInput?: string;
    /**
     * The conversation's MODE (0409) — `chat` or `work`. Carried so the usage row this
     * completion produces records WHICH KIND of turn spent the tokens. Without it,
     * spend can only be attributed to a chat id, and "what does execution actually
     * cost us versus conversation" has no answer.
     */
    mode?: string;
    /**
     * What memory did to THIS call (`memorySavings.ts`): prompt tokens compaction kept out
     * of it and tokens recall added to it. The gateway's usage writer stamps them on the
     * call's own usage row, so the savings ledger costs no request of its own.
     */
    memory?: {
        trimmedTokens: number;
        recallTokens: number;
    };
    /**
     * The run's PIPELINE route (`@builderforce/pipeline-route`) — `full` (plan → code →
     * verify) or `quick` (one coding pass) — and the router's score, decided once in the
     * run preamble. The gateway's usage writer promotes both to `llm_usage_log` columns;
     * the device's run usage ledger reads them off the same call. Absent when the run was
     * not routed (a host that sends no pipeline settings, a sub-agent).
     */
    pipelineRoute?: 'full' | 'quick';
    routeScore?: number;
    /**
     * How the PreFetch gate left this run's turn (`runStore/prefetchGate.ts`): `prefetch`
     * when deterministic facts rode into it, `llm` when nothing did. A turn the gate
     * ANSWERED made no call to carry it. Absent when the host has no gate.
     */
    gateRoute?: 'prefetch' | 'llm';
}
interface StreamChatOptions {
    messages: ChatCompletionMessage[];
    tools?: BrainToolSpec[];
    tool_choice?: 'auto' | 'none' | 'required';
    model?: string;
    /** Hard-pin {@link model}. Used by an explicit user pick so validation cannot
     * silently succeed on a gateway substitute. */
    modelStrict?: boolean;
    /** `auto` lets the gateway choose across every entitled route; `byo_pool`
     * constrains the turn to the tenant's ordered connected-account cascade. */
    routingMode?: 'auto' | 'byo_pool';
    /**
     * Models the caller has already proved unusable for this piece of work — emitted
     * as the body's `excludeModels` so the gateway routes AROUND them.
     *
     * A hint, never a veto: the gateway drops them from the cascade only while another
     * candidate remains, so this can never turn "a weak answer" into "no answer". Only
     * meaningful alongside auto-routing; with an explicit {@link StreamChatOptions.model}
     * the caller has already made the choice. Omitted when empty, so a request without
     * one stays byte-identical to a pre-feature request.
     */
    excludeModels?: string[];
    /**
     * Prompt-cache affinity key (OpenAI-style `prompt_cache_key`), e.g. `brain:<chatId>`,
     * so every turn of one conversation lands on the same provider cache. Forwarded
     * verbatim; absent ⇒ omitted from the body.
     */
    prompt_cache_key?: string;
    /**
     * What kind of call this is (plan/code/verify/explore/chat/utility), emitted as the
     * body's `role`. Under auto-routing the gateway orders the tenant's connected
     * accounts for it — analysis on the tenant's own order, code on the strongest
     * connected model. Omitted when unset, so the body stays byte-identical.
     */
    role?: string;
    /**
     * The launching canvas session's arc stage (idea/make/run/measure/reach), emitted as
     * the body's `arcStage` — a nudge on top of {@link StreamChatOptions.role} that the
     * gateway validates (`isArcStage`) and folds into its role/cost ordering. Omitted when
     * unset, so the body stays byte-identical.
     */
    arcStage?: string;
    temperature?: number;
    maxTokens?: number;
    /**
     * Vendor-neutral reasoning INTENT for this completion. Emitted on the wire as
     * `reasoning: { level }` and mapped SERVER-side against the model the gateway
     * actually resolved (`reasoningParamsForModel`), which knows which families
     * accept Anthropic `thinking` vs OpenAI `reasoning_effort` and drops it for the
     * rest. The client must never emit a vendor param itself: the model is often
     * `auto`, and an Anthropic-only `thinking` sent to an OpenAI-compatible coder
     * 400s the run. Omit (or `{ level: 'off' }`) to leave the body unchanged.
     */
    reasoning?: ReasoningIntent;
    /**
     * Caller identity for this completion, emitted verbatim as the wire body's
     * `metadata` object. The gateway reads it in `recordBrainChatModelActivity`
     * (`api/src/presentation/routes/llmRoutes.ts`) to write the audit-log row that
     * names WHICH MODEL served this turn — the default-agent twin of the addressed
     * agent's `BrainService.agentReply` emit. `chatId` is the key that switches the
     * emit on; without it the server no-ops.
     *
     * Only populated fields should be set: an EMPTY object (or `undefined`) omits
     * the `metadata` key from the body entirely, so anonymous/unsaved runs stay
     * byte-identical to a pre-feature request (same discipline as `reasoning`).
     */
    metadata?: CompletionMetadata;
    /**
     * The run's own chat key on THIS device — what a host groups the conversation's calls
     * by (the local-success label waits under it for the chat's verdict). Never on the
     * wire: on a local-first host it is a view key that must not leave the machine
     * (PRD 36), which is why it is not {@link CompletionMetadata.chatId}.
     */
    conversationKey?: number;
    /**
     * Silence that ends this request — no response headers, or zero bytes read, for this
     * long — defaulting to {@link STREAM_IDLE_MS}. A stalled upstream never settles, so
     * without this a dead turn hangs until the user presses Stop. A host sets its own
     * budget here (the canvas, an interactive surface on free models, waits less than an
     * IDE run whose reasoning model may think for minutes); the RULE is this one.
     */
    idleTimeoutMs?: number;
    signal?: AbortSignal;
    /** Auth + endpoint. Injected by BrainProvider; callers via the hook never set this directly. */
    transport: BrainTransport;
}
/** A fully-stitched tool call assembled from streamed deltas. */
interface AssembledToolCall {
    id: string;
    name: string;
    /** Raw JSON argument string (parse with `JSON.parse`). */
    args: string;
}
/**
 * Token accounting for one completion, as reported by the gateway's final
 * `usage` chunk (OpenAI shape). Absent when the upstream didn't emit usage
 * (some providers don't). Surfaced so the triage/diagnostics layer can tell a
 * CONTEXT-EXHAUSTION death (prompt tokens climbing turn over turn until the
 * model 413s / truncates) apart from a model-DEGRADATION death (an Evermind/SSM
 * turn returning empty or garbage while token counts stay low).
 */
interface CompletionUsage {
    prompt?: number;
    completion?: number;
    total?: number;
    /** Prompt tokens served from the vendor's prompt cache — INCLUDED in `prompt`. */
    cacheRead?: number;
    /** Prompt tokens written to the vendor's prompt cache — INCLUDED in `prompt`. */
    cacheCreation?: number;
}
/**
 * What the vendor's RAW response carried, counted by the gateway before it translated
 * the turn (the `x_builderforce_upstream` field the Responses vendors — Grok, Codex —
 * put on the finishing chunk). It answers the first question of any "the model won't
 * call tools" report: did the vendor return a structured function call at all?
 */
interface UpstreamTurnEvidence {
    /** Output items by type, as the vendor returned them. */
    items: Record<string, number>;
    /** Structured function calls the vendor returned. */
    functionCalls: number;
    /** How many of those the gateway rebuilt from the final frame. */
    recovered: number;
}
/** One model the gateway tried and left before the one that answered. */
interface GatewayFailover {
    model: string;
    vendor: string;
    code: number;
    kind?: string;
}
/**
 * How the gateway routed this turn — its terminal `_builderforce` frame
 * (`api/.../streamDiagnostics.ts`). Without it a run could only see the model that
 * answered, never the coders it was seeded with or the ones that refused: chat #6 ran
 * hundreds of `code` turns on MiniMax Flash with Grok and Kimi connected, and nothing
 * on the client could say why.
 */
interface GatewayRouting {
    /** Every model tried and left, in order. */
    failovers: GatewayFailover[];
    /** The head of the candidate chain the gateway walked. */
    candidates?: string[];
    traceId?: string;
}
interface StreamChatResult {
    /** How the gateway routed the turn — absent off the gateway or on an older one. */
    gateway?: GatewayRouting;
    /**
     * What the vendor's raw response carried before translation — see
     * {@link UpstreamTurnEvidence}. Absent for vendors that do not report it.
     */
    upstream?: UpstreamTurnEvidence;
    text: string;
    toolCalls: AssembledToolCall[];
    finishReason: string | null;
    /**
     * The model the GATEWAY actually used for this completion — which can differ
     * from the requested `model` (empty/absent means the gateway auto-selected
     * from its pool, and failover may have swapped upstreams mid-cascade). Sourced
     * from the `x-builderforce-model` response header when readable, else from the
     * `model` field the OpenAI-shaped stream chunks carry. Surfaced so callers can
     * record which LLM (or which `evermind/…` artifact) produced a turn.
     */
    resolvedModel?: string;
    /** Provider/vendor that actually served the completion, reported independently
     * from the model id so diagnostics never have to guess from naming conventions. */
    resolvedVendor?: string;
    /**
     * Which account served this turn, from the gateway's `x-builderforce-account`
     * response header: `own` (the tenant's connected frontier account), `shared`
     * (the shared pool, no connected account), or `shared_byo_unused` (the shared
     * pool despite a connected account existing). Undefined when the gateway didn't
     * report one (older gateway, or the header wasn't CORS-exposed). Feeds the
     * per-reply provenance chip so a successful turn shows whose account ran it.
     */
    account?: string;
    /**
     * Providers the tenant CONNECTED but that the gateway could NOT resolve for this
     * turn (from `x-builderforce-byo-unresolved`, comma-separated) — e.g. a connected
     * Claude subscription whose token expired, so the run silently fell to the shared
     * pool instead of the tenant's own Opus. Undefined/absent when every connected
     * provider resolved. Surfaced in triage so a "should have used my BYO account" run
     * is self-explaining instead of looking like "nothing connected".
     */
    byoUnresolved?: string;
    /**
     * BYO providers that hit a usage/capacity cap this turn (from
     * `x-builderforce-provider-cap`, comma-separated) — e.g. the tenant's Anthropic
     * key hit its monthly spend limit, or Meta MUSE quota was exhausted. Only set
     * when the tenant's OWN key hit the cap (never the shared operator pool). The
     * client should prompt the user to manage their provider keys in settings.
     */
    providerCap?: string;
    /** Token usage for this completion, when the gateway reported it. */
    usage?: CompletionUsage;
    /**
     * Set only by a LOCAL-FIRST stream (`localFirstTransport.ts`): every attempt this
     * completion made, in order — the on-device model(s) tried and whichever served. The
     * run loop turns a fallback into an `llm.local_fallback` step. Summaries only: no
     * endpoint, no credential.
     */
    localFirst?: LocalFirstAttemptSummary[];
}
/**
 * The stream broke AFTER the gateway committed to a model: an in-band `error` frame, or
 * the connection dropping mid-answer. The gateway can only fail over before it sends
 * headers, so from here the caller is the only one who can route around the model —
 * `model` is what it needs to do that (`excludeModels` on a retry). Before this, both
 * cases ended the stream as a clean, empty `stop`, and the agent run simply ended.
 */
declare class StreamInterruptedError extends Error {
    readonly model: string | undefined;
    constructor(message: string, model: string | undefined);
}
/**
 * A transport-level failure: the fetch itself threw (network error, DNS failure,
 * connection refused, timeout before response). This is distinct from the gateway
 * returning an HTTP error — that reaches us as a non-OK Response and maps through
 * `transport.mapError`. This catches the case where NO response was ever received.
 *
 * The caller retries these the same way as `StreamInterruptedError`: under auto-routing,
 * the turn is retried on another connected model. The model is unknown because the
 * failure happened BEFORE the gateway could commit to one.
 */
declare class TransportError extends Error {
    readonly model: string | undefined;
    /**
     * The gateway could not be reached at all, and stayed unreachable through every
     * backoff retry. Another model cannot help — none was ever asked — so the caller
     * reports the outage instead of retrying.
     */
    readonly unreachable: boolean;
    constructor(message: string, model?: string | undefined, options?: {
        cause?: unknown;
        unreachable?: boolean;
    });
}
/**
 * The model fell into a decoding loop — the same block of prose, verbatim, over and over
 * (`repetitionLoop.ts`). The stream is cut the moment it is seen instead of running to the
 * output ceiling while the reader watches one sentence repeat.
 *
 * An interruption like any other: the model is still answering, just uselessly, and only
 * the caller can route around it — so a caller that retries interrupted turns on another
 * model (the Brain run) does so here without knowing the difference. `kept` is what the
 * model said before it looped, for a caller that would rather show that than retry.
 */
declare class RepetitionLoopError extends StreamInterruptedError {
    readonly kept: string;
    readonly block: string;
    readonly copies: number;
    constructor(loop: {
        block: string;
        copies: number;
        kept: string;
    }, model: string | undefined);
}
/**
 * Stream a chat completion. Resolves once the stream ends with the stitched
 * final text and any tool calls the model requested.
 */
declare function streamChatCompletion(opts: StreamChatOptions, handlers?: StreamHandlers): Promise<StreamChatResult>;

/**
 * What a settled work run reports to learned routing — so a run in the editor teaches
 * the router the way a cloud run does: a change graded on whether it shipped, and a run
 * asked for a change that delivered none graded as the failure it was.
 *
 * Before this, only cloud runs were ever scored: an IDE run changed code, shipped it or
 * failed, and the router never heard. Now a run that changed code reports how its CODER
 * did — the model that made the edits (after an analysis→code hand-off, the coding model;
 * under a pin, the pinned one) — under the `code` role, which is exactly the evidence the
 * gateway reads when it picks the coder for the next run.
 *
 * Field names are the `POST /llm/v1/run-outcome` wire contract (`RunOutcomeRequest` in
 * `@builderforce/learned-routing`); the host owns the transport. Pure.
 */

interface BrainRunOutcome {
    /** Idempotency key — one outcome per run. */
    clientRunId: string;
    /** The model that made this run's code changes. */
    model: string;
    role: 'code';
    source: 'ide';
    terminalStatus: 'completed' | 'failed';
    /** The change landed on the base branch (the run's own push). */
    merged: boolean;
    /** Completed model turns — the efficiency half of the score. */
    steps: number;
    /**
     * What the run cost in millicents. Present ONLY as 0, and only when every completed turn was served by a
     * model on this machine (the hybrid local tier): that run was genuinely free and stays "priced at 0". An
     * unknown cost is ABSENT - never 0 - so a gateway or BYO run is not mistaken for a free one.
     */
    costMc?: 0;
    projectId?: number;
    /** The run failed because the TENANT ran out of quota/budget (the platform's one reading of that failure,
     *  `isTenantBudgetFailure`): stored, never taught to routing - it says nothing about the model. Present only when true. */
    quotaExhausted?: true;
    /** The run died on a provider rate limit / capacity ceiling (`isRateLimitFailure`, which already excludes a tenant
     *  budget): an AVAILABILITY fact that demotes the model without calling it a bad coder. Present only when true. */
    rateLimited?: true;
}

/**
 * STOP HOOKS — a host's say over whether a run may end.
 *
 * The loop's own end-of-run gates (`selfReviewShip.ts`, `previewReview.ts`, …) are the
 * platform's contracts. This is the seam for the WORKSPACE's: a host (the VS Code
 * extension reads them from a committed `.builderforce/hooks.json`) can hold a run that
 * is about to settle and hand it one more instruction — "update README and DONE with what
 * you completed", or "the lint you were told to keep green failed, here is its output".
 *
 * The loop owns only the BOUND and the re-prompt; what the hook says is the host's. Asked
 * every time the run is about to end, so a hook that re-checks (a failing command) gets
 * to see the run's fix — but never more than {@link MAX_STOP_HOOK_ROUNDS} times per run:
 * a command that can never pass must not keep a run alive on the tenant's money.
 *
 * Runs BEFORE the ship gate on purpose: whatever a stop hook asks for (docs, a changelog
 * line, a formatter's fixes) is part of the change, so it lands in the same commit
 * instead of being left dirty after the push.
 */
/** What the host is told about a run that is about to end. */
interface RunStopInput {
    /** The run changed code in this turn (or a resumed turn). */
    codeChanged: boolean;
    /** Workspace-relative files the run touched, in order. */
    touchedFiles: readonly string[];
    /** The user's request that started the run. */
    requestText: string;
    /** How many stop-hook re-prompts this run has already had. */
    round: number;
}
/**
 * A host's stop hook: a non-empty string holds the run and becomes its next user turn;
 * null / undefined / '' lets it settle.
 */
type RunStopHook = (input: RunStopInput) => Promise<string | null | undefined>;
/** Re-prompts one run can receive from stop hooks before it is allowed to settle. */
declare const MAX_STOP_HOOK_ROUNDS = 4;
/**
 * Ask the host's stop hook whether the run may end. Returns the nudge to re-prompt with,
 * or null to let it settle. Best-effort: a throwing hook never fails or holds the run.
 */
declare function askStopHook(hook: RunStopHook | undefined, input: RunStopInput): Promise<string | null>;

/**
 * A run with an OWNER — what makes a sub-agent a sub-agent, and nothing else.
 *
 * A delegated child is not a second kind of loop. It is an ordinary run of THIS store —
 * the same tools, gates, ticket backstop, failure-streak breaker and persistence as the
 * run that spawned it — given its own run key (its own transcript, Stop and approval
 * prompt) and this pointer back to who spawned it. Everything a child does differently
 * follows from the pointer:
 *
 *   • it lives in its OWNER'S conversation: every message it persists goes to the root
 *     chat, attributed to the child (`authoredBy`) and marked as whose sub-agent it is
 *     (`subagentOf`), so the chat reads as Owner and Agent (name), never as one voice;
 *   • its messages are progress inside someone else's work, so they are marked mid-turn
 *     (Evermind does not learn a child's report as the chat's answer);
 *   • it can itself spawn children — the pointer nests, which is all recursion needs.
 */

/** Who a child run is, and whose. */
interface RunLineage {
    /** The server chat the whole tree persists into — the top-level owner's chat. */
    rootChatId: number;
    /** The run key of the run that spawned this one (the root chat id for a top-level owner). */
    ownerKey: number;
    /** The owner's display name, as the chat shows it. */
    ownerName: string;
    /** Short handle the owner and the person address this child by (`a1`, `a2`, …). */
    handle: string;
    /** A few words naming the slice. */
    label: string;
    /** Who the child IS in the chat — a workspace agent it runs as, or a named helper. */
    agent: {
        ref: string;
        name: string;
    };
    /** 1 for a child of a top-level run, 2 for a grandchild, … */
    depth: number;
}
/** The server chat a run's rows are saved to: its owner's for a sub-agent, its own otherwise. THE one place that says so. */
declare const savedChatOf: (runKey: number, lineage?: RunLineage | null) => number;
/** Metadata key under which a child's message names its owner. */
declare const SUBAGENT_OF_META_KEY = "subagentOf";
/** What a persisted message says about the run that wrote it. */
interface SubagentOrigin {
    handle: string;
    owner: string;
    label: string;
}
/** The owner a persisted message was written for, or null for anything not a child's. */
declare function parseSubagentOrigin(msg: {
    metadata?: string | null;
}): SubagentOrigin | null;

/**
 * Chat MODE — "am I being asked a question, or being asked to get something done?"
 *
 * Two modes, one per conversation:
 *
 *   • `chat` — CONVERSATIONAL. The Brain reads, reasons and answers. It may look
 *     anything up, but it does not mint board work, staff it, or start runs off
 *     its own back. This is the default and the surface's resting state.
 *
 *   • `work`  — EXECUTIONAL. The Brain turns what it concludes into real work: it
 *     creates the ticket, scopes the resources, links it to the conversation,
 *     advances its status, and DISPATCHES an agent to run it. The conversation is
 *     the front end of an execution, not a discussion about one.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * The work-linking directive ({@link chatWorkLinkingDirective}) used to ride EVERY
 * run unconditionally — so "what does this error mean?" was answered by a model that
 * had also been instructed to open, staff and status a ticket about it. There was no
 * way to just ask a question, and no way to tell an execution apart from a chat after
 * the fact. Mode is the discriminator for both: it gates the directive at runtime and
 * it is recorded on the conversation, so usage can finally be read as
 * "conversations vs executions" rather than one undifferentiated pile.
 *
 * The value is persisted on the conversation (`brain_chats.mode`, `creation_sessions.mode`,
 * migration 0409) rather than in the browser, so the choice follows the conversation
 * across surfaces and devices — the same reasoning as `capability` (0345).
 *
 * Kept framework-free (pure strings + unions) so it is safe in every bundle: the web
 * Brain, the VS Code webview, and the shared agent loop all import from here.
 */
/** The modes a conversation can be in. Order is display order. */
declare const CHAT_MODES: readonly ["chat", "work"];
type ChatMode = (typeof CHAT_MODES)[number];
/**
 * The mode a NEW conversation opens in.
 *
 * Work, because that is what people come here to do: the measured reality is that a
 * conversation which cannot dispatch produces a plan and stops, and the user is then
 * asked to find a control they did not know existed to get the work started. Opening
 * in Work makes the product's actual promise the resting state; a user who only wants
 * to ask a question flips one switch in the composer's `/` menu.
 *
 * This is NOT the coercion fallback — see {@link RESTING_CHAT_MODE}. The two were one
 * constant, which meant "what does a new chat start as" and "what does an unreadable
 * stored value mean" could not be answered differently, and changing one silently
 * re-armed every legacy row that had never stored a mode at all.
 */
declare const NEW_CHAT_MODE: ChatMode;
/**
 * What an unset or unrecognised stored value resolves to: a conversation. A row that
 * never recorded a mode (or a client ahead of the server) must not be granted execution
 * authority by a default it never opted into.
 */
declare const RESTING_CHAT_MODE: ChatMode;
/**
 * The glyph for a mode. Decorative — the label always carries the meaning — but it
 * lives HERE, beside the mode vocabulary, because both composers render it: the web
 * `/` menu and the VS Code webview's `/` menu. A second copy in one host is how the
 * two surfaces end up showing a different icon for the same conversation state.
 */
declare const CHAT_MODE_ICON: Readonly<Record<ChatMode, string>>;
/** True for a value that is one of the known modes. */
declare function isChatMode(value: unknown): value is ChatMode;
/**
 * Coerce an inbound/stored value to a mode, falling back to {@link RESTING_CHAT_MODE}.
 * Tolerant by design: an unknown value (an older row, a client ahead of the server)
 * resolves to a conversation rather than silently granting execution authority.
 */
declare function normalizeChatMode(value: unknown): ChatMode;
/**
 * The system-prompt block for CHAT mode.
 *
 * Deliberately a positive instruction rather than only a prohibition: a model told
 * merely "do not create tickets" tends to hedge and offer to create one every turn,
 * which is the same interruption in a politer costume. This tells it what its job IS
 * — answer the question — and makes the ONE escape hatch explicit (the user asking
 * outright), so the mode is a default rather than a cage.
 */
declare function chatConversationDirective(): string;
/**
 * One agent invited into the chat, as the Work directive names it.
 *
 * Deliberately the three facts a dispatch decision needs and nothing else: the NAME the
 * human knows them by, the REF `chats.dispatch_agent` takes, and the ROLE that says
 * which work is theirs. Kept structural (no import from the chat-tickets view model) so
 * this module stays framework-free and every host can satisfy it from whatever it
 * already holds.
 */
interface ChatRosterAgent {
    ref: string;
    name: string;
    role?: string;
}
/**
 * The agent half of a chat's addressable participants, as the Work directive wants it.
 *
 * Every host that renders a recipient picker or an @-mention typeahead already holds
 * the participant list (agents AND humans, each with a ref and a display name). Rather
 * than have each of them fetch the roster a SECOND time to tell the run about it — two
 * reads of one endpoint on every chat open — they derive it from what they have. One
 * mapping, here, so the agents the user can @-mention are exactly the agents the run is
 * told it may dispatch to.
 *
 * Typed structurally (`{ kind, ref, name }`) rather than against `DirectedRecipient` so
 * this module keeps its no-dependency posture; the shapes are checked by the call sites.
 */
declare function chatRosterFromParticipants(participants: readonly {
    kind: string;
    ref: string;
    name: string;
}[] | undefined): ChatRosterAgent[];
/** What the Work directive needs to know about the surface and the chat it rides. */
interface ChatWorkDirectiveOptions {
    /** Does this run hold the workspace file tools (see `./localWorkspaceTools`)? */
    canEditHere?: boolean;
    /** Does the catalog carry `spawn_agent`, so persona delegation may be named? */
    canDelegate?: boolean;
    /** Does the catalog carry `spawn_agents`, so fan-out delegation may be named? */
    canFanOut?: boolean;
    /** The agents invited into this chat. Non-empty INVERTS the do-it-here ordering. */
    roster?: readonly ChatRosterAgent[];
}
/**
 * The system-prompt block for WORK mode: the existing chat⇄work linking contract
 * PLUS the dispatch obligation that makes the mode mean execution rather than
 * paperwork.
 *
 * The dispatch half exists because creating a well-staffed ticket and stopping is
 * indistinguishable, from the user's side, from doing nothing: the measured reality
 * is that tickets opened and never dispatched sit in backlog indefinitely. So the
 * mode's closing obligation is to REPORT the dispatch verdict truthfully — `tasks.create`
 * and `tasks.update` already return `autoRun: { dispatched, reason, detail }`, and
 * `chats.dispatch_agent` starts a run directly when autonomy declined.
 *
 * ── WHY `canEditHere` EXISTS ───────────────────────────────────────────
 * "Finish by dispatching" is the right obligation on the web Brain, which has no file
 * tools and can only get code changed by asking someone else to change it. On the IDE
 * surface it is not: that session HAS the workspace, and read as an unconditional rule
 * it sends the agent to open a ticket and hire a remote builder for a one-line fix it
 * was already looking at — measured, on a small UI defect, as a whole turn spent
 * fighting a dispatch with the file untouched at the end of it.
 *
 * So the ordering is stated where the surface actually differs, driven by whether this
 * run was given code-change tools ({@link ./localWorkspaceTools}'s `CODE_CHANGE_TOOLS`,
 * which is the same set the "a code change is always tied to a ticket" backstop reads).
 * Doing the work still ends in a ticket — recording is not optional, it is just not a
 * substitute for doing.
 *
 * ── WHY `roster` OVERRIDES THAT ORDERING ─────────────────────────────────────────
 * `canEditHere` answers "could this session make the change", which is not the same
 * question as "whose change is it". A chat with agents INVITED INTO IT has already
 * answered the second one: a human opened the Agents panel and put Bob, John and the
 * Manager in this conversation, which is the platform's only way of saying "these are
 * the people I want on this work". Read without that fact, the do-it-here rule
 * quietly overrides the staffing the human just did — measured on chat #103, where
 * three invited agents watched an IDE session make every code change itself and the
 * run's staffing summary read `1 ticket filed · 0 dispatched`, with ZERO dispatch
 * attempts: the model never asked, because nothing had told it there was anyone to ask.
 *
 * Two things follow, and they are separate. First, the roster is NAMED in the prompt,
 * because "pick a capable agent" costs a discovery tool call that the do-it-here rule
 * gives the model no reason to spend — the agents were in the chat and invisible to the
 * run. Second, when the roster is non-empty the ordering INVERTS: the invited agents own
 * the work and this session dispatches to them. The do-it-here rule survives only for a
 * chat nobody has staffed, which is the case it was written for.
 *
 * Tool names here are the ADVERTISED (`builtin_*`) names the model actually sees on
 * the gateway relay — never the catalog ids, which appear nowhere in its tool list.
 * The roster is rendered as names AND refs because the model reads the name and
 * `builtin_chats_dispatch_agent` takes the ref.
 */
declare function chatWorkDirective(chatId: number | null, opts?: ChatWorkDirectiveOptions): string;
/**
 * The system-prompt block for a mode. This is the ONE place a mode becomes model-facing
 * behaviour, so the two surfaces (web Brain, VS Code webview) and the shared agent loop
 * cannot drift on what a mode means.
 */
declare function chatModeDirective(mode: ChatMode, chatId: number | null, opts?: ChatWorkDirectiveOptions): string;

/**
 * Evermind memory hooks for the Brain run loop — the client half of "recall +
 * learn + reconcile, visible in the chat".
 *
 * A project-scoped Brain conversation now (a) RECALLS the project's learned
 * memories before answering and injects them into the prompt, and (b) surfaces
 * that its turn will be CONTRIBUTED back (and which recalled memories it
 * RECONCILES) — each as its own timeline step, the same way a Claude Code
 * `memory_recall` shows as a step. The heavy lifting (the corpus + the ranker)
 * lives server-side; the host injects a single {@link EvermindRunHooks.recall}
 * callback bound to the active chat's project, and the run loop
 * ({@link ./brainRunStore}) turns the result into the injected memory block plus
 * the recall/learn/reconcile trace events.
 *
 * The recall CONTRACT, the memory block and the reconcile rule are the Evermind
 * module's (`@seanhogg/builderforce-memory/evermind`); what lives here is the Brain's
 * own port — the hooks a host injects and the one server-backed implementation of them.
 */

/**
 * A memory-first answer that lets the run loop SKIP the paid model entirely — either
 * an exact-repeat Q&A cache hit or the project's Evermind SSM. Returned by the opt-in
 * {@link EvermindRunHooks.answer} hook; null means "memory can't answer, run the LLM".
 */
interface MemoryFirstAnswer {
    /** The answer text to adopt as the assistant turn. */
    text: string;
    /** Where it came from — drives the "no LLM" provenance/step. */
    source: 'qa-cache' | 'evermind';
    /** Evermind head version, when `source === 'evermind'`. */
    evermindVersion?: number;
    /**
     * WHICH Evermind answered (project id), when `source === 'evermind'`. A project can
     * target several heads (its own plus the IDE builds grouped under it), so without
     * this the timeline could not say which one served — and a chat whose OWN project
     * reports inference OFF could still be answered by a sibling head with no way to
     * tell. Recorded on the trace step so a memory hit is triageable.
     */
    evermindProjectId?: number;
}
/**
 * The hooks a host injects into the run loop. Bound to the active chat's project.
 * `recall` grounds the answer (RAG); the OPTIONAL `answer`/`cacheAnswer` pair adds the
 * memory-first short-circuit — answer from the project's own memory (Q&A cache or
 * Evermind) BEFORE spending a model call, and remember a fresh (question→answer) pair
 * so the next exact repeat is free. All return null / no-op when the chat isn't
 * project-scoped or memory is unavailable, so the loop simply falls through to the LLM.
 */
/** Where a run is driven from — the usage ledger's `surface` vocabulary, declared once. */
type MemorySurface = UsageSurface;
/** How a memory-first answer is asked for. */
interface MemoryAnswerOptions {
    /** Whether THIS run can call tools — see {@link EvermindRunHooks.answer}. */
    toolsAvailable: boolean;
    /** The model the run would otherwise call, for pricing a saving. */
    model?: string;
    /** A verification read (the compaction recall probe): answered, but no saving is
     *  recorded, because no model call was ever going to happen. */
    probe?: boolean;
}
/** What producing a cached answer cost — recorded with it (`project_facts.origin_*`). */
interface AnswerOriginCost {
    model: string;
    promptTokens: number;
    completionTokens: number;
}
/**
 * A file a cached answer was about. `contentHash` when the host knows it; otherwise the
 * server stamps it from its directory index at write time, and a later change to that
 * file makes the cached answer stale instead of replayable.
 */
interface AnswerFileAnchor {
    path: string;
    contentHash?: string;
}
interface EvermindRunHooks {
    /** Recall the project's learned memories most relevant to `query`. */
    recall(query: string): Promise<EvermindRecallResult | null>;
    /**
     * Try to answer `query` from memory WITHOUT the LLM; null → run the model.
     *
     * `opts.toolsAvailable` tells the resolver whether THIS run can call tools. It must
     * be honest: the Evermind SSM has no tool-calling, so when tools are available the
     * server serves only the Q&A cache (a replay of an answer a real model produced) and
     * never a fresh SSM generation — otherwise a request whose answer lives behind a tool
     * call ("which tickets are in the backlog?") gets answered from stale weights while
     * the tools that could answer it are never called.
     */
    answer?(query: string, opts: MemoryAnswerOptions): Promise<MemoryFirstAnswer | null>;
    /**
     * Remember a (question → answer) pair so an exact repeat short-circuits next time.
     * `origin` is what producing the answer cost (the run's served model + summed tokens):
     * stored with it, so each replay's saving is a recorded figure, not an estimate.
     * `fileAnchors` are the files the turn read: the server drops the cached answer once
     * one of them changes. Absent → the server-backed hooks derive them from the paths
     * the answer cites ({@link citedPathAnchors}).
     */
    cacheAnswer?(query: string, answer: string, origin?: AnswerOriginCost, fileAnchors?: AnswerFileAnchor[]): void | Promise<void>;
}
/**
 * The host's authenticated JSON transport, as a port. Both Brain hosts already have
 * one (`apiRequest` on the web, the webview's `authedFetch`); this is the intersection
 * the memory hooks need, so neither has to hand it a bespoke wrapper.
 */
type ProjectMemoryRequest = <T>(path: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}) => Promise<T>;
/**
 * The project's SERVER-side memory hooks, built once for every host.
 *
 * The three calls — recall, memory-first answer, write-through — are the same routes
 * with the same query parameters and the same "a failure is not an error, it is just
 * no memory" contract wherever the Brain runs. They were hand-written per host, and
 * the copies had drifted: the web surfaces passed only `recall` (one of them plus a
 * `learn` callback this interface has never had, so it was dead), while only the VS
 * Code webview had the memory-first pair at all. Same loop, three different memories.
 *
 * `toolsAvailable` is threaded through honestly, because the server uses it to decide
 * whether the Evermind SSM leg may run: it cannot call a tool, so on a run that could
 * fetch the real answer it must never pre-empt the model from stale weights.
 */
declare function projectMemoryHooks(projectId: number, request: ProjectMemoryRequest, 
/**
 * The chat these hooks are bound to, when the host knows it.
 *
 * Recall is TIERED on it: this conversation's own memories come first, then the
 * wider project's. Without it the server ranks project-wide, which is what made a
 * reopened chat "remember" turns from other conversations. Optional because a global
 * (project-less) chat and the non-chat callers genuinely have none — those recall
 * project-wide exactly as before.
 */
chatId?: number | null, 
/** Which surface the run is driven from — recorded on the saving a memory answer
 *  makes, so "saved" splits by editor / web / browser like "spent" does. */
surface?: MemorySurface): EvermindRunHooks;

/**
 * THE context-window resolver for a hand-off target — how many tokens the model about to
 * serve can hold, or `undefined` when nobody knows.
 *
 * A local ref (`local/<runtime>/<model>`) is answered by the runtime's own live report
 * (a probe's `contextTokens`) first, then by the shipped catalog row (`LOCAL_MODEL_CATALOG`
 * — the WebLLM 4k rows, Bonsai 32k/65k). A cloud ref is answered only by what the host
 * already knows (`sources.cloud`): `@builderforce/model-catalog` carries no window, and a
 * guessed one would shrink a 200k model's transcript for nothing. Unknown means "keep
 * today's budget" — the gateway fits a cloud request to a model that can hold it.
 */

/** Where a window may come from. Every source is optional. */
interface ModelWindowSources {
    /** Live local runtime probes (or their flattened models). A runtime's own report wins
     *  over the catalog: an Ollama model can be loaded with a different `num_ctx`. */
    probes?: readonly LocalRuntimeProbe[];
    models?: readonly LocalModel[];
    /** The host's own knowledge of a cloud model's window (a gateway catalog), if any. */
    cloud?: (ref: string) => number | undefined;
}
/** The model's context window in tokens, or undefined when unknown. */
declare function contextWindowOf(modelRef: string | undefined, sources?: ModelWindowSources): number | undefined;
/**
 * What a run lends its window-fit gate. The same sources as {@link ModelWindowSources},
 * except the probes are READ ON DEMAND: probing a local runtime is only worth doing for
 * a local target, and a run lives longer than any one probe.
 */
interface RunWindowSources {
    /** The host's own knowledge of a cloud model's window — its gateway catalog. */
    cloud?: (ref: string) => number | undefined;
    /** The live local runtimes, asked only when the target is a local ref. */
    probes?: () => readonly LocalRuntimeProbe[] | Promise<readonly LocalRuntimeProbe[]>;
}
/** {@link contextWindowOf} over a run's sources. A probe that fails leaves the catalog row. */
declare function resolveContextWindow(modelRef: string | undefined, sources?: RunWindowSources): Promise<number | undefined>;

/** What one completed run did, as the note format understands it. */
interface RunActivity {
    /** Paths the run created. Duplicates are collapsed. */
    created?: readonly string[];
    /** Paths the run modified. Duplicates are collapsed. */
    edited?: readonly string[];
    /**
     * Paths the run READ. The note lists the most-read few, so the next run in this
     * workspace sees where the last one had to look; duplicates are kept here because
     * how often a file was re-read is how much the run depended on it.
     */
    read?: readonly string[];
    /** Paths the run deleted. Duplicates are collapsed. */
    deleted?: readonly string[];
    /** Tool names the run invoked. Duplicates are collapsed. */
    tools?: readonly string[];
    /**
     * The run's own prompt — what it was asked to do. When present, the summary
     * describes THAT rather than falling back to a fixed template, so two runs
     * that both edited a test file do not read as the same "Test suite created".
     */
    prompt?: string;
}

/**
 * run-knowledge — the TOOL VOCABULARY of a run's memory.
 *
 * Short-term vs long-term memory is a memory concept and lives in
 * `@seanhogg/builderforce-memory/working`: {@link WorkingMemory} is what this run has
 * read, searched and changed (restated before every turn by its `brief`), and
 * `consolidate` / `mergeConsolidated` turn it into the per-area code map the next run
 * recalls. That package knows observations, never tool names.
 *
 * This module is the one place that maps the platform's tool names onto those
 * observations — every runtime's spelling (shared `write_file`, on-prem native
 * `write`/`create`, …) — so the editor, on-prem and the cloud engine record a run the
 * same way. {@link RunKnowledgeRecorder} is that adapter: it owns the run's
 * {@link WorkingMemory} and the tool names a run note lists.
 */

/**
 * The recorder's CONTRACT — what a loop or host hands across a package boundary. A
 * structural interface, not the class: a bundled `.d.ts` (brain-embedded's) carries its
 * own copy of a class, and two copies of a class with private fields are different
 * types, so a host's recorder could not be passed to the loop by its class.
 */
interface RunKnowledgeLog {
    setPrompt(prompt: string): void;
    record(name: string, args?: unknown): void;
    readonly isEmpty: boolean;
    readonly activity: RunActivity;
    /** The short-term brief for the next turn (`WorkingMemory.brief`), or null while not worth it. */
    brief(): string | null;
    /** The long-term code map this run consolidates into (`consolidate`), or null. */
    consolidate(opts?: ConsolidateOptions): ConsolidatedMemory | null;
}

/**
 * The deterministic-first PreFetch contract (docs/design/deterministic-prefetch.md).
 *
 * Actions are REGISTRY DATA. A host supplies one executor per action id; the gate never
 * runs a tool itself. A new tool is a registry row plus an executor, never a gate branch.
 */
type PrefetchKind = 'answer' | 'prefetch';
/** write ⇒ always a confirm chip, never auto-run, whatever p is. */
type SideEffect = 'read' | 'write';
type PrefetchSurface = 'vscode' | 'onprem' | 'cloud' | 'web';
type GateTier = 1 | 2 | 3;
type GateRoute = 'answer' | 'prefetch' | 'llm';
interface PrefetchAction {
    /** 'symbols.where-defined', 'dup.check', 'knowledge.review-dir', … */
    id: string;
    kind: PrefetchKind;
    sideEffect: SideEffect;
    surfaces: PrefetchSurface[];
    /** Explicit composer slash action (tier 1), e.g. '/dup'. */
    slash?: string;
    /** Rule match (tier 1). */
    patterns?: RegExp[];
    /** Phrasings for tiers 2–3. */
    examples: string[];
    /** Hard executor deadline (withinMs). */
    budgetMs: number;
    /** Tool detection: the action is offered only when the host reports the tool present. */
    requires?: {
        tool: string;
    };
    /** i18n key for the confirm chip / trace label. */
    labelKey: string;
}
/** Per-action logistic head state (same family as difficulty-router/head.ts). */
interface ActionHead {
    weights: number[];
    bias: number;
    n: number;
}
/** Per-action calibrated thresholds; cold start is conservative (answer 0.9). */
interface ActionThreshold {
    answer: number;
    prefetch: number;
    n: number;
}
/** One logged outcome a threshold is recalibrated from: `[p, accepted ? 1 : 0, route]`. */
type LoggedOutcome = [p: number, accepted: 0 | 1, route: 'answer' | 'prefetch'];
interface CalibrationState {
    heads: Record<string, ActionHead>;
    thresholds: Record<string, ActionThreshold>;
    /** The newest outcomes per action (bounded), which `recalibrate` derives thresholds from. */
    outcomes?: Record<string, LoggedOutcome[]>;
}
/** Outcome written back after a decision: accepted, or the user re-asked the LLM. */
interface GateOutcome {
    actionId: string;
    route: GateRoute;
    p: number;
    tier: GateTier;
    accepted: boolean;
    features: number[];
}
/** Local-SLM logprob classifier (tier 3) — Synapse/bfi-node → WebLLM → Ollama last. */
interface LogprobPort {
    /** True only when a local engine is warm; tier 3 is skipped otherwise. */
    warm(): boolean;
    /** One forward pass; returns log-probabilities per label (labels = action ids + 'needs-llm'). */
    logprobs(prompt: string, labels: string[], signal?: AbortSignal): Promise<Record<string, number>>;
}
interface GatePorts {
    /** Tools present in this workspace (memoised per workspace by the host). */
    tools?: ReadonlySet<string>;
    surface: PrefetchSurface;
    calibration?: CalibrationState;
    logprob?: LogprobPort;
    signal?: AbortSignal;
    /** Total gate budget; tier 3 is skipped if the remainder is below its cost. Default 300 ms. */
    budgetMs?: number;
}
interface PrefetchResult {
    actionId: string;
    /** ANSWER: the settled reply (markdown). PREFETCH: context for host.turnContext (volatile tail). */
    text: string;
    /** Optional chips rendered under the answer (e.g. Open in graph). */
    chips?: Array<{
        labelKey: string;
        command: string;
        args?: Record<string, unknown>;
    }>;
    /** Extra trace fields (counts, digests). */
    data?: Record<string, unknown>;
    /**
     * ANSWER actions only: how sure the executor's OWN evidence is (0–1) — e.g. the
     * knowledge index's top hit. Absent ⇒ the result is an answer whenever it is adopted.
     * Present and below the action's learned answer threshold (`thresholdOf(...).answer`)
     * ⇒ the GATE does not settle on it: {@link context} (else `text`) rides into the turn
     * as PREFETCH context instead.
     */
    confidence?: number;
    /** What rides into the turn when the gate demotes this answer to PREFETCH; default `text`. */
    context?: string;
}
interface PrefetchExecutor {
    run(request: string, signal: AbortSignal): Promise<PrefetchResult | undefined>;
    /**
     * WRITE actions: what running it would touch, in one line, read BEFORE the person is
     * asked — the confirm chip's detail (`knowledge.review-dir`: files by pack, unchanged
     * files, ≈ model calls). Read-only; undefined ⇒ the chip shows the request alone.
     */
    preview?(request: string, signal: AbortSignal): Promise<string | undefined>;
}
type PrefetchExecutors = Readonly<Record<string, PrefetchExecutor>>;
/** What brain-embedded receives from a host (`BrainRunRequest.prefetch`): the registry, its executors and the gate ports. */
interface PrefetchPort {
    registry: readonly PrefetchAction[];
    executors: PrefetchExecutors;
    ports: Omit<GatePorts, 'signal'>;
    /**
     * Brings `ports` up to date before the gate reads them — e.g. the workspace's tool
     * detection, memoised by the host, finished the first time. Bounded by the gate
     * (`PREPARE_BUDGET_MS`); a late or failed prepare leaves the ports as they are.
     */
    prepare?(signal?: AbortSignal): Promise<void>;
    /**
     * Write actions: OVERRIDE how the person is asked. Absent ⇒ the run's own confirm
     * channel (the composer's confirm chip — brain-embedded's `prefetchGate.ts`); resolves
     * true only when the person confirms. `detail` is the executor's `preview`, when it has one.
     */
    confirm?(action: PrefetchAction, request: string, detail?: string): Promise<boolean>;
    /** Outcome write-back (head update + persistence of calibration). */
    record?(outcome: GateOutcome): void;
}

/**
 * MODEL PREFLIGHT (PRD 35 E7) — the run learns BEFORE turn 1 that a connected account
 * cannot serve it, instead of after a turn from `x-builderforce-byo-unresolved`.
 *
 * The host checks its BYO health (the VS Code client: the provider-key status reads,
 * which attempt the token refresh themselves) and hands back the unresolved entries in
 * the header's own `provider:reason` form. They are seeded into the run cell's
 * `byoUnresolved` — the SAME state the live banner reads — and recorded as a
 * `model.preflight` step, so the user sees "your Anthropic token expired; this run will
 * not use your own model" up front, and diagnostics can say why the run was weak.
 */

/** What a host's preflight found. Empty `byoUnresolved` = every connected account resolves. */
interface ModelPreflightResult {
    /** `provider:reason` entries, exactly as the gateway's header spells them. */
    byoUnresolved: readonly string[];
    /** The model the run will fall back to, when the host knows it. */
    fallback?: string;
}

/**
 * What the HOST hands a run before its first turn (PRD 35 E2 / E7), gathered in one
 * parallel wait: the recall hint (its context pack's focus files + headings), the task
 * context block, the files that block served whole, and the model preflight.
 *
 * Every part is best-effort. A part that throws costs that part, never the run — and the
 * reason is kept on the run's trace (`host.context_failed`) rather than swallowed.
 */

/** A file the host showed the model WHOLE, before the run read anything. */
interface ServedRead {
    /** Workspace-relative path, as `read_file` takes it. */
    path: string;
    /** The whole file, exactly as served. */
    content: string;
    totalLines: number;
}

/**
 * The run store's public contracts — what a host hands a run ({@link BrainRunRequest})
 * and what it observes ({@link BrainRunSnapshot}, {@link GlobalRunState}). Types only.
 */

/**
 * What a run cell is keyed by. A CHAT's run is keyed by its chat id (a number — the
 * key every chat surface, run driver and the cross-chat {@link GlobalRunState} speak).
 * A run that is not a chat's — a canvas session's turn, hosted through
 * `startEngineRun` — takes a string key (`canvas:<sessionId>`), so it shares the store's
 * single-flight claim, Stop, confirmation gate and live snapshot without being mistaken
 * for a chat.
 */
type RunKey = number | string;
/** Streaming fn shape (matches BrainRuntime.stream). */
type BrainStreamFn = (opts: Omit<StreamChatOptions, 'transport'>, handlers?: StreamHandlers) => Promise<StreamChatResult>;
/** Persistence subset the loop needs (matches BrainPersistenceAdapter). */
interface BrainRunPersistence {
    sendMessages(chatId: number, messages: Array<{
        role: string;
        content: string;
        metadata?: string;
        eventKey?: string;
    }>): Promise<BrainMessage[]>;
    /** Optional read-back: lets a late write ask whether the chat has moved on (`continueChat.ts`'s stopped answer). */
    getMessages?(chatId: number, limit?: number): Promise<BrainMessage[]>;
}
/** Everything a single run needs, captured at start time (survives navigation). */
interface BrainRunRequest {
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
    /** `signal` is passed for a call the person's steer may interrupt (a foreground
     *  command); otherwise the host lends the call the run's own Stop. */
    runTool?: (name: string, args: unknown, signal?: AbortSignal) => Promise<unknown>;
    /** Pure predicate: true → pause the loop for an explicit user confirmation. */
    needsConfirm?: (req: {
        name: string;
        args: unknown;
    }) => boolean;
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
     * Told once, at run end, how the run ended and under which run id its calls were
     * recorded (`runEndOutcome.ts`) — the host stores it beside its usage ledger for the
     * pipeline route report. Also told, on the chat's NEXT request, whether a PreFetch
     * decision made in the run was accepted (`gateAccepted`, the report's gate accuracy).
     * Omit and nothing is reported. Best-effort.
     */
    recordRunOutcome?: (end: RunOutcomeReport) => Promise<unknown> | void;
}
/** One report about a run's end (`outcome`) or its PreFetch decision (`gateAccepted`). */
interface RunOutcomeReport {
    runId: string;
    outcome?: RunEndOutcome;
    /** The PreFetch decision this run made was accepted (the next request did not re-ask). */
    gateAccepted?: boolean;
}
/** A model call a PreFetch ANSWER stood in for (`recordAvoidedCall`). */
interface AvoidedRunCall {
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
type RunEndOutcome = 'succeeded' | 'failed' | 'stopped' | 'budget-contained';
/** The host's per-phase models — absent phase ⇒ the gateway orders by role. */
type RunStageModels = Partial<Record<'plan' | 'code' | 'verify', string>>;
/** How a host wants its runs routed between the full pipeline and a quick pass. */
interface RunPipelineSettings {
    /** `auto` routes on the score; `always` keeps every run on the full pipeline. */
    routing: 'auto' | 'always';
    /** P(full) at or above which a run takes the full pipeline. Default 0.5. */
    threshold?: number;
    /** The model a quick run codes on. Absent ⇒ the code model, else the gateway's order. */
    quickModel?: string;
}
/** Live, observable snapshot of a chat's run (what the hook renders). */
interface BrainRunSnapshot {
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
    pendingConfirm: {
        name: string;
        args: unknown;
    } | null;
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
interface RunTurn {
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
interface GlobalRunState {
    running: number[];
    awaiting: number[];
}

/**
 * The words a person said that are not SAVED yet - kept on the device so a reload before the save lands (a slow
 * network, a closed tab, a timeout) does not lose them. Written when the words are first queued for a run
 * (`runSteering.ts`, AFTER they are in the inbox - a storage failure never costs a steer), cleared the moment they are
 * saved (the run's `persistSteer`, a continuation's save) or ended (every Stop), and replayed when the chat is next
 * opened (`useChatTranscript`) or the app starts (`BrainProvider`): saved under the key they were queued with, so a
 * save that did land is the same row, never a second.
 *
 * WHOSE words. The journal belongs to one signed-in person in one workspace: its key carries both
 * (`bf:pendingWords:<tenant>:<user>:<chatId>`), a host names them (`setPendingWordsOwner`), and signing out removes
 * the lot (`clearPendingWords`). With no owner there is no journal - the words are still kept in memory for the
 * session. An entry also expires (`TTL_MS`) and a chat holds at most `PER_CHAT_CAP`: a device is not an archive.
 *
 * WHICH SESSION. A second tab of the same person must not answer the first tab's words: an entry is replayed only
 * when the page load that wrote it is provably gone. Every page load holds a Web Lock named for itself for as long
 * as it lives (`navigator.locks`); another load replays an entry only if no one holds that lock. Where Web Locks
 * do not exist the load writes a heartbeat instead, and an entry whose heartbeat has gone quiet is dead.
 *
 * READ OR NOT. Words the model has already drained (`markPendingWordsRead`, by the run) were read by the run that
 * lost the page: replayed, they are saved as the mid-turn rows they were (`steerMetadata`) and do not prompt a second
 * answer. Words never drained replay as an ordinary pending user turn.
 *
 * Text only: a file the words carried was uploaded under its own key already. Every storage access is guarded - a
 * private window or a blocked profile simply has no journal - and nothing here throws.
 */

/**
 * Name whose words these are (null: signed out, no journal). Hosts call it as the signed-in identity changes. The moment
 * a person is known the app has started for them: every chat they left words in is replayed, not only the one opened.
 */
declare function setPendingWordsOwner(who: {
    tenant: string | number;
    user: string | number;
} | null): void;
/** The persistence the app-start replay saves through (null: the provider unmounted). Replays at once if the owner is known. */
declare function registerPendingWordsReplay(persistence: Pick<BrainRunPersistence, 'sendMessages'> | null): void;
/** Journal the words. Returns whether they are on the device: false means a reload before the save lands loses them. */
declare function rememberPendingWords(chatId: number, eventKey: string, text: string, savedTo?: number): boolean;
/** The words with these keys were saved, or ended (a Stop): they are no longer the device's to keep. */
declare function forgetPendingWords(chatId: number, eventKeys: ReadonlyArray<string | undefined>): void;
/** The model drained these (it has read them): if the page is lost now, they replay as what they became. */
declare function markPendingWordsRead(chatId: number, eventKeys: ReadonlyArray<string | undefined>): void;
/** Sign-out: nothing a person said stays on a device they have left (every owner's journal, and the heartbeats). */
declare function clearPendingWords(): void;
/**
 * Save the words a DEAD page load left unsaved, under the keys they were queued with (idempotent), then forget them.
 * Bounded; never rejects. One replay per chat at a time (a second asker shares it). Returns how many were saved.
 */
declare function replayPendingWords(chatId: number, persistence: Pick<BrainRunPersistence, 'sendMessages'>): Promise<number>;
/** The app started: replay every chat this person left words in, not only the one that happens to be opened. */
declare function replayAllPendingWords(persistence: Pick<BrainRunPersistence, 'sendMessages'>): Promise<number>;

export { type ImageUrlContentPart as $, type BrainDiagnostics as A, type BrainMessage as B, type ChatInputAttachment as C, type StaffingSummary as D, type Effort as E, type AnswerOriginCost as F, type GlobalRunState as G, type AssembledToolCall as H, type AvoidedRunCall as I, type BrainDiagnosticsContext as J, type BrainRunOutcome as K, type LocalFirstAccount as L, type BrainRunPhase as M, type BuildBrainTriageOptions as N, type ByoUnresolvedEntry as O, type ProjectMemoryRequest as P, CHAT_MODES as Q, type RunKey as R, type SpendSavingsSummary as S, CHAT_MODE_ICON as T, type UsageSurface as U, type ChatWorkDirectiveOptions as V, type CompletionMetadata as W, type DispatchRefusal as X, type EffortProfile as Y, type EvermindLearnOutcome as Z, type EvermindLearnTarget as _, type BrainRunSnapshot as a, formatBrainProvenance as a$, type LocalFirstAttemptSummary as a0, MAX_STOP_HOOK_ROUNDS as a1, type MemoryAnswerOptions as a2, type MemoryFirstAnswer as a3, type MemorySurface as a4, type ModelPreflightResult as a5, type ModelScore as a6, type ModelTurn as a7, type ModelWindowSources as a8, NEW_CHAT_MODE as a9, UNBACKED_TICKET_CLAIM_NOTICE as aA, UNBACKED_WRITE_CLAIM_NOTICE as aB, USAGE_SURFACES as aC, USAGE_SURFACE_HEADER as aD, type UpstreamTurnEvidence as aE, accountUsedInTrace as aF, activityTarget as aG, askStopHook as aH, attachEvermindLearn as aI, buildBrainTriageReport as aJ, byoReasonHint as aK, byoUnresolvedInTrace as aL, byoUnresolvedSummary as aM, chatConversationDirective as aN, chatModeDirective as aO, chatRosterFromParticipants as aP, chatWorkDirective as aQ, clearPendingWords as aR, computeBrainDiagnostics as aS, computeRunProgress as aT, contextWindowOf as aU, describeLiveStep as aV, detectAnnouncedButUnmadeToolCall as aW, detectUnbackedTicketClaim as aX, detectUnbackedWriteClaim as aY, effortProfile as aZ, formatBrainDiagnostics as a_, type PersonaSubagent as aa, type PrefetchResult as ab, RESTING_CHAT_MODE as ac, type ReasoningLevel as ad, type RepeatStreak as ae, type RepeatedTarget as af, RepetitionLoopError as ag, type RunLineage as ah, type RunOutcomeReport as ai, type RunPipelineSettings as aj, type RunStageModels as ak, type RunStopHook as al, type RunStopInput as am, type RunTurn as an, STEP_MESSAGE_ROLE as ao, SUBAGENT_OF_META_KEY as ap, type SavingsBreakdown as aq, type SavingsBySource as ar, type SavingsSourceKey as as, type ServedRead as at, type SpendBreakdown as au, StreamInterruptedError as av, type SubagentOrigin as aw, type TextContentPart as ax, type ToolExposure as ay, TransportError as az, type BrainTraceEvent as b, formatBytes as b0, formatDispatchRefusals as b1, formatEvermindLearnStep as b2, formatModelScorecard as b3, formatModelTurnLog as b4, formatStaffingSummary as b5, hasEditIntent as b6, isChatMode as b7, isDispatchTool as b8, isEffort as b9, streamChatCompletion as bA, summarizeLocalFirstAttempt as bB, toolActivity as bC, toolExposureInTrace as bD, workFiledNotStaffedVerdict as bE, forgetPendingWords as bF, markPendingWordsRead as bG, registerPendingWordsReplay as bH, rememberPendingWords as bI, replayAllPendingWords as bJ, replayPendingWords as bK, isEvermindModel as ba, isFailedToolResult as bb, isMutationTool as bc, isStepMessage as bd, isTicketWriteTool as be, isUsageSurface as bf, localFallbackTrace as bg, midRunNotice as bh, modelFailoversInTrace as bi, modelScorecard as bj, modelTurnLog as bk, modelsUsedInTrace as bl, narratedUnadvertisedInTrace as bm, normalizeChatMode as bn, parseByoUnresolved as bo, parseSubagentOrigin as bp, projectMemoryHooks as bq, reasoningForRun as br, resolveContextWindow as bs, savedChatOf as bt, serverChatIdOf as bu, setPendingWordsOwner as bv, shortenTarget as bw, staffingSummaryInTrace as bx, stallRecoveriesInTrace as by, stallUnrecoveredInTrace as bz, type BrainRunPersistence as c, type BrainRunRequest as d, type BrainTransport as e, type BrainChat as f, type BrainStreamFn as g, type RunEndOutcome as h, type CompletionUsage as i, type ChatCompletionMessage as j, type StreamChatOptions as k, type StreamHandlers as l, type StreamChatResult as m, type LocalFirstAttemptRecord as n, type LocalFirstAttempt as o, type LocalFirstWorkload as p, type EvermindRunHooks as q, type BrainToolSpec as r, type BrainModality as s, type ChatMode as t, type BrainRunActivity as u, type RunWindowSources as v, type ReasoningIntent as w, type ChatRosterAgent as x, type ContentPart as y, type RunProgress as z };
