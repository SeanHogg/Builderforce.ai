import type { AIUseCase } from './aiUseCases';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
}

export interface ChatCompletionCreateParams {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  useCase?: AIUseCase;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  [key: string]: unknown;
}

export interface ChatCompletionChunk {
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

export interface ChatCompletionResponse {
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

export interface ModelsListResponse {
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

export interface UsageByModel {
  llmProduct: string;
  model: string;
  requests: number;
  prompt_tokens: string | number;
  completion_tokens: string | number;
  total_tokens: string | number;
  retries: number;
}

export interface UsageByDay {
  day: string;
  requests: number;
  total_tokens: string | number;
}

export interface UsageByUser {
  user_id: string;
  requests: number;
  total_tokens: string | number;
}

export interface UsageResponse {
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

export interface UsageGetParams {
  days?: number;
}
