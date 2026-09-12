import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
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
 *   GET    /:id/whys               the stored 5-Why ladder                     (MEMBER+)
 *   PUT    /:id/whys               replace the whole 5-Why ladder              (MANAGER+)
 *   GET    /:id/dependency-graph   derived RCA topology {nodes, edges}         (MEMBER+)
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
import { incidentVersionKey, monitoringVersionKey } from '../../application/insights/versionKeys';
import { IncidentService, incidentRoomKey, type IncidentSeverity, type IncidentStatus } from '../../application/incident/IncidentService';
import { CONVENTIONAL_WHY_STEPS, MAX_WHY_STEPS, PostmortemWhyService, type WhyStepInput } from '../../application/incident/PostmortemWhyService';
import { loadIncidentDependencyGraph } from '../../application/incident/incidentDependencyGraph';
import { relayToRoom } from './realtimeRelay';
import { prodIncidents } from '../../infrastructure/database/schema';
import { OnCallService, type RotationKind } from '../../application/incident/OnCallService';
import { EscalationService } from '../../application/incident/EscalationService';
import { dispatchIncidentTriage } from '../../application/incident/incidentDispatch';
import { instantiateWorkflowRun, runTargetFromDefinition, type RunTarget } from '../../application/workflow/instantiateRun';
import { parseDefinition } from '../../domain/workflowGraph';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { parseOptionalBody, z } from './requestBody';

// ── Request bodies ────────────────────────────────────────────────────────────
// Every field the handler answers its own "X is required" message for stays
// optional so that message still wins. Fields the services default with `??`
// accept null; NOT NULL columns written straight from a patch are optional only.

const zRotationKind = z.enum(['manual', 'daily', 'weekly']) satisfies z.ZodType<RotationKind>;
const zIncidentSeverity = z.enum(['sev1', 'sev2', 'sev3', 'sev4']) satisfies z.ZodType<IncidentSeverity>;
const zIncidentStatus = z.enum(['open', 'acknowledged', 'mitigated', 'resolved']) satisfies z.ZodType<IncidentStatus>;

const CreateRotationBody = z.object({
  name: z.string().optional(),
  description: z.string().nullish(),
  rotationKind: zRotationKind.nullish(),
  projectId: z.number().nullish(),
});
const UpdateRotationBody = z.object({
  name: z.string().optional(),
  description: z.string().nullish(),
  rotationKind: zRotationKind.optional(),
  active: z.boolean().optional(),
  currentIndex: z.number().optional(),
});
const AddRotationMemberBody = z.object({
  memberRef: z.string().optional(),
  displayName: z.string().nullish(),
  position: z.number().nullish(),
});
const CreatePolicyBody = z.object({
  name: z.string().optional(),
  description: z.string().nullish(),
  matchSeverity: z.string().nullish(),
  projectId: z.number().nullish(),
});
const AddLevelBody = z.object({
  level: z.number().nullish(),
  afterMinutes: z.number().nullish(),
  targetKind: z.string().nullish(),
  targetRef: z.string().nullish(),
  notifyTeams: z.boolean().nullish(),
  notifySlack: z.boolean().nullish(),
  notifyEmail: z.boolean().nullish(),
});
/** Create AND patch a contact; `name` is NOT NULL, the rest clear with null. */
const ContactBody = z.object({
  name: z.string().optional(),
  roleTitle: z.string().nullish(),
  company: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  teamsId: z.string().nullish(),
  notes: z.string().nullish(),
});
const OpenIncidentBody = z.object({
  title: z.string().optional(),
  description: z.string().nullish(),
  severity: zIncidentSeverity.nullish(),
  source: z.string().nullish(),
  affectedSystem: z.string().nullish(),
  projectId: z.number().nullish(),
  escalationPolicyId: z.string().nullish(),
  openWarRoom: z.boolean().nullish(),
  page: z.boolean().nullish(),
});
const ImplicatedTaskBody = z.object({
  taskId: z.number().optional(),
  relation: z.string().nullish(),
  note: z.string().nullish(),
});
const UpdateIncidentBody = z.object({
  severity: zIncidentSeverity.optional(),
  status: zIncidentStatus.optional(),
  impact: z.string().nullish(),
  rootCause: z.string().nullish(),
});
const ClassifyBody = z.object({ system: z.string().optional() });
const NoteBody = z.object({ message: z.string().optional() });
const PostmortemBody = z.object({
  summary: z.string().nullish(),
  rootCause: z.string().nullish(),
  impact: z.string().nullish(),
  contributingFactors: z.string().nullish(),
  resolution: z.string().nullish(),
  whatWentWell: z.string().nullish(),
  whatWentWrong: z.string().nullish(),
  docType: z.enum(['postmortem', 'known_error']).optional(),
  // The service drops items with a blank title, so a missing one is a dropped item.
  actionItems: z.array(z.object({
    title: z.string().nullish().transform((v) => v ?? ''),
    detail: z.string().nullish(),
  })).optional(),
});
/** One rung; `normaliseWhyChain` trims and drops blank statements itself. */
const WhyStepBody = z.object({
  statement: z.string().nullish().transform((v) => v ?? ''),
  isRoot: z.boolean().nullish().transform((v) => v ?? undefined),
}) satisfies z.ZodType<WhyStepInput>;
const WhysBody = z.object({ whys: z.array(WhyStepBody).optional() });
const RunWorkflowBody = z.object({
  definitionId: z.string().optional(),
  runtime: z.string().optional(),
  agentHostId: z.number().nullish(),
  cloudAgentRef: z.string().nullish(),
});

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
    const b = await parseOptionalBody(c, CreateRotationBody);
    if (!b.name?.trim()) return c.json({ error: 'name is required' }, 400);
    const row = await new OnCallService(db).createRotation(tenantId, { name: b.name, description: b.description ?? null, rotationKind: b.rotationKind ?? undefined, projectId: b.projectId ?? null });
    await invalidate(c, tenantId);
    return c.json({ rotation: row }, 201);
  });
  router.patch('/on-call/rotations/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = await parseOptionalBody(c, UpdateRotationBody);
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
    const b = await parseOptionalBody(c, AddRotationMemberBody);
    if (!b.memberRef?.trim()) return c.json({ error: 'memberRef is required' }, 400);
    const row = await new OnCallService(db).addMember(tenantId, c.req.param('id'), { memberRef: b.memberRef, displayName: b.displayName ?? null, position: b.position ?? undefined });
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
    const b = await parseOptionalBody(c, CreatePolicyBody);
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
    const b = await parseOptionalBody(c, AddLevelBody);
    if (b.afterMinutes == null) return c.json({ error: 'afterMinutes is required' }, 400);
    const row = await new EscalationService(db).addLevel(tenantId, c.req.param('id'), {
      level: b.level ?? undefined, afterMinutes: b.afterMinutes, targetKind: b.targetKind ?? undefined, targetRef: b.targetRef ?? null,
      notifyTeams: b.notifyTeams ?? undefined, notifySlack: b.notifySlack ?? undefined, notifyEmail: b.notifyEmail ?? undefined,
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
      db.select().from(businessContacts).where(eq(businessContacts.tenantId, tenantId)).orderBy(businessContacts.name).limit(LIST_ROW_CAP));
    return c.json({ contacts: data });
  });
  router.post('/contacts', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = await parseOptionalBody(c, ContactBody);
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
    const b = await parseOptionalBody(c, ContactBody);
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
    const b = await parseOptionalBody(c, OpenIncidentBody);
    if (!b.title?.trim()) return c.json({ error: 'title is required' }, 400);
    const svc = new IncidentService(db);
    const res = await svc.openIncident(tenantId, {
      title: b.title, description: b.description ?? null, severity: b.severity ?? undefined, source: b.source ?? 'manual',
      affectedSystem: b.affectedSystem ?? null, projectId: b.projectId ?? null, escalationPolicyId: b.escalationPolicyId ?? null,
      openWarRoom: b.openWarRoom === true, actorRef: `u:${c.get('userId') as string | undefined ?? 'system'}`,
    });
    if (b.page && res.created) await new EscalationService(db).pageInitial(c.env, tenantId, res.incidentId).catch((error) => {
      reportCaughtError(error, { source: "presentation/routes/incidentRoutes.ts", operation: "createIncidentRoutes" });
    });
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
    const b = await parseOptionalBody(c, ImplicatedTaskBody);
    if (typeof b.taskId !== 'number') return c.json({ error: 'taskId is required' }, 400);
    await new IncidentService(db).linkImplicatedTask(tenantId, c.req.param('id'), { taskId: b.taskId, relation: b.relation ?? undefined, note: b.note, createdBy: (c.get('userId') as string | undefined) ?? null });
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
    const b = await parseOptionalBody(c, UpdateIncidentBody);
    await new IncidentService(db).updateIncident(tenantId, c.req.param('id'), { ...b, actorRef: `u:${c.get('userId') as string | undefined ?? 'system'}` });
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.post('/:id/classify', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = await parseOptionalBody(c, ClassifyBody);
    if (!b.system?.trim()) return c.json({ error: 'system is required' }, 400);
    await new IncidentService(db).classify(tenantId, c.req.param('id'), b.system, `u:${c.get('userId') as string | undefined ?? 'system'}`);
    await invalidate(c, tenantId);
    return c.json({ ok: true });
  });
  router.post('/:id/notes', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = await parseOptionalBody(c, NoteBody);
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
    const incidentId = c.req.param('id');
    const chatId = await new IncidentService(db).ensureWarRoom(tenantId, incidentId);
    await invalidate(c, tenantId);
    // Both halves: the persisted Brain chat the transcript lives in, and the live
    // room to connect to. A war room that is only a feed is a place people post
    // into after the fact rather than one they are IN while it is happening.
    return c.json({ chatId, roomKey: incidentRoomKey(incidentId) });
  });

  /**
   * The live war room — presence and relayed frames over `CEREMONY_ROOM`, the same
   * transport standups and meetings use.
   *
   * Tenant-checked before the upgrade rather than trusting the id: an incident id
   * is a UUID, but "unguessable" is not an authorisation model, and the room key
   * is derived from it. A member of another workspace who learned an id would
   * otherwise be relayed straight into somebody else's outage call.
   */
  router.get('/:id/room/ws', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const incidentId = c.req.param('id');
    const [incident] = await db
      .select({ id: prodIncidents.id })
      .from(prodIncidents)
      .where(and(eq(prodIncidents.id, incidentId), eq(prodIncidents.tenantId, tenantId)))
      .limit(1);
    if (!incident) return c.json({ error: 'Incident not found' }, 404);
    return relayToRoom(c, (c.env as Env).CEREMONY_ROOM, incidentRoomKey(incidentId), {
      ref: `u:${(c.get('userId') as string | undefined) ?? 'anon'}`,
      kind: 'human',
    });
  });
  router.post('/:id/postmortem', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = await parseOptionalBody(c, PostmortemBody);
    const res = await new IncidentService(db).publishPostmortem(tenantId, c.req.param('id'), {
      ...b, actorRef: `u:${c.get('userId') as string | undefined ?? 'system'}`,
    }, c.env);
    await invalidate(c, tenantId);
    return c.json(res, 201);
  });
  // ── 5-Why ladder (migration 1072) ────────────────────────────────────────────
  // The ordered causal chain behind the RCA. Read is MEMBER+ like the timeline;
  // the write is MANAGER+ like every other RCA write on this router.
  router.get('/:id/whys', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const incidentId = c.req.param('id');
    const ver = await getCacheVersion(c.env, incidentVersionKey(tenantId));
    const whys = await getOrSetCached(c.env, `incidents:whys:${tenantId}:${incidentId}:v:${ver}`,
      () => new PostmortemWhyService(db).listChain(tenantId, incidentId));
    // The cap and the convention travel with the chain, so the capture UI reads
    // the numbers this service truncates at rather than mirroring them.
    return c.json({ whys, maxSteps: MAX_WHY_STEPS, conventionalSteps: CONVENTIONAL_WHY_STEPS });
  });
  // PUT, not POST: the ladder is replaced as a UNIT. A per-step endpoint would let a
  // client leave why₄ answering a why₃ that no longer exists, and would need a
  // renumbering pass after every delete — see PostmortemWhyService.
  router.put('/:id/whys', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const b = await parseOptionalBody(c, WhysBody);
    if (!Array.isArray(b.whys)) return c.json({ error: 'whys must be an array' }, 400);
    const userId = c.get('userId') as string | undefined;
    const whys = await new PostmortemWhyService(db).replaceChain(tenantId, c.req.param('id'), b.whys, {
      actorRef: `u:${userId ?? 'system'}`,
      createdBy: userId ?? null,
    });
    await invalidate(c, tenantId);
    return c.json({ whys });
  });

  /**
   * The derived RCA topology: implicated change → system → monitor → incident, with
   * the system's prior incidents hanging off it. Assembled from rows the platform
   * already holds (see incidentDependencyGraph) rather than anything typed into the
   * post-mortem, which is what makes it worth drawing at all.
   *
   * Folded on BOTH version tokens: it reads incidents and monitors, so a monitor
   * breach must age it out too — keyed on the incident token alone it would keep
   * serving a graph missing the monitor that just fired.
   */
  router.get('/:id/dependency-graph', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const incidentId = c.req.param('id');
    const [iv, mv] = await Promise.all([
      getCacheVersion(c.env, incidentVersionKey(tenantId)),
      getCacheVersion(c.env, monitoringVersionKey(tenantId)),
    ]);
    const graph = await getOrSetCached(c.env, `incidents:depgraph:${tenantId}:${incidentId}:v:${iv}:${mv}`,
      () => loadIncidentDependencyGraph(db, tenantId, incidentId));
    if (!graph) return c.json({ error: 'Incident not found' }, 404);
    return c.json(graph);
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
    const b = await parseOptionalBody(c, RunWorkflowBody);
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
