/**
 * Creation Session Folders — the entity a session is filed into (migration
 * 1118). Kept as its own router rather than a 7th responsibility bolted onto
 * `creationSessionRouteService.ts`: folders are a new bounded concern (their
 * own identity, rename, and optional Project tie), not a session sub-resource.
 */
import { Hono, type Context } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { authMiddleware } from '../../presentation/middleware/authMiddleware';
import { scope } from '../../presentation/routes/segmentTrackerRoutes';
import { creationSessionFolders, projects } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';

type FolderBody = { name?: string; projectId?: number | null };

function cleanFolderName(input: unknown): string | null {
  const name = typeof input === 'string' ? input.trim().slice(0, 120) : '';
  return name || null;
}

export function createCreationSessionFolderRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  async function requireFolder(c: Context<HonoEnv>) {
    const { tenantId, segmentId } = scope(c);
    const id = c.req.param('id') ?? '';
    const [folder] = await db.select().from(creationSessionFolders).where(and(
      eq(creationSessionFolders.id, id), eq(creationSessionFolders.tenantId, tenantId), eq(creationSessionFolders.segmentId, segmentId),
    )).limit(1);
    return folder ?? null;
  }

  async function validProjectId(tenantId: number, segmentId: string, projectId: number): Promise<boolean> {
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(
      eq(projects.id, projectId), eq(projects.tenantId, tenantId), eq(projects.segmentId, segmentId),
    )).limit(1);
    return Boolean(project);
  }

  router.get('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const rows = await db.select({
      id: creationSessionFolders.id,
      name: creationSessionFolders.name,
      projectId: creationSessionFolders.projectId,
      createdAt: creationSessionFolders.createdAt,
      sessionCount: sql<number>`(SELECT COUNT(*)::int FROM creation_sessions member WHERE member.folder_id = ${creationSessionFolders}.id AND member.status = 'active')`,
    }).from(creationSessionFolders).where(and(
      eq(creationSessionFolders.tenantId, tenantId), eq(creationSessionFolders.segmentId, segmentId),
    )).orderBy(creationSessionFolders.name);
    return c.json({ folders: rows });
  });

  // Ensure semantics: returns the existing folder (200) rather than erroring
  // when the name is already taken, so the quick per-session "Move" picker and
  // the management panel's "New folder" can both call this without a race.
  router.post('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const body: FolderBody = await c.req.json<FolderBody>().catch(() => ({}));
    const name = cleanFolderName(body.name);
    if (!name) return c.json({ error: 'A folder name is required' }, 400);
    let projectId: number | null = null;
    if (body.projectId != null) {
      projectId = Number(body.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0 || !(await validProjectId(tenantId, segmentId, projectId))) {
        return c.json({ error: 'Invalid project id' }, 400);
      }
    }
    const [existing] = await db.select().from(creationSessionFolders).where(and(
      eq(creationSessionFolders.tenantId, tenantId), eq(creationSessionFolders.segmentId, segmentId),
      sql`lower(${creationSessionFolders.name}) = lower(${name})`,
    )).limit(1);
    if (existing) return c.json({ folder: existing });
    const [created] = await db.insert(creationSessionFolders).values({
      tenantId, segmentId, name, projectId, createdBy: userId,
    }).returning();
    return c.json({ folder: created }, 201);
  });

  router.patch('/:id', async (c) => {
    const folder = await requireFolder(c);
    if (!folder) return c.json({ error: 'Folder not found' }, 404);
    const { tenantId, segmentId } = scope(c);
    const body: FolderBody = await c.req.json<FolderBody>().catch(() => ({}));
    const patch: Partial<typeof creationSessionFolders.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) {
      const name = cleanFolderName(body.name);
      if (!name) return c.json({ error: 'A folder name is required' }, 400);
      patch.name = name;
    }
    if (body.projectId !== undefined) {
      if (body.projectId == null) {
        patch.projectId = null;
      } else {
        const projectId = Number(body.projectId);
        if (!Number.isInteger(projectId) || projectId <= 0 || !(await validProjectId(tenantId, segmentId, projectId))) {
          return c.json({ error: 'Invalid project id' }, 400);
        }
        patch.projectId = projectId;
      }
    }
    const [updated] = await db.update(creationSessionFolders).set(patch)
      .where(eq(creationSessionFolders.id, folder.id)).returning();
    return c.json({ folder: updated });
  });

  router.delete('/:id', async (c) => {
    const folder = await requireFolder(c);
    if (!folder) return c.json({ error: 'Folder not found' }, 404);
    // Member sessions fall back to unfiled via ON DELETE SET NULL — no manual cleanup.
    await db.delete(creationSessionFolders).where(eq(creationSessionFolders.id, folder.id));
    return c.json({ deleted: true });
  });

  return router;
}
