import type { FailoverEvent } from '../domain/types';

export class BuilderforceApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: unknown;
  public readonly requestId?: string;
  /**
   * `true` when the gateway has signalled this error will not resolve by
   * retrying on a different model — e.g. plan or per-claw daily token cap
   * exhausted (those caps are per-tenant, not per-model). Consumer-side
   * fallback chains should short-circuit when this is set.
   */
  public readonly terminal?: boolean;
  /** Seconds the consumer should wait before retrying — server-supplied. */
  public readonly retryAfter?: number;
  /**
   * Cascade attempts that failed before this error was returned — populated
   * when the gateway returns `429 cascade_exhausted` with a `details.failovers`
   * array. Each entry includes the vendor that owns the model so callers can
   * detect single-vendor saturation (e.g. all attempts on `openrouter`).
   */
  public readonly failovers?: FailoverEvent[];
  /**
   * Upstream vendor the gateway dispatched against (`'openrouter' | 'cerebras'
   * | 'nvidia' | 'ollama' | 'googleai' | …`). Set on every error where the
   * gateway selected an upstream — including single-attempt failures that
   * never ran a cascade (timeouts, single-vendor 429s, `model_unavailable`).
   *
   * Unset only for pre-dispatch errors where no vendor was ever selected:
   * `401`/`403` auth failures, `400` validation failures, `409` idempotent
   * replay, and tenant-cap 429s (`plan_token_limit_exceeded`,
   * `claw_token_limit_exceeded`) — those caps are per-tenant, not per-model.
   *
   * Sourced from the gateway's catalog lookup so consumers never have to
   * parse the model id to recover vendor identity.
   */
  public readonly vendor?: string;
  /**
   * Model id the gateway dispatched against — set whenever `vendor` is set.
   * Pair with `vendor` for per-attempt observability without prefix parsing.
   */
  public readonly model?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
    requestId?: string,
    extras?: { terminal?: boolean; retryAfter?: number; vendor?: string; model?: string },
  ) {
    super(message);
    this.name = 'BuilderforceApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.terminal = extras?.terminal;
    this.retryAfter = extras?.retryAfter;
    this.vendor = extras?.vendor;
    this.model = extras?.model;
    // Pull typed failovers out of `details.failovers` when the gateway
    // supplied them. Validation is light — drop entries missing required
    // fields so consumers never get a partially-populated row.
    if (details && typeof details === 'object') {
      const f = (details as { failovers?: unknown }).failovers;
      if (Array.isArray(f)) {
        const cleaned: FailoverEvent[] = [];
        for (const entry of f) {
          if (entry && typeof entry === 'object') {
            const e = entry as { model?: unknown; vendor?: unknown; code?: unknown };
            if (typeof e.model === 'string' && typeof e.vendor === 'string' && typeof e.code === 'number') {
              const ev = entry as { durationMs?: unknown; kind?: unknown; reason?: unknown; upstreamStatus?: unknown };
              cleaned.push({
                model: e.model, vendor: e.vendor, code: e.code,
                ...(typeof ev.durationMs === 'number' ? { durationMs: ev.durationMs } : {}),
                ...(typeof ev.kind === 'string' ? { kind: ev.kind } : {}),
                ...(typeof ev.reason === 'string' ? { reason: ev.reason } : {}),
                ...(typeof ev.upstreamStatus === 'number' ? { upstreamStatus: ev.upstreamStatus } : {}),
              });
            }
          }
        }
        if (cleaned.length > 0) this.failovers = cleaned;
      }
    }
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
    // Bind to `globalThis` so calling via `this.fetchFn(...)` doesn't trip
    // Cloudflare Workers' "Illegal invocation" check — the platform's fetch
    // requires the global receiver, not an instance method `this`. Affects
    // any environment that ships a strict-receiver fetch (Workers, Bun, etc.)
    // and is harmless on Node + browsers.
    const fetchImpl = options.fetchFn ?? fetch;
    this.fetchFn = fetchImpl.bind(globalThis);
    // 180s aligns the outer SDK budget with the premium routing path on the
    // gateway: per-vendor 60s × up to 3 PREMIUM-tier attempts = ~180s. Customers
    // running tailor / job-extract style long-context calls were hitting the
    // previous 60s cap before the gateway could finish its premium cascade.
    // Per-call `timeoutMs` still overrides for callers that want a tighter UX.
    this.defaultTimeoutMs = options.timeoutMs ?? 180_000;
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

    // Prefer server-supplied `Retry-After` header (seconds) when present; the
    // body's `retryAfter` is a fallback for environments that strip headers.
    const headerRetryAfter = parsePositiveInt(res.headers.get('retry-after'));

    try {
      const payload = await res.json() as Record<string, unknown> | null;

      // Three envelope shapes are in the wild:
      //
      //   Flat   — { error: "msg", code, details, terminal?, retryAfter? }
      //            (gateway's documented shape — plan_token_limit_exceeded etc.)
      //   OpenAI — { error: { message, code, type, details } }
      //            (cascade-exhausted 429 on both chat and image surfaces —
      //             matches OpenAI's error envelope convention)
      //   Wrapped — { success: false, error: { code, message, details } }
      //            (consumer-side wrappers around the gateway, e.g. some
      //             tenant proxies emit AI_RATE_LIMITED / AI_UNAVAILABLE
      //             envelopes that re-wrap the upstream error)
      //
      // Unwrap to a single `inner` shape so `details.failovers` etc. always
      // populate on `BuilderforceApiError` regardless of which envelope the
      // gateway picked. Single parsing site for every surface (DRY).
      const errorObj =
        payload !== null
        && typeof payload === 'object'
        && typeof payload.error === 'object'
        && payload.error !== null
          ? payload.error as Record<string, unknown>
          : null;

      const isWrapped =
        payload !== null
        && typeof payload === 'object'
        && payload.success === false
        && errorObj !== null;

      const inner = (isWrapped || errorObj !== null ? errorObj : payload) as {
        error?:      string;
        message?:    string;
        code?:       string | number;
        details?:    unknown;
        terminal?:   boolean;
        retryAfter?: number;
        vendor?:     string;
        model?:      string;
      } | null;

      const message =
        (typeof inner?.message === 'string' && inner.message)
        || (typeof inner?.error === 'string' && inner.error)
        || fallback;

      // Coerce numeric error codes (e.g. cascade-exhausted emits `code: 429`)
      // to string so `BuilderforceApiError.code` stays a stable type for
      // consumer-side switches. String codes pass through unchanged.
      const code = typeof inner?.code === 'number' ? String(inner.code) : inner?.code;

      // Vendor/model may travel at the top of the error envelope (gateway
      // dispatched against an upstream) OR be embedded in details (e.g.
      // `model_unavailable` carries `details.requestedModel`). Prefer the
      // top-level fields; fall back to details so we still extract a model
      // from the strict-pin 503 envelope without a gateway change.
      const detailsObj = (inner?.details && typeof inner.details === 'object')
        ? inner.details as { vendor?: unknown; model?: unknown; requestedModel?: unknown }
        : null;
      const vendor = typeof inner?.vendor === 'string'
        ? inner.vendor
        : (typeof detailsObj?.vendor === 'string' ? detailsObj.vendor : undefined);
      const model = typeof inner?.model === 'string'
        ? inner.model
        : (typeof detailsObj?.model === 'string'
            ? detailsObj.model
            : (typeof detailsObj?.requestedModel === 'string' ? detailsObj.requestedModel : undefined));

      return new BuilderforceApiError(
        message,
        res.status,
        code,
        inner?.details,
        requestId,
        {
          terminal:   inner?.terminal,
          retryAfter: headerRetryAfter ?? inner?.retryAfter,
          vendor,
          model,
        },
      );
    } catch {
      const text = await res.text().catch(() => '');
      return new BuilderforceApiError(
        text || fallback,
        res.status,
        undefined,
        undefined,
        requestId,
        headerRetryAfter !== undefined ? { retryAfter: headerRetryAfter } : undefined,
      );
    }
  }
}

function parsePositiveInt(s: string | null): number | undefined {
  if (s == null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
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
