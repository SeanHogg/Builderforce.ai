/**
 * Artifact assignment routes — assign skills, personas, or content to any scope.
 *
 * Scope hierarchy (highest precedence → lowest):
 *   task → project → claw → tenant
 *
 * Routes:
 *   GET    /api/artifact-assignments?scope=<scope>&scopeId=<id>[&artifactType=<type>]
 *   POST   /api/artifact-assignments
 *   DELETE /api/artifact-assignments/:artifactType/:artifactSlug/:scope/:scopeId
 *   GET    /api/artifact-assignments/resolve?taskId=<id>  — resolve effective set
 *
 * All routes require a tenant-scoped JWT.
 * Write routes require at least MANAGER role.
 */
import { Hono } from 'hono';
import { eq, and, inArray } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  artifactAssignments,
  coderclawInstances,
  projects,
  tasks,
} from '../../infrastructure/database/schema';
import {
  TenantRole,
  ArtifactType,
  AssignmentScope,
} from '../../domain/shared/types';
import { resolveArtifacts } from '../../application/artifact/resolveArtifacts';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const VALID_TYPES = new Set(Object.values(ArtifactType));
const VALID_SCOPES = new Set(Object.values(AssignmentScope));

export function createArtifactAssignmentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── List assignments for a given scope ──────────────────────────────────

  router.get('/', async (c) => {
    const tenantId     = c.get('tenantId') as number;
    const scope        = c.req.query('scope') as AssignmentScope | undefined;
    const scopeIdParam = c.req.query('scopeId');
    const artifactType = c.req.query('artifactType') as ArtifactType | undefined;

    if (!scope || !VALID_SCOPES.has(scope)) {
      return c.json({ error: 'scope query param is required (tenant|claw|project|task)' }, 400);
    }
    if (!scopeIdParam) {
      return c.json({ error: 'scopeId query param is required' }, 400);
    }
    const scopeId = Number(scopeIdParam);

    // Verify scope entity belongs to this tenant
    const ownershipOk = await verifyScopeOwnership(db, tenantId, scope, scopeId);
    if (!ownershipOk) return c.json({ error: 'Scope entity not found' }, 404);

    const conditions = [
      eq(artifactAssignments.tenantId, tenantId),
      eq(artifactAssignments.scope, scope),
      eq(artifactAssignments.scopeId, scopeId),
    ];
    if (artifactType && VALID_TYPES.has(artifactType)) {
      conditions.push(eq(artifactAssignments.artifactType, artifactType));
    }

    const rows = await db
      .select()
      .from(artifactAssignments)
      .where(and(...conditions));

    return c.json({ assignments: rows });
  });

  // ── Assign an artifact ──────────────────────────────────────────────────

  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string;
    const body     = await c.req.json<{
      artifactType: ArtifactType;
      artifactSlug: string;
      scope:        AssignmentScope;
      scopeId:      number;
      config?:      string;
    }>();

    if (!body.artifactType || !VALID_TYPES.has(body.artifactType)) {
      return c.json({ error: 'artifactType is required (skill|persona|content)' }, 400);
    }
    if (!body.artifactSlug) {
      return c.json({ error: 'artifactSlug is required' }, 400);
    }
    if (!body.scope || !VALID_SCOPES.has(body.scope)) {
      return c.json({ error: 'scope is required (tenant|claw|project|task)' }, 400);
    }
    if (body.scopeId == null) {
      return c.json({ error: 'scopeId is required' }, 400);
    }

    const ownershipOk = await verifyScopeOwnership(db, tenantId, body.scope, body.scopeId);
    if (!ownershipOk) return c.json({ error: 'Scope entity not found' }, 404);

    await db
      .insert(artifactAssignments)
      .values({
        tenantId,
        artifactType: body.artifactType,
        artifactSlug: body.artifactSlug,
        scope:        body.scope,
        scopeId:      body.scopeId,
        assignedBy:   userId,
        config:       body.config ?? null,
      })
      .onConflictDoNothing();

    return c.json({
      ok: true,
      artifactType: body.artifactType,
      artifactSlug: body.artifactSlug,
      scope:        body.scope,
      scopeId:      body.scopeId,
    }, 201);
  });

  // ── Remove an assignment ────────────────────────────────────────────────

  router.delete(
    '/:artifactType/:artifactSlug/:scope/:scopeId',
    requireRole(TenantRole.MANAGER),
    async (c) => {
      const tenantId     = c.get('tenantId') as number;
      const artifactType = c.req.param('artifactType') as ArtifactType;
      const artifactSlug = c.req.param('artifactSlug');
      const scope        = c.req.param('scope') as AssignmentScope;
      const scopeId      = Number(c.req.param('scopeId'));

      if (!VALID_TYPES.has(artifactType) || !VALID_SCOPES.has(scope)) {
        return c.json({ error: 'Invalid artifactType or scope' }, 400);
      }

      await db
        .delete(artifactAssignments)
        .where(and(
          eq(artifactAssignments.tenantId, tenantId),
          eq(artifactAssignments.artifactType, artifactType),
          eq(artifactAssignments.artifactSlug, artifactSlug),
          eq(artifactAssignments.scope, scope),
          eq(artifactAssignments.scopeId, scopeId),
        ));

      return c.body(null, 204);
    },
  );

  // ── Resolve effective artifacts for a task ──────────────────────────────

  router.get('/resolve', async (c) => {
    const tenantId   = c.get('tenantId') as number;
    const taskIdP    = c.req.query('taskId');
    const clawIdP    = c.req.query('clawId');
    const projectIdP = c.req.query('projectId');

    if (!taskIdP && !clawIdP && !projectIdP) {
      return c.json({ error: 'At least one of taskId, clawId, or projectId is required' }, 400);
    }

    const resolved = await resolveArtifacts(db, {
      tenantId,
      taskId:    taskIdP ? Number(taskIdP) : undefined,
      clawId:    clawIdP ? Number(clawIdP) : undefined,
      projectId: projectIdP ? Number(projectIdP) : undefined,
    });

    return c.json(resolved);
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function verifyScopeOwnership(
  db: Db,
  tenantId: number,
  scope: AssignmentScope,
  scopeId: number,
): Promise<boolean> {
  switch (scope) {
    case AssignmentScope.TENANT:
      return scopeId === tenantId;

    case AssignmentScope.CLAW: {
      const [row] = await db
        .select({ id: coderclawInstances.id })
        .from(coderclawInstances)
        .where(and(eq(coderclawInstances.id, scopeId), eq(coderclawInstances.tenantId, tenantId)))
        .limit(1);
      return !!row;
    }

    case AssignmentScope.PROJECT: {
      const [row] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, scopeId), eq(projects.tenantId, tenantId)))
        .limit(1);
      return !!row;
    }

    case AssignmentScope.TASK: {
      const [row] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(tasks.id, scopeId), eq(projects.tenantId, tenantId)))
        .limit(1);
      return !!row;
    }

    default:
      return false;
  }
}
