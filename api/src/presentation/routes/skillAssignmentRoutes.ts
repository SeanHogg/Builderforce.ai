/**
 * Skill assignment routes
 *
 * Tenant-level:
 *   GET  /api/skill-assignments/tenant         – list skills assigned to the current tenant
 *   POST /api/skill-assignments/tenant         – assign a marketplace skill to the tenant (all agentHosts)
 *   DELETE /api/skill-assignments/tenant/:slug – remove tenant-level assignment
 *
 * AgentHost-level:
 *   GET  /api/skill-assignments/agent-hosts/:agentHostId         – list skills assigned to a specific agentHost
 *   POST /api/skill-assignments/agent-hosts/:agentHostId         – assign a skill to a specific agentHost
 *   DELETE /api/skill-assignments/agent-hosts/:agentHostId/:slug – remove agentHost-level assignment
 *
 *   The camelCase `/agentHosts/*` paths are a deprecated alias of the SAME handlers
 *   (Deprecation + successor Link via legacyAliasNotice) for already-shipped clients.
 *
 * All routes require a tenant-scoped JWT.
 * Write routes require at least MANAGER role.
 *
 * These list assignments AT one scope (the management view). The EFFECTIVE set a
 * host runs with (tenant + host, host winning) is `GET /api/agent-hosts/:id/skills`;
 * both read through `skillAssignmentPort`.
 */
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { legacyAliasNotice } from '../middleware/legacyAlias';
import { agentHostInTenant } from '../../application/agentHost/agentHostDirectory';
import {
  assignSkill,
  listAssignedSkills,
  marketplaceSkillExists,
  unassignSkill,
} from '../../application/skills/skillAssignmentPort';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { parseBody, z } from './requestBody';

/** `skillSlug` stays optional so "skillSlug is required" still answers. */
const SkillAssignmentBody = z.object({ skillSlug: z.string().nullish() });

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
    const body     = await parseBody(c, SkillAssignmentBody);
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
  // ONE sub-router, mounted at the canonical kebab `/agent-hosts` and at the legacy
  // camelCase `/agentHosts` alias.
  const hosts = new Hono<HonoEnv>();

  // GET /api/skill-assignments/agent-hosts/:agentHostId
  hosts.get('/:agentHostId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const agentHostId   = Number(c.req.param('agentHostId'));

    if (!await agentHostInTenant(db, tenantId, agentHostId)) return c.json({ error: 'AgentHost not found' }, 404);

    const rows = await listAssignedSkills(db, tenantId, { scope: 'host', agentHostId });
    return c.json({ agentHostId, assignments: rows });
  });

  // POST /api/skill-assignments/agent-hosts/:agentHostId  body: { skillSlug }
  hosts.post('/:agentHostId', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string;
    const agentHostId   = Number(c.req.param('agentHostId'));
    const body     = await parseBody(c, SkillAssignmentBody);
    if (!body.skillSlug) return c.json({ error: 'skillSlug is required' }, 400);

    if (!await agentHostInTenant(db, tenantId, agentHostId)) return c.json({ error: 'AgentHost not found' }, 404);

    if (!await marketplaceSkillExists(db, body.skillSlug)) return c.json({ error: 'Skill not found' }, 404);

    await assignSkill(db, tenantId, { scope: 'host', agentHostId }, { skillSlug: body.skillSlug, assignedBy: userId });

    return c.json({ ok: true, agentHostId, skillSlug: body.skillSlug }, 201);
  });

  // DELETE /api/skill-assignments/agent-hosts/:agentHostId/:slug
  hosts.delete('/:agentHostId/:slug', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId  = c.get('tenantId') as number;
    const agentHostId    = Number(c.req.param('agentHostId'));
    const skillSlug = c.req.param('slug');
    await unassignSkill(db, tenantId, { scope: 'host', agentHostId }, skillSlug);
    return c.body(null, 204);
  });

  router.route('/agent-hosts', hosts);
  router.use('/agentHosts/*', legacyAliasNotice((c) => c.req.path.replace(/\/agentHosts(?=\/|$)/, '/agent-hosts')));
  router.route('/agentHosts', hosts);

  return router;
}
