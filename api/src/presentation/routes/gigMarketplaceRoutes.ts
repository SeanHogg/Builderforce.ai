/**
 * Gig Marketplace — the "publish a work item, then let a hired worker actually work
 * it" surfaces (migration 0293). Three routers:
 *
 *   /api/marketplace/*       — one-click publish a TICKET as a hireable gig (server
 *                              derives title/description/requirements from the ticket
 *                              so the Brain can publish with just a ticketId), unpublish,
 *                              and the per-ticket posting lookup the board badges off.
 *   /api/engagement-board/*  — a hired freelancer's REAL scoped access into the engaged
 *                              project: list workspaces I'm hired into, read that
 *                              project's board, and signal a ticket for review. Gated by
 *                              EngagementAccessService (an ACTIVE engagement = the grant).
 *   /api/deliverables/*      — a hired worker "presents a proposal" against the scope;
 *                              the employer AI-evaluates it against the posting's
 *                              requirements and accepts / requests changes.
 *
 * Employer routes use the tenant JWT (authMiddleware); freelancer routes use the web
 * JWT (webAuthMiddleware) + the engagement grant. All data access goes through Drizzle
 * (`buildDatabase(c.env)`) — no raw neon client lives here.
 */
import { Hono } from 'hono';
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { notify } from '../../application/notifications/notify';
import { resolveTenantPlan } from './llmRoutes';
import { gatewayJudge } from '../../application/eval/gatewayJudge';
import { evaluateProposal, evalPercent } from '../../application/marketplace/proposalEval';
import { EngagementAccessService } from '../../application/marketplace/EngagementAccessService';
import { buildDatabase } from '../../infrastructure/database/connection';
import {
  deliverableProposals,
  freelancerEngagements,
  jobPostings,
  projects,
  proposalEvaluations,
  tasks,
  tenants,
  users,
} from '../../infrastructure/database/schema';
import type { EvalJudge } from '../../application/eval/semanticEval';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

const JOBS_PUBLIC_CACHE_KEY = 'jobs:public:open';
/** Tenant-scoped: the loader filters by tenant_id, so a key without the tenant lets
 *  tenant A's `null` result be served to tenant B (badge silently disappears) and
 *  vice-versa — cross-tenant cache poisoning on a globally-unique task id. */
const ticketPostingKey = (tenantId: number, taskId: number | string) =>
  `gig:ticket-posting:${tenantId}:${taskId}`;
const POSTING_TYPES = ['project_bid', 'design', 'fte'];
const ENGAGEMENT_TYPES = ['fixed_bid', 'hourly', 'fte'];

const mapPosting = (r: typeof jobPostings.$inferSelect) => ({
  id: r.id,
  title: r.title,
  description: r.description ?? null,
  requirements: r.requirements ?? null,
  postingType: r.postingType ?? 'project_bid',
  engagementType: r.engagementType ?? null,
  status: r.status,
  visibility: r.visibility ?? 'public',
  sourceTicketId: r.sourceTicketId == null ? null : Number(r.sourceTicketId),
  projectId: r.projectId == null ? null : Number(r.projectId),
  rateMinCents: r.rateMinCents == null ? null : Number(r.rateMinCents),
  rateMaxCents: r.rateMaxCents == null ? null : Number(r.rateMaxCents),
  createdAt: r.createdAt ?? null,
});

// ---------------------------------------------------------------------------
// /api/marketplace — publish a ticket as a gig
// ---------------------------------------------------------------------------
export function createGigMarketplaceRoutes(_db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // POST /publish — turn a work item into a hireable gig. The server derives the
  // scope from the ticket (title/description → requirements) so the Brain can publish
  // with just a ticketId; overrides may be supplied. Idempotent-ish: re-publishing a
  // ticket that already has an OPEN posting returns that posting.
  router.post('/publish', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const db = buildDatabase(c.env);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const ticketId = typeof b.ticketId === 'number' ? Math.round(b.ticketId) : Number(b.ticketId);
    if (!Number.isFinite(ticketId)) return c.json({ error: 'ticketId required' }, 400);

    // Load the ticket via its project so we can tenant-guard (tasks have no tenant_id).
    const [t] = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        taskType: tasks.taskType,
        projectId: tasks.projectId,
        jobPostingId: tasks.jobPostingId,
        tenantId: projects.tenantId,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(tasks.id, ticketId));
    if (!t || Number(t.tenantId) !== Number(tenantId)) return c.json({ error: 'Ticket not found' }, 404);

    // Already published to an open posting? Return it (don't duplicate).
    const [openExisting] = await db
      .select()
      .from(jobPostings)
      .where(and(
        eq(jobPostings.sourceTicketId, ticketId),
        eq(jobPostings.tenantId, tenantId),
        eq(jobPostings.status, 'open'),
      ))
      .limit(1);
    if (openExisting) return c.json({ jobId: openExisting.id, posting: mapPosting(openExisting), reused: true });

    const postingType = POSTING_TYPES.includes(b.postingType as string)
      ? (b.postingType as string)
      : (t.taskType === 'design' ? 'design' : 'project_bid');
    const engagementType = ENGAGEMENT_TYPES.includes(b.engagementType as string)
      ? (b.engagementType as string)
      : (postingType === 'fte' ? 'fte' : 'fixed_bid');
    const requirements = typeof b.requirements === 'string' && b.requirements.trim()
      ? b.requirements.slice(0, 8000)
      : (t.description ?? null);
    const discipline = typeof b.discipline === 'string' ? (b.discipline as string) : (t.taskType === 'design' ? 'designer' : null);
    const id = crypto.randomUUID();
    await db.insert(jobPostings).values({
      id,
      tenantId,
      projectId: t.projectId,
      title: t.title,
      description: t.description ?? null,
      discipline,
      rateMinCents: typeof b.rateMinCents === 'number' ? Math.round(b.rateMinCents) : null,
      rateMaxCents: typeof b.rateMaxCents === 'number' ? Math.round(b.rateMaxCents) : null,
      currency: typeof b.currency === 'string' ? (b.currency as string).slice(0, 3).toUpperCase() : 'USD',
      visibility: b.visibility === 'private' ? 'private' : 'public',
      postingType,
      engagementType,
      requirements,
      sourceTicketId: ticketId,
      createdByUserId: actor,
    });
    await db.update(tasks).set({ hireable: true, jobPostingId: id }).where(eq(tasks.id, ticketId));
    await Promise.all([
      invalidateCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY),
      invalidateCached(c.env as Env, ticketPostingKey(tenantId, ticketId)),
    ]);
    const [row] = await db.select().from(jobPostings).where(eq(jobPostings.id, id));
    return c.json({ jobId: id, posting: row ? mapPosting(row) : null }, 201);
  });

  // POST /unpublish — pull a ticket's gig from the marketplace.
  router.post('/unpublish', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const db = buildDatabase(c.env);
    const b = await c.req.json<{ ticketId?: number }>().catch((): { ticketId?: number } => ({}));
    const ticketId = typeof b.ticketId === 'number' ? Math.round(b.ticketId) : Number(b.ticketId);
    if (!Number.isFinite(ticketId)) return c.json({ error: 'ticketId required' }, 400);
    await db
      .update(jobPostings)
      .set({ status: 'closed', closedAt: sql`NOW()`, updatedAt: sql`NOW()` })
      .where(and(
        eq(jobPostings.sourceTicketId, ticketId),
        eq(jobPostings.tenantId, tenantId),
        eq(jobPostings.status, 'open'),
      ));
    // Tenant-scoped via the project (tasks carry no tenant_id — same guard shape the
    // publish handler uses). Without it, any authenticated tenant could clear
    // `hireable`/`job_posting_id` on ANOTHER tenant's ticket by guessing its id.
    await db.update(tasks)
      .set({ hireable: false, jobPostingId: null })
      .where(and(
        eq(tasks.id, ticketId),
        inArray(
          tasks.projectId,
          db.select({ id: projects.id }).from(projects).where(eq(projects.tenantId, tenantId)),
        ),
      ));
    await Promise.all([
      invalidateCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY),
      invalidateCached(c.env as Env, ticketPostingKey(tenantId, ticketId)),
    ]);
    return c.json({ ok: true });
  });

  // GET /ticket/:taskId/posting — the open posting for a ticket (board badge). Cached;
  // invalidated on publish/unpublish.
  router.get('/ticket/:taskId/posting', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const taskId = Number(c.req.param('taskId'));
    const posting = await getOrSetCached(c.env as Env, ticketPostingKey(tenantId, taskId), async () => {
      const db = buildDatabase(c.env);
      const [row] = await db
        .select()
        .from(jobPostings)
        .where(and(
          eq(jobPostings.sourceTicketId, taskId),
          eq(jobPostings.tenantId, tenantId),
          eq(jobPostings.status, 'open'),
        ))
        .limit(1);
      return row ? mapPosting(row) : null;
    });
    return c.json({ posting });
  });

  return router;
}

/** The exact ticket projection the engagement board reads (mirrors `mapTask`). */
const engagementTaskColumns = {
  id: tasks.id,
  key: tasks.key,
  title: tasks.title,
  description: tasks.description,
  status: tasks.status,
  priority: tasks.priority,
  taskType: tasks.taskType,
  assignedUserId: tasks.assignedUserId,
  assignedAgentRef: tasks.assignedAgentRef,
  dueDate: tasks.dueDate,
};

// ---------------------------------------------------------------------------
// /api/engagement-board — a hired freelancer's scoped access into the project
// ---------------------------------------------------------------------------
export function createEngagementBoardRoutes(accessDb: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const access = new EngagementAccessService(accessDb);

  // GET / — the workspaces/projects I'm actively hired into. Per-user + small; not
  // cached (cheap point lookup, and it must reflect a just-accepted hire immediately).
  router.get('/', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const grants = await access.activeForUser(userId);
    if (grants.length === 0) return c.json({ engagements: [] });
    const db = buildDatabase(c.env);
    const ids = grants.map((g) => g.engagementId);
    const rows = await db
      .select({
        id: freelancerEngagements.id,
        tenantId: freelancerEngagements.tenantId,
        projectId: freelancerEngagements.projectId,
        title: freelancerEngagements.title,
        accessScope: freelancerEngagements.accessScope,
        tenantName: tenants.name,
        projectName: projects.name,
        projectKey: projects.key,
      })
      .from(freelancerEngagements)
      .innerJoin(tenants, eq(tenants.id, freelancerEngagements.tenantId))
      .leftJoin(projects, eq(projects.id, freelancerEngagements.projectId))
      .where(inArray(freelancerEngagements.id, ids));
    return c.json({
      engagements: rows.map((r) => ({
        engagementId: r.id,
        tenantId: Number(r.tenantId),
        tenantName: r.tenantName ?? null,
        projectId: r.projectId == null ? null : Number(r.projectId),
        projectName: r.projectName ?? null,
        projectKey: r.projectKey ?? null,
        title: r.title ?? null,
        accessScope: r.accessScope ?? 'project',
      })),
    });
  });

  // GET /:engagementId/tasks — the engaged project's board (read).
  router.get('/:engagementId/tasks', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const grant = await access.getForUser(userId, c.req.param('engagementId'));
    if (!grant || grant.projectId == null) return c.json({ error: 'No access' }, 403);
    const db = buildDatabase(c.env);
    const rows = await db
      .select(engagementTaskColumns)
      .from(tasks)
      .where(and(eq(tasks.projectId, grant.projectId), eq(tasks.archived, false)))
      .orderBy(desc(tasks.updatedAt))
      .limit(200);
    return c.json({ tasks: rows.map(mapTask) });
  });

  // GET /:engagementId/tasks/:taskId — one ticket in the engaged project.
  router.get('/:engagementId/tasks/:taskId', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const grant = await access.getForUser(userId, c.req.param('engagementId'));
    if (!grant || grant.projectId == null) return c.json({ error: 'No access' }, 403);
    const db = buildDatabase(c.env);
    const [row] = await db
      .select(engagementTaskColumns)
      .from(tasks)
      .where(and(eq(tasks.id, Number(c.req.param('taskId'))), eq(tasks.projectId, grant.projectId)));
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ task: mapTask(row) });
  });

  // POST /:engagementId/tasks/:taskId/request-review — the worker signals "ready for
  // review" by moving the ticket to the In Review lane (mirrors the human drag).
  router.post('/:engagementId/tasks/:taskId/request-review', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const grant = await access.getForUser(userId, c.req.param('engagementId'));
    if (!grant || grant.projectId == null) return c.json({ error: 'No access' }, 403);
    if (!access.canWrite(grant)) return c.json({ error: 'Read-only access' }, 403);
    const db = buildDatabase(c.env);
    const taskId = Number(c.req.param('taskId'));
    const rows = await db
      .update(tasks)
      .set({ status: 'in_review', updatedAt: sql`NOW()` })
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, grant.projectId)))
      .returning({ id: tasks.id, title: tasks.title });
    const updated = rows[0];
    if (!updated) return c.json({ error: 'Not found' }, 404);
    // Notify the employer who created the engagement.
    const [eng] = await db
      .select({ createdByUserId: freelancerEngagements.createdByUserId })
      .from(freelancerEngagements)
      .where(eq(freelancerEngagements.id, grant.engagementId));
    if (eng?.createdByUserId) {
      await notify(db, c.env, {
        userId: eng.createdByUserId, tenantId: grant.tenantId, kind: 'review',
        title: `Review requested on "${updated.title}"`, ref: String(taskId),
      });
    }
    return c.json({ ok: true });
  });

  return router;
}

interface EngagementTaskRow {
  id: number;
  key: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  taskType: string;
  assignedUserId: string | null;
  assignedAgentRef: string | null;
  dueDate: Date | null;
}

const mapTask = (r: EngagementTaskRow) => ({
  id: Number(r.id),
  key: r.key,
  title: r.title,
  description: r.description ?? null,
  status: r.status,
  priority: r.priority,
  taskType: r.taskType,
  assignedUserId: r.assignedUserId ?? null,
  assignedAgentRef: r.assignedAgentRef ?? null,
  dueDate: r.dueDate ?? null,
});

// ---------------------------------------------------------------------------
// /api/deliverables — a hired worker presents a proposal; employer AI-evaluates it
// ---------------------------------------------------------------------------
export function createDeliverableRoutes(accessDb: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const access = new EngagementAccessService(accessDb);

  /** `deliverable_proposals.*` plus the joined author display name. */
  const deliverableColumns = {
    ...getTableColumns(deliverableProposals),
    authorName: users.displayName,
  };

  const mapDeliverable = (r: typeof deliverableProposals.$inferSelect & { authorName: string | null }) => ({
    id: r.id,
    engagementId: r.engagementId,
    ticketId: r.ticketId == null ? null : Number(r.ticketId),
    jobId: r.jobId ?? null,
    authorUserId: r.authorUserId,
    authorName: r.authorName ?? null,
    title: r.title,
    body: r.body ?? null,
    status: r.status,
    lastEvalOverall: r.lastEvalOverall == null ? null : Number(r.lastEvalOverall),
    createdAt: r.createdAt ?? null,
  });

  // POST / — worker submits a deliverable proposal against the engaged scope.
  router.post('/', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const b = await c.req.json<{ engagementId?: string; title?: string; body?: string; ticketId?: number }>()
      .catch((): { engagementId?: string; title?: string; body?: string; ticketId?: number } => ({}));
    const engagementId = String(b.engagementId ?? '');
    const grant = await access.getForUser(userId, engagementId);
    if (!grant) return c.json({ error: 'No access' }, 403);
    const title = (b.title ?? '').trim().slice(0, 200);
    if (!title) return c.json({ error: 'title required' }, 400);
    const db = buildDatabase(c.env);
    // Link the engaged project's open posting when there is one (for eval grounding).
    const [posting] = grant.projectId != null
      ? await db
          .select({ id: jobPostings.id })
          .from(jobPostings)
          .where(and(
            eq(jobPostings.projectId, grant.projectId),
            eq(jobPostings.tenantId, grant.tenantId),
            inArray(jobPostings.status, ['open', 'filled']),
          ))
          .orderBy(desc(jobPostings.createdAt))
          .limit(1)
      : [undefined];
    const id = crypto.randomUUID();
    await db.insert(deliverableProposals).values({
      id,
      tenantId: grant.tenantId,
      engagementId,
      ticketId: typeof b.ticketId === 'number' ? Math.round(b.ticketId) : null,
      jobId: posting?.id ?? null,
      authorUserId: userId,
      title,
      body: typeof b.body === 'string' ? b.body.slice(0, 20000) : null,
      status: 'submitted',
    });
    const [eng] = await db
      .select({ createdByUserId: freelancerEngagements.createdByUserId })
      .from(freelancerEngagements)
      .where(eq(freelancerEngagements.id, engagementId));
    const [me] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId));
    if (eng?.createdByUserId) {
      await notify(db, c.env, {
        userId: eng.createdByUserId, tenantId: grant.tenantId, kind: 'proposal',
        title: `${me?.displayName ?? 'A freelancer'} presented a proposal: "${title}"`, ref: id,
      });
    }
    return c.json({ id }, 201);
  });

  // GET /mine?engagementId= — the worker's own deliverables.
  router.get('/mine', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const engagementId = c.req.query('engagementId');
    const db = buildDatabase(c.env);
    const rows = await db
      .select(deliverableColumns)
      .from(deliverableProposals)
      .innerJoin(users, eq(users.id, deliverableProposals.authorUserId))
      .where(engagementId
        ? and(
            eq(deliverableProposals.authorUserId, userId),
            eq(deliverableProposals.engagementId, engagementId),
          )
        : eq(deliverableProposals.authorUserId, userId))
      .orderBy(desc(deliverableProposals.createdAt))
      .limit(200);
    return c.json(rows.map(mapDeliverable));
  });

  // GET /for-job/:jobId — employer views deliverables tied to their posting.
  router.get('/for-job/:jobId', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const jobId = c.req.param('jobId');
    const db = buildDatabase(c.env);
    const rows = await db
      .select(deliverableColumns)
      .from(deliverableProposals)
      .innerJoin(users, eq(users.id, deliverableProposals.authorUserId))
      .where(and(eq(deliverableProposals.jobId, jobId), eq(deliverableProposals.tenantId, tenantId)))
      .orderBy(desc(deliverableProposals.createdAt))
      .limit(200);
    return c.json(rows.map(mapDeliverable));
  });

  // GET /for-engagement/:engagementId — employer views an engagement's deliverables.
  router.get('/for-engagement/:engagementId', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const engagementId = c.req.param('engagementId');
    const db = buildDatabase(c.env);
    const rows = await db
      .select(deliverableColumns)
      .from(deliverableProposals)
      .innerJoin(users, eq(users.id, deliverableProposals.authorUserId))
      .where(and(
        eq(deliverableProposals.engagementId, engagementId),
        eq(deliverableProposals.tenantId, tenantId),
      ))
      .orderBy(desc(deliverableProposals.createdAt))
      .limit(200);
    return c.json(rows.map(mapDeliverable));
  });

  // POST /:id/evaluate — employer AI-scores the deliverable against the posting's
  // requirements (same LLM-as-judge as bid evaluation).
  router.post('/:id/evaluate', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const id = c.req.param('id');
    const db = buildDatabase(c.env);
    const [d] = await db
      .select({
        id: deliverableProposals.id,
        body: deliverableProposals.body,
        jobId: deliverableProposals.jobId,
        ticketId: deliverableProposals.ticketId,
        tenantId: deliverableProposals.tenantId,
        requirements: jobPostings.requirements,
        jobDescription: jobPostings.description,
      })
      .from(deliverableProposals)
      .leftJoin(jobPostings, eq(jobPostings.id, deliverableProposals.jobId))
      .where(eq(deliverableProposals.id, id));
    if (!d || Number(d.tenantId) !== Number(tenantId)) return c.json({ error: 'Not found' }, 404);
    // Requirements: prefer the linked posting; else the linked ticket's description.
    let requirements = d.requirements || d.jobDescription || '';
    if (!requirements && d.ticketId != null) {
      const [t] = await db.select({ description: tasks.description }).from(tasks).where(eq(tasks.id, d.ticketId));
      requirements = t?.description || '';
    }
    let judge: EvalJudge | undefined;
    const plan = await resolveTenantPlan(c.env as Env, tenantId).catch(() => null);
    if (plan) judge = gatewayJudge(c.env as Env, plan.effectivePlan, plan.premiumOverride);
    const scores = await evaluateProposal({ requirements, scope: requirements, proposal: d.body || '' }, { judge });
    const overall100 = evalPercent(scores.overall);
    await db.insert(proposalEvaluations).values({
      id: crypto.randomUUID(),
      tenantId,
      subjectType: 'deliverable',
      subjectId: id,
      jobId: d.jobId ?? null,
      faithfulness: scores.faithfulness,
      answerRelevance: scores.answerRelevance,
      contextRelevance: scores.contextRelevance,
      hallucinationRate: scores.hallucinationRate,
      overall: scores.overall,
      method: scores.method,
      evaluatedByUserId: actor,
    });
    await db
      .update(deliverableProposals)
      .set({ lastEvalOverall: overall100, updatedAt: sql`NOW()` })
      .where(eq(deliverableProposals.id, id));
    return c.json({ ...scores, overall100 });
  });

  // POST /:id/status — employer accepts / requests changes on a deliverable.
  router.post('/:id/status', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const b = await c.req.json<{ status?: string }>().catch((): { status?: string } => ({}));
    const status = ['accepted', 'changes_requested'].includes(b.status ?? '') ? (b.status as string) : null;
    if (!status) return c.json({ error: 'status must be accepted|changes_requested' }, 400);
    const db = buildDatabase(c.env);
    const rows = await db
      .update(deliverableProposals)
      .set({ status, updatedAt: sql`NOW()` })
      .where(and(eq(deliverableProposals.id, id), eq(deliverableProposals.tenantId, tenantId)))
      .returning({ authorUserId: deliverableProposals.authorUserId, title: deliverableProposals.title });
    const d = rows[0];
    if (!d) return c.json({ error: 'Not found' }, 404);
    await notify(db, c.env, {
      userId: d.authorUserId, tenantId,
      kind: status === 'accepted' ? 'accepted' : 'changes_requested',
      title: status === 'accepted' ? `Your proposal "${d.title}" was accepted` : `Changes requested on "${d.title}"`, ref: id,
    });
    return c.json({ ok: true });
  });

  return router;
}
