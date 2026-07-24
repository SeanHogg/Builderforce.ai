import * as react_jsx_runtime from 'react/jsx-runtime';
import { ChatErrorAction } from './chatError.cjs';
export { BrainRequestError, ChatErrorActionKind, brainRequestError, chatErrorAction } from './chatError.cjs';

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
}
interface StreamChatOptions {
    messages: ChatCompletionMessage[];
    tools?: BrainToolSpec[];
    tool_choice?: 'auto' | 'none';
    model?: string;
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
    }): Promise<BrainChat>;
    updateChat(id: number, body: {
        title?: string;
        projectId?: number | null;
        visibility?: 'shared' | 'locked';
        capability?: string | null;
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
    setMessageFeedback(messageId: number, feedback: 'up' | 'down' | null): Promise<unknown>;
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
    /** Try to answer `query` from memory WITHOUT the LLM; null → run the model. */
    answer?(query: string): Promise<MemoryFirstAnswer | null>;
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
 * Pass a STABLE array (wrap in `useMemo`) — the effect re-runs when the array
 * identity changes. If no provider is present (e.g. a route without the Brain),
 * this is a no-op so pages can call it unconditionally.
 */
declare function useRegisterBrainActions(actions: BrainAction[]): void;

/** What a tool call resolved to — handed to {@link UseMcpExtensionsOptions.onToolResult}. */
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
    }): Promise<BrainChat | null>;
    rename(id: number, title: string): Promise<void>;
    /** Set (or clear, with null) what the chat is making. Persisted on the chat, so
     *  the choice follows the conversation across surfaces instead of the browser. */
    setCapability(id: number, capability: string | null): Promise<void>;
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
     */
    likelyCause: 'context-exhaustion' | 'model-degradation' | 'inconclusive' | 'healthy';
}
/**
 * Derive {@link BrainDiagnostics} from a recorded trace. Pure — no clock, no I/O
 * — so both the web report and the VS Code transcript compute the identical
 * block from the same events (single source of truth for A-vs-B triage).
 */
declare function computeBrainDiagnostics(events: BrainTraceEvent[], requestedModel?: string): BrainDiagnostics;
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
    copiedMessageId: number | null;
    feedbackMap: Record<number, 'up' | 'down'>;
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
    copyMessage(msg: BrainMessage): Promise<void>;
    submitFeedback(msg: BrainMessage, value: 'up' | 'down'): Promise<void>;
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
 * turn), `byo:<vendor>` (the tenant's own connected account), `plan` (in the plan pool,
 * included), or `premium` (metered at cost + per-request fee).
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
    /** The project the surrounding UI/panel is showing, when it differs from the chat's. */
    selectedProjectId?: number | null;
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
     */
    tools?: {
        count: number;
        error?: string | null;
        loading?: boolean;
    } | null;
    /**
     * Which BUILD produced this capture. Without it a dump taken minutes before a
     * deploy is indistinguishable from one taken after, so a fixed bug reads as
     * unfixed — which is exactly what happened while debugging chat #71.
     */
    versions?: {
        ui?: string | null;
        api?: string | null;
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

export { ADDRESSED_TO_META_KEY, AUTHORED_BY_META_KEY, type AllowanceState, type AssembledToolCall, type BrainAction, type BrainActionsContextValue, BrainActionsProvider, type BrainChat, type BrainConfig, BrainContextProvider, type BrainContextValue, type BrainDiagnostics, type BrainMessage, type BrainModality, type BrainPageContext, type BrainPersistenceAdapter, BrainProvider, type BrainRunRequest, type BrainRunSnapshot, type BrainRuntime, type BrainToolSpec, type BrainTraceEvent, type BrainTransport, type BuildBrainTriageOptions, type ByoUnresolvedEntry, CODE_CHANGE_TOOLS, CONSOLIDATION_MARKER_PREFIX, CONSOLIDATION_META, type ChatCompletionMessage, type ChatDiagnosticsAccount, type ChatDiagnosticsData, type ChatDiagnosticsEvermind, type ChatDiagnosticsMeter, ChatErrorAction, type ChatInputAttachment, type CompletionMetadata, type ContentPart, type CreatedWorkItemLink, DEFAULT_CHAT_TITLE, DEFAULT_TOOL_LIMIT, type DirectedRecipient, EVERMIND_LEARN_MIN_CHARS, type Effort, type EffortProfile, type EvermindLearnOutcome, type EvermindLearnTarget, type EvermindRecallItem, type EvermindRecallResult, type EvermindRunHooks, type GlobalRunState, type ImageUrlContentPart, type LinkedTicketToAdvance, type McpToolResultInfo, type McpToolStatus, type MentionToken, type MessageProvenance, NOT_STARTED_TASK_STATUSES, PROVENANCE_META_KEY, type PersistedStep, type PreparedImage, type ProvenanceAccount, type ReasoningIntent, type ReasoningLevel, type RecipientChoice, STEP_MESSAGE_ROLE, type StreamChatOptions, type StreamChatResult, type StreamHandlers, TICKET_RECORDING_TOOLS, type TextContentPart, type ToolSelection, type UseBrainChats, type UseBrainChatsOptions, type UseBrainConversation, type UseBrainConversationOptions, type UseMcpExtensionsOptions, accountUsedInTrace, activeMentionToken, allowanceState, attachEvermindLearn, buildBrainTriageReport, byoReasonHint, byoUnresolvedInTrace, byoUnresolvedSummary, chatWorkLinkingDirective, classifyModelFunding, clearRunError, codeChangeFile, computeBrainDiagnostics, consolidationMarkerContent, consolidationMetadata, countReconciledMemories, deriveChatTitle, effortProfile, filterMentionCandidates, formatBrainDiagnostics, formatBrainProvenance, formatChatDiagnostics, formatEvermindLearnStep, formatEvermindMemoryBlock, getGlobalRunState, getLastResolvedModel, getMcpToolStatus, getRunSnapshot, getRunTrace, isCodeChangeTool, isConnectedAccountUnused, isConsolidationMarker, isDirectedToParticipant, isEffort, isEvermindModel, isFailedToolResult, isRunning, isStepMessage, isTicketRecordingTool, lastConsolidationIndex, linkedTicketsToAdvance, mentionRecipient, modelsUsedInTrace, parseByoUnresolved, parseDirectedRecipient, parseMessageAuthor, parseMessageProvenance, parseStepMessage, prepareImageDataUrl, reasoningForRun, resolveRecipient, resolveRunConfirm, startRun as runBrainLoop, savePendingPrompt, scopeToConsolidation, selectToolsForTurn, setLastResolvedModel, setMcpToolStatus, startRun, stepSig, stopRun, streamChatCompletion, subscribeRun, subscribeRunStore, subscribeToChatMessages, takePendingPrompt, traceWithPersistedSteps, useBrainActions, useBrainChats, useBrainConfig, useBrainContext, useBrainConversation, useMcpExtensions, useOptionalBrainContext, useRegisterBrainActions, withDirectedMetadata, withProvenanceMetadata, workItemLinkFromCreate };
