/**
 * Managed Claw hosting routes — /api/managed-claws
 *
 * Tenants can request a hosted CoderClaw instance ($49/mo per Claw add-on).
 * This is a waitlist/provisioning API — admin team provisions and links the Claw once ready.
 *
 * Routes:
 *   POST /api/managed-claws          — submit a managed Claw request
 *   GET  /api/managed-claws          — list requests for the current tenant
 *   GET  /api/managed-claws/:id      — get a single request
 *   DELETE /api/managed-claws/:id    — cancel a pending request
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { managedClawRequests } from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { TenantRole } from '../../domain/shared/types';

export function createManagedClawRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // POST /api/managed-claws — submit a managed Claw hosting request
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      clawName: string;
      region?: string;
      notes?: string;
    }>();

    const clawName = body.clawName?.trim();
    if (!clawName) return c.json({ error: 'clawName is required' }, 400);

    const [inserted] = await db
      .insert(managedClawRequests)
      .values({
        tenantId,
        clawName,
        region: body.region?.trim() || 'us-east',
        notes: body.notes?.trim() || null,
        status: 'pending',
      })
      .returning();

    if (!inserted) return c.json({ error: 'Failed to create request' }, 500);

    return c.json({
      request: inserted,
      message: 'Your managed Claw request has been submitted. Our team will provision it and notify you within 1 business day.',
    }, 201);
  });

  // GET /api/managed-claws — list all managed Claw requests for the tenant
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;

    const rows = await db
      .select()
      .from(managedClawRequests)
      .where(eq(managedClawRequests.tenantId, tenantId))
      .orderBy(desc(managedClawRequests.createdAt));

    return c.json({ requests: rows });
  });

  // GET /api/managed-claws/:id — get a single request
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [row] = await db
      .select()
      .from(managedClawRequests)
      .where(and(eq(managedClawRequests.id, id), eq(managedClawRequests.tenantId, tenantId)))
      .limit(1);

    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ request: row });
  });

  // DELETE /api/managed-claws/:id — cancel a pending request (owner/manager only)
  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [existing] = await db
      .select({ id: managedClawRequests.id, status: managedClawRequests.status })
      .from(managedClawRequests)
      .where(and(eq(managedClawRequests.id, id), eq(managedClawRequests.tenantId, tenantId)))
      .limit(1);

    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (existing.status !== 'pending') {
      return c.json({ error: `Cannot cancel a request with status '${existing.status}'` }, 409);
    }

    await db
      .update(managedClawRequests)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(managedClawRequests.id, id));

    return c.json({ ok: true });
  });

  return router;
}
