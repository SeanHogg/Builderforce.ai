import { ChatCompletionsApi } from './application/ChatCompletionsApi';
import { ModelsApi } from './application/ModelsApi';
import { UsageApi } from './application/UsageApi';
import { HttpClient } from './infrastructure/httpClient';

export interface BuilderforceClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class BuilderforceClient {
  public readonly chat: {
    completions: ChatCompletionsApi;
  };
  public readonly models: ModelsApi;
  public readonly usage: UsageApi;

  constructor(options: BuilderforceClientOptions) {
    const http = new HttpClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? 'https://api.builderforce.ai',
      fetchFn: options.fetch,
    });

    this.chat = {
      completions: new ChatCompletionsApi(http),
    };
    this.models = new ModelsApi(http);
    this.usage = new UsageApi(http);
  }
}
