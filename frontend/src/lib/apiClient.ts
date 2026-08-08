/**
 * THE API client for api.builderforce.ai — one transport, one header contract.
 *
 * Everything that talks to the API goes through {@link apiRequest} (or its
 * text/stream siblings). This is not a style preference: the header contract is
 * load-bearing, and duplicating it broke real features.
 *
 * Before this was the single transport there were FIVE copies of the fetch
 * wrapper — `builderforceApi.request`/`webRequest` (imported by 236 modules),
 * `personaCadenceApi`, `emailPreferencesApi`, plus 72 raw `fetch()` calls in
 * `freelancerApi`. They had drifted, and the drift was invisible:
 *
 *   - only this copy sent `X-Emulation-Token`, so a superadmin emulating a user
 *     saw their OWN data on every screen served by the other clients;
 *   - only this copy sent the locale header, so the API fell back to
 *     Accept-Language and mailed people in their OS language, not the one they
 *     picked in the app;
 *   - two copies omitted `dispatchApiError`, so their failures never raised the
 *     global error toast and looked like nothing happened.
 *
 * Adding a header here now reaches every call site, which is the whole point.
 *
 * When NEXT_PUBLIC_WORKER_URL is set, project and IDE file calls use the worker;
 * otherwise they use the auth API. Auth always uses AUTH_API_URL.
 */

import {
  AUTH_API_URL,
  checkUnauthorizedAndRedirect,
  getStoredTenantToken,
  getStoredWebToken,
} from './auth';
import { planLimitErrorFromResponse } from './planLimitError';
import { dispatchApiError } from './errors/apiErrorEvent';
import { LOCALE_HEADER, readLocaleCookie } from '@/i18n/config';

export function getApiBaseUrl(): string {
  return AUTH_API_URL;
}

/** Builderforce worker URL for projects + files. When set, IDE uses worker for project/file APIs. */
export function getWorkerUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_WORKER_URL;
}

/** Base URL for project and file APIs: worker if set, else auth API. */
export function getProjectsBaseUrl(): string {
  const w = getWorkerUrl();
  if (w) return w.replace(/\/$/, '');
  return getApiBaseUrl();
}

/** True if project/file requests should go to the worker (different path shape). */
export function isWorkerForProjects(): boolean {
  return !!getWorkerUrl();
}

// ---------------------------------------------------------------------------
// Emulation token — set/cleared by EmulationContext; never written to storage.
// When present, all API requests carry X-Emulation-Token so the backend can
// apply the emulation identity (read-only; mutating verbs are blocked server-side).
// ---------------------------------------------------------------------------

let _emulationToken: string | null = null;

export function setEmulationToken(token: string): void {
  _emulationToken = token;
}

export function clearEmulationToken(): void {
  _emulationToken = null;
}

/**
 * Which credential a request carries.
 *
 *  - `tenant` (default) — the workspace JWT. Everything scoped to a workspace.
 *  - `web`              — the person-level JWT, for endpoints behind
 *                         `webAuthMiddleware`: a user may have no workspace at
 *                         all (a freelancer), or the setting belongs to the
 *                         human rather than the workspace (email preferences).
 *  - `none`             — public endpoints. Still gets the locale header and
 *                         still reports errors; just sends no Authorization.
 */
export type AuthMode = 'tenant' | 'web' | 'none';

export function getAuthHeaders(
  extra?: Record<string, string>,
  auth: AuthMode = 'tenant',
): Record<string, string> {
  const token = auth === 'tenant' ? getStoredTenantToken() : auth === 'web' ? getStoredWebToken() : null;
  const headers: Record<string, string> = { ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (_emulationToken) headers['X-Emulation-Token'] = _emulationToken;
  // Tell the API which language the user is actually using. The NEXT_LOCALE cookie
  // cannot reach a different origin, so without this the server falls back to
  // Accept-Language (the OS default) and mails people in the wrong language.
  const locale = readLocaleCookie();
  if (locale) headers[LOCALE_HEADER] = locale;
  return headers;
}

export interface RequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  /** If true, do not parse JSON (e.g. for text or stream). */
  raw?: boolean;
  /**
   * HTTP statuses the caller handles itself (e.g. a 409 it renders inline).
   * For these, the request still throws so the caller's catch runs, but no
   * global error toast / support-ticket prompt is raised — they aren't system
   * faults. Anything not listed still surfaces the global toast.
   */
  expectedErrors?: number[];
  /** Which credential to send. Defaults to the workspace (tenant) JWT. */
  auth?: AuthMode;
  /**
   * Origin to call. Defaults to the auth API. Pass {@link getProjectsBaseUrl} for
   * project/IDE file calls, which go to the standalone worker when
   * NEXT_PUBLIC_WORKER_URL is set. This option exists so that "different origin"
   * never means "different transport" — it was the last remaining excuse for a
   * separate fetch wrapper.
   */
  baseUrl?: string;
  /**
   * Send `Content-Type: application/json`. Defaults to true for requests with a
   * body, and is forced OFF for `FormData` — multipart must set its own
   * Content-Type so the boundary parameter survives.
   */
  json?: boolean;
}

/** Body types that carry (or must be allowed to set) their own Content-Type. */
function isSelfTypedBody(body: BodyInit | null | undefined): boolean {
  if (body == null) return true;
  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams)
  );
}

/**
 * A failed request, carrying what the server said ALONGSIDE the message.
 *
 * A bare `Error` forced every caller that needed the machine-readable half of an
 * error body — a code to branch on, a `details` payload listing exactly which
 * inputs were rejected — to either re-fetch or hand-roll its own transport. The
 * fields are on the error so a caller can `catch` and read them; message-only
 * callers are unaffected because this is still an `Error`.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    if (code !== undefined) this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** The one place a non-ok response becomes a thrown Error + a global toast. */
async function reportAndThrow(
  res: Response,
  url: string,
  method: string,
  expectedErrors?: number[],
): Promise<never> {
  const body = await res.json().catch(() => ({})) as {
    error?: string;
    code?: string;
    message?: string;
    details?: unknown;
  };
  // APIs commonly return a stable machine-readable `error` plus a human-readable
  // `message` (for example the task Done gate). Prefer the explanation in the UI
  // while retaining `code` for diagnostics.
  const message = body.message || body.error || res.statusText || `Request failed (${res.status})`;
  if (!expectedErrors?.includes(res.status)) {
    dispatchApiError({
      method: method.toUpperCase(),
      url,
      status: res.status,
      code: body.code,
      message,
      details: body.details,
      requestId: res.headers.get('x-request-id') ?? undefined,
    });
  }
  throw new ApiRequestError(message, res.status, body.code, body.details);
}

/**
 * Authenticated request to the API. Throws on !res.ok.
 * On 401 (invalid/expired token), clears session and redirects to login.
 * On 402, throws a typed plan-limit error the upgrade UI can render.
 */
export async function apiRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {}
): Promise<T> {
  const { raw, headers: optHeaders, expectedErrors, auth = 'tenant', json, baseUrl, ...init } = opts;
  const wantsJson = json ?? isSelfTypedBody(init.body) === false;
  const base: Record<string, string> = wantsJson ? { 'Content-Type': 'application/json' } : {};
  const authHeaders = getAuthHeaders(base, auth);
  const hadToken = !!authHeaders.Authorization;
  const url = `${baseUrl ?? getApiBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders, ...optHeaders } as HeadersInit,
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (res.status === 402) throw await planLimitErrorFromResponse(res);
  if (!res.ok) await reportAndThrow(res, url, init.method ?? 'GET', expectedErrors);
  if (raw) return undefined as T;
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Request that returns response text (e.g. dataset download). On 401, redirects to login. */
export async function apiRequestText(path: string, opts: RequestOptions = {}): Promise<string> {
  const { raw: _raw, headers: optHeaders, expectedErrors, auth = 'tenant', json, baseUrl, ...init } = opts;
  const wantsJson = json ?? isSelfTypedBody(init.body) === false;
  const authHeaders = getAuthHeaders(wantsJson ? { 'Content-Type': 'application/json' } : {}, auth);
  const hadToken = !!authHeaders.Authorization;
  const url = `${baseUrl ?? getApiBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders, ...optHeaders } as HeadersInit,
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (res.status === 402) throw await planLimitErrorFromResponse(res);
  if (!res.ok) await reportAndThrow(res, url, init.method ?? 'GET', expectedErrors);
  return res.text();
}

/**
 * Request that returns the raw Response for streaming (e.g. SSE) or for a body
 * the caller reads itself (a Blob download). Caller must read the body.
 *
 * Unlike the other two this does NOT throw on a non-ok response — some callers
 * want to inspect the status — but it still reports the failure to the global
 * error surface so a broken stream is never silent.
 */
export async function apiRequestStream(path: string, opts: RequestOptions = {}): Promise<Response> {
  const { raw: _raw, headers: optHeaders, expectedErrors, auth = 'tenant', json, baseUrl, ...init } = opts;
  const wantsJson = json ?? isSelfTypedBody(init.body) === false;
  const authHeaders = getAuthHeaders(wantsJson ? { 'Content-Type': 'application/json' } : {}, auth);
  const hadToken = !!authHeaders.Authorization;
  const url = `${baseUrl ?? getApiBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders, ...optHeaders } as HeadersInit,
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  // A 402 is always a plan limit, and the upgrade UI keys off the typed error —
  // so it throws here exactly as it does in the other two transports rather than
  // leaving each caller to remember the check.
  if (res.status === 402) throw await planLimitErrorFromResponse(res);
  if (!res.ok && !expectedErrors?.includes(res.status)) {
    dispatchApiError({
      method: (init.method ?? 'GET').toUpperCase(),
      url,
      status: res.status,
      message: res.statusText || 'Stream request failed',
      requestId: res.headers.get('x-request-id') ?? undefined,
    });
  }
  return res;
}
