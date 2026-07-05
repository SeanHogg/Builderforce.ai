import * as react from 'react';

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
    createdAt: string;
    updatedAt: string;
}
/** A single message within a chat. */
interface BrainMessage {
    id: number;
    role: string;
    content: string;
    metadata: string | null;
    seq: number;
    createdAt: string;
}
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
interface StreamChatOptions {
    messages: ChatCompletionMessage[];
    tools?: BrainToolSpec[];
    tool_choice?: 'auto' | 'none';
    model?: string;
    temperature?: number;
    maxTokens?: number;
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
    }): Promise<BrainChat>;
    updateChat(id: number, body: {
        title?: string;
        projectId?: number | null;
    }): Promise<BrainChat>;
    deleteChat(id: number): Promise<unknown>;
    summarizeChat(id: number): Promise<{
        summary: string;
    } | {
        error: string;
    }>;
    getMessages(chatId: number, limit?: number): Promise<BrainMessage[]>;
    sendMessages(chatId: number, messages: Array<{
        role: string;
        content: string;
        metadata?: string;
    }>): Promise<BrainMessage[]>;
    setMessageFeedback(messageId: number, feedback: 'up' | 'down' | null): Promise<unknown>;
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
}): react.JSX.Element;
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
}): react.JSX.Element;
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
}): react.JSX.Element;
/** Read/update the ambient Brain context. Throws if no provider is mounted. */
declare function useBrainContext(): BrainContextValue;
/**
 * Safe variant for pages that may render with or without the Brain mounted.
 * Returns null instead of throwing when no provider is present.
 */
declare function useOptionalBrainContext(): BrainContextValue | null;

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
    }): Promise<BrainChat | null>;
    rename(id: number, title: string): Promise<void>;
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
     * - `llm`     — a streamed completion (model, step, tool-call count)
     * - `tool`    — a client action the model invoked (args + result)
     * - `message` — assistant text emitted on a turn
     * - `error`   — a thrown exception or a tool result that failed
     */
    category: 'llm' | 'tool' | 'message' | 'error';
    /** Display label — the tool name, or `llm.complete` / `agent.message`. */
    label: string;
    /** Wall-clock duration of the step, when measured. */
    durationMs?: number;
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
    /** Best-effort verdict — the header a triager reads first. */
    likelyCause: 'context-exhaustion' | 'model-degradation' | 'inconclusive';
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
    /** Extra system-prompt context (e.g. an IDE's open file + content). */
    extraSystem?: string;
    /** Override the system prompt entirely (e.g. a fixed Brain Storm persona). */
    systemPrompt?: string;
    /** Override the model (e.g. run the Brain as a specific assigned agent). */
    model?: string;
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
}
interface UseBrainConversation {
    messages: BrainMessage[];
    loadingMessages: boolean;
    /** Force a transcript refetch without changing the chat id (e.g. after a merge). */
    reloadMessages: () => void;
    sending: boolean;
    error: string;
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
     * Assemble a paste-able triage report of the active chat's execution — the LLM
     * steps, the full tool chain (args + results), intermediate assistant messages,
     * every error, and the visible transcript. `agentLabel` names the persona the
     * Brain ran as. Mirrors the host/cloud "Copy triage info" report.
     */
    buildTriageReport(agentLabel?: string): string;
}
declare function useBrainConversation(options: UseBrainConversationOptions): UseBrainConversation;

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

export { ADDRESSED_TO_META_KEY, type AssembledToolCall, type BrainAction, type BrainActionsContextValue, BrainActionsProvider, type BrainChat, type BrainConfig, BrainContextProvider, type BrainContextValue, type BrainDiagnostics, type BrainMessage, type BrainModality, type BrainPageContext, type BrainPersistenceAdapter, BrainProvider, type BrainRuntime, type BrainToolSpec, type BrainTraceEvent, type BrainTransport, type BuildBrainTriageOptions, CONSOLIDATION_MARKER_PREFIX, CONSOLIDATION_META, type ChatCompletionMessage, type ChatInputAttachment, type ContentPart, type DirectedRecipient, type ImageUrlContentPart, type McpToolResultInfo, type PreparedImage, type StreamChatOptions, type StreamChatResult, type StreamHandlers, type TextContentPart, type UseBrainChats, type UseBrainChatsOptions, type UseBrainConversation, type UseBrainConversationOptions, type UseMcpExtensionsOptions, buildBrainTriageReport, computeBrainDiagnostics, consolidationMarkerContent, consolidationMetadata, formatBrainDiagnostics, isConsolidationMarker, isDirectedToParticipant, isEvermindModel, isFailedToolResult, lastConsolidationIndex, modelsUsedInTrace, parseDirectedRecipient, prepareImageDataUrl, savePendingPrompt, scopeToConsolidation, streamChatCompletion, takePendingPrompt, useBrainActions, useBrainChats, useBrainConfig, useBrainContext, useBrainConversation, useMcpExtensions, useOptionalBrainContext, useRegisterBrainActions, withDirectedMetadata };
