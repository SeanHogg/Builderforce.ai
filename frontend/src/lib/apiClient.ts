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
import { signalTermsGate } from './errors/termsGateEvent';
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

/**
 * The OpenAI-style envelope the gateway emits when the model cascade is
 * exhausted: `{ error: { message, code, type, details } }`. The flat gateway
 * shape puts a plain STRING in `error` instead, so on the wire this field is
 * genuinely a union — and typing it `string` is precisely how an object reached
 * React as a child ("Objects are not valid as a React child (found: object with
 * keys {message, code, type, details})") from whichever banner rendered the
 * message. The SDK's `httpClient.toApiError` unwraps the same three shapes for
 * the same reason; this is that unwrap for the browser client.
 */
interface ApiErrorEnvelope {
  message?: string;
  /** The gateway sends the HTTP status here as a NUMBER (`"code": 429`) while
   *  the flat shape sends a string slug (`plan_token_limit_exceeded`). */
  code?: string | number;
  type?: string;
  details?: unknown;
}

interface ApiErrorBody {
  error?: string | ApiErrorEnvelope;
  code?: string | number;
  message?: string;
  details?: unknown;
}

/**
 * Flatten either envelope to the three fields the rest of this module reads, so
 * no call site has to know which shape the gateway picked. One unwrap, used by
 * every transport — the alternative is each reader re-deciding, and the one that
 * forgets renders an object.
 */
function flattenErrorBody(body: ApiErrorBody): { message?: string; code?: string; details?: unknown } {
  const nested = typeof body.error === 'object' && body.error !== null ? body.error : null;
  const flatMessage = typeof body.error === 'string' ? body.error : undefined;
  const message = body.message ?? nested?.message ?? flatMessage;
  const code = body.code ?? nested?.code;
  return {
    // Never hand back a non-string: everything downstream of this renders or
    // reports it, and the whole point of this unwrap is that none of them can.
    ...(typeof message === 'string' ? { message } : {}),
    ...(code === undefined ? {} : { code: String(code) }),
    details: body.details ?? nested?.details,
  };
}

/**
 * The error envelope, parsed once.
 *
 * `read` clones the response, so the streaming transport — whose caller still
 * owns the body — reports the same `code`/`message` as the JSON transports
 * instead of a bare status line. Without the code it could not tell a fault from
 * a gate signal, and a terms bump toasted every open stream.
 */
async function readErrorBody(res: Response): Promise<ApiErrorBody> {
  return await res.clone().json().catch(() => ({})) as ApiErrorBody;
}

/** APIs return a stable machine-readable `error` plus a human-readable `message`
 *  (for example the task Done gate). Prefer the explanation in the UI while
 *  retaining `code` for diagnostics. */
function errorMessage(body: ApiErrorBody, res: Response): string {
  const { message } = flattenErrorBody(body);
  return message || res.statusText || `Request failed (${res.status})`;
}

/**
 * A 401 answering a request that carried NO credential is not a fault.
 *
 * It is the server restating what the client already knew: nobody is signed in.
 * `checkUnauthorizedAndRedirect` has always drawn this line — it clears the
 * session and bounces to login ONLY when a token was actually sent, because
 * otherwise there is no session to expire — but the reporting path did not, so
 * the same response was simultaneously "nothing to do" and a support ticket.
 *
 * A signed-out visitor on the creation canvas is the case that made this bite:
 * every connected-account panel calls the API with the tenant token, so tapping
 * along the rail filed a ticket per panel ("Missing or malformed Authorization
 * header") without ever telling the person they simply needed an account. Those
 * panels now ask `connectedAccountGate` first, but a gate is a rule each new
 * call site has to remember, and it cannot help a tab still running the bundle
 * from before the gate shipped. This is the floor underneath it: no credential
 * sent, no ticket filed — for every caller, on every transport, forever.
 *
 * Deliberately narrow. A 401 WITH a token is a real expired session, and a 403
 * is a real permission failure; both still report.
 */
function isAnonymousUnauthorized(status: number, hadToken: boolean): boolean {
  return status === 401 && !hadToken;
}

/**
 * The ONE place a non-ok response is judged: fault (toast + support ticket),
 * gate (route the user), or known state (stay quiet).
 *
 * Returns the parsed envelope so the caller can throw with it — all three
 * transports share this decision rather than keeping their own copy of it.
 */
async function reportApiFailure(
  res: Response,
  url: string,
  method: string,
  expectedErrors: number[] | undefined,
  hadToken: boolean,
): Promise<ApiErrorBody> {
  const body = await readErrorBody(res);
  // Read through the same unwrap as the message: a cascade-exhausted 429 carries
  // its code and details nested too, so reading them off the top level alone
  // dropped the one code that explains the failure.
  const { code, details } = flattenErrorBody(body);
  // A terms bump is a GATE, not a fault — it routes the user to the acceptance
  // screen rather than the support-ticket toast. Signalled before the
  // `expectedErrors` check so the gate heals whichever call happens to hit it
  // first, including one whose caller opted out of the error surface.
  const gated = signalTermsGate(res.status, code);
  if (!gated && !isAnonymousUnauthorized(res.status, hadToken) && !expectedErrors?.includes(res.status)) {
    dispatchApiError({
      method: method.toUpperCase(),
      url,
      status: res.status,
      code,
      message: errorMessage(body, res),
      details,
      requestId: res.headers.get('x-request-id') ?? undefined,
    });
  }
  return body;
}

/** The one place a non-ok response becomes a thrown Error + a global toast. */
async function reportAndThrow(
  res: Response,
  url: string,
  method: string,
  expectedErrors: number[] | undefined,
  hadToken: boolean,
): Promise<never> {
  const body = await reportApiFailure(res, url, method, expectedErrors, hadToken);
  // Through the same unwrap as the toast: a caller that catches this reads the
  // nested code and details too, and never a raw numeric `code`.
  const { code, details } = flattenErrorBody(body);
  throw new ApiRequestError(errorMessage(body, res), res.status, code, details);
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
  if (!res.ok) await reportAndThrow(res, url, init.method ?? 'GET', expectedErrors, hadToken);
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
  if (!res.ok) await reportAndThrow(res, url, init.method ?? 'GET', expectedErrors, hadToken);
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
  // Same judgement as the JSON transports, from the same function rather than a
  // copy of it — this is the path the activity tracker's best-effort flush
  // takes, and an un-recognised terms bump made it raise a "Stream request
  // failed" toast every 15 seconds. It reports but does not throw: the caller
  // inspects the status itself.
  if (!res.ok) await reportApiFailure(res, url, init.method ?? 'GET', expectedErrors, hadToken);
  return res;
}
