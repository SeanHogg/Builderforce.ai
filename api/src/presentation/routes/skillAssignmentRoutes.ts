/**
 * Skill assignment routes
 *
 * Tenant-level:
 *   GET  /api/skill-assignments/tenant         – list skills assigned to the current tenant
 *   POST /api/skill-assignments/tenant         – assign a marketplace skill to the tenant (all claws)
 *   DELETE /api/skill-assignments/tenant/:slug – remove tenant-level assignment
 *
 * Claw-level:
 *   GET  /api/skill-assignments/claws/:clawId         – list skills assigned to a specific claw
 *   POST /api/skill-assignments/claws/:clawId         – assign a skill to a specific claw
 *   DELETE /api/skill-assignments/claws/:clawId/:slug – remove claw-level assignment
 *
 * All routes require a tenant-scoped JWT.
 * Write routes require at least MANAGER role.
 */
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  tenantSkillAssignments,
  clawSkillAssignments,
  coderclawInstances,
  marketplaceSkills,
} from '../../infrastructure/database/schema';
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
    const rows = await db
      .select({
        skillSlug:  tenantSkillAssignments.skillSlug,
        assignedBy: tenantSkillAssignments.assignedBy,
        assignedAt: tenantSkillAssignments.assignedAt,
        // join skill metadata
        skillName:  marketplaceSkills.name,
        skillDesc:  marketplaceSkills.description,
        skillIcon:  marketplaceSkills.iconUrl,
        skillVer:   marketplaceSkills.version,
      })
      .from(tenantSkillAssignments)
      .leftJoin(marketplaceSkills, eq(tenantSkillAssignments.skillSlug, marketplaceSkills.slug))
      .where(eq(tenantSkillAssignments.tenantId, tenantId));
    return c.json({ assignments: rows });
  });

  // POST /api/skill-assignments/tenant  body: { skillSlug }
  router.post('/tenant', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string;
    const body     = await c.req.json<{ skillSlug: string }>();
    if (!body.skillSlug) return c.json({ error: 'skillSlug is required' }, 400);

    // Verify skill exists and is published
    const [skill] = await db
      .select({ slug: marketplaceSkills.slug })
      .from(marketplaceSkills)
      .where(eq(marketplaceSkills.slug, body.skillSlug))
      .limit(1);
    if (!skill) return c.json({ error: 'Skill not found' }, 404);

    await db
      .insert(tenantSkillAssignments)
      .values({ tenantId, skillSlug: body.skillSlug, assignedBy: userId })
      .onConflictDoNothing();

    return c.json({ ok: true, tenantId, skillSlug: body.skillSlug }, 201);
  });

  // DELETE /api/skill-assignments/tenant/:slug
  router.delete('/tenant/:slug', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const skillSlug = c.req.param('slug');
    await db
      .delete(tenantSkillAssignments)
      .where(and(
        eq(tenantSkillAssignments.tenantId, tenantId),
        eq(tenantSkillAssignments.skillSlug, skillSlug),
      ));
    return c.body(null, 204);
  });

  // ── Claw-level ────────────────────────────────────────────────────────────

  // GET /api/skill-assignments/claws/:clawId
  router.get('/claws/:clawId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const clawId   = Number(c.req.param('clawId'));

    // Ensure claw belongs to this tenant
    const [claw] = await db
      .select({ id: coderclawInstances.id })
      .from(coderclawInstances)
      .where(and(eq(coderclawInstances.id, clawId), eq(coderclawInstances.tenantId, tenantId)))
      .limit(1);
    if (!claw) return c.json({ error: 'Claw not found' }, 404);

    const rows = await db
      .select({
        skillSlug:  clawSkillAssignments.skillSlug,
        assignedBy: clawSkillAssignments.assignedBy,
        assignedAt: clawSkillAssignments.assignedAt,
        skillName:  marketplaceSkills.name,
        skillDesc:  marketplaceSkills.description,
        skillIcon:  marketplaceSkills.iconUrl,
        skillVer:   marketplaceSkills.version,
      })
      .from(clawSkillAssignments)
      .leftJoin(marketplaceSkills, eq(clawSkillAssignments.skillSlug, marketplaceSkills.slug))
      .where(eq(clawSkillAssignments.clawId, clawId));
    return c.json({ clawId, assignments: rows });
  });

  // POST /api/skill-assignments/claws/:clawId  body: { skillSlug }
  router.post('/claws/:clawId', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string;
    const clawId   = Number(c.req.param('clawId'));
    const body     = await c.req.json<{ skillSlug: string }>();
    if (!body.skillSlug) return c.json({ error: 'skillSlug is required' }, 400);

    const [claw] = await db
      .select({ id: coderclawInstances.id })
      .from(coderclawInstances)
      .where(and(eq(coderclawInstances.id, clawId), eq(coderclawInstances.tenantId, tenantId)))
      .limit(1);
    if (!claw) return c.json({ error: 'Claw not found' }, 404);

    const [skill] = await db
      .select({ slug: marketplaceSkills.slug })
      .from(marketplaceSkills)
      .where(eq(marketplaceSkills.slug, body.skillSlug))
      .limit(1);
    if (!skill) return c.json({ error: 'Skill not found' }, 404);

    await db
      .insert(clawSkillAssignments)
      .values({ clawId, tenantId, skillSlug: body.skillSlug, assignedBy: userId })
      .onConflictDoNothing();

    return c.json({ ok: true, clawId, skillSlug: body.skillSlug }, 201);
  });

  // DELETE /api/skill-assignments/claws/:clawId/:slug
  router.delete('/claws/:clawId/:slug', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const clawId    = Number(c.req.param('clawId'));
    const skillSlug = c.req.param('slug');
    await db
      .delete(clawSkillAssignments)
      .where(and(
        eq(clawSkillAssignments.clawId, clawId),
        eq(clawSkillAssignments.tenantId, tenantId),
        eq(clawSkillAssignments.skillSlug, skillSlug),
      ));
    return c.body(null, 204);
  });

  return router;
}
