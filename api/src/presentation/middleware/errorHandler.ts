import { Context } from 'hono';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
} from '../../domain/shared/errors';
import { createServerCapture } from '@seanhogg/builderforce-quality/server';
import { buildTransactionalDatabase } from '../../infrastructure/database/connection';
import { apiErrorLog } from '../../infrastructure/database/schema';
import type { Env, HonoEnv } from '../../env';
import { API_VERSION } from '../../version';
import { addCorsToResponse } from './cors';

/**
 * Dogfood: ship an unhandled API 500 to our OWN Product Quality pillar via the
 * public /api/quality-ingest endpoint — the exact keyed SDK path a customer uses
 * (@seanhogg/builderforce-quality). Fire-and-forget and never throws; a missing
 * key or transport failure is a silent no-op so it can't mask the real response.
 * Skipped for ingest paths themselves to avoid a self-feeding error loop.
 */
async function reportToQuality(env: Env, err: Error, method: string, path: string): Promise<void> {
  const key = env.BUILDERFORCE_ERROR_API_KEY;
  if (!key || path.startsWith('/api/quality-ingest')) return;
  const base = env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai';
  try {
    const quality = createServerCapture({
      key,
      endpoint: `${base.replace(/\/$/, '')}/api/quality-ingest`,
      environment: env.ENVIRONMENT || 'production',
      release: API_VERSION,
    });
    await quality.captureException(err, { tags: { surface: 'api', method, path } });
  } catch { /* never let self-reporting mask the real error response */ }
}

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
      const env = c.env as { NEON_DATABASE_URL?: string; NEON_TRANSACTIONAL_DATABASE_URL?: string };
      if (env.NEON_DATABASE_URL) {
        const db = buildTransactionalDatabase(env as Parameters<typeof buildTransactionalDatabase>[0]);
        await db.insert(apiErrorLog).values({
          method:  c.req.method,
          path:    new URL(c.req.url).pathname,
          message,
          stack,
        });
      }
    } catch { /* never let logging failures mask the real error response */ }

    // Dogfood: ship this 500 to our own Product Quality pillar (keyed SDK path).
    await reportToQuality(c.env as Env, err, c.req.method, new URL(c.req.url).pathname);

    res = c.json({ error: message }, 500);
  }
  return addCorsToResponse(c as Context<HonoEnv>, res);
}
