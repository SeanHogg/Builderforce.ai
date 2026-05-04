import type { ModelsListResponse } from '../domain/types';
import { HttpClient } from '../infrastructure/httpClient';

export class ModelsApi {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  list(): Promise<ModelsListResponse> {
    return this.http.getJson<ModelsListResponse>('/llm/v1/models');
  }
}
