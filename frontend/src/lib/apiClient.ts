/**
 * Single API client for api.builderforce.ai.
 * When NEXT_PUBLIC_WORKER_URL is set, project and IDE file calls use the worker;
 * otherwise they use the auth API. Auth always uses AUTH_API_URL.
 */

import {
  AUTH_API_URL,
  checkUnauthorizedAndRedirect,
  getStoredTenantToken,
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

export function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getStoredTenantToken();
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
}

/**
 * Authenticated request to the API. Throws on !res.ok.
 * On 401 (invalid/expired token), clears session and redirects to login.
 */
export async function apiRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {}
): Promise<T> {
  const { raw, headers: optHeaders, expectedErrors, ...init } = opts;
  const authHeaders = getAuthHeaders();
  const hadToken = !!authHeaders.Authorization;
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: { ...authHeaders, ...optHeaders } as HeadersInit,
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (res.status === 402) throw await planLimitErrorFromResponse(res);
  if (!res.ok) {
    const msg = await res.json().catch(() => ({})) as { error?: string; code?: string; details?: unknown };
    const message = msg.error || res.statusText || `Request failed (${res.status})`;
    if (!expectedErrors?.includes(res.status)) {
      dispatchApiError({
        method: init.method?.toUpperCase() ?? 'GET',
        url: `${getApiBaseUrl()}${path}`,
        status: res.status,
        code: msg.code,
        message,
        details: msg.details,
        requestId: res.headers.get('x-request-id') ?? undefined,
      });
    }
    throw new Error(message);
  }
  if (raw) return undefined as T;
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Request that returns response text (e.g. dataset download). On 401, redirects to login. */
export async function apiRequestText(path: string, opts: RequestInit = {}): Promise<string> {
  const authHeaders = getAuthHeaders();
  const hadToken = !!authHeaders.Authorization;
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...opts,
    headers: { ...authHeaders, ...(opts.headers as Record<string, string>) },
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (!res.ok) {
    const message = res.statusText || 'Request failed';
    dispatchApiError({
      method: (opts.method ?? 'GET').toUpperCase(),
      url: `${getApiBaseUrl()}${path}`,
      status: res.status,
      message,
      requestId: res.headers.get('x-request-id') ?? undefined,
    });
    throw new Error(message);
  }
  return res.text();
}

/** Request that returns the Response for streaming (e.g. SSE). Caller must read body. On 401, redirects to login. */
export async function apiRequestStream(path: string, opts: RequestInit = {}): Promise<Response> {
  const authHeaders = getAuthHeaders();
  const hadToken = !!authHeaders.Authorization;
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...opts,
    headers: { ...authHeaders, ...(opts.headers as Record<string, string>) },
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (!res.ok) {
    dispatchApiError({
      method: (opts.method ?? 'GET').toUpperCase(),
      url: `${getApiBaseUrl()}${path}`,
      status: res.status,
      message: res.statusText || 'Stream request failed',
      requestId: res.headers.get('x-request-id') ?? undefined,
    });
  }
  return res;
}
