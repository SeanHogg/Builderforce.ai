/**
 * Feedback triage reads — ONE query builder behind BOTH triage surfaces:
 * the tenant/project queue (`GET /api/feedback/submissions`) and the superadmin
 * cross-tenant roll-up (`GET /api/admin/feedback`). The two views differ only in
 * whether a tenant filter is applied, so they share this loader rather than
 * growing two hand-rolled selects that can drift on shape or ordering.
 *
 * Reads are served through the canonical read-through cache, keyed by the version
 * token the engine bumps on every submit/review.
 */

import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import {
  feedbackSubmissions, projects, tasks, tenants, users,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, getCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { feedbackTenantVersionKey, feedbackVersionKey } from './feedbackEngine';
import { FEEDBACK_STATUSES, type FeedbackStatus } from './feedbackSpec';

/** Hard ceiling on a triage page — an unbounded queue read is never served. */
export const MAX_PAGE = 100;
const DEFAULT_PAGE = 50;

export interface FeedbackListFilter {
  /** Null = every tenant (superadmin roll-up); a number scopes to one workspace. */
  tenantId: number | null;
  projectId?: number | null;
  status?: FeedbackStatus | null;
  limit?: number;
  /** Keyset cursor: ISO createdAt of the last row on the previous page. */
  before?: string | null;
}

export interface FeedbackListItem {
  id: string;
  tenantId: number;
  tenantName: string | null;
  projectId: number;
  projectName: string | null;
  kind: string;
  title: string;
  body: string;
  status: string;
  submitterName: string | null;
  submitterEmail: string | null;
  pageUrl: string | null;
  appVersion: string | null;
  taskId: number | null;
  taskKey: string | null;
  /** Live provenance marker on the linked ticket — proves the gate is still on. */
  taskSource: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** Coerce an arbitrary status param to a known value (unknown → no filter). */
export function parseFeedbackStatus(raw: string | undefined | null): FeedbackStatus | null {
  if (!raw) return null;
  return (FEEDBACK_STATUSES as readonly string[]).includes(raw) ? (raw as FeedbackStatus) : null;
}

/** The uncached loader — exported for tests and for the cached wrapper below. */
export async function loadFeedbackSubmissions(db: Db, filter: FeedbackListFilter): Promise<FeedbackListItem[]> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
  const clauses: SQL[] = [];
  if (filter.tenantId != null) clauses.push(eq(feedbackSubmissions.tenantId, filter.tenantId));
  if (filter.projectId != null) clauses.push(eq(feedbackSubmissions.projectId, filter.projectId));
  if (filter.status) clauses.push(eq(feedbackSubmissions.status, filter.status));
  if (filter.before) {
    const ts = new Date(filter.before);
    if (!Number.isNaN(ts.getTime())) clauses.push(lt(feedbackSubmissions.createdAt, ts));
  }

  const rows = await db
    .select({
      id: feedbackSubmissions.id,
      tenantId: feedbackSubmissions.tenantId,
      tenantName: tenants.name,
      projectId: feedbackSubmissions.projectId,
      projectName: projects.name,
      kind: feedbackSubmissions.kind,
      title: feedbackSubmissions.title,
      body: feedbackSubmissions.body,
      status: feedbackSubmissions.status,
      submitterName: feedbackSubmissions.submitterName,
      submitterEmail: feedbackSubmissions.submitterEmail,
      submitterUserName: users.displayName,
      submitterUserEmail: users.email,
      pageUrl: feedbackSubmissions.pageUrl,
      appVersion: feedbackSubmissions.appVersion,
      taskId: feedbackSubmissions.taskId,
      taskKey: tasks.key,
      taskSource: tasks.source,
      reviewedAt: feedbackSubmissions.reviewedAt,
      createdAt: feedbackSubmissions.createdAt,
    })
    .from(feedbackSubmissions)
    .leftJoin(projects, eq(projects.id, feedbackSubmissions.projectId))
    .leftJoin(tenants, eq(tenants.id, feedbackSubmissions.tenantId))
    .leftJoin(tasks, eq(tasks.id, feedbackSubmissions.taskId))
    .leftJoin(users, eq(users.id, feedbackSubmissions.submitterUserId))
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(feedbackSubmissions.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    tenantName: r.tenantName ?? null,
    projectId: r.projectId,
    projectName: r.projectName ?? null,
    kind: r.kind,
    title: r.title,
    body: r.body,
    status: r.status,
    // An in-app submission carries no typed name — fall back to the account's.
    submitterName: r.submitterName ?? r.submitterUserName ?? null,
    submitterEmail: r.submitterEmail ?? r.submitterUserEmail ?? null,
    pageUrl: r.pageUrl ?? null,
    appVersion: r.appVersion ?? null,
    taskId: r.taskId ?? null,
    taskKey: r.taskKey ?? null,
    taskSource: r.taskSource ?? null,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Cached triage page. The version token is per-project when the read is scoped to
 * one project, otherwise per-tenant; the superadmin roll-up (no tenant) is served
 * on a short TTL alone, since no single version token covers "every tenant".
 */
export async function listFeedbackSubmissions(
  db: Db,
  env: Env,
  filter: FeedbackListFilter,
): Promise<FeedbackListItem[]> {
  const scope = filter.projectId != null
    ? feedbackVersionKey(filter.projectId)
    : filter.tenantId != null ? feedbackTenantVersionKey(filter.tenantId) : null;
  const version = scope ? await getCacheVersion(env, scope) : 'all';
  const key = [
    'feedback:list', version,
    filter.tenantId ?? 'all', filter.projectId ?? 'all',
    filter.status ?? 'any', filter.limit ?? DEFAULT_PAGE, filter.before ?? '',
  ].join(':');
  return getOrSetCached(env, key, () => loadFeedbackSubmissions(db, filter), {
    // The cross-tenant roll-up has no version token to invalidate it, so it gets a
    // short TTL instead of a stale-until-write lifetime.
    kvTtlSeconds: scope ? 300 : 30,
  });
}

/** Per-status counts for a triage header (same scoping rules as the list). */
export async function countFeedbackByStatus(
  db: Db,
  env: Env,
  filter: Pick<FeedbackListFilter, 'tenantId' | 'projectId'>,
): Promise<Record<string, number>> {
  const scope = filter.projectId != null
    ? feedbackVersionKey(filter.projectId)
    : filter.tenantId != null ? feedbackTenantVersionKey(filter.tenantId) : null;
  const version = scope ? await getCacheVersion(env, scope) : 'all';
  const key = ['feedback:counts', version, filter.tenantId ?? 'all', filter.projectId ?? 'all'].join(':');

  return getOrSetCached(env, key, async () => {
    const clauses: SQL[] = [];
    if (filter.tenantId != null) clauses.push(eq(feedbackSubmissions.tenantId, filter.tenantId));
    if (filter.projectId != null) clauses.push(eq(feedbackSubmissions.projectId, filter.projectId));
    const rows = await db
      .select({ status: feedbackSubmissions.status, n: sql<number>`count(*)` })
      .from(feedbackSubmissions)
      .where(clauses.length ? and(...clauses) : undefined)
      .groupBy(feedbackSubmissions.status);
    const out: Record<string, number> = { new: 0, approved: 0, declined: 0 };
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }, { kvTtlSeconds: scope ? 300 : 30 });
}
