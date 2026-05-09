import { ChatCompletionsApi } from './application/ChatCompletionsApi';
import { EmbeddingsApi } from './application/EmbeddingsApi';
import { ModelsApi } from './application/ModelsApi';
import { UsageApi } from './application/UsageApi';
import { BuilderforceApiError, HttpClient } from './infrastructure/httpClient';

export interface BuilderforceClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Default request timeout in ms (default 60_000). Per-call override available
   *  via `chat.completions.create({ timeoutMs })` and `embeddings.create({ timeoutMs })`. */
  timeoutMs?: number;
}

export class BuilderforceClient {
  public readonly chat: {
    completions: ChatCompletionsApi;
  };
  public readonly embeddings: EmbeddingsApi;
  public readonly models: ModelsApi;
  public readonly usage: UsageApi;

  constructor(options: BuilderforceClientOptions) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw new BuilderforceApiError(
        'BuilderforceClient requires a non-empty apiKey',
        400,
        'missing_api_key',
      );
    }

    const http = new HttpClient({
      apiKey,
      baseUrl: options.baseUrl ?? 'https://api.builderforce.ai',
      fetchFn: options.fetch,
      timeoutMs: options.timeoutMs,
    });

    this.chat = {
      completions: new ChatCompletionsApi(http),
    };
    this.embeddings = new EmbeddingsApi(http);
    this.models = new ModelsApi(http);
    this.usage = new UsageApi(http);
  }
}
