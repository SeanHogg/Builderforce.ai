import type { ChatCompletionChunk, ChatCompletionCreateParams, ChatCompletionResponse } from '../domain/types';
import { HttpClient, type RequestOptions } from '../infrastructure/httpClient';
import { parseSseJson } from '../infrastructure/sse';

export class ChatCompletionStream implements AsyncIterable<ChatCompletionChunk> {
  private readonly stream: ReadableStream<Uint8Array>;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.stream = stream;
  }

  [Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk, void, unknown> {
    return parseSseJson<ChatCompletionChunk>(this.stream);
  }

  async toText(): Promise<string> {
    let full = '';
    for await (const chunk of this) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') {
        full += delta;
      }
    }
    return full;
  }
}

/**
 * Pull SDK-level transport options (timeout, signal, idempotency key) out of
 * the params object so they don't get JSON-serialized into the request body.
 * Returns the request options AND the cleaned-up body.
 */
function splitTransportOptions(params: ChatCompletionCreateParams): {
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

export class ChatCompletionsApi {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  async create(params: ChatCompletionCreateParams & { stream: true }): Promise<ChatCompletionStream>;
  async create(params: ChatCompletionCreateParams & { stream?: false | undefined }): Promise<ChatCompletionResponse>;
  async create(
    params: ChatCompletionCreateParams,
  ): Promise<ChatCompletionResponse | ChatCompletionStream> {
    const { body, request } = splitTransportOptions(params);

    if (params.stream) {
      const response = await this.http.postRaw('/llm/v1/chat/completions', body, request);
      if (!response.body) {
        throw new Error('Streaming response body is missing');
      }
      return new ChatCompletionStream(response.body);
    }

    return this.http.postJson<ChatCompletionResponse>('/llm/v1/chat/completions', body, request);
  }
}
