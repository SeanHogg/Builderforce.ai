/**
 * Incident-management routes — /api/incidents
 *
 * The HTTP surface for the incident-management subsystem: incidents (open / triage /
 * acknowledge / resolve / war-room), on-call rotations, timed escalation policies, and
 * the business-contact directory. The agent reaches the same logic through the
 * `incidents.*` / `oncall.*` built-in MCP tools; both go through IncidentService /
 * OnCallService / EscalationService so there is one code path.
 *
 * Reads (list incidents, rotations, policies, contacts) serve through the read-through
 * cache folded on a per-tenant version token bumped by every write (incidentVersionKey)
 * + the connector ingest fork.
 *
 * Incidents:
 *   GET    /                       list incidents (activeOnly?)               (MEMBER+)
 *   POST   /                       open an incident (page? to notify on-call) (MANAGER+)
 *   GET    /:id                    one incident + timeline                    (MEMBER+)
 *   PATCH  /:id                    update severity/status/impact/rootCause     (MANAGER+)
 *   POST   /:id/classify           set the affected system                     (MANAGER+)
 *   POST   /:id/notes              append a timeline note                      (MEMBER+)
 *   POST   /:id/page               page on-call now                            (MANAGER+)
 *   POST   /:id/war-room           open the on-call war-room chat              (MEMBER+)
 *   POST   /:id/triage             dispatch the Incident Manager agent         (MANAGER+)
 * On-call:   /on-call/rotations…            (list MEMBER+, writes MANAGER+)
 * Escalation:/escalation/policies…          (list MEMBER+, writes MANAGER+)
 * Contacts:  /contacts…                     (list MEMBER+, writes MANAGER+)
 */
import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { businessContacts, workflows, workflowDefinitions } from '../../infrastructure/database/schema';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { incidentVersionKey } from '../../application/insights/versionKeys';
import { IncidentService, type IncidentSeverity, type IncidentStatus } from '../../application/incident/IncidentService';
import { OnCallService, type RotationKind } from '../../application/incident/OnCallService';
import { EscalationService } from '../../application/incident/EscalationService';
import { dispatchIncidentTriage } from '../../application/incident/incidentDispatch';
import { instantiateWorkflowRun, runTargetFromDefinition, type RunTarget } from '../../application/workflow/instantiateRun';
import { parseDefinition } from '../../domain/workflowGraph';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createIncidentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const invalidate = (c: { env: HonoEnv['Bindings'] }, tenantId: number) =>
    bumpCacheVersion(c.env, incidentVersionKey(tenantId));

  // ── On-call rotations ──────────────────────────────────────────────────────
  router.get('/on-call/rotations', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const ver = await getCacheVersion(c.env, incidentVersionKey(tenantId));
    const data = await getOrSetCached(c.env, `incidents:rotations:${tenantId}:v:${ver}`, () => new OnCallService(db).listRotations(tenantId));
    return c.json({ rotations: data });
  });
  router.post('/on-call/rotations', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; description?: string; rotationKind?: RotationKind; projectId?: number };
    if (!b.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const row = await new OnCallService(db).createRotation(tenantId, { name: b.name, description: b.description ?? null, rotationKind: b.rotationKind, projectId: b.projectId ?? null });
    await invalidate(c, tenantId);
    return c.json({ rotation: row }, 201);
  });
  router.patch('/on-call/rotations/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; description?: string; rotationKind?: RotationKind; active?: boolean; currentIndex?: number };
    await new OnCallService(db).updateRotation(tenantId, c.req.param('id'), b);
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.delete('/on-call/rotations/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    await new OnCallService(db).deleteRotation(tenantId, c.req.param('id'));
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.post('/on-call/rotations/:id/members', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as { memberRef?: string; displayName?: string; position?: number };
    if (!b.memberRef?.trim()) return c.json({ error: 'memberRef is required' }, 400);
    const row = await new OnCallService(db).addMember(tenantId, c.req.param('id'), { memberRef: b.memberRef, displayName: b.displayName ?? null, position: b.position });
    await invalidate(c, tenantId);
    return c.json({ member: row }, 201);
  });
  router.delete('/on-call/rotations/:id/members/:memberId', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    await new OnCallService(db).removeMember(tenantId, c.req.param('id'), c.req.param('memberId'));
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });

  // ── Escalation policies ────────────────────────────────────────────────────
  router.get('/escalation/policies', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const ver = await getCacheVersion(c.env, incidentVersionKey(tenantId));
    const data = await getOrSetCached(c.env, `incidents:policies:${tenantId}:v:${ver}`, () => new EscalationService(db).listPolicies(tenantId));
    return c.json({ policies: data });
  });
  router.post('/escalation/policies', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; description?: string; matchSeverity?: string; projectId?: number };
    if (!b.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const row = await new EscalationService(db).createPolicy(tenantId, { name: b.name, description: b.description ?? null, matchSeverity: b.matchSeverity ?? null, projectId: b.projectId ?? null });
    await invalidate(c, tenantId);
    return c.json({ policy: row }, 201);
  });
  router.delete('/escalation/policies/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    await new EscalationService(db).deletePolicy(tenantId, c.req.param('id'));
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.post('/escalation/policies/:id/levels', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as { level?: number; afterMinutes?: number; targetKind?: string; targetRef?: string; notifyTeams?: boolean; notifySlack?: boolean; notifyEmail?: boolean };
    if (b.afterMinutes == null) return c.json({ error: 'afterMinutes is required' }, 400);
    const row = await new EscalationService(db).addLevel(tenantId, c.req.param('id'), {
      level: b.level, afterMinutes: b.afterMinutes, targetKind: b.targetKind, targetRef: b.targetRef ?? null,
      notifyTeams: b.notifyTeams, notifySlack: b.notifySlack, notifyEmail: b.notifyEmail,
    });
    await invalidate(c, tenantId);
    return c.json({ level: row }, 201);
  });
  router.delete('/escalation/levels/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    await new EscalationService(db).deleteLevel(tenantId, c.req.param('id'));
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });

  // ── Business contacts ──────────────────────────────────────────────────────
  router.get('/contacts', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const ver = await getCacheVersion(c.env, incidentVersionKey(tenantId));
    const data = await getOrSetCached(c.env, `incidents:contacts:${tenantId}:v:${ver}`, () =>
      db.select().from(businessContacts).where(eq(businessContacts.tenantId, tenantId)).orderBy(businessContacts.name));
    return c.json({ contacts: data });
  });
  router.post('/contacts', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; roleTitle?: string; company?: string; email?: string; phone?: string; teamsId?: string; notes?: string };
    if (!b.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const [row] = await db.insert(businessContacts).values({
      tenantId, name: b.name.slice(0, 255), roleTitle: b.roleTitle ?? null, company: b.company ?? null,
      email: b.email ?? null, phone: b.phone ?? null, teamsId: b.teamsId ?? null, notes: b.notes ?? null,
    }).returning();
    await invalidate(c, tenantId);
    return c.json({ contact: row }, 201);
  });
  router.patch('/contacts/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['name', 'roleTitle', 'company', 'email', 'phone', 'teamsId', 'notes'] as const) if (b[k] !== undefined) set[k] = b[k];
    await db.update(businessContacts).set(set).where(and(eq(businessContacts.id, c.req.param('id')), eq(businessContacts.tenantId, tenantId)));
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.delete('/contacts/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    await db.delete(businessContacts).where(and(eq(businessContacts.id, c.req.param('id')), eq(businessContacts.tenantId, tenantId)));
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });

  // ── Incidents ──────────────────────────────────────────────────────────────
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const activeOnly = c.req.query('activeOnly') === 'true';
    const ver = await getCacheVersion(c.env, incidentVersionKey(tenantId));
    const data = await getOrSetCached(c.env, `incidents:list:${tenantId}:${activeOnly}:v:${ver}`, () => new IncidentService(db).listIncidents(tenantId, { activeOnly }));
    return c.json({ incidents: data });
  });
  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as { title?: string; description?: string; severity?: IncidentSeverity; source?: string; affectedSystem?: string; projectId?: number; escalationPolicyId?: string; openWarRoom?: boolean; page?: boolean };
    if (!b.title?.trim()) return c.json({ error: 'title is required' }, 400);
    const svc = new IncidentService(db);
    const res = await svc.openIncident(tenantId, {
      title: b.title, description: b.description ?? null, severity: b.severity, source: b.source ?? 'manual',
      affectedSystem: b.affectedSystem ?? null, projectId: b.projectId ?? null, escalationPolicyId: b.escalationPolicyId ?? null,
      openWarRoom: b.openWarRoom === true, actorRef: `u:${c.get('userId') as string | undefined ?? 'system'}`,
    });
    if (b.page && res.created) await new EscalationService(db).pageInitial(c.env, tenantId, res.incidentId).catch(() => {});
    await invalidate(c, tenantId);
    return c.json(res, res.created ? 201 : 200);
  });
  router.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const data = await new IncidentService(db).getIncident(tenantId, c.req.param('id'));
    if (!data) return c.json({ error: 'Incident not found' }, 404);
    return c.json(data);
  });

  // RCA linkage (PRD §5.10): the implicated delivery ticket(s) + each one's Accountability
  // Report — the concrete "was the process followed?" answer (which roles signed off, with
  // what evidence, where it was skipped/waived).
  router.get('/:id/implicated', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const implicated = await new IncidentService(db).listImplicatedTasks(c.env as Env, tenantId, c.req.param('id'));
    return c.json({ implicated });
  });
  router.post('/:id/implicated', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as { taskId?: number; relation?: string; note?: string };
    if (typeof b.taskId !== 'number') return c.json({ error: 'taskId is required' }, 400);
    await new IncidentService(db).linkImplicatedTask(tenantId, c.req.param('id'), { taskId: b.taskId, relation: b.relation, note: b.note, createdBy: (c.get('userId') as string | undefined) ?? null });
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.delete('/:id/implicated/:taskId', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    await new IncidentService(db).unlinkImplicatedTask(tenantId, c.req.param('id'), Number(c.req.param('taskId')));
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.patch('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as { severity?: IncidentSeverity; status?: IncidentStatus; impact?: string; rootCause?: string };
    await new IncidentService(db).updateIncident(tenantId, c.req.param('id'), { ...b, actorRef: `u:${c.get('userId') as string | undefined ?? 'system'}` });
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.post('/:id/classify', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as { system?: string };
    if (!b.system?.trim()) return c.json({ error: 'system is required' }, 400);
    await new IncidentService(db).classify(tenantId, c.req.param('id'), b.system, `u:${c.get('userId') as string | undefined ?? 'system'}`);
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.post('/:id/notes', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as { message?: string };
    if (!b.message?.trim()) return c.json({ error: 'message is required' }, 400);
    await new IncidentService(db).addEvent(tenantId, c.req.param('id'), { kind: 'note', actorRef: `u:${c.get('userId') as string | undefined ?? 'system'}`, message: b.message });
    return c.json({ ok: true }, 201);
  });
  router.post('/:id/page', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    await new EscalationService(db).pageInitial(c.env, tenantId, c.req.param('id'));
    await invalidate(c, tenantId);
    return c.json({ paged: true });
  });
  router.post('/:id/war-room', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const chatId = await new IncidentService(db).ensureWarRoom(tenantId, c.req.param('id'));
    await invalidate(c, tenantId);
    return c.json({ chatId });
  });
  router.post('/:id/postmortem', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = (await c.req.json().catch(() => ({}))) as {
      summary?: string; rootCause?: string; impact?: string; contributingFactors?: string; resolution?: string;
      whatWentWell?: string; whatWentWrong?: string; docType?: 'postmortem' | 'known_error';
      actionItems?: Array<{ title: string; detail?: string }>;
    };
    const res = await new IncidentService(db).publishPostmortem(tenantId, c.req.param('id'), {
      ...b, actorRef: `u:${c.get('userId') as string | undefined ?? 'system'}`,
    }, c.env);
    await invalidate(c, tenantId);
    return c.json(res, 201);
  });
  router.post('/:id/triage', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const detail = await new IncidentService(db).getIncident(tenantId, c.req.param('id'));
    if (!detail) return c.json({ error: 'Incident not found' }, 404);
    const dispatched = await dispatchIncidentTriage(c.env, db, { tenantId, incidentId: c.req.param('id'), boardTaskId: detail.incident.boardTaskId ?? null });
    return c.json({ dispatched });
  });

  // ── Incident × custom workflows (runbooks) ───────────────────────────────────
  // Workflow runs this incident spawned — via an event trigger (incident-created /
  // status-change / monitor-breach) or a manual runbook launched below. Not cached:
  // run `status` mutates continuously as the run progresses, so a cached list would
  // serve stale states; the query is a single indexed lookup bounded to 50 rows.
  router.get('/:id/workflow-runs', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db.select({
      id: workflows.id,
      description: workflows.description,
      status: workflows.status,
      runtime: workflows.runtime,
      createdAt: workflows.createdAt,
      completedAt: workflows.completedAt,
      definitionId: workflows.workflowDefinitionId,
      definitionName: workflowDefinitions.name,
    })
      .from(workflows)
      .leftJoin(workflowDefinitions, eq(workflows.workflowDefinitionId, workflowDefinitions.id))
      .where(and(eq(workflows.tenantId, tenantId), eq(workflows.sourceIncidentId, c.req.param('id'))))
      .orderBy(desc(workflows.createdAt))
      .limit(50);
    return c.json({ runs: rows });
  });

  // Launch a workflow as a runbook against this incident: instantiate a run of the
  // chosen definition on its stored target (or a per-request override), carrying the
  // incident as the trigger payload and stamping source_incident_id for the list above.
  router.post('/:id/run-workflow', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const incidentId = c.req.param('id');
    const b = (await c.req.json().catch(() => ({}))) as { definitionId?: string; runtime?: string; agentHostId?: number; cloudAgentRef?: string };
    if (!b.definitionId) return c.json({ error: 'definitionId is required' }, 400);

    const detail = await new IncidentService(db).getIncident(tenantId, incidentId);
    if (!detail) return c.json({ error: 'Incident not found' }, 404);
    const [defRow] = await db.select().from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, b.definitionId), eq(workflowDefinitions.tenantId, tenantId)));
    if (!defRow) return c.json({ error: 'Workflow definition not found' }, 404);

    // Request target wins; else fall back to the definition's saved target.
    let target: RunTarget;
    if (b.runtime === 'cloud') target = { runtime: 'cloud', cloudAgentRef: b.cloudAgentRef ?? defRow.runTargetCloudAgentRef };
    else if (b.runtime === 'host' || b.agentHostId) target = { runtime: 'host', agentHostId: b.agentHostId ?? defRow.runTargetAgentHostId };
    else target = runTargetFromDefinition(defRow);

    const inc = detail.incident;
    const result = await instantiateWorkflowRun(db, {
      tenantId,
      segmentId: c.get('segmentId') ?? null,
      definition: parseDefinition(defRow.definition),
      name: defRow.name,
      projectId: defRow.projectId,
      definitionId: defRow.id,
      target,
      triggerSource: 'incident:runbook',
      triggerPayload: { incidentId, title: inc.title, severity: inc.severity, status: inc.status, affectedSystem: inc.affectedSystem, source: inc.source },
      sourceIncidentId: incidentId,
    });
    if (!result.ok) return c.json({ error: result.error }, 400);

    await new IncidentService(db).addEvent(tenantId, incidentId, {
      kind: 'note', actorRef: `u:${c.get('userId') as string | undefined ?? 'system'}`,
      message: `Ran workflow "${defRow.name}" as a runbook`,
    });
    await invalidate(c, tenantId);
    return c.json({ workflowId: result.workflowId, taskCount: result.taskCount }, 201);
  });

  return router;
}
