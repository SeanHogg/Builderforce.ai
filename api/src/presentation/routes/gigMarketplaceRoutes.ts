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
import { and, desc, eq, getTableColumns, inArray, isNotNull, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { notify } from '../../application/notifications/notify';
import { resolveTenantPlan } from './llmRoutes';
import { gatewayJudge } from '../../application/eval/gatewayJudge';
import { evaluateProposal, evalPercent } from '../../application/marketplace/proposalEval';
import { EngagementAccessService } from '../../application/marketplace/EngagementAccessService';
import {
  BudgetShapeError,
  normalizeAttachments,
  normalizeScreeningQuestions,
  readOpenTicketPosting,
  readTicketDefaults,
  ticketPostingKey,
  unpublishTicketPosting,
  upsertJobPosting,
} from '../../application/marketplace/jobPostings';
import { readSavedTalent, readTalentLists, saveTalent, unsaveTalent } from '../../application/marketplace/savedTalent';
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
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { EvalJudge } from '../../application/eval/semanticEval';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

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
  // 0985 — the richer posting. A TOTAL is not a rate (see `jobPostings.ts`), so it
  // rides beside the band rather than being folded into it.
  budgetTotalCents: r.budgetTotalCents == null ? null : Number(r.budgetTotalCents),
  discipline: r.discipline ?? null,
  specialty: r.specialty ?? null,
  experienceLevel: r.experienceLevel ?? null,
  projectLength: r.projectLength ?? null,
  screeningQuestions: normalizeScreeningQuestions(r.screeningQuestions),
  attachments: normalizeAttachments(r.attachments),
  createdAt: r.createdAt ?? null,
});

// ---------------------------------------------------------------------------
// /api/marketplace — publish a ticket as a gig, and the client's talent shortlist
// ---------------------------------------------------------------------------
export function createGigMarketplaceRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // POST /publish — turn a work item into a hireable gig.
  //
  // The route's job is auth, the ticket lookup and the response shape. What a POSTING IS
  // — its identity rule, its defaults, its category, its money, its cache invalidation —
  // belongs to `upsertJobPosting`, which `POST /api/jobs` also calls. Before that
  // convergence the two doors disagreed about all five (see the module header there),
  // and which one you came through decided what you got.
  router.post('/publish', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const db = buildDatabase(c.env);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const ticketId = typeof b.ticketId === 'number' ? Math.round(b.ticketId) : Number(b.ticketId);
    if (!Number.isFinite(ticketId)) return c.json({ error: 'ticketId required' }, 400);

    const ticketDefaults = await readTicketDefaults(db, tenantId, ticketId);
    if (!ticketDefaults) return c.json({ error: 'Ticket not found' }, 404);

    // Already published to an OPEN posting? Return it rather than rewriting a listing
    // freelancers may already be bidding on.
    const openExisting = await readOpenTicketPosting(db, tenantId, ticketId);
    if (openExisting) return c.json({ jobId: openExisting.id, posting: mapPosting(openExisting), reused: true });

    try {
      const result = await upsertJobPosting(db, c.env as Env, {
        tenantId,
        actorUserId: actor,
        draft: { ...b, sourceTicketId: ticketId },
        ticketDefaults,
      });
      return c.json(
        { jobId: result.id, posting: mapPosting(result.posting), reused: result.reused },
        result.reused ? 200 : 201,
      );
    } catch (error) {
      if (error instanceof BudgetShapeError) return c.json({ error: error.message }, 400);
      throw error;
    }
  });

  // POST /unpublish — pull a ticket's gig from the marketplace.
  router.post('/unpublish', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const db = buildDatabase(c.env);
    const b = await c.req.json<{ ticketId?: number }>().catch((): { ticketId?: number } => ({}));
    const ticketId = typeof b.ticketId === 'number' ? Math.round(b.ticketId) : Number(b.ticketId);
    if (!Number.isFinite(ticketId)) return c.json({ error: 'ticketId required' }, 400);
    await unpublishTicketPosting(db, c.env as Env, tenantId, ticketId);
    return c.json({ ok: true });
  });

  // GET /ticket/:taskId/posting — the open posting for a ticket (board badge). Cached;
  // invalidated on publish/unpublish.
  router.get('/ticket/:taskId/posting', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const taskId = Number(c.req.param('taskId'));
    if (!Number.isFinite(taskId)) return c.json({ error: 'invalid taskId' }, 400);
    const posting = await getOrSetCached(c.env as Env, ticketPostingKey(tenantId, taskId), async () => {
      const db = buildDatabase(c.env);
      const row = await readOpenTicketPosting(db, tenantId, taskId);
      return row ? mapPosting(row) : null;
    });
    return c.json({ posting });
  });

  // ---- The client's talent shortlist (0985) ----------------------------------
  //
  // The supply-side mirror of `GET /api/jobs/saved`. Mounted here rather than on
  // `/api/freelancers` because it is a HIRING act performed with the tenant JWT — the
  // freelancer surfaces are the person's own, and this list is the workspace's.

  // GET /saved-talent?list= — the shortlist, newest first.
  router.get('/saved-talent', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const [items, lists] = await Promise.all([
      readSavedTalent(db, {
        tenantId: c.get('tenantId') as number,
        ownerUserId: c.get('userId') as string,
        list: c.req.query('list') ?? null,
      }),
      readTalentLists(db, { tenantId: c.get('tenantId') as number, ownerUserId: c.get('userId') as string }),
    ]);
    return c.json({ items, lists });
  });

  // POST /saved-talent — shortlist somebody (idempotent; a second save edits the note).
  router.post('/saved-talent', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    const b = await c.req.json<{ freelancerUserId?: string; list?: string; note?: string }>()
      .catch((): { freelancerUserId?: string; list?: string; note?: string } => ({}));
    const freelancerUserId = String(b.freelancerUserId ?? '').trim();
    if (!freelancerUserId) return c.json({ error: 'freelancerUserId is required' }, 400);
    const saved = await saveTalent(db, {
      tenantId: c.get('tenantId') as number,
      ownerUserId: c.get('userId') as string,
      freelancerUserId,
      list: b.list ?? null,
      note: b.note ?? null,
    });
    if (!saved) return c.json({ error: 'Not found' }, 404);
    return c.json({ id: saved.id }, 201);
  });

  // DELETE /saved-talent/:freelancerUserId?list= — un-shortlist. Without `list`, from
  // every list: "remove this person" is what the button says.
  router.delete('/saved-talent/:freelancerUserId', authMiddleware, async (c) => {
    const db = buildDatabase(c.env);
    await unsaveTalent(db, {
      tenantId: c.get('tenantId') as number,
      ownerUserId: c.get('userId') as string,
      freelancerUserId: c.req.param('freelancerUserId'),
      list: c.req.query('list') ?? null,
    });
    return c.json({ ok: true });
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
      .where(scopedToTenant(tasks, grant.tenantId, eq(tasks.projectId, grant.projectId), eq(tasks.archived, false)))
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
      .where(scopedToTenant(tasks, grant.tenantId, eq(tasks.id, Number(c.req.param('taskId'))), eq(tasks.projectId, grant.projectId)));
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
      .where(scopedToTenant(tasks, grant.tenantId, eq(tasks.id, taskId), eq(tasks.projectId, grant.projectId)))
      .returning({ id: tasks.id, title: tasks.title });
    const updated = rows[0];
    if (!updated) return c.json({ error: 'Not found' }, 404);
    // Notify the employer who created the engagement.
    const [eng] = await db
      .select({ createdByUserId: freelancerEngagements.createdByUserId })
      .from(freelancerEngagements)
      .where(and(
        eq(freelancerEngagements.id, grant.engagementId),
        eq(freelancerEngagements.tenantId, grant.tenantId),
      ));
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
      .where(and(
        eq(freelancerEngagements.id, engagementId),
        eq(freelancerEngagements.tenantId, grant.tenantId),
      ));
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
            isNotNull(deliverableProposals.tenantId),
          )
        : and(
            eq(deliverableProposals.authorUserId, userId),
            isNotNull(deliverableProposals.tenantId),
          ))
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
      const [t] = await db.select({ description: tasks.description }).from(tasks).where(scopedToTenant(tasks, tenantId, eq(tasks.id, d.ticketId)));
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
      .where(and(eq(deliverableProposals.id, id), eq(deliverableProposals.tenantId, tenantId)));
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
