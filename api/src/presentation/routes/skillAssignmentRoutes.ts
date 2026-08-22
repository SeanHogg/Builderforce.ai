/**
 * Skill assignment routes
 *
 * Tenant-level:
 *   GET  /api/skill-assignments/tenant         – list skills assigned to the current tenant
 *   POST /api/skill-assignments/tenant         – assign a marketplace skill to the tenant (all agentHosts)
 *   DELETE /api/skill-assignments/tenant/:slug – remove tenant-level assignment
 *
 * AgentHost-level:
 *   GET  /api/skill-assignments/agentHosts/:agentHostId         – list skills assigned to a specific agentHost
 *   POST /api/skill-assignments/agentHosts/:agentHostId         – assign a skill to a specific agentHost
 *   DELETE /api/skill-assignments/agentHosts/:agentHostId/:slug – remove agentHost-level assignment
 *
 * All routes require a tenant-scoped JWT.
 * Write routes require at least MANAGER role.
 */
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { agentHosts } from '../../infrastructure/database/schema';
import {
  assignSkill,
  listAssignedSkills,
  marketplaceSkillExists,
  unassignSkill,
} from '../../application/skills/skillAssignmentPort';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createSkillAssignmentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── Tenant-level ──────────────────────────────────────────────────────────

  // GET /api/skill-assignments/tenant
  router.get('/tenant', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await listAssignedSkills(db, tenantId, { scope: 'tenant' });
    return c.json({ assignments: rows });
  });

  // POST /api/skill-assignments/tenant  body: { skillSlug }
  router.post('/tenant', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string;
    const body     = await c.req.json<{ skillSlug: string }>();
    if (!body.skillSlug) return c.json({ error: 'skillSlug is required' }, 400);

    if (!await marketplaceSkillExists(db, body.skillSlug)) return c.json({ error: 'Skill not found' }, 404);

    await assignSkill(db, tenantId, { scope: 'tenant' }, { skillSlug: body.skillSlug, assignedBy: userId });

    return c.json({ ok: true, tenantId, skillSlug: body.skillSlug }, 201);
  });

  // DELETE /api/skill-assignments/tenant/:slug
  router.delete('/tenant/:slug', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const skillSlug = c.req.param('slug');
    await unassignSkill(db, tenantId, { scope: 'tenant' }, skillSlug);
    return c.body(null, 204);
  });

  // ── AgentHost-level ────────────────────────────────────────────────────────────

  // GET /api/skill-assignments/agentHosts/:agentHostId
  router.get('/agentHosts/:agentHostId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId   = Number(c.req.param('agentHostId'));

    // Ensure agentHost belongs to this tenant
    const [agentHost] = await db
      .select({ id: agentHosts.id })
      .from(agentHosts)
      .where(and(eq(agentHosts.id, agentHostId), eq(agentHosts.tenantId, tenantId)))
      .limit(1);
    if (!agentHost) return c.json({ error: 'AgentHost not found' }, 404);

    const rows = await listAssignedSkills(db, tenantId, { scope: 'host', agentHostId });
    return c.json({ agentHostId, assignments: rows });
  });

  // POST /api/skill-assignments/agentHosts/:agentHostId  body: { skillSlug }
  router.post('/agentHosts/:agentHostId', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string;
    const agentHostId   = Number(c.req.param('agentHostId'));
    const body     = await c.req.json<{ skillSlug: string }>();
    if (!body.skillSlug) return c.json({ error: 'skillSlug is required' }, 400);

    const [agentHost] = await db
      .select({ id: agentHosts.id })
      .from(agentHosts)
      .where(and(eq(agentHosts.id, agentHostId), eq(agentHosts.tenantId, tenantId)))
      .limit(1);
    if (!agentHost) return c.json({ error: 'AgentHost not found' }, 404);

    if (!await marketplaceSkillExists(db, body.skillSlug)) return c.json({ error: 'Skill not found' }, 404);

    await assignSkill(db, tenantId, { scope: 'host', agentHostId }, { skillSlug: body.skillSlug, assignedBy: userId });

    return c.json({ ok: true, agentHostId, skillSlug: body.skillSlug }, 201);
  });

  // DELETE /api/skill-assignments/agentHosts/:agentHostId/:slug
  router.delete('/agentHosts/:agentHostId/:slug', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const agentHostId    = Number(c.req.param('agentHostId'));
    const skillSlug = c.req.param('slug');
    await unassignSkill(db, tenantId, { scope: 'host', agentHostId }, skillSlug);
    return c.body(null, 204);
  });

  return router;
}
