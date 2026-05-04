export class BuilderforceApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: unknown;
  public readonly requestId?: string;

  constructor(message: string, status: number, code?: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = 'BuilderforceApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export interface HttpClientOptions {
  apiKey: string;
  baseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    return this.parseJsonResponse<T>(res);
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
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
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
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

  private async fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new BuilderforceApiError(`Request timed out after ${this.timeoutMs}ms`, 408, 'timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseJsonResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      throw await this.toApiError(res);
    }
    return res.json() as Promise<T>;
  }

  private async toApiError(res: Response): Promise<BuilderforceApiError> {
    const fallback = `Request failed (${res.status})`;
    const requestId = res.headers.get('x-request-id') ?? undefined;
    try {
      const payload = await res.json() as { error?: string; code?: string; details?: unknown };
      return new BuilderforceApiError(payload.error ?? fallback, res.status, payload.code, payload.details, requestId);
    } catch {
      const text = await res.text().catch(() => '');
      return new BuilderforceApiError(text || fallback, res.status, undefined, undefined, requestId);
    }
  }
}
