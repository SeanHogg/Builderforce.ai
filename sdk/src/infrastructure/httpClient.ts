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
  /** Default per-request timeout in ms. Overridable per call. */
  timeoutMs?: number;
}

/** Per-request overrides — passed by the API layer, not by SDK consumers directly. */
export interface RequestOptions {
  /** Override the client default timeout for just this request. */
  timeoutMs?: number;
  /** Caller-provided AbortSignal. Linked together with the SDK's internal timeout
   *  signal — whichever fires first aborts the request. */
  signal?: AbortSignal;
  /** Extra headers to merge in (e.g. `Idempotency-Key`). */
  headers?: Record<string, string>;
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly defaultTimeoutMs: number;

  constructor(options: HttpClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.defaultTimeoutMs = options.timeoutMs ?? 60_000;
  }

  async getJson<T>(path: string, options?: RequestOptions): Promise<T> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.mergeHeaders(options),
    }, options);
    return this.parseJsonResponse<T>(res);
  }

  async postJson<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.mergeHeaders(options, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    }, options);
    return this.parseJsonResponse<T>(res);
  }

  async postRaw(path: string, body: unknown, options?: RequestOptions): Promise<Response> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.mergeHeaders(options, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    }, options);
    if (!res.ok) {
      throw await this.toApiError(res);
    }
    return res;
  }

  private mergeHeaders(options?: RequestOptions, base?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...(base ?? {}),
      ...(options?.headers ?? {}),
    };
  }

  /**
   * Wrap a fetch in a combined abort signal: an internal timeout AND any
   * caller-provided signal. Either firing aborts the request. Single source of
   * abort plumbing — every method routes through here (DRY).
   */
  private async fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit,
    options?: RequestOptions,
  ): Promise<Response> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(), timeoutMs);

    // Combine internal timeout signal + caller signal. Native AbortSignal.any
    // (Node 20+ / modern Workers) is preferred; fall back to manual linking.
    const signal = combineSignals(timeoutCtl.signal, options?.signal);

    try {
      return await this.fetchFn(input, { ...init, signal });
    } catch (error) {
      if (timeoutCtl.signal.aborted) {
        throw new BuilderforceApiError(`Request timed out after ${timeoutMs}ms`, 408, 'timeout');
      }
      if (options?.signal?.aborted) {
        throw new BuilderforceApiError('Request aborted by caller', 499, 'aborted');
      }
      throw error;
    } finally {
      clearTimeout(timer);
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

/**
 * Combine multiple AbortSignals into one. Uses native `AbortSignal.any` when
 * available (Node 20+, modern Workers); falls back to manual event linking.
 */
function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const live = signals.filter((s): s is AbortSignal => s !== undefined);
  if (live.length === 1) return live[0]!;

  const anyImpl = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyImpl === 'function') {
    return anyImpl(live);
  }

  const ctl = new AbortController();
  for (const s of live) {
    if (s.aborted) { ctl.abort(s.reason); break; }
    s.addEventListener('abort', () => ctl.abort(s.reason), { once: true });
  }
  return ctl.signal;
}
