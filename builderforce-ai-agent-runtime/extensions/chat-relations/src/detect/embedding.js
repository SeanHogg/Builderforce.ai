import crypto from 'node:crypto';
import OpenAI from 'openai';
import { DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_API_KEY, DEFAULT_EMBEDDING_DIMENSIONS } from './_embed-config.js';

/* For tests, inject null to simulate absent env and avoid real API calls. */
let _openaiClient: OpenAI | null = null;

export function __setOpenAIClient(client: OpenAI | null): void {
  _openaiClient = client;
}

export function __reset(): void {
  _openaiClient = null;
}

/* Resolve an API key prefers init/config env; falls back to process.env. */
function resolveApiEnv(): string {
  if (process.env.BUILDERFORCE_CHAT_RELATIONS_EMBEDDING_API_KEY) {
    return process.env.BUILDERFORCE_CHAT_RELATIONS_EMBEDDING_API_KEY;
  }
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  return DEFAULT_EMBEDDING_API_KEY;
}

/* Resolve an embed model prefers init/config env; falls back to default. */
function resolveModel(): string {
  if (process.env.BUILDERFORCE_CHAT_RELATIONS_EMBEDDING_MODEL) {
    return process.env.BUILDERFORCE_CHAT_RELATIONS_EMBEDDING_MODEL;
  }
  return DEFAULT_EMBEDDING_MODEL;
}

/* Single-call wrapper: returns the OpenAI client (cached). */
export function createClient(): OpenAI {
  if (_openaiClient) {
    return _openaiClient;
  }
  if (process.env.BUILDERFORCE_CHAT_RELATIONS_EMBEDDING_API_KEY === 'null' ||
      process.env.OPENAI_API_KEY === 'null') {
    throw new Error('createOpenAIClient attempted with null env; must supply env or __setOpenAIClient');
  }
  if (process.env.BUILDERFORCE_CHAT_RELATIONS_EMBEDDING_API_KEY === 'FAKE' ||
      process.env.OPENAI_API_KEY === 'FAKE') {
    _openaiClient = new OpenAI({
      apiKey: process.env.BUILDERFORCE_CHAT_RELATIONS_EMBEDDING_API_KEY || 'FAKE',
      baseURL: 'https://fake.openai.com/v1',
    });
    return _openaiClient;
  }

  return new OpenAI({
    apiKey: resolveApiEnv(),
  });
}

/* Resolve vector dims favoring existing model mapping; if missing, fallback compute attempt. */
export function resolveVectorDims(model: string): number {
  return DEFAULT_EMBEDDING_DIMENSIONS[model] ?? 1536;
}

/* Single-call wrapper: invoke embeddings.embeddings.create. */
export async function embedText(text: string): Promise<{ value: number[]; using_fake: boolean }> {
  const client = createClient();
  const using_fake = client.baseURL?.toString().includes('fake');

  const response = await client.embeddings.create({
    model: resolveModel(),
    input: text,
  });

  return {
    value: response.data[0].embedding,
    using_fake,
  };
}

/* Create a stable hash for caching of embedding results keyed on plain text. */
export function hashEmb(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}