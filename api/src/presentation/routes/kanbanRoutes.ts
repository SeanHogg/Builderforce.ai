/**
 * Agentic Workforce Kanban routes — /api/kanban
 *
 * Job-role taxonomy, kanban templates (built-in + tenant + marketplace),
 * apply-template-to-project, recommended roster, and per-ticket role/diagnostic
 * auditing. Reads are open to any member; mutations require MANAGER.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import { projects } from '../../infrastructure/database/schema';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { JobRoleService } from '../../application/kanban/jobRoleService';
import { KanbanTemplateService } from '../../application/kanban/kanbanTemplateService';
import { RosterService } from '../../application/kanban/rosterService';
import { TicketAuditService } from '../../application/audit/ticketAuditService';

export function createKanbanRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const roleService = new JobRoleService(db);
  const templateService = new KanbanTemplateService(db);
  const rosterService = new RosterService(db, templateService, roleService);
  const auditService = new TicketAuditService(db);

  const isManager = (c: { get: (k: 'role') => unknown }) => hasMinRole(c.get('role') as TenantRole, TenantRole.MANAGER);
  const env = (c: { env: unknown }) => c.env as Env;

  // ── Roles ─────────────────────────────────────────────────────────────────
  router.get('/roles', async (c) => c.json({ roles: await roleService.list(env(c), c.get('tenantId') as number) }));

  router.post('/roles', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    try {
      const role = await roleService.create(env(c), c.get('tenantId') as number, await c.req.json());
      return c.json({ role }, 201);
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  router.patch('/roles/:key', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    try {
      await roleService.update(env(c), c.get('tenantId') as number, c.req.param('key'), await c.req.json());
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  router.delete('/roles/:key', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    try {
      await roleService.remove(env(c), c.get('tenantId') as number, c.req.param('key'));
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  // ── Templates ───────────────────────────────────────────────────────────────
  router.get('/templates', async (c) => c.json({ templates: await templateService.list(env(c), c.get('tenantId') as number) }));

  router.get('/templates/public', async (c) => c.json({ templates: await templateService.listPublic(env(c)) }));

  router.get('/templates/:id', async (c) => {
    const t = await templateService.get(env(c), c.get('tenantId') as number, c.req.param('id'));
    return t ? c.json({ template: t }) : c.json({ error: 'not found' }, 404);
  });

  router.post('/templates', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    try {
      const t = await templateService.create(env(c), c.get('tenantId') as number, (c.get('userId') as string) ?? null, await c.req.json());
      return c.json({ template: t }, 201);
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  router.patch('/templates/:id', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    try {
      const t = await templateService.update(env(c), c.get('tenantId') as number, c.req.param('id'), await c.req.json());
      return c.json({ template: t });
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  router.delete('/templates/:id', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    try {
      await templateService.remove(env(c), c.get('tenantId') as number, c.req.param('id'));
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  router.post('/templates/:id/publish', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    try {
      const body = await c.req.json<{ published: boolean; visibility?: 'private' | 'tenant' | 'public'; priceCents?: number | null; pricingModel?: string | null; priceUnit?: string | null }>();
      await templateService.setPublication(env(c), c.get('tenantId') as number, c.req.param('id'), body);
      return c.json({ ok: true });
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  router.post('/templates/:id/install', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    try {
      const t = await templateService.install(env(c), c.get('tenantId') as number, (c.get('userId') as string) ?? null, c.req.param('id'));
      return c.json({ template: t }, 201);
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  // ── Apply a template to a project ────────────────────────────────────────────
  router.post('/projects/:projectId/apply', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    const { templateId } = await c.req.json<{ templateId: string }>();
    if (!templateId) return c.json({ error: 'templateId is required' }, 400);
    const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) return c.json({ error: 'project not found' }, 404);
    try {
      const result = await templateService.applyToProject(env(c), tenantId, projectId, templateId, project.name);
      await rosterService.invalidate(env(c), tenantId, projectId);
      return c.json({ ok: true, ...result });
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  router.get('/projects/:projectId/roster', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    return c.json({ roster: await rosterService.getRecommendedRoster(env(c), tenantId, projectId) });
  });

  router.get('/projects/:projectId/flagged', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectId = Number(c.req.param('projectId'));
    return c.json({ flagged: await auditService.listFlagged(env(c), tenantId, projectId) });
  });

  router.get('/flagged', async (c) =>
    c.json({ flagged: await auditService.listFlagged(env(c), c.get('tenantId') as number) }));

  // ── Per-ticket audit ─────────────────────────────────────────────────────────
  router.get('/tasks/:taskId/audit', async (c) => {
    const audit = await auditService.getAudit(env(c), c.get('tenantId') as number, Number(c.req.param('taskId')));
    return c.json({ audit });
  });

  router.post('/tasks/:taskId/audit/recompute', async (c) => {
    try {
      const audit = await auditService.computeAudit(env(c), c.get('tenantId') as number, Number(c.req.param('taskId')));
      return c.json({ audit });
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  router.post('/tasks/:taskId/signoff', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const taskId = Number(c.req.param('taskId'));
    const body = await c.req.json<{ roleKey: string; laneKey?: string; verdict?: 'approved' | 'changes_requested'; summary?: string }>();
    if (!body.roleKey) return c.json({ error: 'roleKey is required' }, 400);
    try {
      const audit = await auditService.recordSignoff(env(c), tenantId, {
        taskId,
        roleKey: body.roleKey,
        laneKey: body.laneKey,
        verdict: body.verdict ?? 'approved',
        summary: body.summary,
        memberKind: 'human',
        memberRef: (c.get('userId') as string) ?? null,
      });
      return c.json({ audit });
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  return router;
}
