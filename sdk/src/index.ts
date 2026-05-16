export { BuilderforceClient, type BuilderforceClientOptions } from './BuilderforceClient';

export type {
  // Roles & content
  ChatRole,
  ChatMessage,
  ContentPart,
  TextContentPart,
  ImageUrlContentPart,
  // Tool calling
  ToolSpec,
  ToolCall,
  ToolCallFunction,
  ToolCallDelta,
  ToolChoice,
  FunctionDefinition,
  // Structured output
  ResponseFormat,
  JsonSchemaSpec,
  // Per-call options
  PerCallOptions,
  // Chat completions
  ChatCompletionCreateParams,
  ChatCompletionChunk,
  ChatCompletionResponse,
  FailoverEvent,
  // Models / usage
  ModelsListResponse,
  UsageByModel,
  UsageByDay,
  UsageByUser,
  UsageResponse,
  UsageGetParams,
  // Embeddings
  EmbeddingsCreateParams,
  EmbeddingsResponse,
  EmbeddingObject,
} from './domain/types';

export { ChatCompletionStream } from './application/ChatCompletionsApi';
export { EmbeddingsApi } from './application/EmbeddingsApi';
export { BuilderforceApiError } from './infrastructure/httpClient';
