/**
 * Dev team routes – /api/dev-teams
 *
 * Team hierarchy management with manager–employee relationships.
 *
 * POST   /api/dev-teams              Create team (MANAGER+)
 * GET    /api/dev-teams              List teams (MANAGER+)
 * GET    /api/dev-teams/:id          Team detail + members (MANAGER+)
 * PATCH  /api/dev-teams/:id          Update team (MANAGER+)
 * DELETE /api/dev-teams/:id          Delete team (MANAGER+)
 * POST   /api/dev-teams/:id/members  Add member (MANAGER+)
 * DELETE /api/dev-teams/:id/members/:contributorId  Remove member (MANAGER+)
 */

import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { devTeams, devTeamMembers, contributors, contributorDailyMetrics } from '../../infrastructure/database/schema';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createDevTeamRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // POST /api/dev-teams
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      name: string;
      description?: string;
      parentTeamId?: number | null;
      managerId?: number | null;
    }>();

    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);

    const [team] = await db
      .insert(devTeams)
      .values({
        tenantId,
        name:         body.name.trim(),
        description:  body.description ?? null,
        parentTeamId: body.parentTeamId ?? null,
        managerId:    body.managerId ?? null,
      })
      .returning();

    return c.json(team, 201);
  });

  // GET /api/dev-teams
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const teams = await db
      .select()
      .from(devTeams)
      .where(eq(devTeams.tenantId, tenantId));
    return c.json({ teams });
  });

  // GET /api/dev-teams/:id
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [team] = await db
      .select()
      .from(devTeams)
      .where(and(eq(devTeams.id, id), eq(devTeams.tenantId, tenantId)));
    if (!team) return c.json({ error: 'Team not found' }, 404);

    const members = await db
      .select({
        memberId:      devTeamMembers.id,
        contributorId: devTeamMembers.contributorId,
        memberRole:    devTeamMembers.memberRole,
        joinedAt:      devTeamMembers.joinedAt,
        displayName:   contributors.displayName,
        email:         contributors.email,
        jobTitle:      contributors.jobTitle,
        roleType:      contributors.roleType,
        avatarUrl:     contributors.avatarUrl,
      })
      .from(devTeamMembers)
      .innerJoin(contributors, eq(devTeamMembers.contributorId, contributors.id))
      .where(eq(devTeamMembers.teamId, id));

    return c.json({ ...team, members });
  });

  // PATCH /api/dev-teams/:id
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [existing] = await db
      .select({ id: devTeams.id })
      .from(devTeams)
      .where(and(eq(devTeams.id, id), eq(devTeams.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Team not found' }, 404);

    const body = await c.req.json<Partial<{
      name: string;
      description: string | null;
      parentTeamId: number | null;
      managerId: number | null;
    }>>();

    const [updated] = await db
      .update(devTeams)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(devTeams.id, id), eq(devTeams.tenantId, tenantId)))
      .returning();

    return c.json(updated);
  });

  // DELETE /api/dev-teams/:id
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [existing] = await db
      .select({ id: devTeams.id })
      .from(devTeams)
      .where(and(eq(devTeams.id, id), eq(devTeams.tenantId, tenantId)));
    if (!existing) return c.json({ error: 'Team not found' }, 404);

    await db.delete(devTeams)
      .where(and(eq(devTeams.id, id), eq(devTeams.tenantId, tenantId)));

    return c.json({ deleted: true });
  });

  // POST /api/dev-teams/:id/members
  router.post('/:id/members', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [team] = await db
      .select({ id: devTeams.id })
      .from(devTeams)
      .where(and(eq(devTeams.id, id), eq(devTeams.tenantId, tenantId)));
    if (!team) return c.json({ error: 'Team not found' }, 404);

    const body = await c.req.json<{
      contributorId: number;
      memberRole?: string;
    }>();

    if (!body.contributorId) return c.json({ error: 'contributorId is required' }, 400);

    const [member] = await db
      .insert(devTeamMembers)
      .values({
        teamId:        id,
        contributorId: body.contributorId,
        memberRole:    body.memberRole ?? 'member',
      })
      .onConflictDoNothing()
      .returning();

    return c.json(member ?? { error: 'Member already in team' }, member ? 201 : 409);
  });

  // DELETE /api/dev-teams/:id/members/:contributorId
  router.delete('/:id/members/:contributorId', async (c) => {
    const id            = Number(c.req.param('id'));
    const contributorId = Number(c.req.param('contributorId'));

    await db.delete(devTeamMembers)
      .where(and(
        eq(devTeamMembers.teamId, id),
        eq(devTeamMembers.contributorId, contributorId),
      ));

    return c.json({ deleted: true });
  });

  return router;
}
