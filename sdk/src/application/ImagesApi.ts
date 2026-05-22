import type { ImageGenerationCreateParams, ImageGenerationResponse } from '../domain/types';
import { HttpClient, type RequestOptions } from '../infrastructure/httpClient';

/**
 * Pull SDK-level transport options out of the params so they don't ride
 * along inside the JSON body. Same shape as ChatCompletionsApi / EmbeddingsApi
 * (DRY pattern — every API class uses the same splitter).
 */
function splitTransportOptions(params: ImageGenerationCreateParams): {
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

/**
 * `client.images.generate({ prompt, ... })` — OpenAI-compatible image generation
 * routed through the Builderforce gateway. The gateway cascades free Together
 * vendors → premium FluxAPI fallback so callers always see a successful
 * response unless every upstream is saturated. Read
 * `_builderforce.resolvedModel` / `resolvedVendor` to detect which vendor
 * served the request.
 *
 * Image generations are billed against the tenant's daily token budget at a
 * flat per-image rate (currently ~1000 tokens/image — deliberately conservative).
 * Hitting the cap returns the same `429 plan_token_limit_exceeded` envelope
 * as chat — caller code that already handles that path needs no changes.
 */
export class ImagesApi {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  generate(params: ImageGenerationCreateParams): Promise<ImageGenerationResponse> {
    const { body, request } = splitTransportOptions(params);
    return this.http.postJson<ImageGenerationResponse>('/llm/v1/images/generations', body, request);
  }
}
