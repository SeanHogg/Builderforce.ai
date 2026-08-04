import { Context } from 'hono';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
} from '../../domain/shared/errors';
import { reportUnhandledError } from '../../application/observability/caughtErrorReporter';
import type { HonoEnv } from '../../env';
import { addCorsToResponse } from './cors';

/**
 * Global error handler for the Hono application.
 *
 * Maps domain errors to HTTP status codes and returns a consistent JSON body.
 * Unknown errors use the same durable reporter as explicitly caught exceptions:
 * platform logs, api_error_log, and Product Quality.
 */
export async function errorHandler(err: Error, c: Context): Promise<Response> {
  let res: Response;
  if (err instanceof ValidationError)  res = c.json({ error: err.message }, 400);
  else if (err instanceof UnauthorizedError) {
    // Carry the machine-readable cause AND whether refreshing is worth trying, so
    // a client can silently refresh an expired token instead of string-matching
    // the prose (or, for a revoked one, stop retrying immediately).
    res = c.json(
      { error: err.message, ...(err.code ? { code: err.code, refreshable: err.refreshable } : {}) },
      401,
      // RFC 6750 §3: an auth failure on a bearer resource advertises the scheme +
      // an `error` param. Clients and proxies already understand this header.
      err.code ? { 'WWW-Authenticate': `Bearer error="${err.code}"` } : undefined,
    );
  }
  else if (err instanceof ForbiddenError)   res = c.json({ error: err.message }, 403);
  else if (err instanceof NotFoundError)    res = c.json({ error: err.message }, 404);
  else if (err instanceof ConflictError)    res = c.json({ error: err.message }, 409);
  else {
    const message = err instanceof Error ? err.message : String(err);
    const honoContext = c as Context<HonoEnv>;
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
    res = c.json({ error: message }, 500);
  }
  return addCorsToResponse(c as Context<HonoEnv>, res);
}
