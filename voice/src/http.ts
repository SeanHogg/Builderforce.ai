/**
 * http — a minimal bearer-auth fetch wrapper for the gateway synthesize call.
 *
 * Deliberately tiny (one POST shape) rather than re-pulling the full
 * @seanhogg/builderforce-sdk HttpClient: this package has exactly one server
 * endpoint to hit. Same auth + timeout + typed-error conventions as the SDK so
 * behaviour is familiar.
 */

export class VoiceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'VoiceApiError';
  }
}

export interface HttpOptions {
  apiKey: string;
  baseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class Http {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HttpOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    if (typeof this.fetchFn !== 'function') {
      throw new VoiceApiError('No fetch implementation available', 0, 'no_fetch');
    }
  }

  async postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const composite = composeSignals(controller.signal, signal);
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: composite,
      });
      if (!res.ok) throw await toError(res);
      return (await res.json()) as T;
    } catch (err) {
      if (controller.signal.aborted && !(signal?.aborted ?? false)) {
        throw new VoiceApiError(`Request timed out after ${this.timeoutMs}ms`, 408, 'timeout');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function toError(res: Response): Promise<VoiceApiError> {
  let message = `Request failed with ${res.status}`;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { error?: string | { message?: string; code?: string }; code?: string };
    if (typeof body.error === 'string') message = body.error;
    else if (body.error?.message) message = body.error.message;
    code = (typeof body.error === 'object' ? body.error.code : undefined) ?? body.code;
  } catch {
    // Non-JSON error body — keep the status-derived message.
  }
  return new VoiceApiError(message, res.status, code);
}

/** Abort when either the timeout or the caller's signal fires. */
function composeSignals(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  if (typeof (AbortSignal as { any?: unknown }).any === 'function') {
    return (AbortSignal as unknown as { any(s: AbortSignal[]): AbortSignal }).any([a, b]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}
