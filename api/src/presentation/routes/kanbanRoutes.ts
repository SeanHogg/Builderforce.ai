/**
 * Agentic Workforce Kanban routes — /api/kanban
 *
 * Job-role taxonomy, kanban templates (built-in + tenant + marketplace),
 * apply-template-to-project, recommended roster, and per-ticket role/diagnostic
 * auditing. Reads are open to any member; mutations require MANAGER.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { authMiddleware, isManager } from '../middleware/authMiddleware';
import { projects } from '../../infrastructure/database/schema';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { JobRoleService } from '../../application/kanban/jobRoleService';
import { KanbanTemplateService } from '../../application/kanban/kanbanTemplateService';
import { RosterService } from '../../application/kanban/rosterService';
import { RoleAssignmentService } from '../../application/kanban/roleAssignmentService';
import { TicketAuditService } from '../../application/audit/ticketAuditService';
import { loadAssignableWorkforce } from '../../application/kanban/assignableWorkforce';
import { loadAssigneeProfiles, assigneeProfilesCacheKey } from '../../application/kanban/assigneeProfiles';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';

export function createKanbanRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const roleService = new JobRoleService(db);
  const templateService = new KanbanTemplateService(db);
  const assignmentService = new RoleAssignmentService(db);
  const rosterService = new RosterService(db, templateService, roleService, assignmentService);
  const auditService = new TicketAuditService(db);

  const env = (c: { env: unknown }) => c.env as Env;

  // ── Assignable workforce (the ONE cached union the picker fan-out replaces) ──
  // agents (incl. marketplace-hired) + human members + active hires, in one read.
  router.get('/assignable', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const key = `kanban:assignable:t:${tenantId}`;
    const data = await getOrSetCached(env(c), key, () => loadAssignableWorkforce(db, tenantId), {
      kvTtlSeconds: 60, l1TtlMs: 15_000,
    });
    return c.json(data);
  });

  // ── Assignee personalities (the cached map the hovercard reads) ─────────────
  // assignee-ref (`u:<userId>` / `c:<agentRef>`) → { name, psychometric }, for every
  // assignee that has a personality. One tenant-scoped read powers every board card,
  // task-drawer and standup hovercard — no per-hover fetch. Invalidated on any
  // personality write (auth PATCH /me, agent create/update).
  router.get('/assignee-profiles', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const data = await getOrSetCached(env(c), assigneeProfilesCacheKey(tenantId), () => loadAssigneeProfiles(db, tenantId), {
      kvTtlSeconds: 300, l1TtlMs: 30_000,
    });
    return c.json({ profiles: data });
  });

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

  // ── Role assignments (pin an agent / human / hire to a role) ───────────────
  // Scope: no ?projectId → workspace-default rows (Workforce → Roles); ?projectId=N
  // → that project's roster (Recommended Roster card). Reads open; writes MANAGER.
  router.get('/role-assignments', async (c) => {
    const projectId = c.req.query('projectId');
    const scope = projectId != null && projectId !== '' ? Number(projectId) : null;
    return c.json({ assignments: await assignmentService.listForScope(env(c), c.get('tenantId') as number, scope) });
  });

  router.post('/role-assignments', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    const tenantId = c.get('tenantId') as number;
    try {
      const assignment = await assignmentService.create(env(c), tenantId, (c.get('userId') as string) ?? null, await c.req.json());
      await rosterService.invalidate(env(c), tenantId);
      return c.json({ assignment }, 201);
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  router.delete('/role-assignments/:id', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    const tenantId = c.get('tenantId') as number;
    try {
      await assignmentService.remove(env(c), tenantId, c.req.param('id'));
      await rosterService.invalidate(env(c), tenantId);
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
    const body = await c.req.json<{
      roleKey: string; laneKey?: string; verdict?: 'approved' | 'changes_requested'; summary?: string;
      memberKind?: string; memberRef?: string;
    }>();
    if (!body.roleKey) return c.json({ error: 'roleKey is required' }, 400);
    try {
      // The reviewer identity defaults to the authed human, but an AGENT acting as a
      // role reviewer (via the kanban.signoff MCP tool) supplies its own kind/ref so
      // the audit ledger attributes the sign-off to the agent, not a phantom human.
      const memberKind = body.memberKind === 'agent' || body.memberKind === 'human' ? body.memberKind : 'human';
      const memberRef = body.memberRef?.trim() || (c.get('userId') as string) || null;
      const audit = await auditService.recordSignoff(env(c), tenantId, {
        taskId,
        roleKey: body.roleKey,
        laneKey: body.laneKey,
        verdict: body.verdict ?? 'approved',
        summary: body.summary,
        memberKind,
        memberRef,
      });
      return c.json({ audit });
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  return router;
}
