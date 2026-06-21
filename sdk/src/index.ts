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
  AiCapability,
  ModelInfo,
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
  // Image generation
  ImageGenerationCreateParams,
  ImageGenerationResponse,
  ImageGenerationDataEntry,
} from './domain/types';

export { ChatCompletionStream } from './application/ChatCompletionsApi';
export { EmbeddingsApi } from './application/EmbeddingsApi';
export { ImagesApi } from './application/ImagesApi';
export { ModelsApi } from './application/ModelsApi';
export { BuilderforceApiError } from './infrastructure/httpClient';
