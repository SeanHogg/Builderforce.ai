import { createServerCapture } from '@seanhogg/builderforce-quality/server';
import type { CaughtErrorRecord } from '../../application/observability/caughtErrorReporter';
import type { RequestScope } from '../../application/shared/requestScope';
import type { Env } from '../../env';
import { API_VERSION } from '../../version';
import { buildTransactionalDatabase } from '../database/connection';
import { apiErrorLog } from '../database/schema';
import { firstInWindow } from '../cache/firstInWindow';

/**
 * How long one fingerprint is forwarded to Product Quality at most once.
 *
 * Every forward is a self-POST to /api/quality-ingest that costs a Worker request
 * plus ~6 primary-database statements (collector lookup, cap check, group upsert,
 * error_events insert, user counts, collector touch). A failure that recurs on
 * every cron tick or poll paid that each time, keeping the Neon compute awake for
 * no new information: the Quality group already exists and is already open.
 * api_error_log still records every occurrence (one insert), so the superadmin
 * Logs page keeps exact counts; Quality gets the first occurrence per window,
 * which is what opens, reopens and refreshes the group.
 */
export const QUALITY_FORWARD_WINDOW_SECONDS = 10 * 60;

/** The read-through cache reports its own KV faults through this reporter. Gating
 *  those on the same cache would recurse while KV is down, so they are never
 *  forwarded to Quality (api_error_log still records them). */
const CACHE_SOURCE = 'infrastructure/cache/readThroughCache.ts';

/**
 * Identity of an error for the forward window: where it was caught plus its
 * message with digit runs folded, so ids, counts and timestamps inside a recurring
 * message ("task 4127 failed after 3012ms") do not make every tick look new.
 */
export function qualityForwardKey(
  record: Pick<CaughtErrorRecord, 'source' | 'operation' | 'message' | 'handled'>,
): string {
  const message = (record.message ?? '').replace(/\d+/g, '#').slice(0, 200);
  return `caught-error:quality-fwd:${record.handled ? 'h' : 'u'}:${record.source}#${record.operation}:${message}`;
}

function isEnv(value: unknown): value is Env {
  return typeof value === 'object' && value !== null;
}

async function persistToDatabase(
  env: Env,
  record: CaughtErrorRecord,
  runtime: RequestScope,
): Promise<void> {
  // api_error_log lives in the operational database. Guard on the URL that is
  // actually used, including the primary-database fallback in
  // buildTransactionalDatabase, so an operational-only binding still persists.
  if (!env.NEON_TRANSACTIONAL_DATABASE_URL?.trim() && !env.NEON_DATABASE_URL) return;
  const db = buildTransactionalDatabase(env);
  await db.insert(apiErrorLog).values({
    scopeTenantId: runtime.tenantId,
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
  runtime: RequestScope,
): Promise<void> {
  const key = env.BUILDERFORCE_ERROR_API_KEY;
  if (!key || runtime.path?.startsWith('/api/quality-ingest')) return;
  if (record.source === CACHE_SOURCE) return;
  if (!(await firstInWindow(env, qualityForwardKey(record), QUALITY_FORWARD_WINDOW_SECONDS))) return;

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
 * api_error_log takes every occurrence; Product Quality takes the first per
 * fingerprint per {@link QUALITY_FORWARD_WINDOW_SECONDS}.
 */
export async function persistCaughtError(
  record: CaughtErrorRecord,
  runtime: RequestScope,
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
