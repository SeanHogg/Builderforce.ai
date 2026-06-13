/**
 * Native model domain types — the pi-ai type-surface replacement (cutover stage 2).
 *
 * These reproduce the shapes the on-prem runtime imports from `@mariozechner/pi-ai`
 * (Model/Api/Context/AssistantMessage/content blocks/usage/oauth) so type-only import
 * sites can move off pi-ai with NO behavior change. Kept structurally identical to
 * pi-ai 0.54 so the swap is a pure import-path change (tsc verifies equivalence).
 *
 * Runtime values (model catalogs, provider adapters, auth) are NOT here — those route
 * through the gateway via {@link nativeComplete}/{@link nativeStream} in `native-llm.ts`.
 */

import type { TSchema } from "@sinclair/typebox";

export type KnownApi =
  | "openai-completions"
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses"
  | "anthropic-messages"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-gemini-cli"
  | "google-vertex";
// biome-ignore lint/suspicious/noEmptyBlockStatements: pi-ai's `(string & {})` open-enum trick
export type Api = KnownApi | (string & {});

export type Provider = string;
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ThinkingBudgets {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
}

export type CacheRetention = "none" | "short" | "long";
export type Transport = "sse" | "websocket" | "auto";

export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  apiKey?: string;
  transport?: Transport;
  cacheRetention?: CacheRetention;
  sessionId?: string;
  onPayload?: (payload: unknown) => void;
  headers?: Record<string, string>;
  maxRetryDelayMs?: number;
  metadata?: Record<string, unknown>;
}

export type ProviderStreamOptions = StreamOptions & Record<string, unknown>;

export interface SimpleStreamOptions extends StreamOptions {
  reasoning?: ThinkingLevel;
  thinkingBudgets?: ThinkingBudgets;
}

export interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  // biome-ignore lint/suspicious/noExplicitAny: matches pi-ai's arguments shape
  arguments: Record<string, any>;
  thoughtSignature?: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: Provider;
  model: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}

// biome-ignore lint/suspicious/noExplicitAny: matches pi-ai default
export interface ToolResultMessage<TDetails = any> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError: boolean;
  timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
}

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

export interface Model<TApi extends Api = Api> {
  id: string;
  name: string;
  api: TApi;
  provider: Provider;
  baseUrl: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  /** Compatibility overrides for OpenAI-compatible APIs. Loosely typed here; the
   *  gateway owns provider-specific compat in the native runtime. */
  compat?: unknown;
}

export type OAuthCredentials = {
  refresh: string;
  access: string;
  expires: number;
  [key: string]: unknown;
};

export type OAuthProviderId = string;
/** @deprecated Use OAuthProviderId */
export type OAuthProvider = OAuthProviderId;
