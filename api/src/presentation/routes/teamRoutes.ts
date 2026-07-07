/**
 * Workforce Team routes — /api/teams
 *
 * Group the workforce (agents AND humans) into named teams and attach a team to
 * projects. A member is a first-class assignable workforce entity identified the
 * same way a task assignee is: a human (users.id), a cloud agent (ide_agents.id),
 * or a remote host (agent_hosts.id). A workforce entity can belong to many teams;
 * a team can be attached to many projects.
 *
 *   GET    /api/teams                              List teams (+ member/project counts)
 *   POST   /api/teams                              Create  { name, description? }
 *   GET    /api/teams/:id                          Detail + members + projects
 *   PATCH  /api/teams/:id                          Update  { name?, description? }
 *   DELETE /api/teams/:id                          Delete
 *   POST   /api/teams/:id/members                  Add member { memberKind, memberRef, memberName }
 *   DELETE /api/teams/:id/members/:memberId        Remove member
 *   POST   /api/teams/:id/projects                 Attach project { projectId }
 *   DELETE /api/teams/:id/projects/:projectId      Detach project
 *
 * Note: `/api/teams/memory` (the cross-host team-memory mesh) is a separate
 * router mounted at the fully-static path, so Hono's static>param priority keeps
 * it from colliding with `/:id` here.
 */
import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { teams, teamMembers, teamProjects, projects } from '../../infrastructure/database/schema';
import { TenantRole } from '../../domain/shared/types';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { loadProjectTeamMembers } from '../../application/metrics/assigneeRecommender';
import { resolveLiveMemberNames } from '../../application/workforce/liveMemberNames';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const MEMBER_KINDS = ['human', 'cloud_agent', 'host_agent'] as const;
type MemberKind = (typeof MEMBER_KINDS)[number];

/** Cached "teams attached to this project" (read by the Board-config Teams tab).
 *  Reflects team_projects rows + each team's name/description, so it is
 *  invalidated by attach/detach AND by a team rename/delete. */
const teamsByProjectCacheKey = (tenantId: number, projectId: number): string => `teams:proj:${tenantId}:${projectId}`;

/** Cached "assignable workforce for this project" — the union of every attached
 *  team's members (read by the task assignee picker to scope its options). It
 *  reflects team_projects AND team_members, so it is invalidated by attach/detach,
 *  member add/remove, and team delete. */
const teamsWorkforceCacheKey = (tenantId: number, projectId: number): string => `teams:proj-workforce:${tenantId}:${projectId}`;

export function createTeamRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  // Both project-scoped reads (attached-teams + assignable-workforce) for one project.
  const invalidateProjectCaches = (c: { env: unknown }, tenantId: number, projectId: number) =>
    Promise.all([
      invalidateCached(c.env as Env, teamsByProjectCacheKey(tenantId, projectId)),
      invalidateCached(c.env as Env, teamsWorkforceCacheKey(tenantId, projectId)),
    ]);

  // A team's name + membership feed the by-project reads, so a rename/delete or a
  // member change must clear the caches for every project the team is attached to.
  // Cheap indexed lookup, run only on those (infrequent) write paths.
  const invalidateProjectsForTeam = async (c: { env: unknown }, tenantId: number, teamId: number) => {
    const rows = await db
      .select({ projectId: teamProjects.projectId })
      .from(teamProjects)
      .where(eq(teamProjects.teamId, teamId));
    await Promise.all(rows.map((r) => invalidateProjectCaches(c, tenantId, r.projectId)));
  };

  // GET /api/teams — list with member + project counts (single grouped query,
  // no per-team fan-out).
  //
  // Deliberately NOT read-through cached. The per-card member/project counts must
  // be strongly consistent with the (uncached, authoritative) detail view — a
  // cached list drifted from the detail is the exact "card says 1 member, panel
  // shows 6" bug, because cache invalidation on write is only eventually
  // consistent across isolates (L1 is per-isolate; KV delete propagates with a
  // lag). This is a tiny tenant-scoped indexed read (a handful of team rows + two
  // correlated COUNTs over team_id-indexed junction tables), so serving it fresh
  // costs microseconds and carries no fan-out. The hot, cache-worthy reads — the
  // by-project attached-teams and assignable-workforce lookups the assignee picker
  // hits — remain cached below.
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db
      .select({
        id:           teams.id,
        name:         teams.name,
        description:  teams.description,
        avatarUrl:    teams.avatarUrl,
        createdAt:    teams.createdAt,
        updatedAt:    teams.updatedAt,
        memberCount:  sql<number>`(SELECT COUNT(*)::int FROM ${teamMembers} WHERE ${teamMembers.teamId} = ${teams.id})`,
        projectCount: sql<number>`(SELECT COUNT(*)::int FROM ${teamProjects} WHERE ${teamProjects.teamId} = ${teams.id})`,
      })
      .from(teams)
      .where(eq(teams.tenantId, tenantId))
      .orderBy(teams.name);
    return c.json({ teams: rows });
  });

  // POST /api/teams
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ name?: string; description?: string }>();
    const name = body.name?.trim();
    if (!name) return c.json({ error: 'name is required' }, 400);

    const [team] = await db
      .insert(teams)
      .values({ tenantId, name, description: body.description?.trim() || null })
      .returning();

    return c.json(team, 201);
  });

  // GET /api/teams/by-project/:projectId — the teams attached to a project, read
  // by the Board-config Teams tab (a board is 1:1 with its project). Two-segment
  // static-prefixed path, so it never collides with the one-segment /:id below.
  // Cached read-through; invalidated by attach/detach + team rename/delete.
  router.get('/by-project/:projectId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    const rows = await getOrSetCached(
      c.env as Env,
      teamsByProjectCacheKey(tenantId, projectId),
      async () =>
        db
          .select({ id: teams.id, name: teams.name, description: teams.description })
          .from(teamProjects)
          .innerJoin(teams, eq(teamProjects.teamId, teams.id))
          .where(and(eq(teamProjects.projectId, projectId), eq(teams.tenantId, tenantId)))
          .orderBy(teams.name),
    );
    return c.json({ teams: rows });
  });

  // GET /api/teams/by-project/:projectId/workforce — the assignable workforce for
  // a project: the distinct union (humans + agents) of every team attached to it.
  // Used by the task assignee picker to SCOPE its options to the project's teams.
  // `scopedToTeams` is false (and `workforce` empty) when the project has no team
  // assigned — the caller then falls back to the full tenant roster, so projects
  // without teams keep today's behaviour. Cached; invalidated on attach/detach +
  // member add/remove + team delete.
  router.get('/by-project/:projectId/workforce', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    const payload = await getOrSetCached(
      c.env as Env,
      teamsWorkforceCacheKey(tenantId, projectId),
      async () => {
        // Resolve names live so a renamed human/agent shows its current name, not the
        // snapshot taken when they were added to the team (member_name drift).
        const members = await resolveLiveMemberNames(db, await loadProjectTeamMembers(db, projectId, tenantId));
        return {
          scopedToTeams: members.length > 0,
          workforce: members.map((m) => ({ kind: m.memberKind, ref: m.memberRef, name: m.memberName })),
        };
      },
    );
    return c.json(payload);
  });

  // GET /api/teams/:id — detail + members + attached projects.
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const [team] = await db
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), eq(teams.tenantId, tenantId)));
    if (!team) return c.json({ error: 'Team not found' }, 404);

    const members = await resolveLiveMemberNames(db, await db
      .select({
        id:         teamMembers.id,
        memberKind: teamMembers.memberKind,
        memberRef:  teamMembers.memberRef,
        memberName: teamMembers.memberName,
        addedAt:    teamMembers.addedAt,
      })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, id))
      .orderBy(teamMembers.memberName));

    const attachedProjects = await db
      .select({
        id:        projects.id,
        publicId:  projects.publicId,
        key:       projects.key,
        name:      projects.name,
        addedAt:   teamProjects.addedAt,
      })
      .from(teamProjects)
      .innerJoin(projects, eq(teamProjects.projectId, projects.id))
      .where(eq(teamProjects.teamId, id))
      .orderBy(projects.name);

    return c.json({ ...team, members, projects: attachedProjects });
  });

  // PATCH /api/teams/:id
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    const body = await c.req.json<{ name?: string; description?: string | null; avatarUrl?: string | null }>();
    const patch: Partial<typeof teams.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return c.json({ error: 'name cannot be empty' }, 400);
      patch.name = name;
    }
    if (body.description !== undefined) {
      patch.description = body.description?.trim() || null;
    }
    if (body.avatarUrl !== undefined) {
      patch.avatarUrl = body.avatarUrl?.trim() || null;
    }

    const [updated] = await db
      .update(teams)
      .set(patch)
      .where(and(eq(teams.id, id), eq(teams.tenantId, tenantId)))
      .returning();
    if (!updated) return c.json({ error: 'Team not found' }, 404);

    // Rename changes what the by-project read returns for every attached project.
    await invalidateProjectsForTeam(c, c.get('tenantId') as number, id);
    return c.json(updated);
  });

  // DELETE /api/teams/:id
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    // Capture the attached projects BEFORE the cascade removes the links.
    await invalidateProjectsForTeam(c, c.get('tenantId') as number, id);

    const [deleted] = await db
      .delete(teams)
      .where(and(eq(teams.id, id), eq(teams.tenantId, tenantId)))
      .returning({ id: teams.id });
    if (!deleted) return c.json({ error: 'Team not found' }, 404);

    return c.json({ deleted: true });
  });

  // POST /api/teams/:id/members — add a workforce entity (human or agent).
  router.post('/:id/members', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    if (!(await ownsTeam(db, id, tenantId))) return c.json({ error: 'Team not found' }, 404);

    const body = await c.req.json<{ memberKind?: string; memberRef?: string; memberName?: string }>();
    const memberKind = body.memberKind as MemberKind;
    const memberRef = body.memberRef?.trim();
    const memberName = body.memberName?.trim();
    if (!MEMBER_KINDS.includes(memberKind)) return c.json({ error: 'memberKind must be one of ' + MEMBER_KINDS.join(', ') }, 400);
    if (!memberRef) return c.json({ error: 'memberRef is required' }, 400);
    if (!memberName) return c.json({ error: 'memberName is required' }, 400);

    // Re-add of an existing member refreshes the denormalized display name.
    const [member] = await db
      .insert(teamMembers)
      .values({ teamId: id, memberKind, memberRef, memberName })
      .onConflictDoUpdate({
        target: [teamMembers.teamId, teamMembers.memberKind, teamMembers.memberRef],
        set: { memberName },
      })
      .returning();

    // Membership feeds the per-project assignable-workforce read.
    await invalidateProjectsForTeam(c, c.get('tenantId') as number, id);
    return c.json(member, 201);
  });

  // DELETE /api/teams/:id/members/:memberId
  router.delete('/:id/members/:memberId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));
    const memberId = Number(c.req.param('memberId'));

    if (!(await ownsTeam(db, id, tenantId))) return c.json({ error: 'Team not found' }, 404);

    await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, id)));

    await invalidateProjectsForTeam(c, c.get('tenantId') as number, id);
    return c.json({ deleted: true });
  });

  // POST /api/teams/:id/projects — attach this team to a project.
  router.post('/:id/projects', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));

    if (!(await ownsTeam(db, id, tenantId))) return c.json({ error: 'Team not found' }, 404);

    const body = await c.req.json<{ projectId?: number }>();
    const projectId = Number(body.projectId);
    if (!projectId) return c.json({ error: 'projectId is required' }, 400);

    // The project must belong to the same tenant (no cross-tenant attachment).
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const [link] = await db
      .insert(teamProjects)
      .values({ teamId: id, projectId })
      .onConflictDoNothing()
      .returning();

    await invalidateProjectCaches(c, c.get('tenantId') as number, projectId);
    return c.json(link ?? { error: 'Project already attached' }, link ? 201 : 409);
  });

  // DELETE /api/teams/:id/projects/:projectId
  router.delete('/:id/projects/:projectId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));
    const projectId = Number(c.req.param('projectId'));

    if (!(await ownsTeam(db, id, tenantId))) return c.json({ error: 'Team not found' }, 404);

    await db
      .delete(teamProjects)
      .where(and(eq(teamProjects.teamId, id), eq(teamProjects.projectId, projectId)));

    await invalidateProjectCaches(c, c.get('tenantId') as number, projectId);
    return c.json({ deleted: true });
  });

  return router;
}

/** A team belongs to the caller's tenant — the gate every sub-resource shares. */
async function ownsTeam(db: Db, teamId: number, tenantId: number): Promise<boolean> {
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)));
  return !!team;
}
