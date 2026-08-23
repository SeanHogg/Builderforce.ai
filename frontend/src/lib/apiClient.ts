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
 * the freelance client (now `lib/freelance/*`, behind its own `transport` seam). They had drifted, and the drift was invisible:
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
import { fetchWithTransportReport, TRANSPORT_FAILURE_STATUS } from './errors/transportFailure';
import { signalTermsGate } from './errors/termsGateEvent';
import { LOCALE_HEADER, readLocaleCookie } from '@/i18n/config';
import { guestReadResponse, resolveGuestRead } from '@/domains/guest/application/guestRead';

export function getApiBaseUrl(): string {
  return AUTH_API_URL;
}

/** Builderforce worker URL for IDE FILE storage. Projects no longer route here. */
export function getWorkerUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_WORKER_URL;
}

/**
 * Base URL for project reads/writes: ALWAYS the auth API.
 *
 * It used to be the worker when `NEXT_PUBLIC_WORKER_URL` was set, which meant a
 * second implementation of project CRUD served those deployments — one that read
 * projects with no tenant predicate, dropped `dueDate` on save, and returned no
 * health breakdown. That router is retired (see `worker/src/routes/projects.ts`);
 * projects have one implementation now.
 *
 * IDE FILES still follow the worker when it is configured — see
 * {@link isWorkerForFiles}. That path is R2 storage, which is genuinely the
 * worker's job and is not duplicated anywhere.
 */
export function getProjectsBaseUrl(): string {
  return getApiBaseUrl();
}

/** True if IDE FILE requests should go to the worker (different path shape). */
export function isWorkerForFiles(): boolean {
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
  /**
   * True when this is the server restating that nobody is signed in — a 401
   * answering a request that carried no credential at all.
   *
   * The transport has always KNOWN this (see {@link isAnonymousUnauthorized}:
   * it is why no support ticket is filed) and then threw an error that did not
   * say so, leaving every caller to render `Missing or malformed Authorization
   * header` in a red box. That sentence is not a fault report, it is a fact
   * about the reader, and a guest reading `/incidents` over the sample
   * workspace met it as a failure. Carrying the flag on the error is what lets
   * a surface answer with its empty state instead — see
   * {@link isSignedOutFailure}.
   */
  readonly signedOut: boolean;
  constructor(message: string, status: number, code?: string, details?: unknown, signedOut = false) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.signedOut = signedOut;
    if (code !== undefined) this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/**
 * Is this rejection just "you are not signed in"?
 *
 * ONE predicate, so a surface never re-derives it from a status code and a
 * guess about whether a token was sent — it cannot know the second half, which
 * is exactly why the checks that were attempted read `status === 401` and
 * treated an EXPIRED session as a signed-out one.
 *
 * Accepts `unknown` because that is what a `catch` binding is.
 */
export function isSignedOutFailure(error: unknown): boolean {
  return error instanceof ApiRequestError && error.signedOut;
}

/**
 * The message a surface should SHOW for a rejection, or `null` when there is
 * nothing to report.
 *
 * The shape is chosen so the migration is one line per call site and the guards
 * around it keep working: `setError(faultMessage(e))` in place of
 * `setError(e.message)` leaves `error` a `string | null`, so every existing
 * `{error && …}` and `!error &&` reads correctly — and a signed-out read now
 * falls through to the section's EMPTY state, which is the honest answer,
 * rather than a red box quoting a header name at someone who simply has no
 * account.
 */
export function faultMessage(error: unknown): string | null {
  if (!error || isSignedOutFailure(error)) return null;
  return error instanceof Error ? error.message : String(error);
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
  throw new ApiRequestError(errorMessage(body, res), res.status, code, details, isAnonymousUnauthorized(res.status, hadToken));
}

/**
 * Everything the three transports did IDENTICALLY, in one place: resolve the
 * credential, build the URL, send it, and apply the two judgements that are the
 * same regardless of how the caller wants the body back (an expired session
 * redirects; a 402 becomes the typed plan-limit error).
 *
 * It also owns the case none of the three handled: `fetch` REJECTING. A rejection
 * carries no response to inspect, so every check below it was skipped and the
 * `TypeError` escaped the client entirely - no toast, no report, and a console
 * message blaming CORS for a failure that is almost never about CORS. That is why
 * the 2026-07-09 login outage left nothing behind to diagnose. See
 * {@link reportTransportFailure}.
 */
async function sendRequest(
  path: string,
  opts: RequestOptions,
): Promise<{ res: Response; url: string; method: string; hadToken: boolean }> {
  const { headers: optHeaders, expectedErrors, auth = 'tenant', json, baseUrl, raw: _raw, ...init } = opts;
  const wantsJson = json ?? isSelfTypedBody(init.body) === false;
  const authHeaders = getAuthHeaders(wantsJson ? { 'Content-Type': 'application/json' } : {}, auth);
  const hadToken = !!authHeaders.Authorization;
  const url = `${baseUrl ?? getApiBaseUrl()}${path}`;
  const method = init.method ?? 'GET';

  // A caller that lists status 0 in `expectedErrors` handles the outage itself —
  // the product-error reporter does, so a failed report can never report itself.
  // A signed-out visitor's READ is answered from the sample workspace when one
  // covers it — before the network, so a guest surface populates instead of
  // rendering an empty grid behind a 401. Every condition that makes this safe
  // (no credential sent, GET only, browser only, fixture must exist) lives in
  // `resolveGuestRead`, which is the only thing that decides it; a `null` here
  // means "go to the wire" and is the ordinary case for a signed-in person on
  // every request they ever make.
  const sample = resolveGuestRead({ path, method, hadToken });
  if (sample) return { res: guestReadResponse(sample), url, method, hadToken };

  const res = await fetchWithTransportReport(
    url,
    { ...init, headers: { ...authHeaders, ...optHeaders } as HeadersInit },
    { silent: expectedErrors?.includes(TRANSPORT_FAILURE_STATUS) ?? false },
  );

  checkUnauthorizedAndRedirect(res, hadToken);
  if (res.status === 402) throw await planLimitErrorFromResponse(res);
  return { res, url, method, hadToken };
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
  const { res, url, method, hadToken } = await sendRequest(path, opts);
  if (!res.ok) await reportAndThrow(res, url, method, opts.expectedErrors, hadToken);
  if (opts.raw) return undefined as T;
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Request that returns response text (e.g. dataset download). On 401, redirects to login. */
export async function apiRequestText(path: string, opts: RequestOptions = {}): Promise<string> {
  const { res, url, method, hadToken } = await sendRequest(path, opts);
  if (!res.ok) await reportAndThrow(res, url, method, opts.expectedErrors, hadToken);
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
  // The 401 redirect and the typed 402 are applied by sendRequest, exactly as they
  // are for the other two transports rather than from a copy of the checks.
  const { res, url, method, hadToken } = await sendRequest(path, opts);
  // Same judgement as the JSON transports, from the same function rather than a
  // copy of it — this is the path the activity tracker's best-effort flush
  // takes, and an un-recognised terms bump made it raise a "Stream request
  // failed" toast every 15 seconds. It reports but does not throw: the caller
  // inspects the status itself.
  if (!res.ok) await reportApiFailure(res, url, method, opts.expectedErrors, hadToken);
  return res;
}
