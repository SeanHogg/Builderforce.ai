/**
 * IDE projects (0224) — the first-class "IDE project" entity: the buildable
 * artifact you open in the IDE (a Designer app, an Evermind, a Fine-tune, a
 * Video, a Voice).
 *
 * Many IDE projects can hang off one container Project (`containerProjectId`,
 * optional + reassignable), and each one is BACKED by a `projects` row
 * (`storageProjectId`, flagged `is_ide_storage`) that physically holds its R2
 * files / datasets / training / site / repo workspace — so every existing IDE
 * storage route is reused unchanged. Opening an IDE project = opening its storage
 * project's IDE (`/ide/{storageProjectPublicId}`); the storage project's modality
 * mirrors this row so the modality-driven IDE page renders the right panels.
 */
import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authMiddleware } from '../middleware/authMiddleware';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { ideProjects, projects, workflowDefinitions } from '../../infrastructure/database/schema';
import { ProjectService } from '../../application/project/ProjectService';
import { ensureProjectTemplate } from '../../application/project/projectTemplate';
import { applyEvermindRecipe, toEvermindRecipeId } from '../../application/llm/evermindRecipes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The IDE modalities an IDE project can be. `llm` is the retired combined modality,
 *  accepted for backward compatibility (the frontend aliases it to `evermind`). */
const MODALITIES = new Set(['designer', 'mobile', 'video', 'evermind', 'finetune', 'voice', 'llm']);

const listCacheKey = (tenantId: number) => `ide-projects:list:${tenantId}`;

export function createIdeProjectRoutes(projectService: ProjectService, db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const storageP = alias(projects, 'ide_storage_project');
  const containerP = alias(projects, 'ide_container_project');

  /** Shared SELECT projecting the joined view the frontend renders. */
  const viewSelect = () =>
    db
      .select({
        id: ideProjects.id,
        publicId: ideProjects.publicId,
        name: ideProjects.name,
        modality: ideProjects.modality,
        status: ideProjects.status,
        containerProjectId: ideProjects.containerProjectId,
        containerName: containerP.name,
        storageProjectId: ideProjects.storageProjectId,
        storageProjectPublicId: storageP.publicId,
        storageProjectKey: storageP.key,
        workflowDefinitionId: ideProjects.workflowDefinitionId,
        createdAt: ideProjects.createdAt,
        updatedAt: ideProjects.updatedAt,
      })
      .from(ideProjects)
      .innerJoin(storageP, eq(ideProjects.storageProjectId, storageP.id))
      .leftJoin(containerP, eq(ideProjects.containerProjectId, containerP.id));

  const fetchOne = async (tenantId: number, idOrUuid: string) => {
    const cond = UUID_RE.test(idOrUuid)
      ? eq(ideProjects.publicId, idOrUuid)
      : eq(ideProjects.id, Number(idOrUuid));
    const [row] = await viewSelect().where(and(eq(ideProjects.tenantId, tenantId), cond)).limit(1);
    return row ?? null;
  };

  /** Validate a candidate container project belongs to the tenant and is itself a
   *  real (non-storage) project. Returns the id, or null when invalid. */
  const validContainer = async (tenantId: number, containerId: number): Promise<number | null> => {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, containerId), eq(projects.tenantId, tenantId), eq(projects.isIdeStorage, false)))
      .limit(1);
    return row ? row.id : null;
  };

  /** Tenant-ownership gate for an assignable workflow definition (prevents
   *  referencing another tenant's workflow by id). Returns true when it belongs. */
  const ownsWorkflow = async (tenantId: number, wfId: string): Promise<boolean> => {
    const [row] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, wfId), eq(workflowDefinitions.tenantId, tenantId)))
      .limit(1);
    return !!row;
  };

  // GET /api/ide-projects — list the tenant's IDE projects (grouped client-side by container).
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await getOrSetCached(
      c.env as Env,
      listCacheKey(tenantId),
      () => viewSelect().where(eq(ideProjects.tenantId, tenantId)).orderBy(desc(ideProjects.createdAt)),
      { kvTtlSeconds: 30 },
    );
    return c.json(rows);
  });

  // GET /api/ide-projects/containers — candidate parent Projects for the assign/reassign picker.
  // Read-through cached with a short TTL: the parent set changes only when a real
  // project is created/deleted (in projectRoutes, out of this router's reach), so a
  // brief staleness window on a non-critical picker is acceptable rather than
  // cross-wiring invalidation into the project CRUD path.
  router.get('/containers', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await getOrSetCached(
      c.env as Env,
      `ide-projects:containers:${tenantId}`,
      () => db
        .select({ id: projects.id, name: projects.name, key: projects.key })
        .from(projects)
        .where(and(eq(projects.tenantId, tenantId), eq(projects.isIdeStorage, false)))
        .orderBy(desc(projects.updatedAt)),
      { kvTtlSeconds: 30 },
    );
    return c.json(rows);
  });

  // GET /api/ide-projects/by-storage/:storageProjectId — resolve the IDE project
  // backing a given storage project (used when the IDE is opened by storage id,
  // e.g. the Voice studio needs its ide_project id to scope clones).
  router.get('/by-storage/:storageProjectId', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const sid = Number(c.req.param('storageProjectId'));
    if (!Number.isInteger(sid)) return c.json({ error: 'Invalid storage project id' }, 400);
    const [row] = await viewSelect()
      .where(and(eq(ideProjects.tenantId, tenantId), eq(ideProjects.storageProjectId, sid)))
      .limit(1);
    if (!row) return c.json({ error: 'IDE project not found' }, 404);
    return c.json(row);
  });

  // GET /api/ide-projects/:id — single IDE project (int id or public UUID).
  router.get('/:id', async (c) => {
    const view = await fetchOne(c.get('tenantId') as number, c.req.param('id'));
    if (!view) return c.json({ error: 'IDE project not found' }, 404);
    return c.json(view);
  });

  // POST /api/ide-projects — create an IDE project + its backing storage project.
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      name?: string;
      modality?: string;
      containerProjectId?: number | null;
      template?: string | null;
      workflowDefinitionId?: string | null;
      // Evermind modality: the one-click Evermind recipe (+ its optional inputs) that
      // provisions the new project's model. See application/llm/evermindRecipes.
      evermindRecipe?: string | null;
      evermindTeacherModel?: string | null;
      evermindSeedModelSlug?: string | null;
    }>();
    const name = body.name?.trim();
    if (!name) return c.json({ error: 'name is required' }, 400);
    const modality = body.modality && MODALITIES.has(body.modality) ? body.modality : 'designer';

    let containerProjectId: number | null = null;
    if (body.containerProjectId != null) {
      containerProjectId = await validContainer(tenantId, body.containerProjectId);
      if (containerProjectId === null) return c.json({ error: 'Invalid container project' }, 400);
    }

    // An automation workflow is OPTIONAL for any modality (advanced users can attach
    // one later via the details modal). Evermind projects instead pick an Evermind
    // RECIPE at creation, which provisions the project's model (applied below). Validate
    // tenant ownership of a workflow when one is supplied.
    let workflowDefinitionId: string | null = null;
    if (body.workflowDefinitionId) {
      if (!(await ownsWorkflow(tenantId, body.workflowDefinitionId))) return c.json({ error: 'Invalid workflow' }, 400);
      workflowDefinitionId = body.workflowDefinitionId;
    }

    // Backing storage project — reuses the proven project create + template seed.
    const storage = await projectService.createProject({
      tenantId,
      key: await projectService.buildUniqueKey(tenantId, name),
      name,
      template: body.template ?? null,
      modality,
      origin: 'ide',
    });
    // Hide it from the board/PMO project list; it is IDE storage, not a work project.
    const [sp] = await db
      .update(projects)
      .set({ isIdeStorage: true })
      .where(eq(projects.id, storage.id))
      .returning({ segmentId: projects.segmentId });
    // Seed the vanilla starter so a Designer build opens runnable (fixes empty-files).
    await ensureProjectTemplate(c.env.UPLOADS, {
      id: storage.id,
      template: body.template ?? null,
      modality,
      sourceControlRepoFullName: null,
      githubRepoUrl: null,
    });

    const [created] = await db
      .insert(ideProjects)
      .values({
        tenantId,
        segmentId: sp?.segmentId ?? null,
        containerProjectId,
        storageProjectId: storage.id,
        name,
        modality,
        workflowDefinitionId,
      })
      .returning({ id: ideProjects.id });

    // Evermind projects: provision the project's Evermind from the chosen recipe so it
    // opens with a working, learnable model (no automation-workflow gate). Keyed on
    // the BACKING storage project — the id the Evermind panel + routes operate on.
    // Best-effort inside applyEvermindRecipe: creation succeeds even if seeding does not.
    // `llm` is the retired combined modality — treat it as evermind for legacy callers.
    if (modality === 'evermind' || modality === 'llm') {
      await applyEvermindRecipe(c.env as Env, db, tenantId, storage.id, {
        recipe: toEvermindRecipeId(body.evermindRecipe),
        teacherModel: typeof body.evermindTeacherModel === 'string' ? body.evermindTeacherModel : null,
        seedModelSlug: typeof body.evermindSeedModelSlug === 'string' ? body.evermindSeedModelSlug : null,
        name,
      });
    }

    await invalidateCached(c.env as Env, listCacheKey(tenantId));
    const view = await fetchOne(tenantId, String(created!.id));
    return c.json(view, 201);
  });

  // PATCH /api/ide-projects/:id — rename, reassign parent (containerProjectId, null
  // to ungroup), assign a workflow, or change status.
  router.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const existing = await fetchOne(tenantId, c.req.param('id'));
    if (!existing) return c.json({ error: 'IDE project not found' }, 404);
    const body = await c.req.json<{
      name?: string;
      containerProjectId?: number | null;
      workflowDefinitionId?: string | null;
      status?: string;
    }>();

    const set: Partial<typeof ideProjects.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) return c.json({ error: 'name cannot be empty' }, 400);
      set.name = name;
      // Keep the backing storage project's name in sync so the IDE header matches.
      await projectService.updateProject(existing.storageProjectId, { name }, tenantId);
    }
    if (body.containerProjectId !== undefined) {
      if (body.containerProjectId === null) {
        set.containerProjectId = null;
      } else {
        const valid = await validContainer(tenantId, body.containerProjectId);
        if (valid === null) return c.json({ error: 'Invalid container project' }, 400);
        set.containerProjectId = valid;
      }
    }
    if (body.workflowDefinitionId !== undefined) {
      if (body.workflowDefinitionId === null) {
        set.workflowDefinitionId = null;
      } else {
        if (!(await ownsWorkflow(tenantId, body.workflowDefinitionId))) return c.json({ error: 'Invalid workflow' }, 400);
        set.workflowDefinitionId = body.workflowDefinitionId;
      }
    }
    if (body.status !== undefined) set.status = body.status;

    await db.update(ideProjects).set(set).where(eq(ideProjects.id, existing.id));
    await invalidateCached(c.env as Env, listCacheKey(tenantId));
    const view = await fetchOne(tenantId, String(existing.id));
    return c.json(view);
  });

  // DELETE /api/ide-projects/:id — remove the IDE project. A dedicated backing
  // storage project is deleted too (cascades the ide_project row + its files);
  // a backfilled one whose storage is a REAL work project is only unlinked.
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const existing = await fetchOne(tenantId, c.req.param('id'));
    if (!existing) return c.json({ error: 'IDE project not found' }, 404);
    const [storage] = await db
      .select({ isIdeStorage: projects.isIdeStorage })
      .from(projects)
      .where(eq(projects.id, existing.storageProjectId))
      .limit(1);
    if (storage?.isIdeStorage) {
      await projectService.deleteProject(existing.storageProjectId, tenantId);
    } else {
      await db.delete(ideProjects).where(eq(ideProjects.id, existing.id));
    }
    await invalidateCached(c.env as Env, listCacheKey(tenantId));
    return c.body(null, 204);
  });

  return router;
}
