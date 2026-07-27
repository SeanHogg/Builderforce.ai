import { createServerCapture } from '@seanhogg/builderforce-quality/server';
import type {
  CaughtErrorRecord,
  CaughtErrorRuntimeContext,
} from '../../application/observability/caughtErrorReporter';
import type { Env } from '../../env';
import { API_VERSION } from '../../version';
import { buildTransactionalDatabase } from '../database/connection';
import { apiErrorLog } from '../database/schema';

function isEnv(value: unknown): value is Env {
  return typeof value === 'object' && value !== null;
}

async function persistToDatabase(
  env: Env,
  record: CaughtErrorRecord,
  runtime: CaughtErrorRuntimeContext,
): Promise<void> {
  if (!env.NEON_DATABASE_URL) return;
  const db = buildTransactionalDatabase(env);
  await db.insert(apiErrorLog).values({
    tenantId: runtime.tenantId,
    method: (runtime.method ?? (record.handled ? 'CAUGHT' : 'ERROR')).slice(0, 10),
    path: (runtime.path ?? `${record.source}#${record.operation}`).slice(0, 500),
    source: record.source.slice(0, 500),
    operation: record.operation.slice(0, 255),
    handled: record.handled,
    context: record.context,
    message: record.message,
    stack: record.stack,
  });
}

async function persistToQuality(
  env: Env,
  record: CaughtErrorRecord,
  runtime: CaughtErrorRuntimeContext,
): Promise<void> {
  const key = env.BUILDERFORCE_ERROR_API_KEY;
  if (!key || runtime.path?.startsWith('/api/quality-ingest')) return;

  const base = env.INTERNAL_API_BASE_URL ?? 'https://api.builderforce.ai';
  const quality = createServerCapture({
    key,
    endpoint: `${base.replace(/\/$/, '')}/api/quality-ingest`,
    environment: env.ENVIRONMENT || 'production',
    release: API_VERSION,
  });
  await quality.captureException(record.error, {
    level: record.level,
    userKey: runtime.userId,
    url: runtime.path,
    tags: {
      surface: 'api',
      handled: String(record.handled),
      source: record.source,
      operation: record.operation,
      ...(runtime.method ? { method: runtime.method } : {}),
      ...(runtime.tenantId == null ? {} : { tenantId: String(runtime.tenantId) }),
    },
    context: record.context,
  });
}

/**
 * Concrete adapter shared by handled catches and the Hono 500 handler.
 * Each destination is isolated: a failure in one never suppresses the other.
 */
export async function persistCaughtError(
  record: CaughtErrorRecord,
  runtime: CaughtErrorRuntimeContext,
): Promise<void> {
  if (!isEnv(runtime.env)) return;
  const env = runtime.env;
  const results = await Promise.allSettled([
    persistToDatabase(env, record, runtime),
    persistToQuality(env, record, runtime),
  ]);

  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      console.error('[caught-error:sink-failed]', {
        sink: index === 0 ? 'api_error_log' : 'product_quality',
        source: record.source,
        operation: record.operation,
        error: result.reason,
      });
    }
  }
}
