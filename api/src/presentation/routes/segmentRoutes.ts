/**
 * Segment routes — /api/segments
 *
 * Provisioning + lifecycle for the isolation tier below the tenant. A tenant
 * that is itself multi-tenant (e.g. an integrator reselling the platform)
 * creates one Segment per end-client (account, company) so no client data
 * bleeds. Every business entity is scoped to a Segment (migrations 0054/0055).
 *
 * GET    /api/segments        – list this tenant's segments
 * POST   /api/segments        – provision an end-client segment (manager+)
 * PATCH  /api/segments/:id     – update status (suspend/archive)/plan/name (manager+)
 * DELETE /api/segments/:id     – erase an end-client segment + all its data (manager+)
 *
 * NOTE: creating segments does NOT flip the tenant to isolation_mode='segmented'.
 * That cutover is deliberate and gated on every write path threading segmentId
 * (otherwise the default-segment trigger would reject existing writes). Until
 * then segments can be pre-provisioned while the tenant keeps single-mode.
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { segments } from '../../infrastructure/database/schema';
import { invalidateSegment } from '../../infrastructure/auth/segmentResolver';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SEGMENT_STATUSES = ['active', 'suspended', 'archived'] as const;
type SegmentStatus = (typeof SEGMENT_STATUSES)[number];

function slugify(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 255);
}

export function createSegmentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // List the tenant's segments (default segment first, then most-recent).
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const rows = await db
      .select()
      .from(segments)
      .where(eq(segments.tenantId, tenantId))
      .orderBy(desc(segments.isDefault), desc(segments.provisionedAt));
    return c.json(rows);
  });

  // Provision an end-client segment.
  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json<{
      externalAccountId?: string;
      externalCompanyId?: string;
      displayName?: string;
      slug?: string;
      plan?: string;
    }>();

    if (!body.displayName?.trim()) {
      return c.json({ error: 'displayName is required' }, 400);
    }
    const slug = body.slug?.trim() ? slugify(body.slug) : slugify(body.displayName);
    if (!slug) return c.json({ error: 'slug could not be derived; provide a slug' }, 400);

    try {
      const [seg] = await db
        .insert(segments)
        .values({
          tenantId,
          externalAccountId: body.externalAccountId ?? null,
          externalCompanyId: body.externalCompanyId ?? null,
          displayName: body.displayName.trim(),
          slug,
          plan: body.plan ?? 'free',
          isDefault: false,
        })
        .returning();
      return c.json(seg, 201);
    } catch (err) {
      // Unique violations: slug already used, or (account, company) already mapped.
      if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
        return c.json({ error: 'A segment with this slug or (account, company) already exists' }, 409);
      }
      throw err;
    }
  });

  // Update a segment's status / plan / display name. Cannot mutate the default.
  router.patch('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');
    const body = await c.req.json<{ status?: string; plan?: string; displayName?: string }>();

    const patch: Partial<{ status: SegmentStatus; plan: string; displayName: string; updatedAt: Date }> = {};
    if (body.status !== undefined) {
      if (!SEGMENT_STATUSES.includes(body.status as SegmentStatus)) {
        return c.json({ error: `status must be one of ${SEGMENT_STATUSES.join(', ')}` }, 400);
      }
      patch.status = body.status as SegmentStatus;
    }
    if (body.plan !== undefined) patch.plan = body.plan;
    if (body.displayName !== undefined) patch.displayName = body.displayName.trim();
    if (Object.keys(patch).length === 0) return c.json({ error: 'nothing to update' }, 400);
    patch.updatedAt = new Date();

    // Scope to this tenant and never let the API mutate the default segment.
    const [updated] = await db
      .update(segments)
      .set(patch)
      .where(and(eq(segments.id, id), eq(segments.tenantId, tenantId), eq(segments.isDefault, false)))
      .returning();

    if (!updated) return c.json({ error: 'segment not found, not yours, or is the default segment' }, 404);
    // Drop the warm-isolate mapping so a status/plan change takes effect now.
    invalidateSegment(updated.id);
    return c.json(updated);
  });

  // Erase an end-client segment and ALL of its data (DSR / GDPR right-to-erasure,
  // spec 05 §3.4 + §7). Every business table carries `segment_id … ON DELETE
  // CASCADE` (migrations 0056–0061+), so deleting the segment row cascades the
  // delete across all Segment-scoped rows in one transaction at the DB level.
  // The tenant's default segment is never erasable through this path (it backs
  // the single-mode tenant itself — erase the tenant instead).
  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');

    const [deleted] = await db
      .delete(segments)
      .where(and(eq(segments.id, id), eq(segments.tenantId, tenantId), eq(segments.isDefault, false)))
      .returning({ id: segments.id });

    if (!deleted) return c.json({ error: 'segment not found, not yours, or is the default segment' }, 404);
    // Stop the warm isolate from resolving the now-deleted segment.
    invalidateSegment(deleted.id);
    return c.json({ ok: true, id: deleted.id });
  });

  return router;
}
