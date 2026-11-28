/**
 * The tenant-API client (`/api/*`) every Rovr write goes through — authenticated with
 * the session's tenant JWT, and honest about failure: a non-OK answer throws an error
 * that carries its HTTP `status`, which is exactly what the write outbox reads to tell
 * a refusal (4xx: dropped) from a connection that was not there (no status: retried).
 *
 * `asScope` pins the identity a replayed write must be sent as: when the session now
 * acts as another tenant the request is NOT sent — it fails retriably and waits.
 */
import { sendWithTenantSession } from '@builderforce/device-auth';
import { flattenApiError } from '@builderforce/api-errors';
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
 */
export function flattenErrorMessage(body: unknown): string | undefined {
  return flattenApiError(body).message;
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

/**
 * The ONE authenticated send: the session's tenant JWT, the outbox scope pin, the JSON
 * body and the idempotency key. Answers the raw `Response` — `createApiClient` reads it
 * into its two shapes, and a shared client that maps statuses itself
 * (`@builderforce/knowledge-client`) takes it as its `fetch`. A body the caller already
 * serialized (`body`) passes through when there is no `json`.
 */
export type AuthenticatedFetch = (path: string, init?: ApiRequestInit & Pick<RequestInit, 'body'>) => Promise<Response>;

export function createAuthenticatedFetch(deps: { session: Session; baseUrl: string; fetch: ApiFetch }): AuthenticatedFetch {
  return async (path, init = {}) => {
    const { json, asScope, idempotencyKey, headers, ...rest } = init;
    let requiredScope: string | null | undefined = asScope;
    const checkScope = () => {
      const scope = deps.session.scope();
      if (requiredScope !== undefined && requiredScope !== scope) {
        throw new ApiError(undefined, 'parked: queued for another workspace');
      }
      return scope;
    };
    checkScope();
    try {
      const requestHeaders = new Headers(headers);
      if (json !== undefined) requestHeaders.set('content-type', 'application/json');
      if (idempotencyKey) requestHeaders.set('Idempotency-Key', idempotencyKey);
      const body = json !== undefined ? JSON.stringify(json) : rest.body;
      const response = await sendWithTenantSession(
        (force) => deps.session.jwt(force),
        (token) => {
          requiredScope = checkScope();
          const authenticatedHeaders = new Headers(requestHeaders);
          authenticatedHeaders.set('authorization', `Bearer ${token}`);
          return deps.fetch(`${deps.baseUrl}${path}`, { ...rest, headers: authenticatedHeaders, body });
        },
        !(body instanceof ReadableStream),
      );
      // No status: the outbox keeps it and retries once there is a credential again.
      if (!response) throw new ApiError(undefined, 'not signed in or unreachable');
      return response;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(undefined, e instanceof Error ? e.message : String(e));
    }
  };
}

export function createApiClient(deps: { session: Session; baseUrl: string; fetch: ApiFetch }): ApiClient {
  const send = createAuthenticatedFetch(deps);

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
