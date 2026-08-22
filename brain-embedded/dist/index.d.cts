import * as react_jsx_runtime from 'react/jsx-runtime';
import { ChatErrorAction } from './chatError.cjs';
export { BrainRequestError, ChatErrorActionKind, brainRequestError, chatErrorAction } from './chatError.cjs';
export { ModelFallbackSurface, announcesUntakenAction, catalogToolNamesMentionedIn, claimsMissingToolData, nextFallbackModel, toolNamesMentionedIn } from '@builderforce/agent-stall';

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
     * What this chat is FOR — `'chat'` (a conversation: read, reason, answer) or
     * `'work'` (an execution: create, staff and link the ticket, then dispatch an agent
     * to run it). Migration 0409. Absent on a host/server that predates the column;
     * {@link normalizeChatMode} resolves that to the default.
     */
    mode?: string | null;
    createdAt: string;
    updatedAt: string;
}
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
     *   `frozen` Evermind is read-only · `too-short` no teachable assistant text.
     */
    reason?: 'not-attached' | 'not-seeded' | 'frozen' | 'too-short' | null;
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
}
/**
 * Caller-supplied provenance for a completion, forwarded to the gateway as the
 * request body's `metadata` object. Every field is optional; the server treats a
 * missing `chatId` as "not chat traffic" and records nothing.
 */
interface CompletionMetadata {
    /** The Brain chat this completion is serving — the audit emit's switch. */
    chatId?: number;
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
}
interface StreamChatOptions {
    messages: ChatCompletionMessage[];
    tools?: BrainToolSpec[];
    tool_choice?: 'auto' | 'none';
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
}
interface StreamChatResult {
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
}
/**
 * Stream a chat completion. Resolves once the stream ends with the stitched
 * final text and any tool calls the model requested.
 */
declare function streamChatCompletion(opts: StreamChatOptions, handlers?: StreamHandlers): Promise<StreamChatResult>;

/**
 * Chat/message persistence the host provides. Mirrors the Builderforce
 * `/api/brain` client surface; any backend conforming to these signatures works.
 */
interface BrainPersistenceAdapter {
    listChats(params?: {
        projectId?: string;
        limit?: number;
        offset?: number;
    }): Promise<BrainChat[]>;
    getChat(id: number): Promise<BrainChat>;
    createChat(body: {
        title?: string;
        projectId?: number | null;
        capability?: string | null;
        mode?: string | null;
    }): Promise<BrainChat>;
    updateChat(id: number, body: {
        title?: string;
        projectId?: number | null;
        visibility?: 'shared' | 'locked';
        capability?: string | null;
        mode?: string | null;
    }): Promise<BrainChat>;
    deleteChat(id: number): Promise<unknown>;
    summarizeChat(id: number): Promise<{
        summary: string;
    } | {
        error: string;
    }>;
    getMessages(chatId: number, limit?: number): Promise<BrainMessage[]>;
    /** Subscribe to durable message invalidations for one chat. The callback carries
     * no data; the hook reconciles from persistence as the source of truth. */
    subscribeMessages?(chatId: number, onChanged: () => void): () => void;
    /** Advance the caller's unread high-water mark for a chat to `seq` (a message's
     * seq; omit to mark everything read). Called when a chat is OPEN/mounted so an
     * unread badge clears — on either surface, since it's the same server chat.
     * Optional: a guest/offline backend that has no unread concept simply omits it. */
    markChatRead?(chatId: number, seq?: number): Promise<unknown>;
    sendMessages(chatId: number, messages: Array<{
        role: string;
        content: string;
        metadata?: string;
    }>): Promise<BrainMessage[]>;
    /**
     * Record this viewer's thumb on one assistant reply (null clears it).
     *
     * `context` carries what the TRANSCRIPT knows and the server would otherwise have
     * to reconstruct — chiefly which MCP tool the rated turn executed. The server
     * joins it to the model on the reply's provenance and files a durable
     * `llm_action_ratings` row, so the press teaches the learned router which model is
     * good at which kind of work rather than only colouring a button.
     */
    setMessageFeedback(messageId: number, feedback: 'up' | 'down' | null, context?: {
        toolName?: string | null;
    }): Promise<unknown>;
    /**
     * Ask an invited agent participant to reply — a chat-scoped run that answers AS
     * the addressed agent and returns the posted assistant turn (attributed to it via
     * metadata.authoredBy). Called after a user directs a message to an @agent.
     * Optional: when absent, directing to an agent just posts the turn (legacy).
     */
    requestAgentReply?(chatId: number, input: {
        agentRef: string;
        agentName?: string;
    }): Promise<BrainMessage>;
    upload(file: File): Promise<{
        key: string;
        name: string;
        type: string;
    }>;
    uploadUrl(key: string): string;
    /**
     * Mint a short-lived, signature-authenticated public URL for an uploaded
     * object so an upstream LLM provider can fetch it without the tenant token.
     * Used for the rare image too large to inline as a data URL. Optional: when
     * absent, the conversation falls back to the (auth-scoped) text link.
     */
    signedUploadUrl?(key: string): Promise<string>;
}
interface BrainConfig {
    /** Auth + endpoint for the streaming gateway. */
    transport: BrainTransport;
    /** Chat/message persistence backend. */
    persistence: BrainPersistenceAdapter;
    /** Map a modality string to its default system prompt. Defaults to a generic prompt. */
    resolveSystemPrompt?: (modality: string) => string;
}
/** Resolved runtime: config plus a transport-bound streaming function. */
interface BrainRuntime {
    transport: BrainTransport;
    persistence: BrainPersistenceAdapter;
    resolveSystemPrompt: (modality: string) => string;
    /** Stream a completion through the configured transport. */
    stream(opts: Omit<StreamChatOptions, 'transport'>, handlers?: StreamHandlers): Promise<StreamChatResult>;
}
declare function BrainProvider({ config, children, }: {
    config: BrainConfig;
    children: React.ReactNode;
}): react_jsx_runtime.JSX.Element;
/** Consume the resolved brain runtime. Throws if no BrainProvider is mounted. */
declare function useBrainConfig(): BrainRuntime;

/**
 * ONE reading of an OpenAI-compatible `finish_reason`.
 *
 * A turn that ends without tool calls is not automatically a turn where the model
 * chose to speak. Two stop reasons mean the opposite — the model was INTERRUPTED
 * mid-output — and they need the opposite recovery from a normal empty answer:
 *
 *  - TRUNCATED: the response hit the output-token ceiling. Vendors spell this
 *    `length` (OpenAI-compatible), `max_tokens` (Anthropic) and `MAX_TOKENS`
 *    (Google). A tool call cut off here never reaches the caller at all, because
 *    its JSON arguments are incomplete — which is exactly how a canvas turn that
 *    was authoring a real artifact appears as "the model just didn't call a tool".
 *  - MALFORMED_TOOL_CALL: the model tried to call a tool and emitted arguments the
 *    provider could not parse (Gemini's `MALFORMED_FUNCTION_CALL`). Also an
 *    attempted action, not a spoken answer.
 *
 * Vendors are compared case-insensitively and by normalised shape so a new spelling
 * of the same condition does not silently degrade to "the model answered".
 */
type TurnInterruption = 'truncated' | 'malformed-tool-call';
/** The reason this turn was cut short, or `null` when it ended on its own terms. */
declare function turnInterruption(finishReason: string | null | undefined): TurnInterruption | null;
/** The response hit the output-token ceiling — its text and any tool call are incomplete. */
declare function isTruncatedTurn(finishReason: string | null | undefined): boolean;
/** The model attempted a tool call the provider could not parse. */
declare function isMalformedToolCall(finishReason: string | null | undefined): boolean;

/**
 * composerDirectives — the ONE compiler from the composer's toggles (Effort,
 * Browse-the-web) to the extra system-prompt directives a turn carries.
 *
 * ## Why it lives here
 *
 * There were two copies: `frontend/src/lib/brain/platformPrompt.ts` and a module-private
 * one inside `clients/vscode/webview/src/App.tsx`. They had already drifted three ways,
 * and each drift is a behaviour difference a user can feel:
 *
 *  1. **Effort prose vs. real params.** The web copy hardcoded the two effort sentences;
 *     the VS Code copy derived them from {@link effortProfile}, the same table that sets
 *     `max_tokens` and `reasoning.level`. Hardcoded prose can contradict the params it is
 *     supposed to describe. This version always derives.
 *  2. **A "think step by step" sentence.** The web copy still emitted it even though the
 *     same component sends a structured `reasoning.level` on the wire — two mechanisms for
 *     one intent, the weaker one invisible in the request. Dropped: Thinking is a real
 *     field ({@link reasoningForRun}), not a sentence.
 *  3. **A web-fetch tool name that does not exist.** One copy said `` `fetch_url` ``, the
 *     other `` `web.fetch` ``. The tool is advertised to the model as
 *     {@link WEB_FETCH_TOOL_NAME}. Naming a tool the model was never given is the exact
 *     documented failure that `api/scripts/check-prompt-tool-names.mjs` exists to stop —
 *     the model narrates a call it cannot make and the turn "succeeds". Both copies were
 *     wrong; this one is right, in one place.
 *
 * Pure, host-agnostic, no React: the two surfaces call this and render nothing of their
 * own.
 */

/**
 * The name the platform's web-fetch tool is ADVERTISED to the model under.
 *
 * The catalog id is `web.fetch`; the gateway advertises every builtin as
 * `builtin_<id with non-alphanumerics → _>` (api `toolNaming.ts` `advertisedName`). A
 * prompt must name the ADVERTISED name — a prompt naming the catalog id hands the model a
 * string that appears nowhere in its tool list, and the model responds by describing the
 * call instead of making it, with no error anywhere in the loop.
 */
declare const WEB_FETCH_TOOL_NAME = "builtin_web_fetch";
/** The composer toggles that compile into prompt directives. */
interface ComposerDirectiveOptions {
    /** Effort level; `balanced` (or absent) is neutral and contributes nothing. */
    effort?: Effort;
    /** Whether the "Browse the web" toggle is on for this turn. */
    web?: boolean;
}
/**
 * Compile the composer toggles into extra system-prompt directives, folded into the
 * Brain's ambient system context so a toggle actually changes how the next turn runs.
 *
 * Returns `''` when nothing is set — the neutral default, which must add no text at all
 * so a default turn's prompt is byte-identical to one from before the feature existed.
 * Blocks are joined with a blank line so each directive reads as its own instruction.
 */
declare function buildComposerDirectives(o: ComposerDirectiveOptions): string;

/**
 * useToolConfirmationGate — the ONE human-in-the-loop approval gate for the Brain.
 *
 * ## The subtlety this exists to preserve
 *
 * `needsConfirm` is captured ONCE, at run start, by the tool loop. So the flag it reads
 * must be a REF, not captured state: with plain state the callback the run is holding
 * keeps the value it had when the run began, and a user who ticks "auto-approve" mid-run
 * is prompted for every remaining tool call anyway — the reported "I checked the box and
 * still got three prompts" bug. The ref is the source of truth; the returned
 * `autoApprove` state exists only to drive the toggle's own rendering.
 *
 * That is exactly the kind of non-obvious invariant that does not survive being
 * hand-copied, and it was hand-copied: the web `BrainPanel` and the VS Code webview each
 * had their own ~25-line version. They had already drifted — the predicate's operands
 * were in opposite order, and only one of them persisted the setting — so the same
 * product decision ("does auto-approve stick between sessions?") was answered differently
 * on each surface by accident rather than on purpose.
 *
 * ## What is shared and what is injected
 *
 * The GATE LOGIC is shared: ref-backed liveness, the `mutating && !autoApprove` predicate,
 * and a referentially stable `needsConfirm`. PERSISTENCE is injected, because it is a real
 * per-host decision — a browser has `localStorage` scoped to the user's profile, a VS Code
 * webview's storage is partitioned and may be blocked outright. A host that passes no
 * `persistence` simply starts from `defaultOn` each session, which is a policy, not a
 * missing feature.
 */
/** Reads and writes the persisted auto-approve preference for one host. */
interface ToolConfirmationPersistence {
    /** Current stored preference, or `undefined` when nothing has been stored. */
    read(): boolean | undefined;
    /** Persist the preference. Must never throw — storage can be blocked. */
    write(on: boolean): void;
}
interface ToolConfirmationGateOptions {
    /**
     * Does this call mutate anything? Supplied by the host's tool registry — normally
     * `isMutating` from `useBrainActions()`. A throwing predicate must be treated as
     * mutating by its implementation (fail safe), which `BrainActionsContext` already does.
     */
    isMutating: (name: string, args: unknown) => boolean;
    /** Where to persist the preference. Omit for a session-only gate. */
    persistence?: ToolConfirmationPersistence;
    /** Value used when nothing is persisted yet. Defaults to `false` (always confirm). */
    defaultOn?: boolean;
}
interface ToolConfirmationGate {
    /** Whether auto-approve is on — for rendering the toggle ONLY, never for the gate. */
    autoApprove: boolean;
    /** Flip auto-approve. Takes effect immediately, including for a run already in flight. */
    setAutoApprove: (on: boolean) => void;
    /**
     * The predicate handed to `useBrainConversation({ needsConfirm })`. Referentially
     * stable across auto-approve changes — deliberately, so toggling it does not tear down
     * and restart the conversation.
     */
    needsConfirm: (req: {
        name: string;
        args: unknown;
    }) => boolean;
}
declare function useToolConfirmationGate(options: ToolConfirmationGateOptions): ToolConfirmationGate;
/**
 * A `localStorage`-backed {@link ToolConfirmationPersistence}, guarded so a blocked or
 * partitioned store degrades to "not persisted" instead of throwing during render.
 * `'1'`/`'0'` rather than JSON so an existing stored value keeps its meaning.
 */
declare function localStorageConfirmationPersistence(key: string): ToolConfirmationPersistence;

/**
 * Client-side image preparation for vision messages.
 *
 * Turns a user-picked / pasted image File into a `data:` URL the gateway can
 * inline straight into an `image_url` content part — downscaled and recompressed
 * so the request payload (and the provider's per-image budget) stays sane.
 *
 * Why downscale at all: frontier vision models cap the long edge around ~1568px
 * (anything larger is downsampled server-side anyway) and reject images past a
 * few MB of base64. Shrinking here keeps virtually every real screenshot/photo
 * inside the inline budget, so the rare oversize case is the ONLY one that needs
 * the signed-URL fallback (see useBrainConversation.attach).
 *
 * Browser-only (uses canvas). Returns null when run without a DOM (SSR) or for
 * a non-raster type (e.g. SVG/PDF) — callers fall back to the text-link path.
 */
interface PreparedImage {
    /** Inline `data:` URL when the recompressed image fits the budget. */
    dataUrl?: string;
    /** True when even the most-compressed encode exceeded the inline budget —
     *  the caller should upload the original and mint a signed URL instead. */
    tooLarge?: boolean;
}
/**
 * Prepare an image for an inline vision content part. Resolves with a `dataUrl`
 * when it fits the inline budget, `{ tooLarge: true }` when it doesn't even
 * after max compression, or `null` for non-raster / non-DOM inputs.
 */
declare function prepareImageDataUrl(file: File): Promise<PreparedImage | null>;

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
 * Everything here is pure + transport-agnostic (no fetch, no DOM) so it is unit
 * testable and shared verbatim by the web app and the VS Code webview.
 */
/** One learned memory the project's Evermind recalled for the current turn. */
interface EvermindRecallItem {
    /** Stable id of the learned memory (targets a specific contribution). */
    id: number;
    /** Readable snippet of the learned exemplar (or the task it answered). */
    text: string;
    /** Lexical relevance to the query, 0..1. */
    score: number;
}
/**
 * What a recall returns: the project's learning posture (so the loop knows
 * whether the turn will also be CONTRIBUTED) plus the recalled memories. Mirrors
 * the api `recallProjectEvermindMemory` response.
 */
interface EvermindRecallResult {
    /** True once the project has a base Evermind (version ≥ 1). */
    seeded: boolean;
    /** Current head version the recall ran against. */
    version: number;
    /** `connected` = runs/replies contribute back; `offline-frozen` = pinned, read-only. */
    mode: 'connected' | 'offline-frozen';
    /** Recalled memories, best-first. Empty when nothing lexically matched. */
    items: EvermindRecallItem[];
}
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
    answer?(query: string, opts: {
        toolsAvailable: boolean;
    }): Promise<MemoryFirstAnswer | null>;
    /** Remember a (question → answer) pair so an exact repeat short-circuits next time. */
    cacheAnswer?(query: string, answer: string): void | Promise<void>;
}
/**
 * Assistant text shorter than this isn't a teaching signal, so the server won't
 * contribute it. Mirrors `MIN_TEACH_CHARS` in the api's `brainEvermindLearning.ts`
 * so the "contributed to Evermind" step appears exactly when the server actually
 * contributes the turn — keep the two in sync.
 */
declare const EVERMIND_LEARN_MIN_CHARS = 40;
/**
 * Build the `[Evermind Memory]` block injected into the system prompt — the part
 * that makes recall REAL (it changes what the model sees), not just a UI badge.
 * Numbered so the model can cite/correct a specific learning. Returns '' when
 * there is nothing to inject.
 */
declare function formatEvermindMemoryBlock(items: EvermindRecallItem[]): string;
/**
 * How many recalled memories this answer RECONCILES — restates enough of, that
 * the contributed turn supersedes them. Pure heuristic over token overlap; used
 * only to surface the reconcile step, never to gate learning.
 */
declare function countReconciledMemories(items: EvermindRecallItem[], answer: string): number;

/** A capability a consumer exposes to the Brain (the MCP extension unit). */
interface BrainAction<A = unknown, R = unknown> {
    /** Globally-unique, flat snake_case (no dots) so it round-trips through the gateway. */
    name: string;
    description: string;
    /** JSON Schema for the action arguments (becomes the tool's `function.parameters`). */
    parameters: Record<string, unknown>;
    /**
     * Whether running this action changes state — drives the host's
     * confirm-before-mutate gate (see `useBrainConversation`'s `confirmTool`).
     * Use a predicate when mutation depends on the args (e.g. a dispatcher tool
     * that proxies both reads and writes). Defaults to read-only (no gate).
     */
    mutates?: boolean | ((args: A) => boolean);
    run(args: A): Promise<R> | R;
}
interface BrainActionsContextValue {
    /** Tool specs for every currently-registered action (for the model). */
    toolSpecs: BrainToolSpec[];
    /** Execute a registered action by name. Returns a recoverable error object for unknown tools. */
    runTool(name: string, args: unknown): Promise<unknown>;
    /** Whether the named action would mutate state for these args (false if unknown). */
    isMutating(name: string, args: unknown): boolean;
    /** Register a batch of actions; returns an unregister function. (Used by the hook.) */
    register(actions: BrainAction[]): () => void;
}
declare function BrainActionsProvider({ children }: {
    children: React.ReactNode;
}): react_jsx_runtime.JSX.Element;
/** Consume the registry (used by the Brain panel/conversation hook). */
declare function useBrainActions(): BrainActionsContextValue;
/**
 * Register page actions for as long as the calling component is mounted.
 *
 * The array does NOT have to be referentially stable. It used to — the contract
 * was a comment asking callers to `useMemo`, and one caller that did not (a
 * `useComponentLabel()` that returned a fresh function every render, feeding
 * `WidgetBrainBridge`'s memo) froze every navigation on the site. A contract a
 * caller can silently break, whose breach takes down the whole app, belongs in
 * the primitive instead: registration is keyed on the action NAMES, and the
 * handlers are read through a ref, so re-running with an equivalent array is
 * free and the registry never churns.
 *
 * If no provider is present (e.g. a route without the Brain) this is a no-op, so
 * pages can call it unconditionally.
 */
declare function useRegisterBrainActions(actions: BrainAction[]): void;

/**
 * The gateway MCP catalog — fetching it, and turning it into callable actions.
 *
 * A tenant registers MCP servers in the portal; the gateway advertises their tools at
 * `GET /llm/v1/mcp/tools` and relays calls at `POST /llm/v1/mcp/call` (server-to-server,
 * so the MCP secret never reaches the client). This is the whole of that logic, with NO
 * React in it.
 *
 * It lives apart from {@link useMcpExtensions} — which is now a thin hook over it —
 * because the catalog is the single largest determinant of whether the Brain can answer
 * anything at all, and it therefore has to be reachable from places React is not: the
 * headless VS Code probe that reproduces a chat run from a terminal, and the offline
 * scenario harness that asserts on what a run was offered. Two copies of "how do we
 * build the tool list" would be two copies of the thing most worth testing.
 */

/** One tool as the gateway advertises it. */
interface McpToolEntry {
    extensionId: string;
    tool: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    /** Whether the tool writes. Drives the confirm-before-mutate gate. Undefined
     *  (external MCP servers don't advertise it) ⇒ treated as mutating (fail safe). */
    mutates?: boolean;
}
/** What a tool call resolved to — handed to the caller's `onToolResult`. */
interface McpToolResultInfo {
    /** Flat advertised name the model called (e.g. `builtin_tasks_create`). */
    name: string;
    /** Owning server's tool name + extension id (the relay coordinates). */
    tool: string;
    extensionId: string;
    /** Whether the tool writes (advertised mutates, fail-safe true). */
    mutating: boolean;
    /** True when the relay call succeeded (no transport error / `{error}` result). */
    ok: boolean;
}
/**
 * Fetch the tenant's advertised MCP tools.
 *
 * THROWS on any failure rather than resolving to an empty list. That is deliberate: a
 * silent empty catalog leaves the Brain with zero data tools, so every answer degrades
 * to "I don't have that data" — indistinguishable, from the outside, from a weak model.
 * Callers record the reason (the hook publishes it to `mcpToolStatus`; the probe prints
 * it) so a zero is always explained.
 *
 * @param skipExtensionIds extensions the host already registers natively, so the Brain
 * doesn't get the same capability twice.
 */
declare function fetchMcpToolEntries(transport: Pick<BrainTransport, 'baseUrl' | 'getToken'>, skipExtensionIds?: readonly string[]): Promise<McpToolEntry[]>;
/**
 * Turn advertised catalog entries into {@link BrainAction}s whose `run()` posts the call
 * through the gateway relay. Pure over its inputs (module-level create-dedupe aside), so
 * the React hook, the headless probe and the offline harness all produce byte-identical
 * tool behaviour.
 */
declare function mcpActionsFrom(entries: readonly McpToolEntry[], transport: Pick<BrainTransport, 'baseUrl' | 'getToken'>, onToolResult?: (info: McpToolResultInfo) => void): BrainAction[];

interface UseMcpExtensionsOptions {
    /**
     * Extension ids to drop from the fetched tool list. A host that already
     * registers some of the gateway's tools natively (e.g. first-party platform
     * actions exposed under a `builtin` extension) passes those ids here so the
     * Brain doesn't get the same capability twice.
     */
    skipExtensionIds?: string[];
    /**
     * Called after every relay tool call resolves. Lets the host react to writes —
     * e.g. dispatch a "brain data changed" event so the page rendering that domain
     * refetches live instead of going stale. Replaces the per-cap announce wrapper
     * the app used to apply in its native manifest, so catalog tools refresh the UI
     * the same way. Kept generic (no app types) so the package stays portable.
     */
    onToolResult?: (info: McpToolResultInfo) => void;
}
declare function useMcpExtensions(options?: UseMcpExtensionsOptions): {
    loading: boolean;
    toolCount: number;
    error: string | null;
};

/**
 * The one conversion from a registered {@link BrainAction} to the OpenAI `tools[]` entry
 * the model is shown.
 *
 * It lived inline in the React actions registry, which was fine while the registry was
 * the only thing that ever needed it. It no longer is: a headless runner (the VS Code
 * probe, the offline scenario harness) assembles the same action list and must advertise
 * it identically — a second copy of this mapping would be a second definition of what
 * the model can see, which is the single fact those runners exist to reproduce.
 *
 * Type-only import of `BrainAction`, so nothing here pulls React into a Node process.
 */

/** Advertise these actions to the model. Order is preserved. */
declare function toolSpecsFor(actions: readonly BrainAction[]): BrainToolSpec[];

/**
 * Streaming parser for tool calls a model writes inline in its *text* output.
 *
 * Some models (and weaker gateway-routed ones) don't emit native OpenAI
 * `tool_calls` deltas — they write the call into the content stream as markup.
 * There is no single convention, so this handles every dialect seen in the wild:
 *
 *   <tool_call>delete_task<arg_key>id</arg_key><arg_value>75</arg_value></tool_call>
 *   <function_call>{"name":"delete_task","arguments":{"id":75}}</function_call>
 *   <tool_use>delete_task {"id":75}</tool_use>
 *   <invoke name="delete_task"><parameter name="id">75</parameter></invoke>
 *   <function=delete_task>{"id":75}</function>
 *
 * Left untouched that markup (a) renders as literal tags in the chat bubble — the
 * "garbled reply" symptom — and (b), worse, means the call NEVER executes, because
 * the agent loop only runs structured `toolCalls`. This filter lifts every dialect
 * into the same `AssembledToolCall` shape the native path produces AND strips the
 * markup from the visible text so only clean narration reaches the UI.
 *
 * It is a streaming filter: deltas arrive in arbitrary chunks (a tag can split
 * across two reads), so it holds back any text that is — or might be the start of —
 * an opening tag, emitting only text that is safe to display.
 *
 * Deliberately NOT handled: a bare ```json fenced block. A fenced block is far more
 * often legitimate content (the model showing the user a payload) than a call, and
 * swallowing those would eat real answers.
 */
/** A tool call lifted out of text, in the native `AssembledToolCall` shape. */
interface ParsedXmlToolCall {
    id: string;
    name: string;
    /** Raw JSON argument string (parse with `JSON.parse`). */
    args: string;
}
/**
 * Stateful streaming filter. Feed `push(delta)`; it returns the clean text safe
 * to display now (markup withheld). Call `flush()` once at end-of-stream.
 */
declare class XmlToolCallFilter {
    private buf;
    private inside;
    private insideName;
    private innerBuf;
    private clean;
    private calls;
    private seq;
    /** Close the call currently being accumulated and record it. */
    private commit;
    /** Feed a content delta; returns clean (markup-free) text to emit now. */
    push(delta: string): string;
    /** End of stream: flush held-back text and close any unterminated call. */
    flush(): string;
    /** The full clean text accumulated so far. */
    cleanText(): string;
    /** Tool calls lifted out of the text. */
    toolCalls(): ParsedXmlToolCall[];
}
/** One-shot convenience for non-streamed content (the no-reader fallback). */
declare function extractXmlToolCalls(raw: string): {
    text: string;
    toolCalls: ParsedXmlToolCall[];
};

interface BrainPageContext {
    /**
     * Active project, when the current page PINS the Brain to one project (the
     * IDE). Pinning also switches the docked Brain to that project's modality
     * coding persona and scopes its chats — so non-IDE pages that merely want the
     * Brain to be *aware* of the project they're viewing should set
     * `viewingProjectId` instead (it keeps the platform co-pilot persona).
     */
    projectId: number | null;
    /**
     * The project the user is currently looking at (e.g. the Tasks board scoped to
     * `?project=14`). Unlike `projectId`, this does NOT change the persona or pin
     * chats — it only tells the Brain to use this project as the default for
     * project-scoped actions when the user doesn't name one.
     */
    viewingProjectId: number | null;
    /** Active modality — drives the Brain's system prompt/persona. */
    modality: BrainModality;
    /** Extra system-prompt context appended for this page (e.g. the open file + content). */
    extraSystem?: string;
    /** Deep-link: open the drawer on this chat. */
    initialChatId?: number | null;
    /** Deep-link: one-shot prompt auto-sent when the drawer opens (e.g. the IDE
     *  `?prompt=` seed). Distinct from a pending-prompt handoff — this is published
     *  by a page effect, not read from storage. */
    initialPrompt?: string;
    /** Deep-link: one-shot work item to auto-link the opened chat to (the IDE
     *  `?ticket=<kind>:<ref>` seed). The docked Brain gets this as a direct prop; the
     *  floating drawer reads it here. */
    initialTicket?: {
        kind: string;
        ref: string;
    };
}
interface BrainContextValue extends BrainPageContext {
    open: boolean;
    setOpen(open: boolean): void;
    /** Merge partial page context (call from a page effect). */
    setContext(patch: Partial<BrainPageContext>): void;
    /**
     * The chat currently selected in the docked Brain. Lifted here so co-mounted
     * Brain instances (e.g. the IDE Designer left-panel and the floating drawer)
     * stay on the same conversation. Distinct from `initialChatId` (a one-shot
     * deep-link); this tracks the live selection.
     */
    activeChatId: number | null;
    setActiveChatId(id: number | null): void;
}
declare function BrainContextProvider({ children }: {
    children: React.ReactNode;
}): react_jsx_runtime.JSX.Element;
/** Read/update the ambient Brain context. Throws if no provider is mounted. */
declare function useBrainContext(): BrainContextValue;
/**
 * Safe variant for pages that may render with or without the Brain mounted.
 * Returns null instead of throwing when no provider is present.
 */
declare function useOptionalBrainContext(): BrainContextValue | null;

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
 * Tool names here are the ADVERTISED (`builtin_*`) names the model actually sees on
 * the gateway relay — never the catalog ids, which appear nowhere in its tool list.
 */
declare function chatWorkDirective(chatId: number): string;
/**
 * The system-prompt block for a mode. This is the ONE place a mode becomes model-facing
 * behaviour, so the two surfaces (web Brain, VS Code webview) and the shared agent loop
 * cannot drift on what a mode means.
 */
declare function chatModeDirective(mode: ChatMode, chatId: number): string;

/** The placeholder title `create()` stamps on an untitled chat. A chat still carrying
 *  it has never been named, so {@link deriveChatTitle}-based auto-titling may replace it
 *  (a user/seed-provided title never matches this and is left alone). */
declare const DEFAULT_CHAT_TITLE = "New chat";
/**
 * Derive a short, human chat title from the first user message — "what the chat is
 * about" — so a conversation stops showing as "New chat" the moment it starts. Pure and
 * LLM-free (no cost, instant, deterministic): first non-empty line, whitespace
 * collapsed, trimmed to ~60 chars on a word boundary. Returns '' when there's nothing
 * usable (so the caller leaves the placeholder in place).
 */
declare function deriveChatTitle(text: string): string;
interface UseBrainChatsOptions {
    /** Dropdown filter — id string, 'none', or null (all). Ignored when `pinnedProjectId` is set. */
    filterProjectId?: string | null;
    /** Project pages: lock the list (and new chats) to this project; no filter UI. */
    pinnedProjectId?: number | null;
    /**
     * Controlled active chat. When provided (not `undefined`), the active chat id
     * is owned by the caller instead of internal state — so two co-mounted Brain
     * instances (e.g. the IDE Designer left-panel and the floating drawer) can
     * share one selection via a common store. Pair with `onActiveChatChange`.
     */
    activeChatId?: number | null;
    /** Controlled-mode setter, called whenever the hook would change the selection. */
    onActiveChatChange?: (id: number | null) => void;
}
interface UseBrainChats {
    chats: BrainChat[];
    loading: boolean;
    error: string;
    activeChatId: number | null;
    activeChat: BrainChat | null;
    setError(msg: string): void;
    select(id: number | null): Promise<BrainChat | null>;
    /** Create a chat (defaults project to the active filter/pin) and select it. */
    create(opts?: {
        title?: string;
        projectId?: number | null;
        capability?: string | null;
        mode?: ChatMode;
    }): Promise<BrainChat | null>;
    rename(id: number, title: string): Promise<void>;
    /** Set (or clear, with null) what the chat is making. Persisted on the chat, so
     *  the choice follows the conversation across surfaces instead of the browser. */
    setCapability(id: number, capability: string | null): Promise<void>;
    /** Switch the conversation between CHAT (answer) and WORK (execute + dispatch).
     *  Persisted on the chat for the same reason `capability` is — the choice belongs
     *  to the conversation, not to the browser it was flipped in. */
    setMode(id: number, mode: ChatMode): Promise<void>;
    /**
     * Auto-name a still-untitled chat (title === {@link DEFAULT_CHAT_TITLE}) from its
     * first user message, so "New chat" becomes the topic once the conversation begins.
     * No-op when the chat was already given a real title (user rename / task seed), so it
     * never clobbers an intentional name. Wired to the conversation's first-turn hook.
     */
    autoTitle(id: number, firstUserText: string): Promise<void>;
    summarize(id: number): Promise<void>;
    remove(id: number): Promise<void>;
    assignToProject(id: number, projectId: number | null): Promise<void>;
    reload(): Promise<void>;
    /** Bump a chat to the top + refresh ordering after new activity. */
    touch(id: number): Promise<void>;
}
declare function useBrainChats(options?: UseBrainChatsOptions): UseBrainChats;

/**
 * Directed messages — addressing a chat turn to a participant, not the BRAIN.
 *
 * A BuilderForce chat is multi-party: alongside the BRAIN (the agent that
 * executes build/change requests) a chat can have other participants — invited
 * teammate agents and (in future) humans. Not every message is a directive for
 * the BRAIN to run: a user can @-tag a participant and simply talk to them. Such
 * a turn is a normal `user` message tagged with `{ addressedTo: {...} }` in its
 * metadata; the conversation loop reads that flag and does NOT start a BRAIN run
 * for it, while the transcript still shows who it was addressed to. An untagged
 * message (or one addressed to the BRAIN) runs the agent loop as before.
 *
 * This is the single source of truth for the convention, shared by the send path
 * (which skips the run), the auto-reply guard, and any surface that renders the
 * "→ recipient" badge.
 */
/** A non-BRAIN participant a message can be addressed to. */
interface DirectedRecipient {
    /** 'agent' = an invited teammate agent; 'human' = an invited person. */
    kind: 'agent' | 'human';
    /** Stable id/ref of the participant (an agentRef, or a user id/handle). */
    ref: string;
    /** Display name shown in the composer chip + the transcript badge. */
    name: string;
}
/** The metadata key that flags a user message as addressed to a participant. */
declare const ADDRESSED_TO_META_KEY = "addressedTo";
/** The metadata key that attributes an assistant turn to a specific participant
 *  (an invited agent that replied), rather than the default BRAIN. Mirrors
 *  {@link ADDRESSED_TO_META_KEY} on the answering side. */
declare const AUTHORED_BY_META_KEY = "authoredBy";
/** The participant that authored an assistant turn, or `null` for the BRAIN. */
declare function parseMessageAuthor(msg: {
    metadata?: string | null;
}): DirectedRecipient | null;
/**
 * Merge an `addressedTo` flag into a message's metadata object (preserving any
 * other keys, e.g. `attachments`). Returns a serialized string, or `undefined`
 * when there is nothing to store — ready to hand to `persistence.sendMessages`.
 */
declare function withDirectedMetadata(recipient: DirectedRecipient | null | undefined, base?: Record<string, unknown>): string | undefined;
/** The recipient a persisted message was addressed to, or `null` for the BRAIN. */
declare function parseDirectedRecipient(msg: {
    metadata?: string | null;
}): DirectedRecipient | null;
/** True when a message is addressed to a participant (so the BRAIN should NOT run for it). */
declare function isDirectedToParticipant(msg: {
    metadata?: string | null;
}): boolean;
/**
 * A composer's recipient choice: `null` = auto (follow any leading @mention),
 * `'brain'` = explicitly the BRAIN, or an explicit participant. An explicit
 * choice always wins over a typed @mention.
 */
type RecipientChoice = DirectedRecipient | 'brain' | null;
/** An in-progress "@mention" being typed at the caret — what a composer typeahead
 *  offers a picker for. */
interface MentionToken {
    /** The text typed after '@' (before the caret); '' right after typing '@'. */
    query: string;
    /** Index of the '@' character in the text. */
    start: number;
    /** Index just past the query (the caret position). */
    end: number;
}
/**
 * Detect an in-progress "@mention" at the caret, for a composer typeahead. The
 * token is an '@' at the start of the text or right after whitespace, followed by
 * a run of non-whitespace, non-'@' characters, with the caret inside that run.
 * Returns null when the caret is not in such a token (so no picker should show).
 * Deliberately mirrors {@link mentionRecipient}'s `@([^\s@]+)` grammar so what the
 * typeahead offers and what a leading mention resolves to stay consistent.
 */
declare function activeMentionToken(text: string, caret: number): MentionToken | null;
/**
 * Filter + rank participants for a mention query — case-insensitive substring
 * match, name-start matches first. An empty query returns every participant (so
 * typing a bare '@' opens the full roster). Shared by every composer's typeahead.
 */
declare function filterMentionCandidates(participants: DirectedRecipient[], query: string): DirectedRecipient[];
/** Resolve a leading "@name" in composer text to one of `participants`, if any. */
declare function mentionRecipient(text: string, participants: DirectedRecipient[]): DirectedRecipient | null;
/**
 * The effective target of the next message: an explicit BRAIN pick wins (→ null,
 * runs the BRAIN); else an explicit participant; else a leading @mention; else the
 * BRAIN. Shared by every composer so routing is identical across surfaces.
 */
declare function resolveRecipient(choice: RecipientChoice, mention: DirectedRecipient | null): DirectedRecipient | null;

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
    /** `evermind` = the project's SSM GENERATED the reply; `qa-cache` = a stored answer was replayed. */
    source: 'evermind' | 'qa-cache';
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
 * dropped so it never masquerades as a real model id.
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
    /** Count of tool results that were truncated before hitting the model. */
    truncatedToolResults: number;
    /** The single largest tool result (label + pre-trim bytes). */
    largestToolResult: {
        label: string;
        bytes: number;
    } | null;
    /** Distinct models that actually answered, first-seen order. */
    modelsUsed: string[];
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
     */
    likelyCause: 'memory-answered' | 'no-tools-advertised' | 'tool-not-advertised' | 'tool-calls-not-emitted' | 'context-exhaustion' | 'model-degradation' | 'inconclusive' | 'healthy';
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
declare function computeBrainDiagnostics(events: BrainTraceEvent[], requestedModel?: string, messages?: BrainMessage[]): BrainDiagnostics;
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
}
/**
 * Assemble the Brain triage report. Same shape as the host/cloud report:
 * header → errors-first → full event log → derived log lines → transcript.
 */
declare function buildBrainTriageReport(opts: BuildBrainTriageOptions): string;

interface UseBrainConversationOptions {
    chatId: number | null;
    modality?: BrainModality;
    /**
     * The chat's project. Forwarded to the run so the loop's "a code change is always
     * tied to a ticket" backstop can mint a `from_delta` ticket for this project when
     * an IDE run changed code without recording one. Omit for a non-project chat / the
     * web Brain (no file tools → the backstop never fires).
     */
    projectId?: number | null;
    /** Extra system-prompt context (e.g. an IDE's open file + content). */
    extraSystem?: string;
    /** Override the system prompt entirely (e.g. a fixed Brain Storm persona). */
    systemPrompt?: string;
    /** Override the model (e.g. run the Brain as a specific assigned agent). */
    model?: string;
    /** True when `model` came from a deliberate user pick. */
    modelStrict?: boolean;
    /** Gateway-owned routing or the tenant's ordered BYO pool. */
    routingMode?: 'auto' | 'byo_pool';
    /**
     * Pick the next model when the current one burns its stall budget without emitting
     * a tool call. Hosts pass `(tried) => nextFallbackModel(surface, tried)` using the
     * `/llm/v1/models` surface they already cache. Omit to keep the run on one model
     * and stop with an explanation instead of switching.
     */
    pickFallbackModel?: (tried: readonly string[]) => string | undefined;
    /**
     * `max_tokens` for this conversation's completions — the host's Effort control
     * (see `effort.ts`, the single effort→params map). Omit for the 4096 default.
     */
    maxTokens?: number;
    /**
     * Vendor-neutral reasoning intent (the host's Thinking toggle). Build it with
     * `reasoningForRun({ effort, thinking })` so the level tracks Effort. Omit /
     * `undefined` ⇒ no `reasoning` field on the wire at all.
     */
    reasoning?: ReasoningIntent;
    /** Tool specs from the page-action registry. */
    toolSpecs?: BrainToolSpec[];
    /** Dispatch a tool call to the registry. */
    runTool?: (name: string, args: unknown) => Promise<unknown>;
    /**
     * Pure predicate: return true to pause the loop for an explicit user
     * confirmation before the tool runs (the human-in-the-loop gate). The prompt
     * UI is driven by `pendingConfirm` + `resolveConfirm` on the return value, so
     * the gate survives a navigation that swaps which Brain panel is mounted.
     * Hosts typically gate only mutating tools (see BrainActions `isMutating`).
     * Omit to run every requested tool immediately.
     */
    needsConfirm?: (req: {
        name: string;
        args: unknown;
    }) => boolean;
    /** Create-on-demand when sending without an active chat; returns the new chat id. */
    ensureChatId?: () => Promise<number | null>;
    /** Notify the host (chats hook) that this chat got new activity. */
    onActivity?: (chatId: number) => void;
    /**
     * Fired once when the FIRST user turn of a chat is persisted, with that turn's text —
     * the seam the host uses to auto-name a still-"New chat" conversation from what it's
     * about (wired to `useBrainChats.autoTitle`). Best-effort and idempotent on the host
     * side; omit to leave chats untitled.
     */
    onFirstUserTurn?: (chatId: number, text: string) => void;
    /**
     * Project-Evermind memory hooks, bound by the host to the active chat's project.
     * When set, a run recalls the project's learned memories before answering
     * (grounding the reply) and records recall/learn/reconcile steps in the trace.
     * Omit for a non-project chat.
     */
    evermind?: EvermindRunHooks;
    /**
     * Optional async per-turn system-prompt augment, called at run start with the
     * latest user text. Its non-empty return is appended to the system prompt for
     * that run. This is the seam a host uses for a PER-TURN async fetch the sync
     * `resolveSystemPrompt` / `extraSystem` cannot do — e.g. a fresh limbic/affect
     * block appraised against this turn's prompt (VS Code parity). Best-effort: a
     * throw / empty return just skips it. Omit when the static `extraSystem`
     * personality block is enough.
     */
    augmentSystemPrompt?: (userText: string) => Promise<string | undefined>;
    /**
     * The active chat's MODE — `chat` (answer the question) or `work` (create, staff,
     * link AND dispatch the work). Read from the chat row by the host so the choice
     * follows the conversation rather than the browser. Omit to keep the pre-mode
     * always-execute behaviour.
     */
    chatMode?: ChatMode;
}
interface UseBrainConversation {
    messages: BrainMessage[];
    loadingMessages: boolean;
    /** Force a transcript refetch without changing the chat id (e.g. after a merge). */
    reloadMessages: () => void;
    sending: boolean;
    error: string;
    /**
     * What the user can DO about {@link error}: reconnect an expired session, upgrade
     * a plan, or add a card. Decided ONCE from the gateway's structured error body
     * (see `chatErrorAction`), so an error banner renders the fix without
     * pattern-matching the message text. Null when only dismissing applies.
     */
    errorAction: ChatErrorAction | null;
    /** Live assistant delta buffer (rendered as a trailing bubble while streaming). */
    streamingText: string;
    /** This viewer's thumb per message id (+1 up, -1 down). Hand straight to the
     *  shared transcript's `ratings` prop. */
    ratings: Record<number, 1 | -1>;
    pendingAttachments: ChatInputAttachment[];
    uploading: boolean;
    /**
     * Persist + answer a user turn. Resolves `true` once the turn is safely
     * persisted and the run has started (the message can no longer be lost), or
     * `false` if it failed before persisting (e.g. the token expired mid-send) —
     * so a composer can restore the text the user typed instead of dropping it.
     */
    send(text: string, opts?: {
        addressedTo?: DirectedRecipient | null;
    }): Promise<boolean>;
    /**
     * Stop the in-flight run for the active chat: aborts the streaming LLM request
     * and unwinds the agent loop (no error surfaced). No-op when nothing is
     * running. Pair with `sending` to drive a Stop button.
     */
    stop(): void;
    /**
     * Rate one assistant reply (+1 / -1, or 0 to clear). Beyond flipping the thumb it
     * derives WHAT is being rated — the model that served the turn and the MCP tool it
     * ran ({@link ratedTurnContext}) — and sends that with the vote, which is what
     * makes the press teach the learned router instead of just colouring a button.
     */
    rateMessage(msg: BrainMessage, rating: 1 | -1 | 0): Promise<void>;
    attach(file: File): Promise<void>;
    removeAttachment(key: string): void;
    setError(msg: string): void;
    /**
     * Dismiss the current error banner. Clears BOTH the hook's local error and the
     * run cell's error (a failed LLM stream / tool loop sets the latter, which
     * `setError('')` alone can't reach) — so the user can always close the banner.
     */
    clearError(): void;
    /** A tool call awaiting the user's Approve/Cancel decision (or null). */
    pendingConfirm: {
        name: string;
        args: unknown;
    } | null;
    /** Resolve the pending confirmation. */
    resolveConfirm(ok: boolean): void;
    /**
     * True once the active chat has any recorded execution steps (LLM/tool/error)
     * — drives the "capture execution" affordance.
     */
    hasTrace: boolean;
    /**
     * The live execution trace (LLM turns + tool calls + errors) for the active
     * chat, in order — updated AS THE RUN HAPPENS. Render it as the timeline's
     * tool/thinking/error steps; pair it with `messages` for the durable
     * user/assistant turns. Empty when the chat has no run this session.
     */
    trace: BrainTraceEvent[];
    /**
     * Connected providers the gateway could NOT use this run (e.g. an expired Claude
     * subscription that fell back to the shared pool). A mounted view renders a passive
     * "reconnect your account" banner off this; empty when everything resolved.
     */
    byoUnresolved: string[];
    /**
     * BYO providers that hit a usage/capacity cap this run (e.g. Anthropic monthly
     * spend limit, Meta MUSE quota exhausted). A mounted view renders a "manage your
     * API keys" banner so the user can top up or switch providers. Empty when no cap
     * was hit this run.
     */
    providerCap: string[];
    /**
     * Assemble a paste-able triage report of the active chat's execution — the LLM
     * steps, the full tool chain (args + results), intermediate assistant messages,
     * every error, and the visible transcript. `agentLabel` names the persona the
     * Brain ran as; `surface` names where it ran (e.g. `VS Code (VSIX)`). Mirrors the
     * host/cloud "Copy triage info" report.
     */
    buildTriageReport(agentLabel?: string, surface?: string): string;
}
declare function useBrainConversation(options: UseBrainConversationOptions): UseBrainConversation;

/**
 * Shared reconnecting WebSocket invalidation client for Brain chat messages.
 * Both BuilderForce web and VSIX adapters use this implementation so auth,
 * reconnect, cleanup, and frame handling cannot drift between surfaces.
 */
declare function subscribeToChatMessages(baseUrl: string, getToken: () => string | null, chatId: number, onChanged: () => void): () => void;

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

/** Streaming fn shape (matches BrainRuntime.stream). */
type BrainStreamFn = (opts: Omit<StreamChatOptions, 'transport'>, handlers?: StreamHandlers) => Promise<StreamChatResult>;
/** Persistence subset the loop needs (matches BrainPersistenceAdapter). */
interface BrainRunPersistence {
    sendMessages(chatId: number, messages: Array<{
        role: string;
        content: string;
        metadata?: string;
    }>): Promise<BrainMessage[]>;
}
/** Everything a single run needs, captured at start time (survives navigation). */
interface BrainRunRequest {
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
     * Tool-iteration ceiling for THIS run (one iteration = one model turn, which may
     * batch several tool calls). Omit to use the shared default.
     *
     * An injected capability, not a per-host branch: a surface whose budget is
     * legitimately different — the native VS Code chat participant runs a longer
     * coding loop than a web panel — states its own number here instead of the loop
     * learning which host is calling it. Non-positive values are ignored.
     */
    maxIterations?: number;
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
/**
 * A snapshot of which chats are live right now, split by whether they are actively
 * executing (`running`) or paused on a human-in-the-loop confirm (`awaiting` — the
 * actionable one: the loop cannot proceed until the user answers). The two lists
 * are disjoint (an awaiting chat is omitted from `running`).
 */
interface GlobalRunState {
    running: number[];
    awaiting: number[];
}
/**
 * Drop all run state. For tests/teardown only — there's no per-chat eviction in
 * normal operation (transcripts are session-lived grounding, as before).
 */
declare function resetBrainRunStore(): void;
/**
 * Subscribe to ANY run-state change across all chats (a run starting, finishing,
 * or pausing on a confirm — in any chat, mounted or not). Returns an unsubscribe
 * fn. Pair with {@link getGlobalRunState} to render a cross-chat live indicator.
 */
declare function subscribeRunStore(listener: () => void): () => void;
/**
 * Which chats are live right now, split into actively-executing (`running`) and
 * paused-on-a-confirm (`awaiting`). Disjoint: a chat paused on a confirm is in
 * `awaiting` only. Recomputed from the current cells on each call — cheap (a scan
 * of the bounded cell map); callers debounce via a stable key of the two lists.
 */
declare function getGlobalRunState(): GlobalRunState;
/** Subscribe to a chat's run state. Returns an unsubscribe fn. */
declare function subscribeRun(chatId: number, listener: () => void): () => void;
/** Current snapshot (referentially stable until something changes). */
declare function getRunSnapshot(chatId: number | null): BrainRunSnapshot;
declare function isRunning(chatId: number | null): boolean;
/** The accumulated execution trace for a chat (for the capture/triage report). */
declare function getRunTrace(chatId: number | null): BrainTraceEvent[];
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
declare function stopRun(chatId: number): void;
/**
 * Clear a chat's surfaced run error so the UI's error banner can be dismissed.
 * The error lives on the run cell (set when the LLM stream / tool loop threw),
 * so the hook's local `setError('')` can't reach it — this is the store-side
 * companion `clearError()` calls. No-op when there's no cell or no error.
 */
declare function clearRunError(chatId: number | null): void;
/** Resolve a pending human-in-the-loop confirmation. No-op if none is pending. */
declare function resolveRunConfirm(chatId: number, ok: boolean): void;
/**
 * Start (or no-op join) the agent loop for a chat. Single-flight per chat: if a
 * run is already in flight the call returns immediately, so a second mounted
 * Brain instance can never spawn a duplicate loop. The claim is synchronous
 * (set before any await), so two callers in the same tick can't both pass it.
 */
declare function startRun(chatId: number, req: BrainRunRequest): Promise<void>;

/**
 * CHAT ACTIVITY — the structured contract behind a run milestone / agent dispatch line.
 *
 * The runtime narrates itself into the conversation that spawned the work: "▶️ **Ada**
 * started working on task #41", "✅ … finished … — moved to **in review**". Those rows
 * are persisted as ordinary `role:'assistant'` messages carrying `metadata.runMilestone`
 * / `metadata.agentDispatch`, and BOTH chat renderers showed them as exactly that: an
 * assistant bubble with an emoji glued to the front, indistinguishable from something
 * the model said — and, because the server composed the sentence in English, untouchable
 * by either surface's i18n.
 *
 * This module is the fix's foundation: the metadata carries the FACTS (who, which
 * ticket, which phase, which lane, the first line of the result), and each surface
 * renders the sentence itself from its own catalogue. So the line is a system/activity
 * line rather than a bubble, and it is localized where localization actually lives —
 * next-intl on the web, `vscode.l10n.t()` in the VS Code webview.
 *
 * Older rows carry only the English `content` (the structured fields did not exist yet).
 * {@link parseChatActivity} still recognises them and reports `text: undefined`, so a
 * renderer falls back to the stored sentence: an old transcript keeps reading correctly,
 * it just isn't translated.
 */
/** The lifecycle moments a run narrates. Mirrors the api's `RunMilestonePhase`. */
type RunMilestonePhase = 'started' | 'completed' | 'failed' | 'paused' | 'resumed' | 'cancelled';
/** One run-lifecycle line. */
interface RunMilestoneActivity {
    kind: 'milestone';
    phase: RunMilestonePhase;
    /** Display name of the agent, resolved server-side (it owns the workforce directory). */
    agentName: string;
    /** `task` | `epic` | `gap` — the ticket vocabulary, rendered as-is. */
    ticketKind: string;
    ticketRef: string;
    executionId: number | null;
    /** Lane the ticket moved to on completion, already de-underscored. */
    toStatus?: string;
    /** First line of the run result (completed) or the error (failed). */
    note?: string;
    /** The `ask_human` question a `paused` milestone is blocked on. */
    question?: string;
}
/** One "an agent joined this ticket" line. */
interface AgentDispatchActivity {
    kind: 'dispatch';
    agentName: string;
    ticketKind: string;
    ticketRef: string;
}
type ChatActivity = RunMilestoneActivity | AgentDispatchActivity;
/**
 * Parse a message's activity metadata, or null when it is an ordinary turn.
 *
 * Defensive by construction: a malformed blob, or one missing the structured fields,
 * yields either null or an activity whose optional fields are simply absent — never a
 * throw, and never a half-built sentence.
 */
declare function parseChatActivity(msg: {
    metadata?: string | null;
}): ChatActivity | null;
/** True when a message is an activity line rather than something the model said. */
declare function isActivityMessage(msg: {
    metadata?: string | null;
}): boolean;
/**
 * The label templates a surface must supply to render an activity line in ITS language.
 * Every value is a template with `{…}` placeholders — never a pre-composed sentence — so
 * word order is the translator's to decide.
 */
interface ChatActivityLabels {
    /** `{agent}`, `{kind}`, `{ref}` */
    milestoneStarted: string;
    /** `{agent}`, `{kind}`, `{ref}` */
    milestoneCompleted: string;
    /** `{agent}`, `{kind}`, `{ref}`, `{lane}` */
    milestoneCompletedWithLane: string;
    /** `{agent}`, `{kind}`, `{ref}` */
    milestoneFailed: string;
    /** `{agent}`, `{kind}`, `{ref}` */
    milestonePaused: string;
    /** `{agent}`, `{kind}`, `{ref}`, `{question}` */
    milestonePausedWithQuestion: string;
    /** `{agent}`, `{kind}`, `{ref}` */
    milestoneResumed: string;
    /** `{agent}`, `{kind}`, `{ref}` */
    milestoneCancelled: string;
    /** `{agent}`, `{kind}`, `{ref}` */
    agentDispatched: string;
}
declare const DEFAULT_CHAT_ACTIVITY_LABELS: ChatActivityLabels;
/** The glyph that marks each activity — one per phase, shared by both surfaces. */
declare function activityIcon(activity: ChatActivity): string;
/** Tone for the activity line — drives the accent colour, not the wording. */
declare function activityTone(activity: ChatActivity): 'neutral' | 'good' | 'bad' | 'waiting';
/**
 * Compose the activity's sentence FROM the structured facts, in the caller's language.
 * Pure, so both surfaces get identical wording rules from one implementation and the
 * only thing that differs between them is the catalogue they hand in.
 */
declare function chatActivityText(activity: ChatActivity, labels: ChatActivityLabels): string;

/**
 * persistedSteps — the READER for the durable tool/memory step rows the agent
 * loop writes, and the counterpart to `brainRunStore.persistStep`.
 *
 * A run's `trace` is IN-MEMORY ONLY: it lives on the run cell and is gone the
 * moment the chat is closed, remounted, or resumed in another window. That is
 * exactly why every tool/memory step is ALSO persisted as a `role:'tool'` message
 * whose `metadata` carries `{ kind:'step', … }`.
 *
 * Every consumer that wants "the steps of this conversation" therefore has to read
 * BOTH sources and de-duplicate. The timeline already did; the triage diagnostics
 * did not — it counted the live `trace` alone, so a copied transcript of a reopened
 * chat rendered 20 tool calls from the persisted rows while the Diagnostics block
 * above it said `Tool calls: 0`, `Tool results: 0 B`, and — starved of signal —
 * `Likely cause: Inconclusive`. Both now go through {@link traceWithPersistedSteps}.
 */

/** A tool/memory step in the shape shared by a live `trace` event and its durable
 *  persisted copy — so ONE builder covers both sources. */
interface PersistedStep {
    category: string;
    label: string;
    args?: unknown;
    result?: unknown;
    isError?: boolean;
    durationMs?: number;
    /** `tool` steps: pre-trim byte size of the full result (the stored copy is capped). */
    resultBytes?: number;
    /** `tool` steps: the result the model saw was truncated. */
    truncated?: boolean;
    /** `llm` steps: token usage the gateway reported for the turn. */
    usage?: {
        prompt?: number;
        completion?: number;
        total?: number;
    };
    /** `llm` steps: OpenAI finish_reason. */
    finishReason?: string | null;
    /** `llm` steps: length of the assistant text the turn produced. */
    textChars?: number;
    /** `llm` steps: time-to-first-token. */
    ttftMs?: number;
}
/**
 * Identity of a step across the live trace and its durable copy: same category +
 * label + client timestamp. Lets a step present in BOTH be handled once, while a
 * prior run's step — present only in the messages — still counts.
 */
declare function stepSig(category: string, label: string, tsIso: string | undefined): string;
/**
 * Parse a persisted `role:'tool'` step message's metadata into a {@link PersistedStep}
 * plus its client timestamp. Null when the row isn't a well-formed step (so it is
 * never rendered as an assistant bubble or counted as a tool call).
 */
declare function parseStepMessage(metadata: string | null): {
    step: PersistedStep;
    tsIso?: string;
} | null;
/**
 * The FULL step + turn history of a conversation as trace events: the live
 * in-memory `trace` plus every durable step row the messages carry that the trace
 * doesn't already hold (deduped by {@link stepSig}). Ordered by timestamp so a
 * reader sees the run in sequence.
 *
 * Feed this — not the bare `trace` — to `computeBrainDiagnostics` so a reloaded or
 * resumed chat reports the tool calls it actually made.
 *
 * `persistStep` stores the diagnostics scalars alongside each step — the pre-trim
 * `resultBytes` + `truncated` flag on a tool step, and `usage` / `finishReason` /
 * `textChars` on an `llm` turn — so a recovered run reports the same tool counts,
 * payload sizes, token peaks and finish reasons a live one does. Only the step
 * RESULT payload is lossy (capped at `STEP_RESULT_CAP` in the stored copy).
 */
declare function traceWithPersistedSteps(messages: BrainMessage[], trace: BrainTraceEvent[]): BrainTraceEvent[];

/**
 * The deployed API version, read once per session from `/health`.
 *
 * A support capture with no build stamp is ambiguous in the worst way: a dump taken
 * minutes BEFORE a deploy is byte-identical to one taken after, so a fixed bug reads
 * as unfixed. Every surface therefore stamps `UI x · API y` onto its diagnostics.
 *
 * The surfaces REACH `/health` differently — the web app hits the api origin
 * unauthenticated, the VS Code webview goes through its configured gateway base — so
 * the caller supplies the read and this module owns the part that must not be
 * duplicated: a session cache plus in-flight coalescing, so the footer, the sidebar
 * and a diagnostics capture cost one request between them.
 */
/**
 * How long a resolved version stays good.
 *
 * IT USED TO BE FOREVER, and that reproduced the EXACT failure the header above says
 * this module exists to prevent. `cached` was set once per page load and never
 * invalidated, so a tab open across a deploy stamped every later capture with the build
 * it started on. Measured 2026-07-29: a diagnostics capture taken twelve hours after
 * `2026.7.181` shipped reported `apiVersion: 2026.7.180`, and the fixes in that build —
 * visibly present in the very decision payloads inside the same report — were read as
 * never deployed. A stamp that lies about which build produced the evidence is worse
 * than no stamp: it is the one field a reader cannot cross-check.
 *
 * A minute is long enough to keep the property the cache was added for (the footer, the
 * sidebar and a capture still cost ONE request between them) and short enough that no
 * capture can name a build that is no longer running.
 */
declare const API_VERSION_TTL_MS = 60000;
/**
 * How long the `/health` read may take before the caller stops waiting for it.
 *
 * UNREACHABLE and SLOW are different failures, and only the first one was ever handled.
 * A rejected read resolves null and a report honestly says the API version is unknown;
 * a read that never SETTLES (offline behind a live socket, a captive portal, a stalled
 * connection) left every awaiting caller hanging forever. That is precisely what turns
 * "Copy diagnostics" into a button that does nothing at all: the click is received, the
 * report is never built, and nothing is ever shown to say so.
 *
 * The stamp is the least important line in a diagnostics report and must never be able
 * to hold the rest of it hostage — so the wait is bounded HERE, in the one module both
 * surfaces already go through, rather than each host racing its own timer (the web app
 * had one, the VS Code webview did not, and only one of the two copy buttons worked).
 * An over-run is just a null.
 *
 * A caller that can cancel the underlying request should ALSO pass its own
 * `AbortSignal.timeout(API_VERSION_PROBE_TIMEOUT_MS)` — the race below guarantees the
 * bound, the signal is the courtesy that also frees the socket.
 */
declare const API_VERSION_PROBE_TIMEOUT_MS = 2500;
/** Drop the memoized version — for tests, and for a surface that knows it just
 *  reconnected to a different deployment. */
declare function resetApiVersionCache(): void;
/**
 * Resolve the API version through `read`, memoizing a success for
 * {@link API_VERSION_TTL_MS} and abandoning a read that outruns
 * {@link API_VERSION_PROBE_TIMEOUT_MS}. Resolves null when `/health` is unreachable OR
 * too slow — a diagnostics capture must never fail, and must never STALL, because a
 * version lookup did.
 *
 * `now` and `timeoutMs` are injectable so the expiry and the deadline are unit-testable
 * without a clock; pass `timeoutMs: 0` to wait indefinitely.
 */
declare function fetchApiVersionVia(read: () => Promise<{
    version?: string;
} | null>, now?: () => number, timeoutMs?: number): Promise<string | null>;

/**
 * Chat ⇄ work linking — the single source for (a) the system-prompt directive that
 * tells the Brain to turn work it identifies or code it changes into a ticket LINKED
 * to the current conversation, and (b) the tool-name predicates that back the
 * deterministic "a code change is always tied to a ticket" guarantee.
 *
 * Why it lives here: the shared agent loop ({@link ./brainRunStore}) drives BOTH the
 * web Brain and the VS Code webview Brain, and it is the one place that always knows
 * the RESOLVED chatId of the run. Injecting the directive there (with the real id)
 * gives the primary Brain loop the same behaviour the server-side `@agent` reply loop
 * already has (BrainService.agentReply bakes the chatId in), so:
 *   1. when the agent's investigation determines work must be done, it CREATES the
 *      work item and links it to this chat (lineage), instead of only describing it;
 *   2. when the agent changes code, that change becomes a ticket linked to this chat.
 *
 * The predicates are also consumed by the loop's post-run backstop: if a run changed
 * code (a workspace file tool succeeded) but never itself recorded a ticket, the loop
 * mints one via `builtin_tickets_from_delta` tied to the chat — so an IDE edit is
 * never left invisible or unlinked.
 *
 * Kept framework-free (pure strings + Sets) so it is safe in every bundle.
 */
/**
 * Advertised (gateway `builtin_*`) names of the platform tools that RECORD work
 * against the chat. If the model calls any of these itself during a run, the turn
 * already tied its work to a ticket and the deterministic backstop stays quiet.
 */
declare const TICKET_RECORDING_TOOLS: ReadonlySet<string>;
/**
 * Local workspace tools whose success means the agent CHANGED code on disk — the
 * surface-specific signal that a ticket must exist. Only the VS Code (IDE) surface
 * exposes these; the web Brain has no file tools, so a web run never trips the
 * backstop. `run_command` is intentionally excluded: it usually runs tests / build /
 * lint, not a durable code change, so treating it as one would mint spurious tickets.
 */
declare const CODE_CHANGE_TOOLS: ReadonlySet<string>;
declare function isCodeChangeTool(name: string): boolean;
/** A work item a create tool just produced, in the shape `builtin_chats_link_ticket`
 *  wants: which tier it is, its ref, and whether it was newly created vs. an
 *  idempotent hit on a pre-existing item (so the link records the honest lineage). */
interface CreatedWorkItemLink {
    kind: string;
    ref: string;
    linkType: 'created' | 'linked';
}
/**
 * Derive the chat-link descriptor for the result of a work-item CREATE tool, or null
 * when the tool is not a create (or the result carries no usable id). This is what
 * makes "an item the Brain creates is always tied to the conversation" DETERMINISTIC:
 * the run loop fires `builtin_chats_link_ticket` off this instead of hoping the model
 * remembers to. An idempotent-hit result (`{ deduped: true, … }`) links as 'linked'
 * (the item already existed) rather than 'created'.
 */
declare function workItemLinkFromCreate(toolName: string, result: unknown): CreatedWorkItemLink | null;
declare function isTicketRecordingTool(name: string): boolean;
/**
 * Task-tier statuses that mean "not started yet" — mirrors the board's not-started
 * lanes (TaskStatus BACKLOG | TODO | READY). A linked ticket in one of these that a
 * code-changing run actively worked is advanced to `in_progress` by the loop backstop,
 * so "you worked a ticket but never moved it off backlog" can't happen silently.
 * `blocked` / `in_progress` / `in_review` / `done` are deliberately excluded — the run
 * must not un-block, re-open, or regress a ticket that already moved past the backlog.
 */
declare const NOT_STARTED_TASK_STATUSES: ReadonlySet<string>;
/** A linked ticket the deterministic backstop should advance to in_progress. */
interface LinkedTicketToAdvance {
    kind: string;
    ref: string;
}
/**
 * From a `builtin_chats_list_tickets` result, the task-tier tickets still sitting in a
 * not-started lane — the ones a code-changing run left behind in backlog. The loop
 * advances each to `in_progress` via `builtin_tasks_update`, closing the gap that let
 * the agent "start work on a ticket without ever updating its status". Tolerant of the
 * tool result arriving as a JSON string, a parsed array, or an error object (returns
 * [] for anything unusable), and skips deleted/unresolved links.
 */
declare function linkedTicketsToAdvance(listResult: unknown): LinkedTicketToAdvance[];
/** The workspace-relative path a code-change tool touched (for delta provenance),
 *  or null when the args carry no usable `path`. */
declare function codeChangeFile(args: unknown): string | null;
/**
 * The system-prompt block that binds a chat's work to the conversation. Encodes BOTH
 * operator requirements: investigation-identified work → create + link; and a code
 * change → from_delta tied to this chat. Uses the advertised `builtin_*` tool names
 * the model actually sees on the gateway MCP relay.
 */
declare function chatWorkLinkingDirective(chatId: number): string;

/** Persist a landing-page prompt for replay after authentication. No-ops on empty input or SSR. */
declare function savePendingPrompt(text: string): void;
/** Read and clear the saved prompt. Returns null when none is stored or on SSR. */
declare function takePendingPrompt(): string | null;

/**
 * Chat consolidation markers.
 *
 * A long conversation can be compressed into a single summary that becomes the
 * new base context — everything before the marker stays visible in the
 * transcript, but is dropped from what gets sent to the model on the next turn.
 * The marker is a normal assistant message (so the user SEES the summary the AI
 * produced) tagged with `{ consolidation: true }` in its metadata. Keeping the
 * flag in metadata (not the text) means the summary reads naturally while the
 * seed-builder can still find it reliably.
 *
 * This is the single source of truth for the marker convention, shared by the
 * conversation loop (which trims the model seed to the last marker) and any host
 * that creates a marker (the IDE's "Consolidate" / "Fork" actions).
 */

/** The metadata key that flags an assistant message as a consolidation marker. */
declare const CONSOLIDATION_META: {
    readonly consolidation: true;
};
/** Serialized metadata for a consolidation marker message (ready to persist). */
declare function consolidationMetadata(): string;
/** True when a persisted message is a consolidation marker (by its metadata flag). */
declare function isConsolidationMarker(msg: {
    metadata?: string | null;
}): boolean;
/**
 * The index of the LAST consolidation marker in a message list, or -1 if none.
 * The seed-builder slices FROM this index (inclusive) so the summary itself is
 * the base context the next turn sees.
 */
declare function lastConsolidationIndex(messages: Array<{
    metadata?: string | null;
}>): number;
/**
 * Trim a message list to the compressed context: everything from the last
 * consolidation marker onward. Returns the list unchanged when there is no
 * marker. Used to build the model seed so a consolidated chat sends the summary
 * instead of the full (large) history — the whole point of consolidating.
 */
declare function scopeToConsolidation<T extends {
    metadata?: string | null;
}>(messages: T[]): T[];
/** The visible header prefixed onto a consolidation summary so the user recognizes it. */
declare const CONSOLIDATION_MARKER_PREFIX = "\uD83D\uDCCC **Consolidated summary** \u2014 context continues from here.\n\n";
/** Wrap a raw summary as the marker's visible content (prefix + summary). */
declare function consolidationMarkerContent(summary: string): string;

/**
 * Per-reply model/account provenance — the durable "which LLM, and whose account,
 * produced this turn" signal shown as a small chip under an assistant message.
 *
 * Motivation: a SUCCESSFUL Brain turn used to reveal nothing about how it was
 * served, so "why didn't it use my paid Claude?" was invisible until a turn came
 * back empty (the only case the diagnostic note fired). This attaches the resolved
 * model + whether the tenant's OWN connected frontier account served it — or the
 * shared pool did despite a connected account existing — to every assistant turn,
 * so the confirmation is always on screen.
 *
 * Single source of truth for the convention, shared by the writers (server-side
 * `agentReply` metadata + the streaming gateway's `x-builderforce-account` header,
 * captured client-side and persisted) and the renderer (the BrainTimeline chip).
 * The `account` string values are the wire contract with the server — the api's
 * `classifyReplyAccount()` MUST emit these exact literals.
 */
/** The metadata key under which a message's provenance rides. */
declare const PROVENANCE_META_KEY = "provenance";
/**
 * Which account served a completed turn:
 * - `own`               — the tenant's OWN connected frontier account (a Claude
 *                         subscription or a BYO vendor key) served it; the platform
 *                         paid nothing and the user is on the model they connected.
 * - `shared`            — the shared model pool served it AND the tenant has no
 *                         connected account (nothing else was possible).
 * - `shared_byo_unused` — the shared pool served it EVEN THOUGH the tenant has a
 *                         connected account — the case worth flagging inline
 *                         ("your connected account wasn't used for this turn").
 */
type ProvenanceAccount = 'own' | 'shared' | 'shared_byo_unused';
/** Durable provenance for one assistant turn. */
interface MessageProvenance {
    /** The model the gateway ACTUALLY used (resolved, post-failover). */
    model: string;
    /**
     * Which account served it — see {@link ProvenanceAccount}. OPTIONAL: the
     * gateway reports it via `x-builderforce-account`, which an older gateway (or a
     * CORS setup that doesn't expose the header) omits. Requiring it used to drop
     * the whole record, so a turn's MODEL — the thing users most need when output
     * quality collapses — went unreported too. Absent = "model known, account not".
     */
    account?: ProvenanceAccount;
    /** Vendor that owns `model` (e.g. `anthropic`), when known — names the account
     *  in tooltips ("your connected Claude account"). */
    vendor?: string;
    /** Present when the project's own self-learning Evermind generated this reply's
     *  final prose (opt-in inference). `version` is the Evermind head the turn ran on.
     *  Absent for turns served by a frontier/pool model — so the "🧠 Evermind vN" chip
     *  shows ONLY when the learned model actually spoke. */
    evermind?: {
        version: number;
    };
}
/** True when a turn ran on the shared pool despite a connected account existing —
 *  the only state the chip flags inline. Shared by the chip and any host that
 *  wants to nudge the user to check their connection. */
declare function isConnectedAccountUnused(prov: MessageProvenance | null | undefined): boolean;
/** Parse a message's persisted provenance, or `null` when it carries none (older
 *  turns). The MODEL is the only required field — a turn whose gateway didn't
 *  report an account still names the model that answered. Defensive: a malformed
 *  blob yields `null` rather than throwing. */
declare function parseMessageProvenance(msg: {
    metadata?: string | null;
}): MessageProvenance | null;
/**
 * Merge a provenance object into a message's metadata (preserving any other keys,
 * e.g. `authoredBy` on an agent's reply). Returns a serialized string, or
 * `undefined` when there is nothing to store — ready to hand to
 * `persistence.sendMessages`. Mirrors `withDirectedMetadata`.
 */
declare function withProvenanceMetadata(provenance: MessageProvenance | null | undefined, base?: Record<string, unknown>): string | undefined;

/**
 * WHAT THE USER IS TOLD RAN THEIR TURN — the one rule, shared by every surface.
 *
 * A turn served by BuilderForce's own routed pool IS the product the user signed up
 * for: "Builderforce Free" or "Builderforce PRO". Which upstream model the cascade
 * happened to land on (`minimaxai/minimax-m3`, `@cf/zai-org/glm-4.7-flash`, …) is an
 * implementation detail of that product — it changes per turn, per vendor outage, per
 * cooldown, and the user on a routed plan has no control over it. Naming it in the UI
 * only ever raises a question they cannot act on ("why did I get Minimax?").
 *
 * The id is NOT hidden from us. It still rides every `llm_usage_log` row, every
 * execution trace, the provenance metadata on the message, and the "Copy diagnostics"
 * report — the places where WE need to know exactly which model served a turn. This
 * module governs the DISPLAY layer only.
 *
 * It is shown to the user in exactly the two cases where the choice is theirs:
 *   • the turn ran on their OWN connected account (BYO) — it is their model, on their
 *     key, and naming it is the whole point of connecting it; or
 *   • they are entitled to pick a model at all (a paid plan, or a connected provider),
 *     in which case the catalog is theirs to browse and pin.
 *
 * Everyone else — the free plan and the anonymous canvas — sees the product name.
 *
 * Lives in brain-embedded (not a UI package) because four surfaces have to agree on
 * it: the shared `/` composer menu, the per-reply provenance chip in the transcript,
 * the VS Code host's `Change model` QuickPick, and the public `/models` catalog page.
 */

/** The two BuilderForce routing products. A turn with no explicit pin runs on one of
 *  them, and that PRODUCT is what the user sees named. */
type RoutedProduct = 'free' | 'pro';
/**
 * The user-facing names of our two routing products. THE single source — the composer
 * menu, the provenance chip and the public `/models` catalog all read these, so the
 * product can never be called three different things in three places.
 *
 * Brand tokens, deliberately NOT localized (see the i18n rule for brand names).
 */
declare const BUILDERFORCE_PRODUCT_NAME: Readonly<Record<RoutedProduct, string>>;
/**
 * What this viewer is allowed to see about model identity.
 *
 * `product`   — which routing product funds their unpinned turns.
 * `canChoose` — may they pick a model at all (paid plan OR a connected provider)?
 *               This is the SAME gate the gateway enforces on a strict pin, so the
 *               label a user reads and the choice they are offered agree by construction.
 */
interface ModelIdentityContext {
    product: RoutedProduct;
    canChoose: boolean;
}
/**
 * The safe default: a free, choice-less viewer. Deliberately the FALLBACK for a host
 * that has not wired an identity yet, so the failure mode of forgetting is "masked",
 * never "leaked". A host that is wired always passes its own.
 */
declare const DEFAULT_MODEL_IDENTITY: ModelIdentityContext;
/** The product name for this viewer — "Builderforce Free" / "Builderforce PRO". */
declare function productModelName(identity: ModelIdentityContext | null | undefined): string;
/** Which product a plan funds. One mapping, so "paid ⇒ PRO" is not re-decided per host. */
declare function productForPlan(isPaid: boolean): RoutedProduct;
/** True when `model` is a user-configured ref (Evermind head / saved LLM config)
 *  rather than an upstream catalog id. */
declare function isUserConfiguredModelRef(model: string | null | undefined): boolean;
/**
 * THE decision: may this viewer be shown the raw model id, or do they get the product
 * name? See the module header for the rule. `account` is the turn's provenance account
 * when known — a turn served by the tenant's OWN connected account always names its
 * model, because that model is the thing they connected.
 */
declare function revealsModelId(identity: ModelIdentityContext | null | undefined, account?: ProvenanceAccount): boolean;
/**
 * The name to PUT ON SCREEN for `model`. Returns the model id when this viewer owns the
 * choice (see {@link revealsModelId}) or when the ref names something they configured
 * themselves; otherwise the routing product's name.
 *
 * Every surface that renders a model to a user goes through this — the composer menu,
 * the provenance chip, the QuickPick — so a masked plan cannot leak an upstream id
 * through whichever surface was written last.
 */
declare function displayModelName(model: string | null | undefined, identity: ModelIdentityContext | null | undefined, opts?: {
    account?: ProvenanceAccount;
}): string;

/**
 * WHAT A RATING IS ABOUT — the pure rule that turns "the user pressed 👎 on this
 * reply" into the two facts the learned router needs: WHICH MODEL served the turn,
 * and WHICH MCP TOOL it executed.
 *
 * "Some models are better than others at specific tasks" is only measurable if a
 * rating is filed against the task, and the task a chat turn performed is the tool
 * it called. That association is derivable from the transcript itself: the agent
 * loop persists each tool call as a durable STEP row (see `persistedSteps.ts`) that
 * sits between the user's question and the assistant's answer. Walking back from
 * the rated reply to the steps of ITS turn therefore works after a reload, unlike
 * the in-memory trace, which is empty on a freshly-opened chat.
 *
 * Pure and host-agnostic: the web Brain panel, the Canvas dock and the VS Code
 * webview all mount the same transcript and all call this, so a rating means the
 * same thing wherever it was pressed.
 */
/** The minimum message shape this rule needs — every surface's own `BrainMessage`
 *  satisfies it, so nothing has to be converted to call in. */
interface RatableMessage {
    id: number;
    role: string;
    metadata?: string | null;
}
/** Everything a rating carries beyond the thumb itself. */
interface RatedTurnContext {
    /** The model the gateway actually resolved for this reply, from its provenance.
     *  Empty when the turn predates provenance — the caller must then skip the
     *  rating rather than attribute it to a guess. */
    model: string;
    /** The MCP tool the rated turn executed, or null for a prose-only reply. */
    toolName: string | null;
}
/**
 * The tool a rated turn executed. Walks BACK from the reply over the durable step
 * rows that belong to the same turn (they sit between it and the previous
 * conversation message) and returns the LAST tool step — the one whose result the
 * reply is actually reporting on, and therefore the one being judged.
 *
 * Returns null for a turn that called nothing. That is a real and common case, and
 * a rating with no tool is still evidence about the model: "it answered badly" is a
 * verdict, and forcing it into some tool's bucket would libel that tool.
 */
declare function ratedTurnTool(messages: readonly RatableMessage[], messageId: number): string | null;
/**
 * Build the full rating context for one assistant reply. `model` comes from the
 * reply's own persisted provenance, so it is the id the gateway resolved after any
 * failover — never the model the composer happened to be showing.
 */
declare function ratedTurnContext(messages: readonly RatableMessage[], messageId: number): RatedTurnContext;

/**
 * The model id the most recent completion ACTUALLY resolved to.
 *
 * The gateway auto-selects per turn (a connected BYO account, the learned reorder, or
 * a cascade failover can all change which model answers), and it reports the winner on
 * the `x-builderforce-model` response header — which `streamChatCompletion` already
 * surfaces as `StreamChatResult.resolvedModel`. That value was previously only used for
 * after-the-fact triage, so the assistant itself had no way to answer "what model are
 * you running on?" — it would guess, or say it didn't know.
 *
 * Recording it here lets the `builtin_session_current_model` MCP tool be answered with
 * the EXACT model that served the turn instead of the plan default: the MCP bridge reads
 * this and passes it as the tool's `model` argument (an MCP call is a separate request,
 * so the server cannot see the chat's resolved model on its own).
 *
 * Module-level by design, matching the surface: both hosts (the web Brain and the VS
 * Code extension) are single-user processes, and the tool call always lands immediately
 * after the turn that set this. It is therefore "the active conversation's last model" in
 * practice. Deliberately NOT per-chat state — that would need threading through every
 * hook for no behavioural gain at this granularity.
 */
/** Record the model a completion resolved to. Ignores empty values so a turn that
 *  reported no model leaves the previous (still-accurate) answer intact. */
declare function setLastResolvedModel(model: string | undefined | null): void;
/** The model the last completion resolved to, or undefined before any turn has run. */
declare function getLastResolvedModel(): string | undefined;

/**
 * Context used only to choose tools for a turn.
 *
 * A correction such as "actually, make those weekly" contains almost no domain
 * nouns. Scoring tools against that sentence alone drops the scheduler/project
 * tools selected for the preceding request. Keep a small, bounded tail of user
 * intent so follow-ups inherit the task they refine without resending a whole chat.
 */
declare function routingQueryForTurn(messages: readonly ChatCompletionMessage[]): string;
/**
 * Small, stable model-facing contract that makes context-efficiency a platform
 * responsibility instead of a collection of user prompting rituals.
 */
declare function turnOptimizationDirective(): string;

/**
 * chatDiagnostics — a pure serializer for the "Copy diagnostics" action.
 *
 * The plain transcript (turns + tool I/O) answers "what did the model say?"; this
 * answers "what STATE was this chat in?" — the identity + wiring facts you otherwise
 * have to guess at from screenshots: the chat's own project, the tenant, the project
 * Evermind head (version / mode / learned / queued / last-learned), the learn-gate
 * outcome for the last turn, the agents invited into the chat, and the linked tickets.
 *
 * It is the fix for a whole class of "even after N fixes I can't tell what's wrong"
 * loops: the #1 real cause of "Learning · Connected yet nothing learns" is that the
 * CHAT is bound to a different project (or none) than the panel shows — a fact invisible
 * in the UI but dumped plainly here, with a Signals section that names the likely cause.
 *
 * Pure + host-agnostic (no fetch, no DOM): every surface gathers the data its own way
 * and calls this ONE renderer, so the copied report is identical on web and in VS Code.
 */
/** The project Evermind head/activity snapshot, as the panel reads it. */
interface ChatDiagnosticsEvermind {
    version: number;
    mode: string;
    inferenceEnabled?: boolean;
    teacherModel?: string | null;
    /** Merged contributions to date — the panel's "Learned". */
    contributions?: number;
    /** Queued-but-not-yet-merged contributions — the panel's "Queued". */
    pending?: number;
    /** ISO timestamp of the last merge, or null if never — the panel's "Last learned". */
    lastLearnedAt?: string | null;
}
/** One metered resource, mirroring the `/api/consumption` meter snapshot shape. */
interface ChatDiagnosticsMeter {
    /** 'ai_tokens' | 'ingestion' | 'error_events' | 'outbound_fetches' | 'cloud_runs' */
    key: string;
    /** 'tokens' | 'bytes' | 'events' | 'fetches' | 'runs' */
    unit: string;
    used: number;
    /** Monthly allowance; -1 = unlimited. */
    limit: number;
    unlimited: boolean;
    /** Remaining this month; -1 when unlimited. */
    remaining: number;
    /** 0–100; 0 when unlimited. */
    percentUsed: number;
}
/**
 * WHO the user is to the platform and WHAT they are allowed to spend — the half of
 * "why is this chat behaving like that?" that identity + Evermind state can't answer.
 *
 * The motivating case is a brand-new signup: free plan, no card, a small token
 * allowance and no premium/frontier entitlement. From the outside that looks
 * indistinguishable from a broken install ("it picked a weak model", "it stopped
 * answering") — so the report states the plan, the billing status, the month-to-date
 * meters, and the model entitlement explicitly, and the Signals section names the
 * consequence rather than leaving the reader to infer it.
 */
interface ChatDiagnosticsAccount {
    /** Effective plan key ('free' | 'pro' | …) as the API resolves it. */
    plan?: string | null;
    /** Billing status ('none' = no payment method on file, 'trialing', 'active', …). */
    billingStatus?: string | null;
    /** Current metering period — when the allowances reset. */
    periodStart?: string | null;
    resetsAt?: string | null;
    /** Month-to-date usage vs allowance for every metered resource. */
    meters?: ChatDiagnosticsMeter[];
    /** The model in force for this chat (absent ⇒ the gateway routes per turn). */
    model?: string | null;
    /** Which purse funds `model`: 'byo:<vendor>' | 'plan' | 'premium' | 'auto'. */
    modelFunding?: string | null;
    /** Whether the plan entitles the tenant to premium/frontier models. */
    canUsePremiumModels?: boolean;
    /** How many models the plan pool currently offers. */
    planModelCount?: number;
    /** Connected bring-your-own provider keys (empty ⇒ every turn is plan-funded). */
    byoProviders?: string[];
    /** Client build + gateway it is talking to, so a report pins the exact surface. */
    extensionVersion?: string | null;
    baseUrl?: string | null;
}
/**
 * WHICH purse funds a model, as a machine key: `auto` (no pin — the gateway routes per
 * turn), `evermind` (the project's own learned head), `byo:<vendor>` (the tenant's own
 * connected account), `plan` (in the plan pool, included), or `premium` (metered at
 * cost + per-request fee).
 *
 * ONE decision, two consumers: the chat header renders a localized sentence from it and
 * the diagnostics report records it. Kept here (not in a UI file) so the sentence a user
 * READS and the key a support report SHOWS can never disagree.
 */
declare function classifyModelFunding(model: string | null | undefined, surface: {
    data?: Array<{
        id?: string;
    }>;
    byo?: {
        models?: Array<{
            id?: string;
            vendor?: string;
        }>;
    };
} | null | undefined): string;
/** Everything the diagnostics block needs — already gathered by the host (pure in). */
interface ChatDiagnosticsData {
    surface?: string;
    chatId?: number | null;
    chatTitle?: string | null;
    /** 'shared' | 'locked' — who can see the chat. */
    chatVisibility?: string | null;
    /** The chat's OWN project (what the learn gate keys on), or null when unattached. */
    projectId?: number | null;
    projectName?: string | null;
    /**
     * The project the surrounding UI/panel currently has SELECTED — `null` when nothing is
     * selected. Always reported (never conditionally omitted): "no project is selected" and
     * "a project IS selected but the chat never adopted it" have opposite causes and
     * opposite fixes, and a report that prints only the chat's project renders them
     * identically as `Chat's project: none`. Reading that ambiguity the wrong way once cost
     * a wrong revert.
     */
    selectedProjectId?: number | null;
    /** Display name for {@link selectedProjectId}, when the host holds one. */
    selectedProjectName?: string | null;
    tenantId?: number | string | null;
    userId?: string | null;
    /** The project Evermind head for the CHAT's project (not the selected one). */
    evermind?: ChatDiagnosticsEvermind | null;
    /** The server learn-gate outcome for the most recent assistant turn, if known. */
    lastLearn?: {
        learned: boolean;
        version: number;
        reason?: string | null;
    } | null;
    agents?: Array<{
        agentRef: string;
        role: string;
    }>;
    tickets?: Array<{
        kind: string;
        ref: string;
        label?: string;
        linkType?: string;
        status?: string;
    }>;
    /** Plan, quota and model entitlement for the signed-in tenant (see the interface). */
    account?: ChatDiagnosticsAccount | null;
    /**
     * How many tools the model could actually call, and why not more. Without this
     * a tool-less Brain ("I don't have that data", zero tool calls) is
     * indistinguishable from a model that simply chose not to call anything — the
     * exact ambiguity that made a silent MCP-catalog failure impossible to diagnose.
     *
     * `advertisedMin`/`advertisedLastTurn` are the OBSERVED per-turn numbers, read off
     * the run's trace (`toolExposureInTrace`). They exist because this line used to
     * render the per-turn CEILING (`up to 64 advertised`) while the Diagnostics block
     * directly below it rendered the real measured range off the same run — two lines
     * in one report answering the same question differently, and the ceiling was the
     * one that was always wrong for the turn that actually failed.
     */
    tools?: {
        count: number;
        error?: string | null;
        loading?: boolean;
        /** Fewest tools advertised on any measured turn; null when no turn was measured. */
        advertisedMin?: number | null;
        /** Tools advertised on the LAST measured turn; null when no turn was measured. */
        advertisedLastTurn?: number | null;
    } | null;
    /**
     * Which BUILD produced this capture. Without it a dump taken minutes before a
     * deploy is indistinguishable from one taken after, so a fixed bug reads as
     * unfixed — which is exactly what happened while debugging chat #71.
     */
    versions?: {
        ui?: string | null;
        api?: string | null;
        /**
         * Short SOURCE HASH of the client build.
         *
         * A version names a RELEASE, not an ARTIFACT: a client can be rebuilt and
         * redistributed under the same version with different code, at which point `ui`
         * alone makes a fixed bug read as unfixed. On 2026-07-25 exactly that happened —
         * two `2026.7.104` VSIXes, one with an agent-stall recovery fix and one without,
         * and the report said `UI 2026.7.104` for both. This is the field that separates
         * them; `"dev"` means the surface was not running a packaged artifact at all.
         */
        uiBuildId?: string | null;
        /** When the client artifact was built, so two builds of the same source are orderable. */
        uiBuiltAt?: string | null;
    } | null;
}
/** How close a metered allowance is to stopping turns. */
type AllowanceState = 'ok' | 'warn' | 'exhausted';
/**
 * Classify a token allowance. THE single definition of the thresholds — the
 * diagnostics signals below and any host banner must agree on when to warn, or a
 * user gets a scary banner and a calm report (or vice versa).
 *
 * Takes the structural meter shape, so hosts can pass their own
 * `/api/consumption` snapshot meter without converting it.
 *
 * `unlimited` is authoritative: a tenant the gateway does not cap must never be
 * told it is out of tokens, however large `used` grows.
 */
declare function allowanceState(meter: {
    unlimited: boolean;
    remaining: number;
    percentUsed: number;
} | null | undefined): AllowanceState;
/**
 * Render the diagnostics block as Markdown lines (no trailing blank line). Every field
 * is best-effort: an absent value is shown as "unknown"/"none" rather than omitted, so
 * the reader can tell "not gathered" from "genuinely empty".
 */
declare function formatChatDiagnostics(d: ChatDiagnosticsData): string[];

/**
 * gatherChatDiagnostics — the one ASSEMBLER behind every "Copy diagnostics" report.
 *
 * {@link formatChatDiagnostics} has always been shared, so the two surfaces RENDER
 * identically. What was not shared was the step before it: each host built its own
 * {@link ChatDiagnosticsData} inline — the VS Code webview inside `App.tsx`'s
 * `copyTranscript` callback, the web app inside `BrainPanel.tsx`'s `captureExecution`,
 * the headless probe inside `probe.ts`. Three assemblies of one object, and they
 * drifted exactly as three copies do: the probe's report silently omitted
 * `projectName`, `chatVisibility`, `modelFunding` and `extensionVersion`, because those
 * four were assembled from React state the probe has no access to. A report that is
 * "equivalent" to a Copy click is not the same thing as one that is byte-identical to
 * it, and only the second can be used to reproduce a user's capture.
 *
 * So the assembly lives here, host-agnostic: the caller supplies the facts it already
 * holds and READERS for the facts it has to fetch, and this owns the parts that must
 * not be re-derived — running every read concurrently, degrading each one
 * independently to null/[], reading the observed per-turn tool exposure off the trace,
 * and classifying which purse funds the model.
 *
 * Pure of fetch, DOM and React: the readers are injected, so the same function serves
 * a webview, a Next.js client component and a Node CLI.
 */

/** The `/api/consumption` snapshot, structurally — each host has its own named type
 *  for it, and they agree on exactly these fields. */
interface ChatDiagnosticsPlanSnapshot {
    period: {
        start: string;
        resetsAt: string;
    };
    plan: {
        effective: string;
        billingStatus: string;
    };
    meters: ChatDiagnosticsMeter[];
}
/** The `/llm/v1/models` surface, structurally — enough to classify funding and to
 *  count what the plan pool offers. */
interface ChatDiagnosticsModelSurface {
    data?: Array<{
        id?: string;
    }>;
    byo?: {
        providers?: string[];
        models?: Array<{
            id?: string;
            vendor?: string;
        }>;
    };
    canUsePremiumModels?: boolean;
}
/** The `/api/projects/:id/evermind/contributions` head, structurally. */
interface ChatDiagnosticsEvermindHead {
    version: number;
    mode: string;
    inferenceEnabled?: boolean;
    teacherModel?: string | null;
    contributions?: number;
    pending?: number;
    lastLearnedAt?: string | null;
}
/** The minimum of a message this needs: the last assistant turn's learn outcome.
 *  Structural on purpose so a host can pass its own message array unchanged. */
interface ChatDiagnosticsMessageLike {
    role: string;
    evermindLearn?: {
        learned: boolean;
        version: number;
        reason?: string | null;
    } | null;
}
/**
 * Everything the report needs, split into what the host KNOWS and what it must READ.
 *
 * Every reader is optional and best-effort: an omitted one is simply "not gathered"
 * and a rejecting one degrades to null/[]. That is deliberate — a diagnostics capture
 * whose whole point is to explain a broken chat must never itself fail because one of
 * the endpoints it asks about is the broken one.
 */
interface ChatDiagnosticsSources {
    /** Which surface produced the capture ('Web' | 'VS Code (VSIX)' | …). */
    surface: string;
    chatId?: number | null;
    chatTitle?: string | null;
    /** 'shared' | 'locked'. */
    chatVisibility?: string | null;
    /** The CHAT's own project — what the learn gate keys on. */
    projectId?: number | null;
    projectName?: string | null;
    /** The project the surrounding UI currently has SELECTED — `null` when none is.
     *  Always reported, so "nothing selected" stays distinguishable from "selected but
     *  the chat never adopted it" (see `ChatDiagnosticsData.selectedProjectId`). */
    selectedProjectId?: number | null;
    /** Display name for {@link selectedProjectId}, when the host holds one. */
    selectedProjectName?: string | null;
    tenantId?: number | string | null;
    userId?: string | null;
    /** The transcript — read only for the newest assistant turn's learn outcome. */
    messages?: readonly ChatDiagnosticsMessageLike[];
    /** The live tool registry the conversation runs on, and why it might be short. */
    tools?: {
        count: number;
        error?: string | null;
        loading?: boolean;
    };
    /** The run's trace, so the report states the tools the model was ACTUALLY handed
     *  per turn rather than a ceiling derived from the registry size. */
    trace?: readonly BrainTraceEvent[];
    /** The model pinned for this chat, or null when the gateway routes per turn. */
    model?: string | null;
    /** The model surface the pickers already loaded — reused, never re-fetched. */
    modelSurface?: ChatDiagnosticsModelSurface | null;
    /** The build that produced the capture (extension version / web app version). */
    uiVersion?: string | null;
    /** Short SOURCE HASH of the client artifact — the identity `uiVersion` cannot carry
     *  (two artifacts can share a version and differ in code). `"dev"` when unbundled. */
    uiBuildId?: string | null;
    /** ISO timestamp the client artifact was built. */
    uiBuiltAt?: string | null;
    /** The gateway this surface is talking to. */
    baseUrl?: string | null;
    /** Resolve the chat project's NAME when the host does not already hold it (the two
     *  UI surfaces read it from a loaded project list; the headless probe has none).
     *  Wins over the static `projectName` above when it answers. */
    readProjectName?: () => Promise<string | null>;
    readAgents?: () => Promise<Array<{
        agentRef: string;
        role: string;
    }>>;
    readTickets?: () => Promise<Array<{
        kind: string;
        ref: string;
        label?: string;
        linkType?: string;
        status?: string;
    }>>;
    readEvermind?: () => Promise<ChatDiagnosticsEvermindHead | null>;
    readPlan?: () => Promise<ChatDiagnosticsPlanSnapshot | null>;
    /** Resolve the deployed API version — bounded + session-cached by
     *  `fetchApiVersionVia`, which every host reaches it through. */
    readApiVersion?: () => Promise<string | null>;
}
/**
 * Assemble the diagnostics payload. Resolves — never rejects — so a caller can hand
 * the result straight to {@link formatChatDiagnostics} without a try/catch that would
 * only ever produce a worse report.
 */
declare function gatherChatDiagnostics(src: ChatDiagnosticsSources): Promise<ChatDiagnosticsData>;

/**
 * WHICH MODELS a chat surface may offer, in WHAT ORDER, and WHO PAYS for each —
 * the model-choice domain, with no UI in it.
 *
 * It lives here rather than in the React UI package because three very different
 * surfaces have to agree on it: the shared `/` composer menu (web + VS Code
 * webview), and the VS Code extension HOST's `Change model` QuickPick, which runs
 * in the Node extension process and cannot import React. When each owned its own
 * list they drifted on grouping order, on how a connected provider was named, and
 * on the sentence that told the user who was being billed.
 */

/** The gateway pin that expands to a project's CURRENT Evermind head at call time.
 *  Mirrors `PROJECT_EVERMIND_MODEL_PREFIX` on the gateway (api/.../projectEvermind.ts). */
declare const PROJECT_EVERMIND_MODEL_PREFIX = "project_evermind:";
/** What the user picked. `auto` lets the gateway route; `byo_pool` walks the
 *  tenant's connected accounts in their configured priority order; `model` is a
 *  strict pin. */
type ChatModelSelection = {
    mode: 'auto';
} | {
    mode: 'byo_pool';
} | {
    mode: 'model';
    model: string;
};
/** The selectable model surface, grouped by WHO PAYS (see {@link ModelCategory}). */
interface ChatModelOptions {
    /** Tenant-defined named LLM configs (`tenant_model:<slug>`). */
    configured?: Array<{
        id: string;
        label: string;
    }>;
    /** Models the tenant's own connected provider accounts can serve. */
    byo: Array<{
        id: string;
        vendor: string;
        cost?: string;
    }>;
    free: Array<string | {
        id: string;
        cost?: string;
    }>;
    plan: Array<string | {
        id: string;
        cost?: string;
    }>;
    paid: Array<string | {
        id: string;
        cost?: string;
    }>;
}
/** Funding tier of a model row — the axis the list is grouped and filtered by. */
type ModelCategory = 'auto' | 'byo' | 'free' | 'plan' | 'paid' | 'configured';
/** One row in the model list. `detail` is the funding sentence for that row. */
interface ModelItem {
    key: string;
    label: string;
    detail: string;
    category: ModelCategory;
    selection: ChatModelSelection;
}
/**
 * The strings a model list needs. Hosts pass their own localized bundle (the web
 * app via next-intl, the VS Code surfaces via `vscode.l10n`); the English defaults
 * keep the list readable unmapped. The composer menu's own chrome extends this
 * (see `PromptOptionsLabels` in brain-ui).
 */
interface ModelChoiceLabels {
    categoryAuto: string;
    categoryByo: string;
    categoryFree: string;
    categoryPlan: string;
    categoryPaid: string;
    categoryConfigured: string;
    /** The funding sentence for the routed row. Its NAME comes from the product
     *  ({@link BUILDERFORCE_PRODUCT_NAME}), not from a label — a brand token is not
     *  translated, and the tier it states must match what the gateway actually funds. */
    autoDetail: string;
    poolLabel: string;
    poolDetail: string;
    freeDetail: string;
    planDetail: string;
    paidDetail: string;
    /** Per-model premium price line. `{input}` / `{output}` are the formatted
     *  per-1M-token rates (see {@link premiumCostLabel}). */
    paidCostDetail: string;
    /** `{vendor}` is substituted with the connected provider's display name. */
    byoDetail: string;
    configuredDetail: string;
    /** Display name for a `project_evermind:<id>` pin (the raw pin is not a model name). */
    evermindLabel: string;
    /** Funding line for a `project_evermind:<id>` pin (a plan feature, not a catalog model). */
    evermindDetail: string;
}
declare const DEFAULT_MODEL_CHOICE_LABELS: ModelChoiceLabels;
declare function byoVendorLabel(vendor: string): string;
/** A gateway per-token rate as the per-1M-token price every surface quotes. */
declare function perMillionUsd(rate: number): string;
/**
 * What a premium (metered) model costs, formatted from the gateway's per-token
 * rates against the host's localized `paidCostDetail` line. For a host with an
 * ICU formatter (the web app) prefer interpolating {@link perMillionUsd} through
 * it; this is the plain-substitution path for hosts without one.
 */
declare function premiumCostLabel(pricing: {
    prompt: number;
    completion: number;
}, template: string): string;
/** The categories, in display order. Only the populated ones are ever offered. */
declare const MODEL_CATEGORIES: ModelCategory[];
declare function modelCategoryLabel(category: ModelCategory, labels: ModelChoiceLabels): string;
/**
 * Every selectable route, ordered by what it COSTS the user: BuilderForce
 * collections (free → plan → paid) lead, then the tenant's own connected
 * accounts (BYO pool + its models, in the server-supplied provider priority
 * order), then saved workspace LLM configs. A model already listed in a cheaper
 * group is never repeated.
 *
 * `identity` names the ROUTED row after the product that actually funds it —
 * "Builderforce Free" / "Builderforce PRO" rather than a bare "Auto" — because that
 * is the thing the user bought and the only honest answer to "what am I running on?"
 * when the gateway picks per turn. Omit it and the row degrades to the free product
 * (see {@link DEFAULT_MODEL_IDENTITY}: the safe default is masked, never leaked).
 */
declare function buildModelItems(options: ChatModelOptions, labels: ModelChoiceLabels, identity?: ModelIdentityContext): ModelItem[];
/** The key identifying the active row (matches {@link ModelItem.key}). */
declare function activeModelKey(selection: ChatModelSelection): string;
/** Search + category narrowing. Matches label, funding detail, and category name. */
declare function filterModelItems(items: ModelItem[], labels: ModelChoiceLabels, query: string, category: 'all' | ModelCategory): ModelItem[];
/**
 * What is ACTUALLY running the next turn, said in one line: the pinned model, the
 * BYO pool, or — under `auto` — the routing PRODUCT that funds it.
 *
 * `effective` (what the host resolved an `auto` turn to) is honoured only when it names
 * something the user owns: a project-Evermind head, a saved workspace LLM config, or —
 * for a viewer entitled to pick models at all — a catalog id. On a routed plan the
 * answer is the product, not the upstream model the cascade happened to reach for; see
 * `modelIdentity.ts` for why. This is the fix for a free-plan composer that announced
 * "minimaxai/minimax-m3" beside a menu that would not let the user change it.
 */
declare function modelInUse(selection: ChatModelSelection, items: ModelItem[], labels: ModelChoiceLabels, effective?: string, identity?: ModelIdentityContext): {
    name: string;
    detail: string;
};

/**
 * Last-known state of the MCP tool catalog fetch — a module singleton, mirroring
 * `lastResolvedModel`.
 *
 * Why this exists: `useMcpExtensions` fetches the gateway's tool catalog, and a
 * failure there (401, 500, network) used to collapse silently to an EMPTY tool
 * list. The Brain then has no data tools, so every answer becomes "I don't have
 * that data" / "calling the tool now" followed by nothing — indistinguishable from
 * a weak model, and invisible in the diagnostics dump.
 *
 * The hook publishes here; the diagnostics reporter reads it, so "how many tools
 * did the model actually have?" is always answerable after the fact.
 */
interface McpToolStatus {
    /** Tools registered into the Brain's loop (0 = the model can call nothing). */
    count: number;
    /** Why the catalog fetch failed, when it did. Null on success. */
    error: string | null;
    /** True until the first fetch settles. */
    loading: boolean;
}
declare function setMcpToolStatus(next: McpToolStatus): void;
declare function getMcpToolStatus(): McpToolStatus;

/**
 * Per-turn tool selection.
 *
 * The Brain's catalog has grown to ~300 tools (205 first-party `builtin_*` entries
 * plus tenant MCP servers and navigation). Sending ALL of them on every turn is
 * the failure mode this module exists to fix:
 *
 *   - Most providers degrade sharply past ~128 tool definitions, and small
 *     free-pool models routinely respond to an oversized catalog by emitting NO
 *     tool calls at all — observed live: a chart request answered with "I do not
 *     have the task status data", zero tool calls, three times running, with 308
 *     tools advertised.
 *   - Every definition carries a JSON schema, so the catalog alone can dominate
 *     the prompt budget before the conversation is even considered.
 *
 * The selection is LEXICAL and deterministic — no embeddings, no extra round trip,
 * no network. It scores each tool against the live turn's text and keeps the best
 * `limit`, while pinning anything the run has already touched so a multi-step task
 * never loses a tool mid-flight.
 *
 * Safety posture: when in doubt, INCLUDE. A catalog at or under the limit is
 * returned untouched, so small deployments behave exactly as before.
 */

/**
 * How many tools to advertise per turn. Comfortably under the ~128 threshold where
 * providers start to degrade, while leaving room for a broad request to still see
 * several domains at once.
 */
declare const DEFAULT_TOOL_LIMIT = 64;
interface SelectToolsOptions {
    /** The turn's text — typically the latest user message. */
    query: string;
    /** Max tools to advertise. Defaults to {@link DEFAULT_TOOL_LIMIT}. */
    limit?: number;
    /**
     * Tool names already called in this run. Always kept regardless of score, so a
     * multi-step task cannot lose a tool it is mid-way through using.
     */
    pinned?: Iterable<string>;
    /**
     * Tool names the SYSTEM PROMPT instructs the model to call. Kept ahead of
     * everything else, because advertising less than the prompt promises is a
     * contradiction the model can only resolve by narrating a call it cannot make.
     */
    required?: Iterable<string>;
}
interface ToolSelection {
    tools: BrainToolSpec[];
    /** True when the catalog was trimmed (i.e. selection actually applied). */
    trimmed: boolean;
    /** Size of the catalog before selection — recorded in the run trace. */
    available: number;
}
/**
 * Choose the tools to advertise for one turn.
 *
 * Order of inclusion: pinned tools first (continuity), then by descending
 * relevance, then — if the limit is still unmet — catalog order, so a vague query
 * ("help me") still gets a usable, stable set rather than an arbitrary one.
 */
declare function selectToolsForTurn(tools: BrainToolSpec[] | undefined, options: SelectToolsOptions): ToolSelection;

/**
 * The tool ROUTER — the escape hatch that makes per-turn tool selection lossless.
 *
 * The problem with advertising a relevance-picked subset of a ~317-tool catalog is
 * not that it picks badly; it is that picking AT ALL is lossy and the model has no
 * way to know. A tool that misses the cut simply does not exist from where the model
 * is standing, so a request that needs it ends in a narrated call or an "I don't have
 * that data" — with no signal that the capability was there all along, one rank below
 * the cut. Worse, the cut is recomputed per turn, so a tool can be present on one
 * turn and gone on the next.
 *
 * The fix is a different DATA STRUCTURE rather than a better ranking: keep advertising
 * the relevant leaves for ergonomics, and additionally advertise three small, FIXED
 * tools that together reach every tool in the catalog:
 *
 *   find     → search the full catalog by keyword          (name + description only)
 *   describe → fetch one tool's exact JSON schema           (so args can be built)
 *   invoke   → call any tool in the catalog by name         (dispatch to the real one)
 *
 * Cost is three schemas per turn instead of 317, and the guarantee flips: nothing is
 * ever unreachable, only less convenient. This is progressive disclosure — the model
 * pays a round trip for the long tail and nothing for the hot set.
 *
 * Everything resolves against the in-memory catalog the run already holds, so `find`
 * and `describe` cost no network at all.
 */

/** Advertised names of the three router tools. Stable — the model learns them. */
declare const TOOL_ROUTER_FIND = "builtin_tools_find";
declare const TOOL_ROUTER_DESCRIBE = "builtin_tools_describe";
declare const TOOL_ROUTER_INVOKE = "builtin_tools_invoke";
/** True when `name` is one of the router's own tools (not a catalog tool). */
declare function isRouterTool(name: string): boolean;
/**
 * The three router specs. Their descriptions are written AT the model: they have to
 * make it obvious that a missing tool is a lookup away, because a model that does not
 * know the catalog is bigger than its tool list will never think to look.
 */
declare function routerToolSpecs(catalogSize: number): BrainToolSpec[];
/** One catalog entry as `find` reports it. */
interface ToolCatalogMatch {
    name: string;
    description: string;
}
/**
 * Keyword search over the FULL catalog. Ranks a name match above a description match
 * (the same weighting `selectTools` uses — the model should see the tool whose NAME is
 * about tickets before one that merely mentions them).
 */
declare function findTools(catalog: BrainToolSpec[], query: string, limit?: number): ToolCatalogMatch[];
/** The exact spec for one catalog tool, or null when the name is unknown. */
declare function describeTool(catalog: BrainToolSpec[], name: string): BrainToolSpec | null;
/**
 * Run a router call against the in-memory catalog.
 *
 * `find` and `describe` are answered locally (no network). `invoke` unwraps to a real
 * catalog call and is dispatched by the caller through `runTool`, so every guard the
 * normal path applies — confirmation gate, dedupe, audit, auto-link — still applies to
 * a routed call. Returns `{ dispatch }` for that case rather than calling anything
 * itself, keeping this module pure.
 */
declare function handleRouterCall(catalog: BrainToolSpec[], name: string, args: unknown): {
    result: unknown;
} | {
    dispatch: {
        name: string;
        args: unknown;
    };
};

/**
 * WHERE a linked work item OPENS — one routing table, every surface.
 *
 * The chat⇄ticket panel renders an "Open" affordance for each item a conversation
 * created or linked. Turning `(kind, ref, projectId)` into a destination was written
 * TWICE — once in the web host (`ChatTicketsPanel`'s `openTicket`, pushing through the
 * Next router) and once in the VS Code host (`brainWebview.openArtifact`, opening an
 * external URL). The two agreed on the day they were written and then drifted, which is
 * exactly the class of duplication the repo forbids: the same decision, expressed twice,
 * with nothing making them equal.
 *
 * They also both stopped SHORT of the item. A task deep-linked to its detail drawer
 * (`&task=<id>`), but every other kind landed on the SURFACE that contains the item and
 * left the user to find the card: an objective opened the portfolio tab, a spec opened
 * the project board. "Open" that reveals a page is not opening the thing.
 *
 * So this module returns a path that names the EXACT artifact for every kind:
 *
 *   task · epic · gap   → the ticket detail drawer               (`&task=`)
 *   objective · initiative · portfolio
 *                       → the PMO Structure tab, that card focused and scrolled to
 *                                                                 (`&focus=kind:id`)
 *   spec                → the project's PRDs tab with that document's drawer open
 *                                                                 (`&panel=prds&spec=`)
 *   roadmap             → the PM Roadmap section with that item's panel open
 *                                                                 (`&section=roadmap&roadmap=`)
 *   retro · poker       → the ceremony session itself             (`&session=`)
 *
 * Framework-free on purpose (plain strings in, one path out): the web host feeds it to
 * `router.push`, the VS Code host concatenates it onto the configured web base URL, and
 * neither can be given a route the other does not have.
 */
/** Every work-item kind a Brain chat can be tied to. Mirrors `TICKET_KINDS`. */
type ArtifactKind = 'portfolio' | 'objective' | 'initiative' | 'roadmap' | 'spec' | 'epic' | 'gap' | 'task' | 'retro' | 'poker';
/**
 * The query param the PMO views read to focus ONE strategy card, as `kind:id`.
 * A single param (rather than `focusKind` + `focusId`) keeps the two halves
 * inseparable — a link cannot carry an id with no kind to interpret it.
 */
declare const PMO_FOCUS_PARAM = "focus";
/** Build the `focus` value for a strategy card. */
declare function pmoFocusValue(kind: 'objective' | 'initiative' | 'portfolio', ref: string): string;
/** Parse a `focus` value back into its halves; `null` for anything unrecognised. */
declare function parsePmoFocus(value: string | null | undefined): {
    kind: 'objective' | 'initiative' | 'portfolio';
    id: string;
} | null;
/**
 * The DOM id a focusable PMO card carries, so the view can scroll to it without
 * threading refs through three levels of render helper. Derived from the same
 * `kind:id` pair the URL carries, so the link and the element cannot disagree.
 */
declare function pmoFocusDomId(kind: string, id: string): string;
/**
 * The path that opens ONE work item.
 *
 * `projectId` scopes the kinds that live under a project (task/epic/gap/spec/roadmap);
 * strategy tiers and ceremonies are workspace-wide and ignore it. Returns an absolute,
 * same-origin path — never a full URL, so the VS Code host stays in control of which
 * deployment it opens.
 */
declare function artifactRoutePath(kind: string, ref: string | null | undefined, projectId?: number | null): string;

export { ADDRESSED_TO_META_KEY, API_VERSION_PROBE_TIMEOUT_MS, API_VERSION_TTL_MS, AUTHORED_BY_META_KEY, type AgentDispatchActivity, type AllowanceState, type ArtifactKind, type AssembledToolCall, BUILDERFORCE_PRODUCT_NAME, type BrainAction, type BrainActionsContextValue, BrainActionsProvider, type BrainChat, type BrainConfig, BrainContextProvider, type BrainContextValue, type BrainDiagnostics, type BrainMessage, type BrainModality, type BrainPageContext, type BrainPersistenceAdapter, BrainProvider, type BrainRunPersistence, type BrainRunRequest, type BrainRunSnapshot, type BrainRuntime, type BrainStreamFn, type BrainToolSpec, type BrainTraceEvent, type BrainTransport, type BuildBrainTriageOptions, type ByoUnresolvedEntry, CHAT_MODES, CHAT_MODE_ICON, CODE_CHANGE_TOOLS, CONSOLIDATION_MARKER_PREFIX, CONSOLIDATION_META, type ChatActivity, type ChatActivityLabels, type ChatCompletionMessage, type ChatDiagnosticsAccount, type ChatDiagnosticsData, type ChatDiagnosticsEvermind, type ChatDiagnosticsEvermindHead, type ChatDiagnosticsMessageLike, type ChatDiagnosticsMeter, type ChatDiagnosticsModelSurface, type ChatDiagnosticsPlanSnapshot, type ChatDiagnosticsSources, ChatErrorAction, type ChatInputAttachment, type ChatMode, type ChatModelOptions, type ChatModelSelection, type CompletionMetadata, type ComposerDirectiveOptions, type ContentPart, type CreatedWorkItemLink, DEFAULT_CHAT_ACTIVITY_LABELS, DEFAULT_CHAT_TITLE, DEFAULT_MODEL_CHOICE_LABELS, DEFAULT_MODEL_IDENTITY, DEFAULT_TOOL_LIMIT, type DirectedRecipient, EVERMIND_LEARN_MIN_CHARS, type Effort, type EffortProfile, type EvermindLearnOutcome, type EvermindLearnTarget, type EvermindRecallItem, type EvermindRecallResult, type EvermindRunHooks, type GlobalRunState, type ImageUrlContentPart, type LinkedTicketToAdvance, MODEL_CATEGORIES, type McpToolEntry, type McpToolResultInfo, type McpToolStatus, type MemoryFirstAnswer, type MentionToken, type MessageProvenance, type ModelCategory, type ModelChoiceLabels, type ModelIdentityContext, type ModelItem, NEW_CHAT_MODE, NOT_STARTED_TASK_STATUSES, PMO_FOCUS_PARAM, PROJECT_EVERMIND_MODEL_PREFIX, PROVENANCE_META_KEY, type ParsedXmlToolCall, type PersistedStep, type PreparedImage, type ProvenanceAccount, RESTING_CHAT_MODE, type RatableMessage, type RatedTurnContext, type ReasoningIntent, type ReasoningLevel, type RecipientChoice, type RoutedProduct, type RunMilestoneActivity, type RunMilestonePhase, STEP_MESSAGE_ROLE, type StreamChatOptions, type StreamChatResult, type StreamHandlers, TICKET_RECORDING_TOOLS, TOOL_ROUTER_DESCRIBE, TOOL_ROUTER_FIND, TOOL_ROUTER_INVOKE, type TextContentPart, type ToolCatalogMatch, type ToolConfirmationGate, type ToolConfirmationGateOptions, type ToolConfirmationPersistence, type ToolExposure, type ToolSelection, type TurnInterruption, type UseBrainChats, type UseBrainChatsOptions, type UseBrainConversation, type UseBrainConversationOptions, type UseMcpExtensionsOptions, WEB_FETCH_TOOL_NAME, XmlToolCallFilter, accountUsedInTrace, activeMentionToken, activeModelKey, activityIcon, activityTone, allowanceState, artifactRoutePath, attachEvermindLearn, buildBrainTriageReport, buildComposerDirectives, buildModelItems, byoReasonHint, byoUnresolvedInTrace, byoUnresolvedSummary, byoVendorLabel, chatActivityText, chatConversationDirective, chatModeDirective, chatWorkDirective, chatWorkLinkingDirective, classifyModelFunding, clearRunError, codeChangeFile, computeBrainDiagnostics, consolidationMarkerContent, consolidationMetadata, countReconciledMemories, deriveChatTitle, describeTool, detectAnnouncedButUnmadeToolCall, detectUnbackedTicketClaim, detectUnbackedWriteClaim, displayModelName, effortProfile, extractXmlToolCalls, fetchApiVersionVia, fetchMcpToolEntries, filterMentionCandidates, filterModelItems, findTools, formatBrainDiagnostics, formatBrainProvenance, formatChatDiagnostics, formatEvermindLearnStep, formatEvermindMemoryBlock, gatherChatDiagnostics, getGlobalRunState, getLastResolvedModel, getMcpToolStatus, getRunSnapshot, getRunTrace, handleRouterCall, isActivityMessage, isChatMode, isCodeChangeTool, isConnectedAccountUnused, isConsolidationMarker, isDirectedToParticipant, isEffort, isEvermindModel, isFailedToolResult, isMalformedToolCall, isRouterTool, isRunning, isStepMessage, isTicketRecordingTool, isTruncatedTurn, isUserConfiguredModelRef, lastConsolidationIndex, linkedTicketsToAdvance, localStorageConfirmationPersistence, mcpActionsFrom, mentionRecipient, modelCategoryLabel, modelFailoversInTrace, modelInUse, modelsUsedInTrace, narratedUnadvertisedInTrace, normalizeChatMode, parseByoUnresolved, parseChatActivity, parseDirectedRecipient, parseMessageAuthor, parseMessageProvenance, parsePmoFocus, parseStepMessage, perMillionUsd, pmoFocusDomId, pmoFocusValue, premiumCostLabel, prepareImageDataUrl, productForPlan, productModelName, ratedTurnContext, ratedTurnTool, reasoningForRun, resetApiVersionCache, resetBrainRunStore, resolveRecipient, resolveRunConfirm, revealsModelId, routerToolSpecs, routingQueryForTurn, startRun as runBrainLoop, savePendingPrompt, scopeToConsolidation, selectToolsForTurn, setLastResolvedModel, setMcpToolStatus, stallRecoveriesInTrace, stallUnrecoveredInTrace, startRun, stepSig, stopRun, streamChatCompletion, subscribeRun, subscribeRunStore, subscribeToChatMessages, takePendingPrompt, toolExposureInTrace, toolSpecsFor, traceWithPersistedSteps, turnInterruption, turnOptimizationDirective, useBrainActions, useBrainChats, useBrainConfig, useBrainContext, useBrainConversation, useMcpExtensions, useOptionalBrainContext, useRegisterBrainActions, useToolConfirmationGate, withDirectedMetadata, withProvenanceMetadata, workItemLinkFromCreate };
