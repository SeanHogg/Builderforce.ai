/**
 * Project-agent routes — manage the agents attached to a project and their
 * per-agent governance. Each row gives an agent (workforce or registered) a
 * numeric id; per-agent skills/personas/content live in artifact_assignments
 * with scope='agent' and scope_id = project_agents.id.
 *
 * Routes:
 *   GET    /api/project-agents?projectId=<id>      — list a project's agents
 *   POST   /api/project-agents                     — attach an agent (MANAGER+)
 *   DELETE /api/project-agents/:id                 — detach an agent (MANAGER+)
 *   PUT    /api/project-agents/:id/governance      — set per-agent governance (MANAGER+)
 *
 * All routes require a tenant-scoped JWT.
 */
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  projectAgents,
  projects,
  artifactAssignments,
} from '../../infrastructure/database/schema';
import { TenantRole, AssignmentScope } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const VALID_KINDS = new Set(['workforce', 'registered']);

export function createProjectAgentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── List a project's agents ─────────────────────────────────────────────
  router.get('/', async (c) => {
    const tenantId     = c.get('tenantId') as number;
    const projectIdP   = c.req.query('projectId');
    if (!projectIdP) return c.json({ error: 'projectId query param is required' }, 400);
    const projectId = Number(projectIdP);

    if (!(await projectBelongsToTenant(db, tenantId, projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const rows = await db
      .select()
      .from(projectAgents)
      .where(and(eq(projectAgents.tenantId, tenantId), eq(projectAgents.projectId, projectId)));

    return c.json({ agents: rows });
  });

  // ── Attach an agent to a project ────────────────────────────────────────
  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string;
    const body     = await c.req.json<{
      projectId: number;
      agentKind: string;
      agentRef:  string;
      name:      string;
      role?:     string;
    }>();

    if (body.projectId == null) return c.json({ error: 'projectId is required' }, 400);
    if (!body.agentKind || !VALID_KINDS.has(body.agentKind)) {
      return c.json({ error: 'agentKind is required (workforce|registered)' }, 400);
    }
    if (!body.agentRef) return c.json({ error: 'agentRef is required' }, 400);
    if (!body.name) return c.json({ error: 'name is required' }, 400);

    if (!(await projectBelongsToTenant(db, tenantId, body.projectId))) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const [row] = await db
      .insert(projectAgents)
      .values({
        tenantId,
        projectId: body.projectId,
        agentKind: body.agentKind,
        agentRef:  body.agentRef,
        name:      body.name,
        role:      body.role ?? 'default',
        addedBy:   userId,
      })
      .onConflictDoNothing()
      .returning();

    // onConflictDoNothing → no row when the agent is already attached; return existing.
    if (!row) {
      const [existing] = await db
        .select()
        .from(projectAgents)
        .where(and(
          eq(projectAgents.tenantId, tenantId),
          eq(projectAgents.projectId, body.projectId),
          eq(projectAgents.agentKind, body.agentKind),
          eq(projectAgents.agentRef, body.agentRef),
        ))
        .limit(1);
      return c.json({ agent: existing }, 200);
    }

    return c.json({ agent: row }, 201);
  });

  // ── Detach an agent (and its per-agent assignments) ─────────────────────
  router.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id       = Number(c.req.param('id'));

    const [row] = await db
      .select({ id: projectAgents.id })
      .from(projectAgents)
      .where(and(eq(projectAgents.id, id), eq(projectAgents.tenantId, tenantId)))
      .limit(1);
    if (!row) return c.json({ error: 'Agent not found' }, 404);

    // Clean up per-agent artifact assignments keyed on this project_agents.id.
    await db
      .delete(artifactAssignments)
      .where(and(
        eq(artifactAssignments.tenantId, tenantId),
        eq(artifactAssignments.scope, AssignmentScope.AGENT),
        eq(artifactAssignments.scopeId, id),
      ));

    await db
      .delete(projectAgents)
      .where(and(eq(projectAgents.id, id), eq(projectAgents.tenantId, tenantId)));

    return c.body(null, 204);
  });

  // ── Set per-agent governance ────────────────────────────────────────────
  router.put('/:id/governance', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id       = Number(c.req.param('id'));
    const body     = await c.req.json<{ governance: string }>();

    const [updated] = await db
      .update(projectAgents)
      .set({ governance: body.governance ?? null, updatedAt: new Date() })
      .where(and(eq(projectAgents.id, id), eq(projectAgents.tenantId, tenantId)))
      .returning();

    if (!updated) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ agent: updated });
  });

  return router;
}

// ---------------------------------------------------------------------------

async function projectBelongsToTenant(db: Db, tenantId: number, projectId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  return !!row;
}
