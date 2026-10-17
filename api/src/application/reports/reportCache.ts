/**
 * Read-through caching for the on-demand report GETs (standup, code review,
 * executive, completed-by-assignee).
 *
 * The window keyspace is unbounded (any `days` / date range), so per the cache
 * convention a per-tenant *version token* is folded into every key instead of
 * deleting each window on write. A task status write bumps the token (see
 * {@link invalidateCompletedByAssignee}); every window-keyed entry then ages out
 * naturally on the next read. The token itself is a cheap, separately-cached
 * counter, and the getOrSetCached KV TTL is the backstop for activity/metric
 * writes that don't bump it.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { buildExecutiveSummary } from './executiveSummary';
import { generateCodeReviewReport, generateStandupReport } from './devActivityReports';
import { generateCompletedByAssigneeReport } from './completedByAssignee';

function versionTokenKey(tenantId: number): string {
  return `report-completed-by-assignee:ver:tenant:${tenantId}`;
}

/** Cache key for the completed-by-assignee rollup (per tenant + version + window). */
export function completedByAssigneeCacheKey(tenantId: number, version: number, days: number): string {
  return `report-completed-by-assignee:tenant:${tenantId}:v:${version}:days:${days}`;
}
export function standupCacheKey(tenantId: number, version: number, dayKey: string): string {
  return `report-standup:tenant:${tenantId}:v:${version}:date:${dayKey}`;
}
export function codeReviewCacheKey(tenantId: number, version: number, windowKey: string): string {
  return `report-code-review:tenant:${tenantId}:v:${version}:w:${windowKey}`;
}
export function executiveCacheKey(tenantId: number, version: number, windowKey: string): string {
  return `report-executive:tenant:${tenantId}:v:${version}:w:${windowKey}`;
}

/** Current version token for a tenant's report caches (defaults to 0). */
async function readReportVersion(env: Env, tenantId: number): Promise<number> {
  return getOrSetCached(env, versionTokenKey(tenantId), async () => 0, { kvTtlSeconds: 86_400 });
}

/**
 * Bump the per-tenant version token so every window-keyed report entry ages out.
 * Call from the task status-write path. Cheap: one KV write of a small integer.
 */
export async function invalidateCompletedByAssignee(env: Env, tenantId: number): Promise<void> {
  const key = versionTokenKey(tenantId);
  const current = await readReportVersion(env, tenantId);
  await invalidateCached(env, key);
  // Re-seed the token at current+1 so the next read computes a fresh window key.
  await getOrSetCached(env, key, async () => current + 1, { kvTtlSeconds: 86_400 });
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function cachedStandupReport(env: Env, db: Db, tenantId: number, date: Date, dayKey = isoDay(date)) {
  const version = await readReportVersion(env, tenantId);
  return getOrSetCached(env, standupCacheKey(tenantId, version, dayKey), () => generateStandupReport(db, tenantId, date));
}

export async function cachedCodeReviewReport(env: Env, db: Db, tenantId: number, from: Date, to: Date) {
  const version = await readReportVersion(env, tenantId);
  return getOrSetCached(env, codeReviewCacheKey(tenantId, version, isoDay(to)), () => generateCodeReviewReport(db, tenantId, from, to));
}

/** `windowKey` defaults to the two ISO days; the route passes the raw params when given. */
export async function cachedExecutiveReport(env: Env, db: Db, tenantId: number, from: Date, to: Date, windowKey = `${isoDay(from)}:${isoDay(to)}`) {
  const version = await readReportVersion(env, tenantId);
  return getOrSetCached(env, executiveCacheKey(tenantId, version, windowKey), () => buildExecutiveSummary(db, tenantId, from, to));
}

export async function cachedCompletedByAssigneeReport(env: Env, db: Db, tenantId: number, days: number) {
  const version = await readReportVersion(env, tenantId);
  return getOrSetCached(env, completedByAssigneeCacheKey(tenantId, version, days), () => generateCompletedByAssigneeReport(db, tenantId, days));
}
