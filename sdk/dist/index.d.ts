declare const AI_USE_CASES: readonly ["ide.chat", "ide.code_complete", "training.dataset_generate", "training.dataset_evaluate", "agent.inference", "coder.code", "coder.review", "coder.test", "coder.debug", "coder.refactor", "coder.document", "coder.architect", "coach.chat", "coach.insight", "coach.classify", "studio.compose", "studio.script", "studio.brief", "pitch_deck.generate", "investor.update", "ask.general", "tool.classify_email", "tool.categorize_expense", "tool.contract_analyze", "tool.competitor_scan", "tool.feature_score", "tool.market_research", "tool.health_score", "tool.journey_insight", "vision.describe", "ocr.extract", "embed.text", "match", "match_tailor", "match_insights", "resume_roast", "skill_extract", "job_parser", "autofill", "article_writer", "studio_script", "studio_edit_script", "studio_misc", "linkedin_post", "interview_questions", "interview_analyze", "chat", "career", "discovery", "dashboard_summary"];
type AIUseCase = (typeof AI_USE_CASES)[number];
declare function isAIUseCase(value: string): value is AIUseCase;

type ChatRole = 'system' | 'user' | 'assistant' | 'tool';
interface ChatMessage {
    role: ChatRole;
    content: string;
    name?: string;
}
interface ChatCompletionCreateParams {
    model?: string;
    messages: ChatMessage[];
    stream?: boolean;
    useCase?: AIUseCase;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    [key: string]: unknown;
}
interface ChatCompletionChunk {
    id?: string;
    object?: string;
    created?: number;
    model?: string;
    choices?: Array<{
        index?: number;
        delta?: {
            role?: ChatRole;
            content?: string;
        };
        finish_reason?: string | null;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
}
interface ChatCompletionResponse {
    id?: string;
    object?: string;
    created?: number;
    model?: string;
    choices?: Array<{
        index?: number;
        message?: {
            role?: ChatRole;
            content?: string;
        };
        finish_reason?: string | null;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
    _builderforce?: {
        resolvedModel?: string;
        retries?: number;
        pool?: number;
        product?: string;
        effectivePlan?: string;
    };
    [key: string]: unknown;
}
interface ModelsListResponse {
    configured?: boolean;
    object?: 'list';
    product?: string;
    effectivePlan?: string;
    data?: Array<{
        model: string;
        vendor: string;
        preferred: boolean;
        available: boolean;
        cooldownUntil?: number;
    }>;
    models?: string[];
    [key: string]: unknown;
}
interface UsageByModel {
    llmProduct: string;
    model: string;
    requests: number;
    prompt_tokens: string | number;
    completion_tokens: string | number;
    total_tokens: string | number;
    retries: number;
}
interface UsageByDay {
    day: string;
    requests: number;
    total_tokens: string | number;
}
interface UsageByUser {
    user_id: string;
    requests: number;
    total_tokens: string | number;
}
interface UsageResponse {
    days: number;
    tenantId: number;
    plan: string;
    effectivePlan: string;
    billingStatus: string;
    totals: {
        requests: number;
        totalTokens: number;
        promptTokens: number;
        completionTokens: number;
    };
    mine: {
        userId: string | null;
        requests: number;
        totalTokens: number;
        promptTokens: number;
        completionTokens: number;
    };
    byModel: UsageByModel[];
    byDay: UsageByDay[];
    byUser: UsageByUser[];
}
interface UsageGetParams {
    days?: number;
}

declare class BuilderforceApiError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly details?: unknown;
    constructor(message: string, status: number, code?: string, details?: unknown);
}
interface HttpClientOptions {
    apiKey: string;
    baseUrl: string;
    fetchFn?: typeof fetch;
}
declare class HttpClient {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly fetchFn;
    constructor(options: HttpClientOptions);
    getJson<T>(path: string): Promise<T>;
    postJson<T>(path: string, body: unknown): Promise<T>;
    postRaw(path: string, body: unknown): Promise<Response>;
    private authHeaders;
    private parseJsonResponse;
    private toApiError;
}

declare class ChatCompletionStream implements AsyncIterable<ChatCompletionChunk> {
    private readonly stream;
    constructor(stream: ReadableStream<Uint8Array>);
    [Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk, void, unknown>;
    toText(): Promise<string>;
}
declare class ChatCompletionsApi {
    private readonly http;
    constructor(http: HttpClient);
    create(params: ChatCompletionCreateParams & {
        stream: true;
    }): Promise<ChatCompletionStream>;
    create(params: ChatCompletionCreateParams & {
        stream?: false | undefined;
    }): Promise<ChatCompletionResponse>;
}

declare class ModelsApi {
    private readonly http;
    constructor(http: HttpClient);
    list(): Promise<ModelsListResponse>;
}

declare class UsageApi {
    private readonly http;
    constructor(http: HttpClient);
    get(params?: UsageGetParams): Promise<UsageResponse>;
}

interface BuilderforceClientOptions {
    apiKey: string;
    baseUrl?: string;
    fetch?: typeof fetch;
}
declare class BuilderforceClient {
    readonly chat: {
        completions: ChatCompletionsApi;
    };
    readonly models: ModelsApi;
    readonly usage: UsageApi;
    constructor(options: BuilderforceClientOptions);
}

export { type AIUseCase, AI_USE_CASES, BuilderforceApiError, BuilderforceClient, type BuilderforceClientOptions, type ChatCompletionChunk, type ChatCompletionCreateParams, type ChatCompletionResponse, ChatCompletionStream, type ChatMessage, type ChatRole, type ModelsListResponse, type UsageByDay, type UsageByModel, type UsageByUser, type UsageGetParams, type UsageResponse, isAIUseCase };
