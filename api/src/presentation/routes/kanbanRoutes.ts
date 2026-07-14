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
import { projects, tasks } from '../../infrastructure/database/schema';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { JobRoleService } from '../../application/kanban/jobRoleService';
import { KanbanTemplateService } from '../../application/kanban/kanbanTemplateService';
import { RosterService } from '../../application/kanban/rosterService';
import { RoleAssignmentService } from '../../application/kanban/roleAssignmentService';
import { TicketAuditService, type SignoffVerdict, type SignoffContribution } from '../../application/audit/ticketAuditService';
import { TicketParticipantsService } from '../../application/kanban/ticketParticipants';
import { isAgentRefRoleCapable, humanIsRoleCapable, resolveMemberDisplayName } from '../../application/kanban/roleCapability';
import { BUILTIN_ROLES } from '../../application/kanban/roleCatalog';
import { loadAssignableWorkforce } from '../../application/kanban/assignableWorkforce';
import { loadAssigneeProfiles, assigneeProfilesCacheKey } from '../../application/kanban/assigneeProfiles';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { recordActivity, cloudAgentActor, resolveHumanActor } from '../../application/activity/activityLog';
import { coordinateTicket } from '../../application/manager/coordinateTicket';
import { buildRuntimeService } from '../../buildRuntimeService';

/** Create a child work-item task under a parent ticket — injected from the composition
 *  root (needs TaskService's key allocation). Absent ⇒ materialize endpoint 503s. */
export type CreateChildTaskPort = (args: {
  projectId: number; tenantId: number; title: string; parentTaskId: number;
  assignedAgentRef?: string | null; assignedUserId?: string | null;
}) => Promise<{ id: number }>;

const ROLE_LABEL = new Map(BUILTIN_ROLES.map((r) => [r.key, r.name]));
const roleLabel = (key: string): string => ROLE_LABEL.get(key) ?? key;

export function createKanbanRoutes(db: Db, createChild?: CreateChildTaskPort): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const roleService = new JobRoleService(db);
  const templateService = new KanbanTemplateService(db);
  const assignmentService = new RoleAssignmentService(db);
  const rosterService = new RosterService(db, templateService, roleService, assignmentService);
  const auditService = new TicketAuditService(db);
  const participantsService = new TicketParticipantsService(db);

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
      roleKey: string; laneKey?: string; verdict?: SignoffVerdict; summary?: string;
      memberKind?: string; memberRef?: string; contribution?: SignoffContribution; waiveReason?: string;
    }>();
    if (!body.roleKey) return c.json({ error: 'roleKey is required' }, 400);
    const verdict: SignoffVerdict = ['approved', 'changes_requested', 'waived', 'delegated'].includes(body.verdict as string) ? (body.verdict as SignoffVerdict) : 'approved';
    if ((verdict === 'waived' || verdict === 'delegated') && !body.waiveReason?.trim() && !body.summary?.trim()) {
      return c.json({ error: 'a reason is required to waive or delegate a required role' }, 400);
    }
    try {
      // The signer identity defaults to the authed human, but an AGENT acting as a role
      // reviewer (via the kanban.signoff MCP tool) supplies its own kind/ref so the
      // ledger attributes the sign-off to the agent, not a phantom human.
      const memberKind = body.memberKind === 'agent' || body.memberKind === 'human' ? body.memberKind : 'human';
      const userId = (c.get('userId') as string) || null;
      const memberRef = body.memberRef?.trim() || userId;
      const [taskScope] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!taskScope) return c.json({ error: 'task not found' }, 404);

      // RBAC (default-deny, AC-6): only a member ROLE-CAPABLE of roleKey may sign off as
      // it. Agents check capability; humans pass if manager, pinned, or discipline-matched.
      const capable = memberKind === 'agent'
        ? await isAgentRefRoleCapable(db, tenantId, memberRef, body.roleKey)
        : (isManager(c) || await humanIsRoleCapable(db, tenantId, memberRef, body.roleKey, taskScope.projectId));
      if (!capable) return c.json({ error: `not authorized to sign off as role '${body.roleKey}'` }, 403);

      const memberName = await resolveMemberDisplayName(db, tenantId, memberKind, memberRef);
      const audit = await auditService.recordSignoff(env(c), tenantId, {
        taskId,
        roleKey: body.roleKey,
        laneKey: body.laneKey,
        verdict,
        summary: body.summary,
        memberKind,
        memberRef,
        memberName,
        contribution: body.contribution ?? null,
        waiveReason: body.waiveReason ?? null,
      });
      // Keep the participation manifest in step with the ledger.
      await participantsService.syncStates(env(c), tenantId, taskId);
      await participantsService.invalidate(env(c), taskId);
      // Sign-off may be the final missing requirement for this stage. Hand control
      // back to the ticket's Coordinator, which alone verifies + advances managed
      // tickets and dispatches the next role.
      await coordinateTicket(env(c), db, buildRuntimeService(env(c), db), { tenantId, taskId }).catch(() => null);

      // Emit the accountability trail on the HTTP path too (previously MCP-only).
      const actor = memberKind === 'agent'
        ? cloudAgentActor(memberRef ?? 'agent', memberName ?? memberRef ?? 'agent')
        : await resolveHumanActor(env(c), db, tenantId, memberRef ?? userId ?? '');
      await recordActivity(env(c), db, {
        tenantId, projectId: taskScope.projectId, actor,
        verb: verdict === 'approved' || verdict === 'waived' ? 'ticket.role.completed' : 'ticket.signed_off',
        targetType: 'task', targetId: String(taskId), targetLabel: `#${taskId}`,
        summary: `${roleLabel(body.roleKey)} ${verdict.replace('_', ' ')}${body.summary ? `: ${body.summary}` : ''}`.slice(0, 300),
        metadata: { roleKey: body.roleKey, verdict, laneKey: body.laneKey ?? null },
      });
      return c.json({ audit });
    } catch (e) { return c.json({ error: (e as Error).message }, 400); }
  });

  // ── Participation manifest & Accountability Report ───────────────────────────
  // The manifest (who MUST participate, who has, with what evidence) — cached.
  router.get('/tasks/:taskId/participants', async (c) =>
    c.json({ participants: await participantsService.listParticipants(env(c), c.get('tenantId') as number, Number(c.req.param('taskId'))) }));

  // The Accountability Report — Who / When / Verdict / Comments / Contribution + gaps.
  router.get('/tasks/:taskId/accountability', async (c) =>
    c.json({ accountability: await participantsService.getAccountability(env(c), c.get('tenantId') as number, Number(c.req.param('taskId'))) }));

  // Per-project participation progress for the board's %-complete chips (cached).
  router.get('/projects/:projectId/participants-summary', async (c) =>
    c.json({ summary: await participantsService.projectSummary(env(c), c.get('tenantId') as number, Number(c.req.param('projectId'))) }));

  // Force a Coordinator tick — derive the manifest + dispatch the next required role.
  router.post('/tasks/:taskId/coordinate', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    const result = await coordinateTicket(env(c), db, buildRuntimeService(env(c), db), {
      tenantId: c.get('tenantId') as number, taskId: Number(c.req.param('taskId')),
    });
    return c.json({ result });
  });

  // Resource Assessment — add a role the ticket needs beyond the template (designer,
  // security engineer, …). Manager-gated. An unstaffed add surfaces as a resource gap.
  router.post('/tasks/:taskId/participants', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    const tenantId = c.get('tenantId') as number;
    const taskId = Number(c.req.param('taskId'));
    const body = await c.req.json<{ roleKey: string; responsibility?: 'owner' | 'reviewer' | 'contributor'; stageKey?: string; note?: string }>();
    if (!body.roleKey) return c.json({ error: 'roleKey is required' }, 400);
    const participant = await participantsService.addParticipant(env(c), tenantId, taskId, {
      roleKey: body.roleKey, responsibility: body.responsibility, stageKey: body.stageKey, note: body.note,
    });
    if (participant) {
      const [proj] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
      await recordActivity(env(c), db, {
        tenantId, projectId: proj?.projectId ?? null, actor: await resolveHumanActor(env(c), db, tenantId, (c.get('userId') as string) ?? ''),
        verb: 'ticket.resource.assessed', targetType: 'task', targetId: String(taskId), targetLabel: `#${taskId}`,
        summary: `Added required role ${roleLabel(body.roleKey)}${participant.state === 'unstaffed' ? ' (resource gap — unstaffed)' : ''}`.slice(0, 300),
        metadata: { roleKey: body.roleKey, state: participant.state },
      });
    }
    return c.json({ participant });
  });

  router.delete('/tasks/:taskId/participants/:participantId', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    await participantsService.removeParticipant(env(c), c.get('tenantId') as number, Number(c.req.param('taskId')), c.req.param('participantId'));
    return c.json({ ok: true });
  });

  // Materialize a child work-item task per resolved participant (the %-complete rollup).
  router.post('/tasks/:taskId/participants/materialize', async (c) => {
    if (!isManager(c)) return c.json({ error: 'manager role required' }, 403);
    if (!createChild) return c.json({ error: 'child-task creation unavailable' }, 503);
    const tenantId = c.get('tenantId') as number;
    const taskId = Number(c.req.param('taskId'));
    const [proj] = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!proj) return c.json({ error: 'task not found' }, 404);
    const created = await participantsService.materializeChildTasks(env(c), tenantId, taskId, (input) =>
      createChild({ projectId: proj.projectId, tenantId, title: input.title, parentTaskId: input.parentTaskId, assignedAgentRef: input.assignedAgentRef, assignedUserId: input.assignedUserId }));
    return c.json({ created });
  });

  return router;
}
