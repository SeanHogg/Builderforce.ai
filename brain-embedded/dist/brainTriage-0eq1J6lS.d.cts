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

/**
 * A chat's VIEW KEY: the numeric id a chat is addressed by in this package (a local chat's
 * device-only key, or a server chat's own id). Not a LocalId (docs/design/typed-entity-ids.md
 * §3); an alias only — no field is renamed.
 */
type ViewKey = number;
/** A brain chat (conversation) record. */
interface BrainChat {
    id: ViewKey;
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
    /** Non-cancelled linked tickets below 100%. Absent on older servers (unknown, not 0). */
    ticketOpenCount?: number;
    /** Non-cancelled linked tickets at 100%. Absent on older servers (unknown, not 0). */
    ticketDoneCount?: number;
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
    /**
     * The chat's LOCAL client id (its local-first record id) — a projection, like `serverId`, set
     * on a chat this device holds. What a device-addressed call names a chat by when the platform
     * does not know it (the editor's ticket rail on a chat only on this machine). Absent on a chat
     * read from the server alone.
     */
    clientId?: string;
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
    /**
     * Who sent a human (role 'user') message - a fact of the message, stamped server-side from the
     * authenticated caller. The server answers the chat owner for a legacy row; null for assistant /
     * agent / system rows and for a message written on this device alone (the reader's own).
     */
    authorUserId?: string | null;
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
 * WHAT a failed model request looked like - the structured detail a stream interruption
 * carries, so a transcript and the editor's log name the destination, the phase it died in,
 * how long it waited and how big the request was, instead of just "sent nothing for 240s".
 *
 * Pure data + ONE describe function: triage (`brainTriage.ts`) and the host logs both read
 * `describeStreamFailure`, so the two can never word the same failure differently.
 */
interface StreamFailureDetail {
    /** `headers`: no response headers arrived. `body`: headers arrived, then silence or a drop. */
    phase: 'headers' | 'body';
    /** Where the request went: our gateway, or a provider reached directly (Kimi Code). */
    destination: {
        kind: 'gateway' | 'provider';
        label: string;
        host: string;
    };
    /** Milliseconds since the attempt started. */
    elapsedMs: number;
    /** The silence budget that tripped, when applicable. */
    idleMs: number;
    /** Length of the JSON request body. */
    requestBytes: number;
    messageCount: number;
    toolCount: number;
    /** Body phase: bytes of response received before the failure. */
    bytesReceived?: number;
    /** Whether a per-request credential lookup finished before the deadline. */
    credential?: 'resolved' | 'pending' | 'none';
}
/** One human line for logs and triage. */
declare function describeStreamFailure(d: StreamFailureDetail): string;

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
 * WHICH TASKS OF A HAND-OFF RUN SIDE BY SIDE — and why the rest do not.
 *
 * A slice that owns a parent directory blocks every slice beneath it. VS Code chat #70776:
 * task 1 owned `src/surface`, tasks 2–4 owned `src/surface/style`, `src/surface/features` and
 * one test under it. The old all-or-nothing rule saw the overlap, threw the clash away, and the
 * whole plan went inline silently — the planner was never told, so it never narrowed the paths,
 * and a plan whose overlap came LAST lost the parallelism its earlier tasks could have had.
 *
 * Two answers live here:
 *   • the clash itself ({@link planScopeClash}), named back to the planner ONCE so it can narrow
 *     each task's paths to what it actually changes ({@link scopeClashCorrective});
 *   • the split of a plan that still overlaps ({@link splitForParallel}): the leading tasks that
 *     own paths and are mutually disjoint run side by side; from the first task that overlaps
 *     (or owns none) onward, the coder runs them inline in plan order — order beats parallelism.
 *
 * Every child is a clone of its owner and nothing downstream restricts it, so this is where
 * slices are kept apart. Pure.
 */
/** What the split reads of a task. */
interface ScopedTask {
    title: string;
    paths: readonly string[];
}
/** Two tasks that claim the same path: `a` and `b` are titles, `path` the overlap. */
interface ScopeClash {
    a: string;
    b: string;
    path: string;
}
/** How one plan is carried out. */
type HandOffMode = 'parallel' | 'inline' | 'mixed';
interface ParallelSplit {
    /** Indexes of the tasks that run side by side, in plan order (empty or 2+). */
    parallel: number[];
    /** Indexes of the tasks the coder implements itself, in plan order. */
    inline: number[];
    /** The first overlap among the tasks that own paths — what kept the plan from running fully parallel. */
    clash: ScopeClash | null;
}
/**
 * Whether the WHOLE plan can run side by side: two or more tasks, every one owning paths, and
 * no two owning the same file.
 */
declare function canRunInParallel(tasks: readonly ScopedTask[]): boolean;
/** How a plan was carried out: which tasks ran side by side, which the coder took, and the overlap that decided it. */
interface HandOffDecision {
    mode: HandOffMode;
    parallelTasks: string[];
    inlineTasks: string[];
    clash: ScopeClash | null;
}

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
    /** How each hand-off ran (`hand_off.mode`): side by side, inline or mixed, and the overlap that decided it. */
    handOffModes?: HandOffDecision[];
    /** Plans sent back once because their tasks' paths overlapped (`hand_off.scope_clash`). */
    handOffClashesRefused?: number;
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
    /** Of those, the ones filed with the editor's device-local create: on this machine, not yet on the account's board. */
    filedLocally: number;
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
     *  - `filed-locally`     — every ticket was filed on this device; the session and its local sub-agents run the
     *                           work here, and the tickets sync to the account when sync is on (the import never staffs).
     *  - `staffing-refused`  — somebody was asked and the platform said no.
     */
    verdict: 'no-work-filed' | 'staffed' | 'filed-not-staffed' | 'filed-locally' | 'staffing-refused';
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
 * failure. A REAL create links its own chat in the same call (the host stamps the chat
 * and the server — or the editor's local store — links it), so a claim with no
 * successful create/link tool means nothing was actually filed or linked. Pure over the recorded trace + visible messages, so both copy surfaces flag
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
/**
 * A TOOL turn the model answered IN PROSE with zero tool calls: the turn was handed
 * tools, wanted one, but replied with text instead of a structured call — and nothing
 * downstream ran. Recorded per-turn by the run loop as `answeredInProse` (only it holds
 * both the turn's text and the exact tool set it was offered).
 *
 * This is the turn-level twin of {@link narratedUnadvertisedInTrace}: that one names a
 * tool the selection dropped (our fault), while this one flags a turn that HAD tools and
 * still answered in prose (a model/provider fault — the model is describing work instead
 * of doing it). A run made of these used to score "healthy": no errors, no truncation,
 * no context pressure — while accomplishing nothing.
 */
declare function answeredInProseInTrace(events: BrainTraceEvent[]): boolean;
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
/**
 * The remediation for a role-gate refusal, stated once here so the report and every
 * surface agree on the advice.
 */
declare const ROLE_GATE_REMEDIATION = "Re-select the workspace or ask a manager to raise your role.";
/**
 * Parse a `BuiltinToolForbiddenError` message — the API's role gate for mutating
 * built-in tools throws exactly one shape
 * (`'tasks.create' changes workspace data and requires at least the 'developer' role (caller has 'contributor')`
 * — `api/.../builtinToolAuthority.ts`), but nothing about it was STRUCTURED, so a run
 * that died on a role gate read as an unexplained refusal. Returns both roles, or nulls
 * for any other message — a parser that guesses on unrelated text manufactures causes.
 */
declare function parseRoleGateRefusal(message: string | null | undefined): {
    requiredRole: string | null;
    callerRole: string | null;
};
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
        failure?: StreamFailureDetail;
        requiredRole?: string;
        callerRole?: string;
        remediation?: string;
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
     * True when at least one TOOL turn was handed tools but answered IN PROSE with zero
     * tool calls — the model described the work instead of doing it, and nothing ran.
     * A run made only of these used to score "healthy" (no errors, no truncation, no
     * pressure) while accomplishing nothing. See {@link answeredInProseInTrace}.
     */
    answeredInProse: boolean;
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
    likelyCause: 'memory-answered' | 'no-tools-advertised' | 'tool-not-advertised' | 'tool-calls-not-emitted' | 'answered-in-prose' | 'no-progress' | 'context-exhaustion' | 'model-degradation' | 'app-errors-unresolved' | 'work-filed-not-staffed' | 'inconclusive' | 'healthy';
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

export { detectUnbackedTicketClaim as $, USAGE_SURFACES as A, type BrainTraceEvent as B, type ChatInputAttachment as C, type DispatchRefusal as D, type EvermindLearnOutcome as E, USAGE_SURFACE_HEADER as F, accountUsedInTrace as G, type HandOffMode as H, activityTarget as I, answeredInProseInTrace as J, attachEvermindLearn as K, buildBrainTriageReport as L, type ModelScore as M, byoReasonHint as N, byoUnresolvedInTrace as O, type ParallelSplit as P, byoUnresolvedSummary as Q, type RunProgress as R, type StreamFailureDetail as S, canRunInParallel as T, type UsageSurface as U, type ViewKey as V, computeBrainDiagnostics as W, computeRunProgress as X, describeLiveStep as Y, describeStreamFailure as Z, detectAnnouncedButUnmadeToolCall as _, type BrainMessage as a, detectUnbackedWriteClaim as a0, formatBrainDiagnostics as a1, formatBrainProvenance as a2, formatBytes as a3, formatDispatchRefusals as a4, formatEvermindLearnStep as a5, formatModelScorecard as a6, formatModelTurnLog as a7, formatStaffingSummary as a8, hasEditIntent as a9, isDispatchTool as aa, isEvermindModel as ab, isFailedToolResult as ac, isMutationTool as ad, isStepMessage as ae, isTicketWriteTool as af, isUsageSurface as ag, midRunNotice as ah, modelFailoversInTrace as ai, modelScorecard as aj, modelTurnLog as ak, modelsUsedInTrace as al, narratedUnadvertisedInTrace as am, parseByoUnresolved as an, parseRoleGateRefusal as ao, serverChatIdOf as ap, shortenTarget as aq, staffingSummaryInTrace as ar, stallRecoveriesInTrace as as, stallUnrecoveredInTrace as at, toolActivity as au, workFiledNotStaffedVerdict as av, type RoutingByRole as aw, type BrainRunActivity as b, type BrainChat as c, type SpendSavingsSummary as d, type BrainModality as e, type ScopeClash as f, type HandOffDecision as g, type BrainDiagnostics as h, type StaffingSummary as i, type BrainDiagnosticsContext as j, type BrainRunPhase as k, type BuildBrainTriageOptions as l, type ByoUnresolvedEntry as m, type EvermindLearnTarget as n, type ModelTurn as o, type PersonaSubagent as p, ROLE_GATE_REMEDIATION as q, type RepeatStreak as r, type RepeatedTarget as s, STEP_MESSAGE_ROLE as t, type SavingsBreakdown as u, type SavingsBySource as v, type SavingsSourceKey as w, type SpendBreakdown as x, UNBACKED_TICKET_CLAIM_NOTICE as y, UNBACKED_WRITE_CLAIM_NOTICE as z };
