import { ChatCompletionsApi } from './application/ChatCompletionsApi';
import { ModelsApi } from './application/ModelsApi';
import { UsageApi } from './application/UsageApi';
import { HttpClient } from './infrastructure/httpClient';

export interface BuilderforceClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class BuilderforceClient {
  public readonly chat: {
    completions: ChatCompletionsApi;
  };
  public readonly models: ModelsApi;
  public readonly usage: UsageApi;

  constructor(options: BuilderforceClientOptions) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw new Error('BuilderforceClient requires a non-empty apiKey');
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
    this.models = new ModelsApi(http);
    this.usage = new UsageApi(http);
  }
}
