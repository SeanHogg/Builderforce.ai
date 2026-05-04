import type { ChatCompletionChunk, ChatCompletionCreateParams, ChatCompletionResponse } from '../domain/types';
import { HttpClient } from '../infrastructure/httpClient';
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
    if (params.stream) {
      const response = await this.http.postRaw('/llm/v1/chat/completions', params);
      if (!response.body) {
        throw new Error('Streaming response body is missing');
      }
      return new ChatCompletionStream(response.body);
    }

    return this.http.postJson<ChatCompletionResponse>('/llm/v1/chat/completions', params);
  }
}
