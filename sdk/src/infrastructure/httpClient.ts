export class BuilderforceApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'BuilderforceApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface HttpClientOptions {
  apiKey: string;
  baseUrl: string;
  fetchFn?: typeof fetch;
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    return this.parseJsonResponse<T>(res);
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return this.parseJsonResponse<T>(res);
  }

  async postRaw(path: string, body: unknown): Promise<Response> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw await this.toApiError(res);
    }
    return res;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async parseJsonResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      throw await this.toApiError(res);
    }
    return res.json() as Promise<T>;
  }

  private async toApiError(res: Response): Promise<BuilderforceApiError> {
    const fallback = `Request failed (${res.status})`;
    try {
      const payload = await res.json() as { error?: string; code?: string; details?: unknown };
      return new BuilderforceApiError(payload.error ?? fallback, res.status, payload.code, payload.details);
    } catch {
      const text = await res.text().catch(() => '');
      return new BuilderforceApiError(text || fallback, res.status);
    }
  }
}
