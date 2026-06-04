/**
 * Managed AgentHost hosting routes — /api/managed-agent-hosts
 *
 * Tenants can request a hosted BuilderForce Agents instance ($49/mo per AgentHost add-on).
 * This is a waitlist/provisioning API — admin team provisions and links the AgentHost once ready.
 *
 * Routes:
 *   POST /api/managed-agent-hosts          — submit a managed AgentHost request
 *   GET  /api/managed-agent-hosts          — list requests for the current tenant
 *   GET  /api/managed-agent-hosts/:id      — get a single request
 *   DELETE /api/managed-agent-hosts/:id    — cancel a pending request
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { managedAgentHostRequests } from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { TenantRole } from '../../domain/shared/types';

export function createManagedAgentHostRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // POST /api/managed-agent-hosts — submit a managed AgentHost hosting request
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      agentHostName: string;
      region?: string;
      notes?: string;
    }>();

    const agentHostName = body.agentHostName?.trim();
    if (!agentHostName) return c.json({ error: 'agentHostName is required' }, 400);

    const [inserted] = await db
      .insert(managedAgentHostRequests)
      .values({
        tenantId,
        agentHostName,
        region: body.region?.trim() || 'us-east',
        notes: body.notes?.trim() || null,
        status: 'pending',
      })
      .returning();

    if (!inserted) return c.json({ error: 'Failed to create request' }, 500);

    return c.json({
      request: inserted,
      message: 'Your managed AgentHost request has been submitted. Our team will provision it and notify you within 1 business day.',
    }, 201);
  });

  // GET /api/managed-agent-hosts — list all managed AgentHost requests for the tenant
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;

    const rows = await db
      .select()
      .from(managedAgentHostRequests)
      .where(eq(managedAgentHostRequests.tenantId, tenantId))
      .orderBy(desc(managedAgentHostRequests.createdAt));

    return c.json({ requests: rows });
  });

  // GET /api/managed-agent-hosts/:id — get a single request
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [row] = await db
      .select()
      .from(managedAgentHostRequests)
      .where(and(eq(managedAgentHostRequests.id, id), eq(managedAgentHostRequests.tenantId, tenantId)))
      .limit(1);

    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ request: row });
  });

  // DELETE /api/managed-agent-hosts/:id — cancel a pending request (owner/manager only)
  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [existing] = await db
      .select({ id: managedAgentHostRequests.id, status: managedAgentHostRequests.status })
      .from(managedAgentHostRequests)
      .where(and(eq(managedAgentHostRequests.id, id), eq(managedAgentHostRequests.tenantId, tenantId)))
      .limit(1);

    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (existing.status !== 'pending') {
      return c.json({ error: `Cannot cancel a request with status '${existing.status}'` }, 409);
    }

    await db
      .update(managedAgentHostRequests)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(managedAgentHostRequests.id, id));

    return c.json({ ok: true });
  });

  return router;
}
