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
 * JWT (webAuthMiddleware) + the engagement grant. Raw neon SQL to match jobRoutes.
 */
import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { authMiddleware } from '../middleware/authMiddleware';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { notify } from '../../application/notifications/notify';
import { resolveTenantPlan } from './llmRoutes';
import { gatewayJudge } from '../../application/eval/gatewayJudge';
import { evaluateProposal, evalPercent } from '../../application/marketplace/proposalEval';
import { EngagementAccessService } from '../../application/marketplace/EngagementAccessService';
import type { EvalJudge } from '../../application/eval/semanticEval';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';

const JOBS_PUBLIC_CACHE_KEY = 'jobs:public:open';
const ticketPostingKey = (taskId: number | string) => `gig:ticket-posting:${taskId}`;
const POSTING_TYPES = ['project_bid', 'design', 'fte'];
const ENGAGEMENT_TYPES = ['fixed_bid', 'hourly', 'fte'];

const sqlFor = (env: HonoEnv['Bindings']) => neon(env.NEON_DATABASE_URL);

const mapPosting = (r: Record<string, unknown>) => ({
  id: r.id,
  title: r.title,
  description: r.description ?? null,
  requirements: r.requirements ?? null,
  postingType: r.posting_type ?? 'project_bid',
  engagementType: r.engagement_type ?? null,
  status: r.status,
  visibility: r.visibility ?? 'public',
  sourceTicketId: r.source_ticket_id == null ? null : Number(r.source_ticket_id),
  projectId: r.project_id == null ? null : Number(r.project_id),
  rateMinCents: r.rate_min_cents == null ? null : Number(r.rate_min_cents),
  rateMaxCents: r.rate_max_cents == null ? null : Number(r.rate_max_cents),
  createdAt: r.created_at ?? null,
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
    const sql = sqlFor(c.env);
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const ticketId = typeof b.ticketId === 'number' ? Math.round(b.ticketId) : Number(b.ticketId);
    if (!Number.isFinite(ticketId)) return c.json({ error: 'ticketId required' }, 400);

    // Load the ticket via its project so we can tenant-guard (tasks have no tenant_id).
    const [t] = await sql`
      SELECT t.id, t.title, t.description, t.task_type, t.project_id, t.job_posting_id, p.tenant_id
      FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ${ticketId}
    `;
    if (!t || Number(t.tenant_id) !== Number(tenantId)) return c.json({ error: 'Ticket not found' }, 404);

    // Already published to an open posting? Return it (don't duplicate).
    const [openExisting] = await sql`
      SELECT * FROM job_postings WHERE source_ticket_id = ${ticketId} AND tenant_id = ${tenantId} AND status = 'open' LIMIT 1
    `;
    if (openExisting) return c.json({ jobId: openExisting.id, posting: mapPosting(openExisting), reused: true });

    const postingType = POSTING_TYPES.includes(b.postingType as string)
      ? (b.postingType as string)
      : (t.task_type === 'design' ? 'design' : 'project_bid');
    const engagementType = ENGAGEMENT_TYPES.includes(b.engagementType as string)
      ? (b.engagementType as string)
      : (postingType === 'fte' ? 'fte' : 'fixed_bid');
    const requirements = typeof b.requirements === 'string' && b.requirements.trim()
      ? b.requirements.slice(0, 8000)
      : ((t.description as string) ?? null);
    const discipline = typeof b.discipline === 'string' ? (b.discipline as string) : (t.task_type === 'design' ? 'designer' : null);
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO job_postings (id, tenant_id, project_id, title, description, discipline, rate_min_cents, rate_max_cents, currency, visibility, posting_type, engagement_type, requirements, source_ticket_id, created_by_user_id)
      VALUES (${id}, ${tenantId}, ${t.project_id}, ${t.title}, ${t.description ?? null}, ${discipline},
        ${typeof b.rateMinCents === 'number' ? Math.round(b.rateMinCents) : null}, ${typeof b.rateMaxCents === 'number' ? Math.round(b.rateMaxCents) : null},
        ${typeof b.currency === 'string' ? (b.currency as string).slice(0, 3).toUpperCase() : 'USD'},
        ${b.visibility === 'private' ? 'private' : 'public'}, ${postingType}, ${engagementType}, ${requirements}, ${ticketId}, ${actor})
    `;
    await sql`UPDATE tasks SET hireable = TRUE, job_posting_id = ${id} WHERE id = ${ticketId}`;
    await Promise.all([
      invalidateCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY),
      invalidateCached(c.env as Env, ticketPostingKey(ticketId)),
    ]);
    const [row] = await sql`SELECT * FROM job_postings WHERE id = ${id}`;
    return c.json({ jobId: id, posting: row ? mapPosting(row) : null }, 201);
  });

  // POST /unpublish — pull a ticket's gig from the marketplace.
  router.post('/unpublish', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const sql = sqlFor(c.env);
    const b = await c.req.json<{ ticketId?: number }>().catch((): { ticketId?: number } => ({}));
    const ticketId = typeof b.ticketId === 'number' ? Math.round(b.ticketId) : Number(b.ticketId);
    if (!Number.isFinite(ticketId)) return c.json({ error: 'ticketId required' }, 400);
    await sql`UPDATE job_postings SET status = 'closed', closed_at = NOW(), updated_at = NOW() WHERE source_ticket_id = ${ticketId} AND tenant_id = ${tenantId} AND status = 'open'`;
    await sql`UPDATE tasks SET hireable = FALSE, job_posting_id = NULL WHERE id = ${ticketId}`;
    await Promise.all([
      invalidateCached(c.env as Env, JOBS_PUBLIC_CACHE_KEY),
      invalidateCached(c.env as Env, ticketPostingKey(ticketId)),
    ]);
    return c.json({ ok: true });
  });

  // GET /ticket/:taskId/posting — the open posting for a ticket (board badge). Cached;
  // invalidated on publish/unpublish.
  router.get('/ticket/:taskId/posting', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const taskId = Number(c.req.param('taskId'));
    const posting = await getOrSetCached(c.env as Env, ticketPostingKey(taskId), async () => {
      const [row] = await sqlFor(c.env)`
        SELECT * FROM job_postings WHERE source_ticket_id = ${taskId} AND tenant_id = ${tenantId} AND status = 'open' LIMIT 1
      ` as unknown as Record<string, unknown>[];
      return row ? mapPosting(row) : null;
    });
    return c.json({ posting });
  });

  return router;
}

// ---------------------------------------------------------------------------
// /api/engagement-board — a hired freelancer's scoped access into the project
// ---------------------------------------------------------------------------
export function createEngagementBoardRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const access = new EngagementAccessService(db);

  // GET / — the workspaces/projects I'm actively hired into. Per-user + small; not
  // cached (cheap point lookup, and it must reflect a just-accepted hire immediately).
  router.get('/', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const grants = await access.activeForUser(userId);
    if (grants.length === 0) return c.json({ engagements: [] });
    const sql = sqlFor(c.env);
    const ids = grants.map((g) => g.engagementId);
    const rows = await sql`
      SELECT e.id, e.tenant_id, e.project_id, e.title, e.access_scope, t.name AS tenant_name, p.name AS project_name, p.key AS project_key
      FROM freelancer_engagements e
      JOIN tenants t ON t.id = e.tenant_id
      LEFT JOIN projects p ON p.id = e.project_id
      WHERE e.id = ANY(${ids})
    ` as unknown as Record<string, unknown>[];
    return c.json({
      engagements: rows.map((r) => ({
        engagementId: r.id,
        tenantId: Number(r.tenant_id),
        tenantName: r.tenant_name ?? null,
        projectId: r.project_id == null ? null : Number(r.project_id),
        projectName: r.project_name ?? null,
        projectKey: r.project_key ?? null,
        title: r.title ?? null,
        accessScope: r.access_scope ?? 'project',
      })),
    });
  });

  // GET /:engagementId/tasks — the engaged project's board (read).
  router.get('/:engagementId/tasks', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const grant = await access.getForUser(userId, c.req.param('engagementId'));
    if (!grant || grant.projectId == null) return c.json({ error: 'No access' }, 403);
    const rows = await sqlFor(c.env)`
      SELECT id, key, title, description, status, priority, task_type, assigned_user_id, assigned_agent_ref, due_date
      FROM tasks WHERE project_id = ${grant.projectId} AND archived = FALSE ORDER BY updated_at DESC LIMIT 200
    ` as unknown as Record<string, unknown>[];
    return c.json({ tasks: rows.map(mapTask) });
  });

  // GET /:engagementId/tasks/:taskId — one ticket in the engaged project.
  router.get('/:engagementId/tasks/:taskId', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const grant = await access.getForUser(userId, c.req.param('engagementId'));
    if (!grant || grant.projectId == null) return c.json({ error: 'No access' }, 403);
    const [row] = await sqlFor(c.env)`
      SELECT id, key, title, description, status, priority, task_type, assigned_user_id, assigned_agent_ref, due_date
      FROM tasks WHERE id = ${Number(c.req.param('taskId'))} AND project_id = ${grant.projectId}
    ` as unknown as Record<string, unknown>[];
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
    const sql = sqlFor(c.env);
    const taskId = Number(c.req.param('taskId'));
    const rows = await sql`
      UPDATE tasks SET status = 'in_review', updated_at = NOW()
      WHERE id = ${taskId} AND project_id = ${grant.projectId} RETURNING id, title
    ` as unknown as Record<string, unknown>[];
    const updated = rows[0];
    if (!updated) return c.json({ error: 'Not found' }, 404);
    // Notify the employer who created the engagement.
    const [eng] = await sql`SELECT created_by_user_id FROM freelancer_engagements WHERE id = ${grant.engagementId}`;
    if (eng?.created_by_user_id) {
      await notify(sql, c.env, {
        userId: eng.created_by_user_id as string, tenantId: grant.tenantId, kind: 'review',
        title: `Review requested on "${updated.title}"`, ref: String(taskId),
      });
    }
    return c.json({ ok: true });
  });

  return router;
}

const mapTask = (r: Record<string, unknown>) => ({
  id: Number(r.id),
  key: r.key,
  title: r.title,
  description: r.description ?? null,
  status: r.status,
  priority: r.priority,
  taskType: r.task_type,
  assignedUserId: r.assigned_user_id ?? null,
  assignedAgentRef: r.assigned_agent_ref ?? null,
  dueDate: r.due_date ?? null,
});

// ---------------------------------------------------------------------------
// /api/deliverables — a hired worker presents a proposal; employer AI-evaluates it
// ---------------------------------------------------------------------------
export function createDeliverableRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  const access = new EngagementAccessService(db);

  const mapDeliverable = (r: Record<string, unknown>) => ({
    id: r.id,
    engagementId: r.engagement_id,
    ticketId: r.ticket_id == null ? null : Number(r.ticket_id),
    jobId: r.job_id ?? null,
    authorUserId: r.author_user_id,
    authorName: r.author_name ?? null,
    title: r.title,
    body: r.body ?? null,
    status: r.status,
    lastEvalOverall: r.last_eval_overall == null ? null : Number(r.last_eval_overall),
    createdAt: r.created_at ?? null,
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
    const sql = sqlFor(c.env);
    // Link the engaged project's open posting when there is one (for eval grounding).
    const [posting] = grant.projectId != null
      ? await sql`SELECT id FROM job_postings WHERE project_id = ${grant.projectId} AND tenant_id = ${grant.tenantId} AND status IN ('open', 'filled') ORDER BY created_at DESC LIMIT 1`
      : [undefined];
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO deliverable_proposals (id, tenant_id, engagement_id, ticket_id, job_id, author_user_id, title, body, status)
      VALUES (${id}, ${grant.tenantId}, ${engagementId}, ${typeof b.ticketId === 'number' ? Math.round(b.ticketId) : null}, ${posting?.id ?? null}, ${userId}, ${title}, ${typeof b.body === 'string' ? b.body.slice(0, 20000) : null}, 'submitted')
    `;
    const [eng] = await sql`SELECT created_by_user_id FROM freelancer_engagements WHERE id = ${engagementId}`;
    const [me] = await sql`SELECT display_name FROM users WHERE id = ${userId}`;
    if (eng?.created_by_user_id) {
      await notify(sql, c.env, {
        userId: eng.created_by_user_id as string, tenantId: grant.tenantId, kind: 'proposal',
        title: `${(me?.display_name as string) ?? 'A freelancer'} presented a proposal: "${title}"`, ref: id,
      });
    }
    return c.json({ id }, 201);
  });

  // GET /mine?engagementId= — the worker's own deliverables.
  router.get('/mine', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const engagementId = c.req.query('engagementId');
    const sql = sqlFor(c.env);
    const rows = engagementId
      ? await sql`SELECT d.*, u.display_name AS author_name FROM deliverable_proposals d JOIN users u ON u.id = d.author_user_id WHERE d.author_user_id = ${userId} AND d.engagement_id = ${engagementId} ORDER BY d.created_at DESC LIMIT 200`
      : await sql`SELECT d.*, u.display_name AS author_name FROM deliverable_proposals d JOIN users u ON u.id = d.author_user_id WHERE d.author_user_id = ${userId} ORDER BY d.created_at DESC LIMIT 200`;
    return c.json((rows as unknown as Record<string, unknown>[]).map(mapDeliverable));
  });

  // GET /for-job/:jobId — employer views deliverables tied to their posting.
  router.get('/for-job/:jobId', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const jobId = c.req.param('jobId');
    const rows = await sqlFor(c.env)`
      SELECT d.*, u.display_name AS author_name FROM deliverable_proposals d JOIN users u ON u.id = d.author_user_id
      WHERE d.job_id = ${jobId} AND d.tenant_id = ${tenantId} ORDER BY d.created_at DESC LIMIT 200
    ` as unknown as Record<string, unknown>[];
    return c.json(rows.map(mapDeliverable));
  });

  // GET /for-engagement/:engagementId — employer views an engagement's deliverables.
  router.get('/for-engagement/:engagementId', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const engagementId = c.req.param('engagementId');
    const rows = await sqlFor(c.env)`
      SELECT d.*, u.display_name AS author_name FROM deliverable_proposals d JOIN users u ON u.id = d.author_user_id
      WHERE d.engagement_id = ${engagementId} AND d.tenant_id = ${tenantId} ORDER BY d.created_at DESC LIMIT 200
    ` as unknown as Record<string, unknown>[];
    return c.json(rows.map(mapDeliverable));
  });

  // POST /:id/evaluate — employer AI-scores the deliverable against the posting's
  // requirements (same LLM-as-judge as bid evaluation).
  router.post('/:id/evaluate', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const actor = c.get('userId') as string;
    const id = c.req.param('id');
    const sql = sqlFor(c.env);
    const [d] = await sql`
      SELECT d.id, d.body, d.job_id, d.ticket_id, d.tenant_id, j.requirements, j.description AS job_description
      FROM deliverable_proposals d LEFT JOIN job_postings j ON j.id = d.job_id WHERE d.id = ${id}
    `;
    if (!d || Number(d.tenant_id) !== Number(tenantId)) return c.json({ error: 'Not found' }, 404);
    // Requirements: prefer the linked posting; else the linked ticket's description.
    let requirements = (d.requirements as string) || (d.job_description as string) || '';
    if (!requirements && d.ticket_id != null) {
      const [t] = await sql`SELECT description FROM tasks WHERE id = ${d.ticket_id}`;
      requirements = (t?.description as string) || '';
    }
    let judge: EvalJudge | undefined;
    const plan = await resolveTenantPlan(c.env as Env, tenantId).catch(() => null);
    if (plan) judge = gatewayJudge(c.env as Env, plan.effectivePlan, plan.premiumOverride);
    const scores = await evaluateProposal({ requirements, scope: requirements, proposal: (d.body as string) || '' }, { judge });
    const overall100 = evalPercent(scores.overall);
    await sql`
      INSERT INTO proposal_evaluations (id, tenant_id, subject_type, subject_id, job_id, faithfulness, answer_relevance, context_relevance, hallucination_rate, overall, method, evaluated_by_user_id)
      VALUES (${crypto.randomUUID()}, ${tenantId}, 'deliverable', ${id}, ${d.job_id ?? null}, ${scores.faithfulness}, ${scores.answerRelevance}, ${scores.contextRelevance}, ${scores.hallucinationRate}, ${scores.overall}, ${scores.method}, ${actor})
    `;
    await sql`UPDATE deliverable_proposals SET last_eval_overall = ${overall100}, updated_at = NOW() WHERE id = ${id}`;
    return c.json({ ...scores, overall100 });
  });

  // POST /:id/status — employer accepts / requests changes on a deliverable.
  router.post('/:id/status', authMiddleware, async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    const b = await c.req.json<{ status?: string }>().catch((): { status?: string } => ({}));
    const status = ['accepted', 'changes_requested'].includes(b.status ?? '') ? (b.status as string) : null;
    if (!status) return c.json({ error: 'status must be accepted|changes_requested' }, 400);
    const sql = sqlFor(c.env);
    const rows = await sql`
      UPDATE deliverable_proposals SET status = ${status}, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING author_user_id, title
    ` as unknown as Record<string, unknown>[];
    const d = rows[0];
    if (!d) return c.json({ error: 'Not found' }, 404);
    await notify(sql, c.env, {
      userId: d.author_user_id as string, tenantId,
      kind: status === 'accepted' ? 'accepted' : 'changes_requested',
      title: status === 'accepted' ? `Your proposal "${d.title}" was accepted` : `Changes requested on "${d.title}"`, ref: id,
    });
    return c.json({ ok: true });
  });

  return router;
}
