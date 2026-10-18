/**
 * THE pending-approvals tally a dashboard tile needs — the count plus the recent
 * creation timestamps for its per-day inflow sparkline.
 *
 * The dashboard used to call `GET /api/approvals?status=pending` for this, which
 * reads the tenant's newest LIST_ROW_CAP approvals of EVERY status (joined to
 * executions + tasks) and filters in memory — so it was both the wrong size and,
 * past the cap, the wrong count. This reads only pending rows, only the columns
 * the visibility rule needs.
 *
 * Visibility matches the list: someone else's self-owned approvals (their
 * desktop's steps) are not the tenant's queue — {@link isApprovalVisibleTo}. That
 * makes the answer per viewer, so the cache key carries the user.
 *
 * No approvals version token exists (approvals are written from the route, the
 * cloud `ask_human` path and the approval gate), so the cache is a short TTL: a
 * tile read once per dashboard visit tolerates a minute.
 */
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { approvals } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { isApprovalVisibleTo } from '../../domain/approval/selfOwned';
import { DAY_MS } from '../../domain/shared/time';

export interface PendingApprovalCount {
  pending: number;
  /** `createdAt` of visible pending approvals created in the trailing 15 days, newest first. */
  recentCreatedAt: string[];
}

const RECENT_WINDOW_MS = 15 * DAY_MS;
/** Bound on pending rows read — far past any real queue; the count saturates here. */
const PENDING_SCAN_CAP = 5000;

export async function computePendingApprovalCount(db: Db, tenantId: number, viewerUserId: string | undefined): Promise<PendingApprovalCount> {
  const rows = await db
    .select({ actionType: approvals.actionType, requestedBy: approvals.requestedBy, createdAt: approvals.createdAt })
    .from(approvals)
    .where(scopedToTenant(approvals, tenantId, eq(approvals.status, 'pending')))
    .orderBy(desc(approvals.createdAt))
    .limit(PENDING_SCAN_CAP);
  const visible = rows.filter((r) => isApprovalVisibleTo(r, viewerUserId));
  const since = Date.now() - RECENT_WINDOW_MS;
  const recentCreatedAt: string[] = [];
  for (const r of visible) {
    const at = r.createdAt instanceof Date ? r.createdAt : new Date(String(r.createdAt));
    if (at.getTime() < since) break; // newest first
    recentCreatedAt.push(at.toISOString());
  }
  return { pending: visible.length, recentCreatedAt };
}

/** {@link computePendingApprovalCount}, read-through cached per tenant + viewer (short TTL). */
export async function getPendingApprovalCount(db: Db, env: Env, tenantId: number, viewerUserId: string | undefined): Promise<PendingApprovalCount> {
  return getOrSetCached(
    env,
    `approvals-pending-count:tenant:${tenantId}:user:${viewerUserId ?? 'none'}`,
    () => computePendingApprovalCount(db, tenantId, viewerUserId),
    { kvTtlSeconds: 60, l1TtlMs: 15_000 },
  );
}
