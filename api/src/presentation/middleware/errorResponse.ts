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
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { RequestValidationError, isClientError, statusOf } from '../../domain/shared/errors';
import { reportCaughtError, type CaughtErrorDetails } from '../../application/observability/caughtErrorReporter';
import type { HonoEnv } from '../../env';

/** What a 500 says. The real message went to the reporter, not to the caller. */
export const GENERIC_SERVER_ERROR = 'Something went wrong on our side. The failure has been recorded.';

export interface ErrorResponseBody {
  error: string;
  /** Present for a {@link RequestValidationError}: the per-field problems. */
  issues?: ReadonlyArray<{ path: string; message: string }>;
  /** Passed through when the error carries `.details` (a service's structured refusal). */
  details?: unknown;
  /** Passed through when the error carries a string `.code` (a machine-readable refusal). */
  code?: string;
}

/**
 * The status and JSON body an error answers with. PURE — no reporting here, so
 * both callers decide (with the same rule: 5xx ⇒ report) before rendering.
 */
export function errorResponseBody(error: unknown): { status: number; body: ErrorResponseBody } {
  const status = statusOf(error);
  if (status >= 500) return { status, body: { error: GENERIC_SERVER_ERROR } };
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
  const { status, body } = errorResponseBody(error);
  if (!isClientError(status)) {
    reportCaughtError(error, details, {
      env: c.env,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      tenantId: c.get('tenantId'),
      userId: c.get('userId'),
    });
  }
  return c.json(extra ? { ...body, ...extra } : body, status as ContentfulStatusCode);
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
