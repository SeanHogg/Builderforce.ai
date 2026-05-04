export { BuilderforceClient, type BuilderforceClientOptions } from './BuilderforceClient';

export {
  AI_USE_CASES,
  isAIUseCase,
  type AIUseCase,
} from './domain/aiUseCases';

export type {
  ChatRole,
  ChatMessage,
  ChatCompletionCreateParams,
  ChatCompletionChunk,
  ChatCompletionResponse,
  ModelsListResponse,
  UsageByModel,
  UsageByDay,
  UsageByUser,
  UsageResponse,
  UsageGetParams,
} from './domain/types';

export { ChatCompletionStream } from './application/ChatCompletionsApi';
export { BuilderforceApiError } from './infrastructure/httpClient';
