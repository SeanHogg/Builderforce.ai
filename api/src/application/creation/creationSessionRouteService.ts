/**
 * Creation Sessions — durable, tenant-owned canvas workspaces.
 *
 * The canvas persists placement/native content here while canonical resources
 * (projects, workflows, agents, sites, tasks, …) remain referenced by type/id.
 */
import { Hono, type Context } from 'hono';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { authMiddleware } from '../../presentation/middleware/authMiddleware';
import { scope } from '../../presentation/routes/segmentTrackerRoutes';
import {
  creationSessionConnections,
  creationSessionComments,
  brainChats,
  creationSessionEvents,
  creationSessionMembers,
  creationSessionObjects,
  creationSessionProjectLinks,
  creationSessionSnapshots,
  creationSessions,
  ceremonySessions,
  ideAgents,
  agents,
  tasks,
  workflows,
  workflowDefinitions,
  projects,
  tenantMembers,
  users,
} from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';
import { resolveChatAccess } from '../brain/chatAccess';

type SessionRole = 'viewer' | 'commenter' | 'editor' | 'runner' | 'owner';
const ROLE_RANK: Record<SessionRole, number> = { viewer: 0, commenter: 1, editor: 2, runner: 3, owner: 4 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GraphObjectInput = {
  id: string;
  kind: string;
  resourceType?: string | null;
  resourceId?: string | null;
  resourceRevision?: string | null;
  canvasData?: unknown;
  content?: unknown;
};
type GraphConnectionInput = {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  kind?: string;
  label?: string | null;
  metadata?: unknown;
};
type CreateSessionBody = { title?: string; description?: string; initialPrompt?: string; projectIds?: number[] };
type PatchSessionBody = { title?: string; description?: string | null; status?: string; preview?: unknown };
type SaveGraphBody = { objects?: GraphObjectInput[]; connections?: GraphConnectionInput[]; viewport?: unknown; expectedRevision?: number };
type InviteBody = { userId?: string; email?: string; role?: string };
type CommentBody = { body?: string; objectId?: string | null; parentCommentId?: string | null; mentions?: string[] };
type CanvasCommand = { type?: string; [key: string]: unknown };
type CommandsBody = { commands?: CanvasCommand[]; atomic?: boolean };
type PinBody = { pinned?: boolean };
type CheckpointBody = { label?: string };

function cleanTitle(raw: unknown, fallback = 'Untitled session'): string {
  const title = typeof raw === 'string' ? raw.trim() : '';
  return (title || fallback).slice(0, 255);
}

function cleanRole(raw: unknown): SessionRole | null {
  return typeof raw === 'string' && raw in ROLE_RANK ? raw as SessionRole : null;
}

function validGraph(objects: GraphObjectInput[], connections: GraphConnectionInput[]): string | null {
  if (objects.length > 1_000) return 'A session may contain at most 1,000 objects';
  if (connections.length > 4_000) return 'A session may contain at most 4,000 connections';
  const ids = new Set<string>();
  for (const object of objects) {
    if (!UUID_RE.test(object.id)) return `Invalid object id: ${object.id}`;
    if (!object.kind || object.kind.length > 48) return 'Object kind is required and must be at most 48 characters';
    if (ids.has(object.id)) return `Duplicate object id: ${object.id}`;
    ids.add(object.id);
  }
  for (const edge of connections) {
    if (!UUID_RE.test(edge.id)) return `Invalid connection id: ${edge.id}`;
    if (!ids.has(edge.sourceObjectId) || !ids.has(edge.targetObjectId)) return 'A connection references an object outside this session';
    if (edge.kind && edge.kind.length > 24) return 'Connection kind must be at most 24 characters';
  }
  return null;
}

export function createCreationSessionRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  async function membership(sessionId: string, tenantId: number, userId: string) {
    const [row] = await db
      .select({ session: creationSessions, role: creationSessionMembers.role })
      .from(creationSessions)
      .innerJoin(creationSessionMembers, and(
        eq(creationSessionMembers.sessionId, creationSessions.id),
        eq(creationSessionMembers.userId, userId),
      ))
      .where(and(eq(creationSessions.id, sessionId), eq(creationSessions.tenantId, tenantId)))
      .limit(1);
    return row ?? null;
  }

  async function requireSession(c: Context<HonoEnv>, minimum: SessionRole = 'viewer') {
    const sessionId = c.req.param('id') ?? '';
    if (!UUID_RE.test(sessionId)) return null;
    const access = await membership(sessionId, c.get('tenantId') as number, c.get('userId') as string);
    if (!access || ROLE_RANK[access.role as SessionRole] < ROLE_RANK[minimum]) return null;
    return access;
  }

  /**
   * A session permission never grants access to the resources placed inside it.
   * Validate every authoritative reference against the active tenant before a
   * graph replacement is committed. Canvas-native drafts have no resource ref.
   */
  async function validateResourceAccess(
    objects: GraphObjectInput[],
    tenantId: number,
    segmentId: string | null,
    userId: string,
  ): Promise<string | null> {
    if (!segmentId) return 'This session is missing its workspace segment';
    const refs = objects.filter((object) => object.resourceType && object.resourceId);
    const ids = (type: string) => [...new Set(refs.filter((object) => object.resourceType === type).map((object) => object.resourceId as string))];
    const numericIds = (type: string) => ids(type).map(Number).filter((id) => Number.isInteger(id) && id > 0);

    const projectIds = numericIds('project');
    if (projectIds.length !== ids('project').length) return 'A Project reference is invalid';
    if (projectIds.length) {
      const found = await db.select({ id: projects.id }).from(projects).where(and(
        eq(projects.tenantId, tenantId), eq(projects.segmentId, segmentId), inArray(projects.id, projectIds),
      ));
      if (found.length !== projectIds.length) return 'A Project is unavailable or belongs to another workspace';
    }

    const taskIds = numericIds('task');
    if (taskIds.length !== ids('task').length) return 'A Task reference is invalid';
    if (taskIds.length) {
      const found = await db.select({ id: tasks.id }).from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(projects.tenantId, tenantId), eq(tasks.segmentId, segmentId), inArray(tasks.id, taskIds)));
      if (found.length !== taskIds.length) return 'A Task is unavailable or belongs to another workspace';
    }

    const workflowIds = ids('workflow');
    if (workflowIds.length) {
      if (workflowIds.some((id) => !UUID_RE.test(id))) return 'A Workflow reference is invalid';
      const [definitions, executions] = await Promise.all([
        db.select({ id: workflowDefinitions.id }).from(workflowDefinitions).where(and(
          eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.segmentId, segmentId), inArray(workflowDefinitions.id, workflowIds),
        )),
        db.select({ id: workflows.id }).from(workflows).where(and(
          eq(workflows.tenantId, tenantId), eq(workflows.segmentId, segmentId), inArray(workflows.id, workflowIds),
        )),
      ]);
      if (new Set([...definitions, ...executions].map((row) => row.id)).size !== workflowIds.length) return 'A Workflow is unavailable or belongs to another workspace';
    }

    for (const chatId of ids('chat')) {
      const numeric = Number(chatId);
      if (!Number.isInteger(numeric) || !(await resolveChatAccess(db, { chatId: numeric, userId, tenantId }))) {
        return 'A Chat is unavailable or belongs to another workspace';
      }
    }

    const agentIds = ids('agent');
    if (agentIds.length) {
      const numeric = agentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
      const text = agentIds.filter((id) => !numeric.includes(Number(id)));
      const [legacy, workforce] = await Promise.all([
        numeric.length ? db.select({ id: agents.id }).from(agents).where(and(eq(agents.tenantId, tenantId), eq(agents.segmentId, segmentId), inArray(agents.id, numeric))) : Promise.resolve([]),
        text.length ? db.select({ id: ideAgents.id }).from(ideAgents).where(and(eq(ideAgents.tenantId, tenantId), inArray(ideAgents.id, text))) : Promise.resolve([]),
      ]);
      if (legacy.length + workforce.length !== agentIds.length) return 'An Agent is unavailable or belongs to another workspace';
    }

    const ceremonyIds = ids('ceremony');
    if (ceremonyIds.length) {
      if (ceremonyIds.some((id) => !UUID_RE.test(id))) return 'A ceremony reference is invalid';
      const found = await db.select({ id: ceremonySessions.id }).from(ceremonySessions).where(and(
        eq(ceremonySessions.tenantId, tenantId), eq(ceremonySessions.segmentId, segmentId), inArray(ceremonySessions.id, ceremonyIds),
      ));
      if (found.length !== ceremonyIds.length) return 'A ceremony is unavailable or belongs to another workspace';
    }

    const staffIds = ids('staff');
    if (staffIds.length) {
      const found = await db.select({ userId: tenantMembers.userId }).from(tenantMembers).where(and(
        eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.userId, staffIds),
      ));
      if (found.length !== staffIds.length) return 'A staff member is unavailable or belongs to another workspace';
    }
    return null;
  }

  router.get('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const status = c.req.query('status') === 'archived' ? 'archived' : 'active';
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 30)));
    const rows = await db
      .select({
        id: creationSessions.id,
        title: creationSessions.title,
        description: creationSessions.description,
        status: creationSessions.status,
        preview: creationSessions.preview,
        revision: creationSessions.canvasRevision,
        lastActivityAt: creationSessions.lastActivityAt,
        createdAt: creationSessions.createdAt,
        role: creationSessionMembers.role,
        pinned: creationSessionMembers.pinned,
        unread: sql<boolean>`${creationSessionMembers.lastSeenRevision} < ${creationSessions.canvasRevision}`,
        collaboratorCount: sql<number>`(SELECT COUNT(*)::int FROM creation_session_members member_count WHERE member_count.session_id = ${creationSessions.id})`,
        projectIds: sql<number[]>`COALESCE((SELECT array_agg(project_id ORDER BY project_id) FROM creation_session_project_links project_link WHERE project_link.session_id = ${creationSessions.id}), ARRAY[]::integer[])`,
      })
      .from(creationSessions)
      .innerJoin(creationSessionMembers, and(
        eq(creationSessionMembers.sessionId, creationSessions.id),
        eq(creationSessionMembers.userId, userId),
      ))
      .where(and(
        eq(creationSessions.tenantId, tenantId),
        eq(creationSessions.segmentId, segmentId),
        eq(creationSessions.status, status),
      ))
      .orderBy(desc(creationSessions.lastActivityAt))
      .limit(limit);
    return c.json({ sessions: rows });
  });

  router.post('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const body = await c.req.json<CreateSessionBody>().catch(() => ({} as CreateSessionBody));
    const sessionId = crypto.randomUUID();
    const projectIds = [...new Set((body.projectIds ?? []).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 20);
    const validProjects = projectIds.length
      ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.tenantId, tenantId), inArray(projects.id, projectIds)))
      : [];
    if (validProjects.length !== projectIds.length) return c.json({ error: 'One or more projects were not found' }, 404);

    const initialPrompt = typeof body.initialPrompt === 'string' ? body.initialPrompt.trim().slice(0, 20_000) : '';
    const objectRows: Array<typeof creationSessionObjects.$inferInsert> = [];
    const connectionRows: Array<typeof creationSessionConnections.$inferInsert> = [];
    validProjects.forEach((project, index) => objectRows.push({
      id: crypto.randomUUID(), sessionId, kind: 'project', resourceType: 'project', resourceId: String(project.id),
      canvasData: { x: 120 + index * 360, y: 100, w: 300, h: 220 }, content: { title: project.name }, createdBy: userId, updatedBy: userId,
    }));
    if (initialPrompt) {
      const chatObjectId = crypto.randomUUID();
      objectRows.push({
      id: chatObjectId, sessionId, kind: 'chat', resourceType: null, resourceId: null,
      canvasData: { x: 120, y: validProjects.length ? 380 : 100, w: 320, h: 300 },
      content: { kind: 'chat', title: 'Brain', subtitle: initialPrompt, messages: [{ role: 'user', content: initialPrompt, createdAt: new Date().toISOString() }] },
      createdBy: userId, updatedBy: userId,
      });
      const lower = initialPrompt.toLowerCase();
      const addIntent = (kind: string, title: string, x: number, y: number) => {
        const id = crypto.randomUUID();
        objectRows.push({ id, sessionId, kind, canvasData: { x, y, w: 360, h: 260 }, content: { kind, title, status: 'AI draft', subtitle: `Created from: ${initialPrompt}` }, createdBy: userId, updatedBy: userId });
        connectionRows.push({ id: crypto.randomUUID(), sessionId, sourceObjectId: chatObjectId, targetObjectId: id, kind: 'creates', label: 'creates', createdBy: userId });
        return id;
      };
      const title = cleanTitle(body.title, initialPrompt.slice(0, 80));
      if (/website|landing page|web app|prototype/.test(lower)) addIntent('website', title, 570, 80);
      if (/workflow|campaign|automation|process/.test(lower)) addIntent('workflow', `${title} workflow`, 570, 390);
      if (/data|dataset|csv|spreadsheet|report|dashboard|chart/.test(lower)) {
        const datasetId = addIntent('dataset', 'Imported data', 570, 120);
        const dashboardId = crypto.randomUUID();
        objectRows.push({ id: dashboardId, sessionId, kind: 'dashboard', canvasData: { x: 1050, y: 120, w: 360, h: 260 }, content: { kind: 'dashboard', title: `${title} dashboard`, status: 'AI draft' }, createdBy: userId, updatedBy: userId });
        connectionRows.push({ id: crypto.randomUUID(), sessionId, sourceObjectId: datasetId, targetObjectId: dashboardId, kind: 'visualizes', label: 'visualizes', createdBy: userId });
      }
    }

    await db.insert(creationSessions).values({
      id: sessionId, tenantId, segmentId, title: cleanTitle(body.title, initialPrompt ? initialPrompt.slice(0, 80) : 'Untitled session'),
      description: typeof body.description === 'string' ? body.description.slice(0, 2_000) : null,
      createdBy: userId, updatedBy: userId, canvasRevision: 1,
    });
    try {
      await db.insert(creationSessionMembers).values({ sessionId, userId, role: 'owner', invitedBy: userId });
      if (objectRows.length) await db.insert(creationSessionObjects).values(objectRows);
      if (connectionRows.length) await db.insert(creationSessionConnections).values(connectionRows);
      if (validProjects.length) await db.insert(creationSessionProjectLinks).values(validProjects.map((project) => ({ sessionId, projectId: project.id, addedBy: userId })));
      await db.insert(creationSessionEvents).values({
        sessionId, revision: 1, actorType: 'user', actorRef: userId, eventType: 'session.created',
        payload: { initialPrompt: !!initialPrompt, projectIds: validProjects.map((project) => project.id) },
        idempotencyKey: c.req.header('Idempotency-Key')?.slice(0, 128) || null,
      });
      await db.insert(creationSessionSnapshots).values({
        sessionId, revision: 1,
        graph: {
          objects: objectRows.map((object) => ({ id: object.id, kind: object.kind, resourceType: object.resourceType, resourceId: object.resourceId, canvasData: object.canvasData, content: object.content })),
          connections: connectionRows.map((edge) => ({ id: edge.id, sourceObjectId: edge.sourceObjectId, targetObjectId: edge.targetObjectId, kind: edge.kind, label: edge.label, metadata: edge.metadata })),
        },
        viewport: { x: 0, y: 0, zoom: 1 }, createdBy: userId,
      });
    } catch (error) {
      await db.delete(creationSessions).where(and(eq(creationSessions.id, sessionId), eq(creationSessions.tenantId, tenantId))).catch(() => undefined);
      throw error;
    }
    return c.json({ session: { id: sessionId, title: cleanTitle(body.title, initialPrompt ? initialPrompt.slice(0, 80) : 'Untitled session'), revision: 1 } }, 201);
  });

  router.get('/:id', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const [objects, connections, projectLinks, members] = await Promise.all([
      db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, access.session.id)),
      db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, access.session.id)),
      db.select({ projectId: creationSessionProjectLinks.projectId }).from(creationSessionProjectLinks).where(eq(creationSessionProjectLinks.sessionId, access.session.id)),
      db.select({ userId: creationSessionMembers.userId, role: creationSessionMembers.role, displayName: users.displayName, lastSeenAt: creationSessionMembers.lastSeenAt, viewport: creationSessionMembers.viewport, cursor: creationSessionMembers.cursor, selection: creationSessionMembers.selection, typing: creationSessionMembers.typing })
        .from(creationSessionMembers).leftJoin(users, eq(users.id, creationSessionMembers.userId))
        .where(eq(creationSessionMembers.sessionId, access.session.id)),
    ]);
    const currentMember = members.find((member) => member.userId === c.get('userId'));
    return c.json({ session: access.session, role: access.role, currentUserId: c.get('userId'), objects, connections, projectIds: projectLinks.map((p) => p.projectId), members, personalViewport: currentMember?.viewport ?? access.session.viewport });
  });

  router.get('/:id/activity', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50)));
    const [events, comments] = await Promise.all([
      db.select({
        id: creationSessionEvents.id,
        type: creationSessionEvents.eventType,
        objectId: creationSessionEvents.objectId,
        payload: creationSessionEvents.payload,
        revision: creationSessionEvents.revision,
        actorRef: creationSessionEvents.actorRef,
        actorName: users.displayName,
        createdAt: creationSessionEvents.createdAt,
      }).from(creationSessionEvents)
        .leftJoin(users, eq(users.id, creationSessionEvents.actorRef))
        .where(eq(creationSessionEvents.sessionId, access.session.id))
        .orderBy(desc(creationSessionEvents.createdAt)).limit(limit),
      db.select({
        id: creationSessionComments.id,
        objectId: creationSessionComments.objectId,
        body: creationSessionComments.body,
        actorRef: creationSessionComments.createdBy,
        actorName: users.displayName,
        resolvedAt: creationSessionComments.resolvedAt,
        createdAt: creationSessionComments.createdAt,
      }).from(creationSessionComments)
        .leftJoin(users, eq(users.id, creationSessionComments.createdBy))
        .where(eq(creationSessionComments.sessionId, access.session.id))
        .orderBy(desc(creationSessionComments.createdAt)).limit(limit),
    ]);
    const activity = [
      ...events.map((event) => ({ ...event, kind: 'event' as const })),
      ...comments.map((comment) => ({ ...comment, kind: 'comment' as const, type: comment.resolvedAt ? 'comment.resolved' : 'comment.created' })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
    return c.json({ activity });
  });

  router.get('/:id/comments', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const objectId = c.req.query('objectId');
    if (objectId && !UUID_RE.test(objectId)) return c.json({ error: 'Invalid object id' }, 400);
    const where = objectId
      ? and(eq(creationSessionComments.sessionId, access.session.id), eq(creationSessionComments.objectId, objectId))
      : eq(creationSessionComments.sessionId, access.session.id);
    const comments = await db.select({
      id: creationSessionComments.id,
      objectId: creationSessionComments.objectId,
      parentCommentId: creationSessionComments.parentCommentId,
      body: creationSessionComments.body,
      mentions: creationSessionComments.mentions,
      createdBy: creationSessionComments.createdBy,
      authorName: users.displayName,
      resolvedAt: creationSessionComments.resolvedAt,
      resolvedBy: creationSessionComments.resolvedBy,
      createdAt: creationSessionComments.createdAt,
      updatedAt: creationSessionComments.updatedAt,
    }).from(creationSessionComments)
      .leftJoin(users, eq(users.id, creationSessionComments.createdBy))
      .where(where).orderBy(desc(creationSessionComments.createdAt)).limit(200);
    return c.json({ comments });
  });

  router.post('/:id/comments', async (c) => {
    const access = await requireSession(c, 'commenter');
    if (!access) return c.json({ error: 'Session not found or comments are not allowed' }, 404);
    const body = await c.req.json<CommentBody>().catch(() => ({} as CommentBody));
    const content = typeof body.body === 'string' ? body.body.trim() : '';
    if (!content || content.length > 5_000) return c.json({ error: 'Comment must be between 1 and 5,000 characters' }, 400);
    const objectId = body.objectId || null;
    if (objectId) {
      if (!UUID_RE.test(objectId)) return c.json({ error: 'Invalid object id' }, 400);
      const [object] = await db.select({ id: creationSessionObjects.id }).from(creationSessionObjects)
        .where(and(eq(creationSessionObjects.id, objectId), eq(creationSessionObjects.sessionId, access.session.id))).limit(1);
      if (!object) return c.json({ error: 'Object not found in this session' }, 404);
    }
    const parentCommentId = body.parentCommentId || null;
    if (parentCommentId) {
      if (!UUID_RE.test(parentCommentId)) return c.json({ error: 'Invalid parent comment id' }, 400);
      const [parent] = await db.select({ id: creationSessionComments.id }).from(creationSessionComments)
        .where(and(eq(creationSessionComments.id, parentCommentId), eq(creationSessionComments.sessionId, access.session.id))).limit(1);
      if (!parent) return c.json({ error: 'Parent comment not found' }, 404);
    }
    const requestedMentions = [...new Set((body.mentions ?? []).filter((id) => typeof id === 'string' && id.length <= 36))].slice(0, 20);
    const memberMentions = requestedMentions.length
      ? await db.select({ userId: creationSessionMembers.userId }).from(creationSessionMembers)
        .where(and(eq(creationSessionMembers.sessionId, access.session.id), inArray(creationSessionMembers.userId, requestedMentions)))
      : [];
    const userId = c.get('userId') as string;
    const [created] = await db.insert(creationSessionComments).values({
      sessionId: access.session.id, objectId, parentCommentId, body: content,
      mentions: memberMentions.map((member) => member.userId), createdBy: userId,
    }).returning();
    await db.update(creationSessions).set({ lastActivityAt: new Date(), updatedAt: new Date(), updatedBy: userId })
      .where(and(eq(creationSessions.id, access.session.id), eq(creationSessions.tenantId, access.session.tenantId)));
    return c.json(created, 201);
  });

  router.patch('/:id/comments/:commentId', async (c) => {
    const access = await requireSession(c, 'commenter');
    if (!access) return c.json({ error: 'Session not found or comments are not allowed' }, 404);
    const commentId = c.req.param('commentId');
    if (!UUID_RE.test(commentId)) return c.json({ error: 'Invalid comment id' }, 400);
    const body: { resolved?: boolean } = await c.req.json<{ resolved?: boolean }>().catch(() => ({}));
    if (typeof body.resolved !== 'boolean') return c.json({ error: 'resolved is required' }, 400);
    const userId = c.get('userId') as string;
    const [updated] = await db.update(creationSessionComments).set({
      resolvedAt: body.resolved ? new Date() : null,
      resolvedBy: body.resolved ? userId : null,
      updatedAt: new Date(),
    }).where(and(eq(creationSessionComments.id, commentId), eq(creationSessionComments.sessionId, access.session.id))).returning();
    if (!updated) return c.json({ error: 'Comment not found' }, 404);
    return c.json(updated);
  });

  router.patch('/:id', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or not editable' }, 404);
    const body = await c.req.json<PatchSessionBody>().catch(() => ({} as PatchSessionBody));
    const patch: Partial<typeof creationSessions.$inferInsert> = { updatedBy: c.get('userId') as string, updatedAt: new Date(), lastActivityAt: new Date() };
    if (body.title !== undefined) patch.title = cleanTitle(body.title);
    if (body.description !== undefined) patch.description = body.description == null ? null : String(body.description).slice(0, 2_000);
    if (body.status === 'active' || body.status === 'archived') {
      patch.status = body.status;
      patch.archivedAt = body.status === 'archived' ? new Date() : null;
    }
    if (body.preview !== undefined) patch.preview = body.preview;
    const [updated] = await db.update(creationSessions).set(patch).where(and(
      eq(creationSessions.id, access.session.id),
      eq(creationSessions.tenantId, access.session.tenantId),
    )).returning();
    return c.json(updated);
  });

  router.post('/:id/pin', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const body = await c.req.json<PinBody>().catch(() => ({} as PinBody));
    if (typeof body.pinned !== 'boolean') return c.json({ error: 'pinned is required' }, 400);
    await db.update(creationSessionMembers).set({ pinned: body.pinned }).where(and(
      eq(creationSessionMembers.sessionId, access.session.id), eq(creationSessionMembers.userId, c.get('userId') as string),
    ));
    return c.json({ pinned: body.pinned });
  });

  router.post('/:id/duplicate', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const [objects, connections] = await Promise.all([
      db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, access.session.id)),
      db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, access.session.id)),
    ]);
    const sessionId = crypto.randomUUID();
    const idMap = new Map(objects.map((object) => [object.id, crypto.randomUUID()]));
    const copiedObjects = objects.map((object) => ({
      ...object, id: idMap.get(object.id)!, sessionId, createdBy: userId, updatedBy: userId, createdAt: undefined, updatedAt: undefined,
    }));
    const copiedConnections = connections.map((edge) => ({
      ...edge, id: crypto.randomUUID(), sessionId, sourceObjectId: idMap.get(edge.sourceObjectId)!, targetObjectId: idMap.get(edge.targetObjectId)!, createdBy: userId, createdAt: undefined,
    }));
    const graph = {
      objects: copiedObjects.map(({ id, kind, resourceType, resourceId, resourceRevision, canvasData, content }) => ({ id, kind, resourceType, resourceId, resourceRevision, canvasData, content })),
      connections: copiedConnections.map(({ id, sourceObjectId, targetObjectId, kind, label, metadata }) => ({ id, sourceObjectId, targetObjectId, kind, label, metadata })),
    };
    const statements: unknown[] = [
      db.insert(creationSessions).values({ id: sessionId, tenantId, segmentId, title: cleanTitle(`Copy of ${access.session.title}`), description: access.session.description, preview: buildPreview(graph.objects), createdBy: userId, updatedBy: userId, canvasRevision: 1 }),
      db.insert(creationSessionMembers).values({ sessionId, userId, role: 'owner', invitedBy: userId }),
      db.insert(creationSessionEvents).values({ sessionId, revision: 1, actorType: 'user', actorRef: userId, eventType: 'session.duplicated', payload: { sourceSessionId: access.session.id } }),
      db.insert(creationSessionSnapshots).values({ sessionId, revision: 1, graph, viewport: access.session.viewport, createdBy: userId }),
    ];
    if (copiedObjects.length) statements.push(db.insert(creationSessionObjects).values(copiedObjects.map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...object }) => object)));
    if (copiedConnections.length) statements.push(db.insert(creationSessionConnections).values(copiedConnections.map(({ createdAt: _createdAt, ...edge }) => edge)));
    const projectLinks = await db.select({ projectId: creationSessionProjectLinks.projectId }).from(creationSessionProjectLinks).where(eq(creationSessionProjectLinks.sessionId, access.session.id));
    if (projectLinks.length) statements.push(db.insert(creationSessionProjectLinks).values(projectLinks.map(({ projectId }) => ({ sessionId, projectId, addedBy: userId }))));
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    return c.json({ session: { id: sessionId, title: cleanTitle(`Copy of ${access.session.title}`), revision: 1 } }, 201);
  });

  router.put('/:id/graph', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or not editable' }, 404);
    const body = await c.req.json<SaveGraphBody>().catch(() => ({} as SaveGraphBody));
    const objects = Array.isArray(body.objects) ? body.objects : [];
    const connections = Array.isArray(body.connections) ? body.connections : [];
    const error = validGraph(objects, connections);
    if (error) return c.json({ error }, 400);
    const resourceError = await validateResourceAccess(objects, access.session.tenantId, access.session.segmentId, c.get('userId') as string);
    if (resourceError) return c.json({ error: resourceError, code: 'RESOURCE_ACCESS_DENIED' }, 403);
    if (body.expectedRevision != null && body.expectedRevision !== access.session.canvasRevision) {
      return c.json({ error: 'Session changed', code: 'REVISION_CONFLICT', revision: access.session.canvasRevision }, 409);
    }
    const userId = c.get('userId') as string;
    const nextRevision = access.session.canvasRevision + 1;
    // D1 batch is atomic: replacement graph + revision/event commit together, so
    // a failed insert cannot leave the session empty after the deletes.
    const statements: unknown[] = [
      db.delete(creationSessionConnections).where(eq(creationSessionConnections.sessionId, access.session.id)),
      db.delete(creationSessionObjects).where(eq(creationSessionObjects.sessionId, access.session.id)),
    ];
    if (objects.length) statements.push(db.insert(creationSessionObjects).values(objects.map((object) => ({
      id: object.id, sessionId: access.session.id, kind: object.kind.slice(0, 48),
      resourceType: object.resourceType?.slice(0, 64) || null, resourceId: object.resourceId?.slice(0, 128) || null,
      resourceRevision: object.resourceRevision?.slice(0, 128) || null, canvasData: object.canvasData ?? {}, content: object.content ?? null,
      createdBy: userId, updatedBy: userId,
    }))));
    if (connections.length) statements.push(db.insert(creationSessionConnections).values(connections.map((edge) => ({
      id: edge.id, sessionId: access.session.id, sourceObjectId: edge.sourceObjectId, targetObjectId: edge.targetObjectId,
      kind: (edge.kind || 'reference').slice(0, 24), label: edge.label?.slice(0, 255) || null, metadata: edge.metadata ?? null, createdBy: userId,
    }))));
    statements.push(
      db.update(creationSessions).set({
        canvasRevision: nextRevision, viewport: body.viewport ?? access.session.viewport, updatedBy: userId,
        updatedAt: new Date(), lastActivityAt: new Date(), preview: buildPreview(objects),
      }).where(and(
        eq(creationSessions.id, access.session.id),
        eq(creationSessions.tenantId, access.session.tenantId),
      )),
      db.insert(creationSessionEvents).values({
        sessionId: access.session.id, revision: nextRevision, actorType: 'user', actorRef: userId, eventType: 'canvas.saved',
        payload: { objectCount: objects.length, connectionCount: connections.length },
        idempotencyKey: c.req.header('Idempotency-Key')?.slice(0, 128) || null,
      }),
      db.insert(creationSessionSnapshots).values({
        sessionId: access.session.id, revision: nextRevision, graph: { objects, connections },
        viewport: body.viewport ?? access.session.viewport, createdBy: userId,
      }).onConflictDoNothing(),
    );
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    return c.json({ revision: nextRevision, savedAt: new Date().toISOString() });
  });

  router.post('/:id/commands', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or not editable' }, 404);
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim().slice(0, 128) || null;
    if (!idempotencyKey) return c.json({ error: 'Idempotency-Key is required' }, 400);
    const [prior] = await db.select({ payload: creationSessionEvents.payload }).from(creationSessionEvents).where(and(
      eq(creationSessionEvents.sessionId, access.session.id), eq(creationSessionEvents.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (prior) return c.json((prior.payload as { result?: unknown })?.result ?? { replayed: true });

    const match = Number(c.req.header('If-Match'));
    if (!Number.isInteger(match) || match !== access.session.canvasRevision) {
      return c.json({ error: 'Session changed', code: 'REVISION_CONFLICT', revision: access.session.canvasRevision }, 409);
    }
    const body = await c.req.json<CommandsBody>().catch(() => ({} as CommandsBody));
    const commands = Array.isArray(body.commands) ? body.commands.slice(0, 500) : [];
    if (!commands.length) return c.json({ error: 'At least one command is required' }, 400);

    const [storedObjects, storedConnections] = await Promise.all([
      db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, access.session.id)),
      db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, access.session.id)),
    ]);
    let objects: GraphObjectInput[] = storedObjects.map((object) => ({
      id: object.id, kind: object.kind, resourceType: object.resourceType, resourceId: object.resourceId,
      resourceRevision: object.resourceRevision, canvasData: object.canvasData, content: object.content,
    }));
    let connections: GraphConnectionInput[] = storedConnections.map((edge) => ({
      id: edge.id, sourceObjectId: edge.sourceObjectId, targetObjectId: edge.targetObjectId,
      kind: edge.kind, label: edge.label, metadata: edge.metadata,
    }));
    let personalViewport: unknown = null;
    const accepted: Array<{ index: number; type: string; id?: string; clientId?: string }> = [];
    const rejected: Array<{ index: number; error: string }> = [];
    const clientIds = new Map<string, string>();
    const reject = (index: number, error: string) => {
      rejected.push({ index, error });
      if (body.atomic !== false) throw new Error(error);
    };
    try {
      commands.forEach((command, index) => {
        const type = typeof command.type === 'string' ? command.type : '';
        if (type === 'graph.replace') {
          if (!Array.isArray(command.objects) || !Array.isArray(command.connections)) { reject(index, 'graph.replace requires objects and connections'); return; }
          objects = command.objects as GraphObjectInput[];
          connections = command.connections as GraphConnectionInput[];
          personalViewport = command.viewport ?? null;
          accepted.push({ index, type }); return;
        }
        if (type === 'object.add') {
          const kind = typeof command.kind === 'string' ? command.kind.slice(0, 48) : '';
          if (!kind) { reject(index, 'object.add requires kind'); return; }
          const id = typeof command.id === 'string' && UUID_RE.test(command.id) ? command.id : crypto.randomUUID();
          const clientId = typeof command.clientId === 'string' ? command.clientId.slice(0, 128) : undefined;
          if (objects.some((object) => object.id === id)) { reject(index, 'Object id already exists'); return; }
          const resourceRef = command.resourceRef && typeof command.resourceRef === 'object' ? command.resourceRef as { type?: unknown; id?: unknown } : null;
          objects.push({
            id, kind,
            resourceType: typeof resourceRef?.type === 'string' ? resourceRef.type : null,
            resourceId: typeof resourceRef?.id === 'string' || typeof resourceRef?.id === 'number' ? String(resourceRef.id) : null,
            canvasData: command.geometry && typeof command.geometry === 'object' ? command.geometry : {},
            content: command.content && typeof command.content === 'object' ? command.content : { kind, title: String(command.title || kind) },
          });
          if (clientId) clientIds.set(clientId, id);
          accepted.push({ index, type, id, clientId }); return;
        }
        if (type === 'object.update' || type === 'object.move') {
          const id = String(command.objectId || '');
          const object = objects.find((candidate) => candidate.id === id);
          if (!object) { reject(index, 'Object not found'); return; }
          if (type === 'object.move' && command.geometry && typeof command.geometry === 'object') object.canvasData = { ...(object.canvasData as object), ...(command.geometry as object) };
          if (type === 'object.update' && command.content && typeof command.content === 'object') object.content = { ...(object.content as object), ...(command.content as object) };
          accepted.push({ index, type, id }); return;
        }
        if (type === 'object.delete') {
          const id = String(command.objectId || '');
          if (!objects.some((object) => object.id === id)) { reject(index, 'Object not found'); return; }
          objects = objects.filter((object) => object.id !== id);
          connections = connections.filter((edge) => edge.sourceObjectId !== id && edge.targetObjectId !== id);
          accepted.push({ index, type, id }); return;
        }
        if (type === 'connection.add') {
          const resolveId = (value: unknown) => clientIds.get(String(value)) ?? String(value || '');
          const sourceObjectId = resolveId(command.sourceId);
          const targetObjectId = resolveId(command.targetId);
          if (!objects.some((object) => object.id === sourceObjectId) || !objects.some((object) => object.id === targetObjectId)) { reject(index, 'Connection endpoint not found'); return; }
          const id = typeof command.id === 'string' && UUID_RE.test(command.id) ? command.id : crypto.randomUUID();
          connections.push({ id, sourceObjectId, targetObjectId, kind: typeof command.kind === 'string' ? command.kind : 'reference', label: typeof command.label === 'string' ? command.label : null });
          accepted.push({ index, type, id }); return;
        }
        if (type === 'connection.delete') {
          const id = String(command.connectionId || '');
          if (!connections.some((edge) => edge.id === id)) { reject(index, 'Connection not found'); return; }
          connections = connections.filter((edge) => edge.id !== id);
          accepted.push({ index, type, id }); return;
        }
        if (type === 'viewport.set') {
          personalViewport = command.viewport;
          accepted.push({ index, type }); return;
        }
        reject(index, `Unsupported command: ${type || 'missing type'}`);
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Command batch rejected', rejected }, 400);
    }
    const graphError = validGraph(objects, connections);
    if (graphError) return c.json({ error: graphError, rejected }, 400);
    const resourceError = await validateResourceAccess(objects, access.session.tenantId, access.session.segmentId, c.get('userId') as string);
    if (resourceError) return c.json({ error: resourceError, code: 'RESOURCE_ACCESS_DENIED', rejected }, 403);
    const nextRevision = access.session.canvasRevision + 1;
    const userId = c.get('userId') as string;
    const result = { accepted, rejected, serverIds: Object.fromEntries(clientIds), revision: nextRevision, savedAt: new Date().toISOString() };
    const statements: unknown[] = [
      db.delete(creationSessionConnections).where(eq(creationSessionConnections.sessionId, access.session.id)),
      db.delete(creationSessionObjects).where(eq(creationSessionObjects.sessionId, access.session.id)),
    ];
    if (objects.length) statements.push(db.insert(creationSessionObjects).values(objects.map((object) => ({
      id: object.id, sessionId: access.session.id, kind: object.kind.slice(0, 48), resourceType: object.resourceType?.slice(0, 64) || null,
      resourceId: object.resourceId?.slice(0, 128) || null, resourceRevision: object.resourceRevision?.slice(0, 128) || null,
      canvasData: object.canvasData ?? {}, content: object.content ?? null, createdBy: userId, updatedBy: userId,
    }))));
    if (connections.length) statements.push(db.insert(creationSessionConnections).values(connections.map((edge) => ({
      id: edge.id, sessionId: access.session.id, sourceObjectId: edge.sourceObjectId, targetObjectId: edge.targetObjectId,
      kind: (edge.kind || 'reference').slice(0, 24), label: edge.label?.slice(0, 255) || null, metadata: edge.metadata ?? null, createdBy: userId,
    }))));
    statements.push(
      db.update(creationSessions).set({ canvasRevision: nextRevision, updatedBy: userId, updatedAt: new Date(), lastActivityAt: new Date(), preview: buildPreview(objects) }).where(and(eq(creationSessions.id, access.session.id), eq(creationSessions.tenantId, access.session.tenantId))),
      db.insert(creationSessionEvents).values({ sessionId: access.session.id, revision: nextRevision, actorType: 'user', actorRef: userId, eventType: 'canvas.commands_applied', payload: { commands, result }, idempotencyKey }),
      db.insert(creationSessionSnapshots).values({ sessionId: access.session.id, revision: nextRevision, graph: { objects, connections }, viewport: personalViewport ?? access.session.viewport, createdBy: userId }),
    );
    if (personalViewport) statements.push(db.update(creationSessionMembers).set({ viewport: personalViewport }).where(and(eq(creationSessionMembers.sessionId, access.session.id), eq(creationSessionMembers.userId, userId))));
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    return c.json(result);
  });

  router.get('/:id/history', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const snapshots = await db.select({ revision: creationSessionSnapshots.revision, label: creationSessionSnapshots.label, createdBy: creationSessionSnapshots.createdBy, createdAt: creationSessionSnapshots.createdAt })
      .from(creationSessionSnapshots).where(eq(creationSessionSnapshots.sessionId, access.session.id))
      .orderBy(desc(creationSessionSnapshots.revision)).limit(100);
    return c.json({ snapshots });
  });

  router.post('/:id/checkpoints', async (c) => {
    const access = await requireSession(c, 'editor');
    if (!access) return c.json({ error: 'Session not found or not editable' }, 404);
    const body = await c.req.json<CheckpointBody>().catch(() => ({} as CheckpointBody));
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) : '';
    if (!label) return c.json({ error: 'Checkpoint name is required' }, 400);
    const [objects, connections] = await Promise.all([
      db.select().from(creationSessionObjects).where(eq(creationSessionObjects.sessionId, access.session.id)),
      db.select().from(creationSessionConnections).where(eq(creationSessionConnections.sessionId, access.session.id)),
    ]);
    const graph = { objects, connections };
    await db.insert(creationSessionSnapshots).values({ sessionId: access.session.id, revision: access.session.canvasRevision, graph, viewport: access.session.viewport, label, createdBy: c.get('userId') as string })
      .onConflictDoUpdate({ target: [creationSessionSnapshots.sessionId, creationSessionSnapshots.revision], set: { label, graph, viewport: access.session.viewport } });
    return c.json({ revision: access.session.canvasRevision, label }, 201);
  });

  router.get('/:id/history/:revision', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const revision = Number(c.req.param('revision'));
    if (!Number.isInteger(revision) || revision < 0) return c.json({ error: 'Invalid revision' }, 400);
    const [snapshot] = await db.select().from(creationSessionSnapshots).where(and(eq(creationSessionSnapshots.sessionId, access.session.id), eq(creationSessionSnapshots.revision, revision))).limit(1);
    if (!snapshot) return c.json({ error: 'Snapshot not found' }, 404);
    return c.json(snapshot);
  });

  router.post('/:id/invite', async (c) => {
    const access = await requireSession(c, 'owner');
    if (!access) return c.json({ error: 'Session not found or not shareable' }, 404);
    const body = await c.req.json<InviteBody>().catch(() => ({} as InviteBody));
    const role = cleanRole(body.role ?? 'editor');
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if ((!body.userId && !email) || !role) return c.json({ error: 'A userId or email and role are required' }, 400);
    const tenantId = c.get('tenantId') as number;
    const [target] = await db.select({ id: users.id }).from(users)
      .innerJoin(tenantMembers, and(
        eq(tenantMembers.userId, users.id),
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.isActive, true),
      ))
      .where(or(body.userId ? eq(users.id, body.userId) : sql`false`, email ? eq(users.email, email) : sql`false`)).limit(1);
    if (!target) return c.json({ error: 'User not found' }, 404);
    await db.insert(creationSessionMembers).values({ sessionId: access.session.id, userId: target.id, role, invitedBy: c.get('userId') as string })
      .onConflictDoUpdate({ target: [creationSessionMembers.sessionId, creationSessionMembers.userId], set: { role } });
    return c.json({ userId: target.id, role }, 201);
  });

  router.post('/:id/presence', async (c) => {
    const access = await requireSession(c);
    if (!access) return c.json({ error: 'Session not found' }, 404);
    const body: { revision?: number; viewport?: unknown; cursor?: unknown; selection?: unknown; typing?: boolean } = await c.req.json<{ revision?: number; viewport?: unknown; cursor?: unknown; selection?: unknown; typing?: boolean }>().catch(() => ({}));
    const now = new Date();
    const revision = Number.isFinite(body.revision) ? Math.max(0, Math.floor(body.revision!)) : access.session.canvasRevision;
    const viewport = body.viewport && typeof body.viewport === 'object' ? body.viewport : access.session.viewport;
    const cursor = body.cursor && typeof body.cursor === 'object' ? body.cursor : null;
    const selection = Array.isArray(body.selection) ? body.selection.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)).slice(0, 100) : [];
    await db.update(creationSessionMembers).set({ lastSeenAt: now, lastSeenRevision: revision, viewport, cursor, selection, typing: body.typing === true }).where(and(
      eq(creationSessionMembers.sessionId, access.session.id),
      eq(creationSessionMembers.userId, c.get('userId') as string),
    ));
    const activeSince = new Date(now.getTime() - 60_000);
    const members = await db.select({
      userId: creationSessionMembers.userId,
      role: creationSessionMembers.role,
      displayName: users.displayName,
      lastSeenRevision: creationSessionMembers.lastSeenRevision,
      lastSeenAt: creationSessionMembers.lastSeenAt,
      viewport: creationSessionMembers.viewport,
      cursor: creationSessionMembers.cursor,
      selection: creationSessionMembers.selection,
      typing: creationSessionMembers.typing,
    }).from(creationSessionMembers)
      .leftJoin(users, eq(users.id, creationSessionMembers.userId))
      .where(and(eq(creationSessionMembers.sessionId, access.session.id), gte(creationSessionMembers.lastSeenAt, activeSince)));
    return c.json({ revision: access.session.canvasRevision, currentUserId: c.get('userId'), members });
  });

  router.post('/projects/:projectId/open', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const projectId = Number(c.req.param('projectId'));
    if (!Number.isInteger(projectId) || projectId <= 0) return c.json({ error: 'Invalid project id' }, 400);
    const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId))).limit(1);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const [existing] = await db.select({ id: creationSessions.id, objectId: creationSessionObjects.id })
      .from(creationSessionProjectLinks)
      .innerJoin(creationSessions, eq(creationSessions.id, creationSessionProjectLinks.sessionId))
      .innerJoin(creationSessionMembers, and(eq(creationSessionMembers.sessionId, creationSessions.id), eq(creationSessionMembers.userId, userId)))
      .innerJoin(creationSessionObjects, and(eq(creationSessionObjects.sessionId, creationSessions.id), eq(creationSessionObjects.resourceType, 'project'), eq(creationSessionObjects.resourceId, String(projectId))))
      .where(and(eq(creationSessionProjectLinks.projectId, projectId), eq(creationSessions.status, 'active')))
      .orderBy(desc(creationSessions.lastActivityAt)).limit(1);
    if (existing) return c.json({ sessionId: existing.id, objectId: existing.objectId, created: false });
    const sessionId = crypto.randomUUID();
    const objectId = crypto.randomUUID();
    await db.insert(creationSessions).values({ id: sessionId, tenantId, segmentId, title: project.name, createdBy: userId, updatedBy: userId, canvasRevision: 1 });
    await db.batch([
      db.insert(creationSessionMembers).values({ sessionId, userId, role: 'owner', invitedBy: userId }),
      db.insert(creationSessionObjects).values({ id: objectId, sessionId, kind: 'project', resourceType: 'project', resourceId: String(projectId), canvasData: { x: 160, y: 120, w: 320, h: 220 }, content: { title: project.name }, createdBy: userId, updatedBy: userId }),
      db.insert(creationSessionProjectLinks).values({ sessionId, projectId, addedBy: userId }),
      db.insert(creationSessionEvents).values({ sessionId, revision: 1, actorType: 'user', actorRef: userId, eventType: 'session.created_from_project', payload: { projectId } }),
      db.insert(creationSessionSnapshots).values({
        sessionId, revision: 1,
        graph: { objects: [{ id: objectId, kind: 'project', resourceType: 'project', resourceId: String(projectId), canvasData: { x: 160, y: 120, w: 320, h: 220 }, content: { kind: 'project', title: project.name } }], connections: [] },
        viewport: { x: 0, y: 0, zoom: 1 }, createdBy: userId,
      }),
    ]);
    return c.json({ sessionId, objectId, created: true }, 201);
  });

  router.post('/resources/:resourceType/:resourceId/open', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const userId = c.get('userId') as string;
    const resourceType = c.req.param('resourceType');
    const resourceId = c.req.param('resourceId');
    let title: string;
    let kind: 'chat' | 'workflow';
    let projectId: number | null = null;
    if (resourceType === 'chat') {
      const chatId = Number(resourceId);
      if (!Number.isInteger(chatId) || chatId <= 0) return c.json({ error: 'Invalid chat id' }, 400);
      const chat = await resolveChatAccess(db, {
        chatId, tenantId, userId,
        selectExtra: { title: brainChats.title, projectId: brainChats.projectId, segmentId: brainChats.segmentId },
      });
      if (!chat || (chat.segmentId != null && chat.segmentId !== segmentId)) return c.json({ error: 'Chat not found' }, 404);
      title = String(chat.title || 'Brain session');
      projectId = chat.projectId == null ? null : Number(chat.projectId);
      kind = 'chat';
    } else if (resourceType === 'workflow') {
      if (!UUID_RE.test(resourceId)) return c.json({ error: 'Invalid workflow id' }, 400);
      const [definition] = await db.select({ id: workflowDefinitions.id, name: workflowDefinitions.name, projectId: workflowDefinitions.projectId })
        .from(workflowDefinitions).where(and(
          eq(workflowDefinitions.id, resourceId), eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.segmentId, segmentId),
        )).limit(1);
      if (!definition) return c.json({ error: 'Workflow not found' }, 404);
      title = definition.name;
      projectId = definition.projectId;
      kind = 'workflow';
    } else {
      return c.json({ error: 'Unsupported resource type' }, 400);
    }

    const [existing] = await db.select({ sessionId: creationSessions.id, objectId: creationSessionObjects.id })
      .from(creationSessionObjects)
      .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
      .innerJoin(creationSessionMembers, and(eq(creationSessionMembers.sessionId, creationSessions.id), eq(creationSessionMembers.userId, userId)))
      .where(and(
        eq(creationSessions.tenantId, tenantId), eq(creationSessions.status, 'active'),
        eq(creationSessionObjects.resourceType, resourceType), eq(creationSessionObjects.resourceId, resourceId),
      )).orderBy(desc(creationSessions.lastActivityAt)).limit(1);
    if (existing) return c.json({ ...existing, created: false });

    const sessionId = crypto.randomUUID();
    const objectId = crypto.randomUUID();
    const statements: unknown[] = [
      db.insert(creationSessions).values({ id: sessionId, tenantId, segmentId, title, createdBy: userId, updatedBy: userId, canvasRevision: 1 }),
      db.insert(creationSessionMembers).values({ sessionId, userId, role: 'owner', invitedBy: userId }),
      db.insert(creationSessionObjects).values({
        id: objectId, sessionId, kind, resourceType, resourceId,
        canvasData: { x: 160, y: 120, w: kind === 'workflow' ? 460 : 320, h: 280 },
        content: { kind, title, status: 'Live resource' }, createdBy: userId, updatedBy: userId,
      }),
      db.insert(creationSessionEvents).values({
        sessionId, revision: 1, actorType: 'user', actorRef: userId, eventType: `session.created_from_${resourceType}`,
        objectId, payload: { resourceType, resourceId, projectId },
      }),
      db.insert(creationSessionSnapshots).values({
        sessionId, revision: 1,
        graph: { objects: [{ id: objectId, kind, resourceType, resourceId, canvasData: { x: 160, y: 120, w: kind === 'workflow' ? 460 : 320, h: 280 }, content: { kind, title, status: 'Live resource' } }], connections: [] },
        viewport: { x: 0, y: 0, zoom: 1 }, createdBy: userId,
      }),
    ];
    if (projectId) statements.push(db.insert(creationSessionProjectLinks).values({ sessionId, projectId, addedBy: userId }).onConflictDoNothing());
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    return c.json({ sessionId, objectId, created: true }, 201);
  });

  return router;
}

function buildPreview(objects: GraphObjectInput[]) {
  return {
    objectCount: objects.length,
    kinds: [...new Set(objects.map((object) => object.kind))].slice(0, 8),
    objects: objects.slice(0, 12).map((object) => ({
      id: object.id, kind: object.kind,
      x: Number((object.canvasData as { x?: number } | undefined)?.x ?? 0),
      y: Number((object.canvasData as { y?: number } | undefined)?.y ?? 0),
      title: String((object.content as { title?: string } | undefined)?.title ?? object.kind).slice(0, 80),
      status: String((object.content as { status?: string } | undefined)?.status ?? '').slice(0, 48) || undefined,
      resourceType: object.resourceType || undefined,
      resourceId: object.resourceId || undefined,
    })),
  };
}
