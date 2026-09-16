/**
 * ONE translation of a caught error into an HTTP answer, for the handlers that
 * must catch (to degrade, to add a field, to keep a partial result) rather than
 * let `app.onError` see the throw.
 *
 * Seven route files carried their own `fail(c, error)`; four of them reported the
 * unknown error and three did not, and five of the seven answered a 500 with the
 * raw `error.message` — a database error's text is not something a caller should
 * read. This helper and {@link errorHandler} share {@link errorResponseBody}, so
 * a thrown error and a caught one produce byte-identical answers.
 */
import type { Context, Env as HonoBaseEnv } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { InternalError, RequestValidationError, ServiceUnavailableError, isClientError, statusOf } from '../../domain/shared/errors';
import { reportCaughtError, type CaughtErrorDetails } from '../../application/observability/caughtErrorReporter';
import type { HonoEnv } from '../../env';

/** What a 500 says. The real message went to the reporter, not to the caller. */
export const GENERIC_SERVER_ERROR = 'Something went wrong on our side. The failure has been recorded.';

/**
 * A short id shared by a 5xx ANSWER and the error row it was reported as.
 *
 * The answer is generic on purpose, so without this nothing a user sees ties back
 * to the stored failure: "Something went wrong on our side" in a VS Code chat
 * banner could only be explained by someone with production database access
 * scanning `api_error_log` by path and time. The id is written into the row's
 * `context.errorId` and onto the answer, so the reference in the banner IS the
 * lookup key. 48 bits: no realistic collision inside the 30-day retention window.
 */
export function mintErrorId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

/**
 * A 5xx body carrying its reference: as `errorId` for a client that reads fields,
 * and inside the sentence for every surface that only renders the text — which is
 * every chat banner, so the reference reaches the user with no client release.
 */
function referenced<T extends object>(body: T, errorId: string): T & { errorId: string } {
  const said = (body as { error?: unknown }).error;
  return typeof said === 'string'
    ? { ...body, error: `${said} Reference: ${errorId}`, errorId }
    : { ...body, errorId };
}

export interface ErrorResponseBody {
  error: string;
  /** Present for a {@link RequestValidationError}: the per-field problems. */
  issues?: ReadonlyArray<{ path: string; message: string }>;
  /** Passed through when the error carries `.details` (a service's structured refusal). */
  details?: unknown;
  /** Passed through when the error carries a string `.code` (a machine-readable refusal). */
  code?: string;
  /** A 5xx only: the id its stored error row carries — see {@link mintErrorId}. */
  errorId?: string;
}

/**
 * The status and JSON body an error answers with. PURE — no reporting here, so
 * both callers decide (with the same rule: 5xx ⇒ report) before rendering. A 5xx
 * given the `errorId` it was reported under carries it as a reference.
 */
export function errorResponseBody(error: unknown, errorId?: string): { status: number; body: ErrorResponseBody } {
  const status = statusOf(error);
  // An InternalError's message was written for the caller; any other 5xx text is a diagnostic.
  if (status >= 500) {
    const body: ErrorResponseBody = { error: error instanceof InternalError ? error.message : GENERIC_SERVER_ERROR };
    // An outage's code lets the client say "temporarily unavailable" instead of "something broke".
    if (error instanceof ServiceUnavailableError && error.code) body.code = error.code;
    return { status, body: errorId ? referenced(body, errorId) : body };
  }
  const message = error instanceof Error ? error.message : String(error);
  const body: ErrorResponseBody = { error: message };
  if (error instanceof RequestValidationError) body.issues = error.issues;
  const carried = error as { details?: unknown; code?: unknown } | null;
  if (carried && typeof carried === 'object') {
    if (carried.details !== undefined) body.details = carried.details;
    if (typeof carried.code === 'string') body.code = carried.code;
  }
  return { status, body };
}

/**
 * Answer a caught error. A 4xx is the caller's mistake and is rendered as-is; a
 * 5xx is reported through the durable reporter (platform logs, api_error_log,
 * Product Quality) and answered generically. `extra` fields ride along on the
 * body (a `sourceFileKey` the client must keep, a partial `spec`).
 */
export function failResponse(
  c: Context<HonoEnv>,
  error: unknown,
  details: CaughtErrorDetails,
  extra?: Record<string, unknown>,
): Response {
  const errorId = isClientError(statusOf(error)) ? undefined : reportServerError(c, error, details);
  const { status, body } = errorResponseBody(error, errorId);
  return c.json(extra ? { ...body, ...extra } : body, status as ContentfulStatusCode);
}

/**
 * Answer `body` at a status the handler COMPUTED — a service's `{ ok: false, status }`,
 * a rejection→status table, a pass-through op result — rather than one it threw. The
 * body and status are rendered exactly as given; a 5xx is also REPORTED (with `cause`
 * when the handler holds the underlying error). Replaces `c.json(body, result.status)`,
 * which answered a 502 and told nobody.
 */
export function statusResponse<E extends HonoBaseEnv = HonoEnv>(
  c: Context<E>,
  body: object,
  status: number,
  details: CaughtErrorDetails,
  cause?: unknown,
): Response {
  // Generic so routers whose env adds bindings (agent-host relay, runtime) can call it;
  // the reporter reads only the request, the env handle and the identity variables every
  // env in this app carries.
  const ctx = c as unknown as Context<HonoEnv>;
  if (status >= 500) {
    const said = (body as { error?: unknown }).error;
    const errorId = reportServerError(ctx, new InternalError(typeof said === 'string' ? said : `answered ${status}`, cause === undefined ? undefined : { cause }), details);
    return ctx.json(referenced(body, errorId) as Record<string, unknown>, status as ContentfulStatusCode);
  }
  return ctx.json(body as Record<string, unknown>, status as ContentfulStatusCode);
}

/**
 * Report a server failure with the request's identity attached, for the rare handler
 * whose 5xx body is a PROTOCOL's shape rather than `{ error }` (a JSON-RPC error
 * envelope) and so cannot answer through {@link failResponse} or {@link statusResponse}.
 * Returns the {@link mintErrorId} the stored row carries, for a body that can hold it.
 */
export function reportServerError(c: Context<HonoEnv>, error: unknown, details: CaughtErrorDetails): string {
  const errorId = mintErrorId();
  reportCaughtError(error, { ...details, context: { ...details.context, errorId } }, {
    env: c.env,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
  });
  return errorId;
}

/**
 * A refusal CODE as an HTTP answer, for application results shaped
 * `{ ok: false, reason: '<code>' }`. The route declares its map as data
 * (`{ not_found: 404, wrong_party: 403 }`); anything unmapped is the caller's
 * mistake, a 400. Replaces four hand-written `refusalStatus()` switch copies.
 */
export function refusalResponse(
  c: Context<HonoEnv>,
  reason: string,
  statusMap: Readonly<Record<string, number>>,
  extra?: Record<string, unknown>,
): Response {
  const status = statusMap[reason] ?? 400;
  return c.json({ error: reason, ...extra }, status as ContentfulStatusCode);
}
