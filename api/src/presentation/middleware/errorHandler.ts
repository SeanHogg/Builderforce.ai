import { Context } from 'hono';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
} from '../../domain/shared/errors';
import { buildDatabase } from '../../infrastructure/database/connection';
import { apiErrorLog } from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import { addCorsToResponse } from './cors';

/**
 * Global error handler for the Hono application.
 *
 * Maps domain errors to HTTP status codes and returns a consistent JSON body.
 * Unknown errors are logged to the DB (for admin visibility) and surfaced as 500s.
 * All responses get CORS headers so browser shows real status (e.g. 500) instead of CORS errors.
 */
export async function errorHandler(err: Error, c: Context): Promise<Response> {
  let res: Response;
  if (err instanceof ValidationError)  res = c.json({ error: err.message }, 400);
  else if (err instanceof UnauthorizedError) res = c.json({ error: err.message }, 401);
  else if (err instanceof ForbiddenError)   res = c.json({ error: err.message }, 403);
  else if (err instanceof NotFoundError)    res = c.json({ error: err.message }, 404);
  else if (err instanceof ConflictError)    res = c.json({ error: err.message }, 409);
  else {
    // Unexpected errors — log to DB for admin visibility
    console.error('[unhandled]', err);
    const message = err instanceof Error ? err.message : String(err);
    const stack   = err instanceof Error ? (err.stack ?? null) : null;

    try {
      const env = c.env as { NEON_DATABASE_URL?: string };
      if (env.NEON_DATABASE_URL) {
        const db = buildDatabase(env as Parameters<typeof buildDatabase>[0]);
        await db.insert(apiErrorLog).values({
          method:  c.req.method,
          path:    new URL(c.req.url).pathname,
          message,
          stack,
        });
      }
    } catch { /* never let logging failures mask the real error response */ }

    res = c.json({ error: message }, 500);
  }
  return addCorsToResponse(c as Context<HonoEnv>, res);
}
