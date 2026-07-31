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
  else if (err instanceof UnauthorizedError) res = c.json({ error: err.message }, 401);
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
