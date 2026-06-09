import * as react_jsx_runtime from 'react/jsx-runtime';

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
/** A message in the working array — supports assistant tool-call turns and tool results. */
interface ChatCompletionMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
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
interface StreamChatResult {
    text: string;
    toolCalls: AssembledToolCall[];
    finishReason: string | null;
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

interface UseMcpExtensionsOptions {
    /**
     * Extension ids to drop from the fetched tool list. A host that already
     * registers some of the gateway's tools natively (e.g. first-party platform
     * actions exposed under a `builtin` extension) passes those ids here so the
     * Brain doesn't get the same capability twice.
     */
    skipExtensionIds?: string[];
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
}
interface BrainContextValue extends BrainPageContext {
    open: boolean;
    setOpen(open: boolean): void;
    /** Merge partial page context (call from a page effect). */
    setContext(patch: Partial<BrainPageContext>): void;
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

interface UseBrainChatsOptions {
    /** Dropdown filter — id string, 'none', or null (all). Ignored when `pinnedProjectId` is set. */
    filterProjectId?: string | null;
    /** Project pages: lock the list (and new chats) to this project; no filter UI. */
    pinnedProjectId?: number | null;
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
     * Confirm a tool call before it runs (the human-in-the-loop gate). Return
     * false to skip the call — a `{ cancelled: true }` result is fed back to the
     * model so it can adjust. Omit to run every requested tool immediately.
     * Hosts typically gate only mutating tools (see BrainActions `isMutating`).
     */
    confirmTool?: (req: {
        name: string;
        args: unknown;
    }) => Promise<boolean>;
    /** Create-on-demand when sending without an active chat; returns the new chat id. */
    ensureChatId?: () => Promise<number | null>;
    /** Notify the host (chats hook) that this chat got new activity. */
    onActivity?: (chatId: number) => void;
}
interface UseBrainConversation {
    messages: BrainMessage[];
    loadingMessages: boolean;
    sending: boolean;
    error: string;
    /** Live assistant delta buffer (rendered as a trailing bubble while streaming). */
    streamingText: string;
    copiedMessageId: number | null;
    feedbackMap: Record<number, 'up' | 'down'>;
    pendingAttachments: ChatInputAttachment[];
    uploading: boolean;
    send(text: string): Promise<void>;
    copyMessage(msg: BrainMessage): Promise<void>;
    submitFeedback(msg: BrainMessage, value: 'up' | 'down'): Promise<void>;
    attach(file: File): Promise<void>;
    removeAttachment(key: string): void;
    setError(msg: string): void;
}
declare function useBrainConversation(options: UseBrainConversationOptions): UseBrainConversation;

/** Persist a landing-page prompt for replay after authentication. No-ops on empty input or SSR. */
declare function savePendingPrompt(text: string): void;
/** Read and clear the saved prompt. Returns null when none is stored or on SSR. */
declare function takePendingPrompt(): string | null;

export { type AssembledToolCall, type BrainAction, type BrainActionsContextValue, BrainActionsProvider, type BrainChat, type BrainConfig, BrainContextProvider, type BrainContextValue, type BrainMessage, type BrainModality, type BrainPageContext, type BrainPersistenceAdapter, BrainProvider, type BrainRuntime, type BrainToolSpec, type BrainTransport, type ChatCompletionMessage, type ChatInputAttachment, type StreamChatOptions, type StreamChatResult, type StreamHandlers, type UseBrainChats, type UseBrainChatsOptions, type UseBrainConversation, type UseBrainConversationOptions, savePendingPrompt, streamChatCompletion, takePendingPrompt, useBrainActions, useBrainChats, useBrainConfig, useBrainContext, useBrainConversation, useMcpExtensions, useOptionalBrainContext, useRegisterBrainActions };
