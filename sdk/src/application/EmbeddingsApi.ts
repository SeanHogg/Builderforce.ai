import type { EmbeddingsCreateParams, EmbeddingsResponse } from '../domain/types';
import { HttpClient, type RequestOptions } from '../infrastructure/httpClient';

/**
 * Pull SDK-level transport options out of the params so they don't ride
 * along inside the JSON body. Same shape as ChatCompletionsApi (DRY pattern).
 */
function splitTransportOptions(params: EmbeddingsCreateParams): {
  body: Record<string, unknown>;
  request: RequestOptions;
} {
  const { timeoutMs, signal, idempotencyKey, ...rest } = params;
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return {
    body: rest as unknown as Record<string, unknown>,
    request: {
      timeoutMs,
      signal,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    },
  };
}

export class EmbeddingsApi {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /**
   * Create one or more text embeddings. Wired to OpenRouter (default model
   * `nvidia/llama-nemotron-embed-vl-1b-v2:free`). Override via `model`.
   */
  create(params: EmbeddingsCreateParams): Promise<EmbeddingsResponse> {
    const { body, request } = splitTransportOptions(params);
    return this.http.postJson<EmbeddingsResponse>('/llm/v1/embeddings', body, request);
  }
}
