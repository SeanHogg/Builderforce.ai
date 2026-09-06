import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { isClientError } from '../../domain/shared/errors';
import { reportUnhandledError } from '../../application/observability/caughtErrorReporter';
import type { HonoEnv } from '../../env';
import { addCorsToResponse } from './cors';
import { errorResponseBody } from './errorResponse';

/**
 * Global error handler for the Hono application.
 *
 * Runs on `statusOf` (domain/shared/errors.ts) — the same rule `failResponse`
 * uses for caught errors — so a thrown `NotFoundError`, a thrown `PublisherError`
 * carrying `status: 409`, and a `RequestValidationError` with per-field issues
 * all answer exactly as they would from inside a handler's own catch.
 *
 * A 5xx is an invariant failure: it goes to the same durable reporter as
 * explicitly caught exceptions (platform logs, api_error_log, Product Quality)
 * and is answered with a GENERIC message. The thrown message used to be echoed
 * to the caller; `relation "x" does not exist` is a diagnostic, not a response.
 */
export async function errorHandler(err: Error, c: Context): Promise<Response> {
  const { status, body } = errorResponseBody(err);
  const honoContext = c as Context<HonoEnv>;
  if (!isClientError(status)) {
    await reportUnhandledError(err, {
      source: 'presentation/middleware/errorHandler.ts',
      operation: 'request',
    }, {
      env: honoContext.env,
      method: honoContext.req.method,
      path: new URL(honoContext.req.url).pathname,
      tenantId: honoContext.get('tenantId'),
      userId: honoContext.get('userId'),
    });
  }
  return addCorsToResponse(honoContext, c.json(body, status as ContentfulStatusCode));
}
