import type { UsageGetParams, UsageResponse } from '../domain/types';
import { HttpClient } from '../infrastructure/httpClient';

export class UsageApi {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  get(params: UsageGetParams = {}): Promise<UsageResponse> {
    const query = typeof params.days === 'number' ? `?days=${encodeURIComponent(String(params.days))}` : '';
    return this.http.getJson<UsageResponse>(`/llm/v1/usage${query}`);
  }
}
