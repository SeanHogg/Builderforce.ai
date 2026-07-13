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
  FailoverKind,
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

// Error classification — branch on the gateway's own failure taxonomy instead of
// hand-rolling HTTP-status guesses (see classifyError).
export { classifyError } from './application/classifyError';
export type { ErrorKind, ErrorClassification } from './application/classifyError';

// Response-format derivation — pick strict json_schema vs loose json_object by
// schema complexity / vendor capability, pre-empting `schema_too_complex`.
export {
  deriveResponseFormat,
  canUseStrictSchema,
  estimateSchemaComplexity,
  DEFAULT_SCHEMA_COMPLEXITY_CEILING,
} from './application/deriveResponseFormat';
export type { DeriveResponseFormatOptions, SchemaComplexity } from './application/deriveResponseFormat';
