/**
 * The tenant-API client (`/api/*`) every Rovr write goes through — authenticated with
 * the session's tenant JWT, and honest about failure: a non-OK answer throws an error
 * that carries its HTTP `status`, which is exactly what the write outbox reads to tell
 * a refusal (4xx: dropped) from a connection that was not there (no status: retried).
 *
 * `asScope` pins the identity a replayed write must be sent as: when the session now
 * acts as another tenant the request is NOT sent — it fails retriably and waits.
 */
import type { Session } from '../auth/session';

export type ApiFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  json?: unknown;
  /** The outbox scope this write was queued under (`tenant:<id>`). */
  asScope?: string;
  /** Sent as `Idempotency-Key` — a replay is answered with the first response. */
  idempotencyKey?: string;
}

/**
 * The API answers `{error:"msg"}` or the nested `{error:{message,code}}`. Reading
 * `error` as a string alone rendered "[object Object]" for the nested form.
 * Mirrors frontend/src/lib/apiClient.ts flattenErrorBody (no package the
 * extension and the web app both import, so one copy per runtime).
 */
export function flattenErrorMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const b = body as { error?: unknown; message?: unknown };
  const nested = typeof b.error === 'object' && b.error !== null ? (b.error as { message?: unknown }) : null;
  return [b.message, nested?.message, b.error].find((c): c is string => typeof c === 'string' && c.length > 0);
}

export class ApiError extends Error {
  constructor(readonly status: number | undefined, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  request<T>(path: string, init?: ApiRequestInit): Promise<T>;
  /**
   * The same authenticated call, answering with the STATUS and parsed body instead of
   * throwing on a non-2xx — for a caller whose decision turns on which refusal it got
   * (`@builderforce/provider-connect`: 404 = connect first, 409 = reconnect). Still throws
   * an `ApiError` without a status when there was no answer at all.
   */
  raw(path: string, init?: ApiRequestInit): Promise<{ status: number; body: unknown }>;
}

export function createApiClient(deps: { session: Session; baseUrl: string; fetch: ApiFetch }): ApiClient {
  /** The ONE authenticated send both answers share. */
  const send = async (path: string, init: ApiRequestInit): Promise<Response> => {
    const { json, asScope, idempotencyKey, headers, ...rest } = init;
    if (asScope !== undefined && asScope !== deps.session.scope()) {
      throw new ApiError(undefined, 'parked: queued for another workspace');
    }
    const token = await deps.session.jwt();
    // No status: the outbox keeps it and retries once there is a credential again.
    if (!token) throw new ApiError(undefined, 'not signed in or unreachable');
    try {
      return await deps.fetch(`${deps.baseUrl}${path}`, {
        ...rest,
        headers: {
          ...(headers as Record<string, string> | undefined),
          authorization: `Bearer ${token}`,
          ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      });
    } catch (e) {
      throw new ApiError(undefined, e instanceof Error ? e.message : String(e));
    }
  };

  return {
    async request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
      const res = await send(path, init);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let message = text.slice(0, 300);
        try {
          message = flattenErrorMessage(JSON.parse(text)) ?? message;
        } catch {
          /* not JSON */
        }
        throw new ApiError(res.status, `${message || 'request failed'} (HTTP ${res.status})`);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    },
    async raw(path: string, init: ApiRequestInit = {}) {
      const res = await send(path, init);
      const text = await res.text().catch(() => '');
      let body: unknown = undefined;
      try {
        body = text ? (JSON.parse(text) as unknown) : undefined;
      } catch {
        body = text;
      }
      return { status: res.status, body };
    },
  };
}
