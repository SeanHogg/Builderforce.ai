/**
 * An end-client Segment's lifecycle — provision, update, erase — written ONCE for both
 * doors that drive it: the tenant's own `/api/segments` (a manager's session) and the
 * host's `/v1/admin/segments` seam (a `segments:manage` service key, spec 05 §3).
 *
 * The rules both doors share live here: every write is scoped to the caller's tenant,
 * the tenant's DEFAULT segment is never updated or erased through either door (it backs
 * the single-mode tenant itself), a change drops the warm-isolate segment mapping so it
 * takes effect now, and an erase also removes the run telemetry that lives beyond the
 * core `segment_id … ON DELETE CASCADE`.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { segments } from '../../infrastructure/database/schema';
import { invalidateSegment } from '../../infrastructure/auth/segmentResolver';
import { cascadeSegmentDelete, collectSegmentTelemetryKeys } from '../shared/siblingCascade';

export const SEGMENT_STATUSES = ['active', 'suspended', 'archived'] as const;
export type SegmentStatus = (typeof SEGMENT_STATUSES)[number];

export function isSegmentStatus(value: string): value is SegmentStatus {
  return (SEGMENT_STATUSES as readonly string[]).includes(value);
}

export type SegmentRow = typeof segments.$inferSelect;

export interface NewSegment {
  externalAccountId: string | null;
  externalCompanyId: string | null;
  displayName: string;
  slug: string;
  plan: string;
}

export type SegmentPatch = Partial<{ status: SegmentStatus; plan: string; displayName: string }>;

/** The tenant's segment for one (account, company) pair — the provisioning idempotency key. */
export async function findSegmentByExternalIds(
  db: Db, tenantId: number, accountId: string, companyId: string,
): Promise<SegmentRow | null> {
  const [row] = await db
    .select()
    .from(segments)
    .where(and(eq(segments.tenantId, tenantId), eq(segments.externalAccountId, accountId), eq(segments.externalCompanyId, companyId)))
    .limit(1);
  return row ?? null;
}

/** Insert a non-default segment. A unique violation (slug, or account+company) propagates to the caller. */
export async function provisionSegment(db: Db, tenantId: number, input: NewSegment): Promise<SegmentRow> {
  const [row] = await db
    .insert(segments)
    .values({ tenantId, ...input, isDefault: false })
    .returning();
  if (!row) throw new Error('segment insert returned no row');
  return row;
}

/** Apply a patch to a non-default segment of the tenant; null when it is missing, foreign or the default. */
export async function updateSegment(
  db: Db, env: Env, tenantId: number, id: string, patch: SegmentPatch,
): Promise<SegmentRow | null> {
  const [updated] = await db
    .update(segments)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(segments.id, id), eq(segments.tenantId, tenantId), eq(segments.isDefault, false)))
    .returning();
  if (!updated) return null;
  // Drop the warm-isolate mapping so a status/plan change takes effect now.
  await invalidateSegment(updated.id, env);
  return updated;
}

/**
 * Erase a non-default segment and everything scoped to it (DSR / GDPR erasure, spec 05 §3.4 + §7).
 * Returns the erased id, or null when it is missing, foreign or the default.
 */
export async function eraseSegment(db: Db, env: Env, tenantId: number, id: string): Promise<string | null> {
  // Run telemetry lives on its own database, beyond the cascade: capture which runs and
  // hosts were this segment's while core can still say so, erase them after.
  const telemetryKeys = await collectSegmentTelemetryKeys(db, tenantId, id);
  const [deleted] = await db
    .delete(segments)
    .where(and(eq(segments.id, id), eq(segments.tenantId, tenantId), eq(segments.isDefault, false)))
    .returning({ id: segments.id });
  if (!deleted) return null;
  await cascadeSegmentDelete(db, telemetryKeys);
  // Stop the warm isolate from resolving the now-deleted segment.
  await invalidateSegment(deleted.id, env);
  return deleted.id;
}
