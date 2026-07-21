/**
 * Feedback management routes — /api/feedback (tenant JWT).
 *
 * The authenticated half of the Product Feedback pillar:
 *   - Collectors: ONE per project (one ingest key = one embeddable snippet), so any
 *     application carrying the snippet feeds that project's backlog.
 *   - In-app submissions: the signed-in right-edge feedback panel posts here; it is
 *     the SAME engine the public snippet uses, just authenticated by session instead
 *     of by ingest key (this is the dogfooding surface).
 *   - Triage: review the queue and APPROVE or DECLINE each external request. Approval
 *     is the human gate — until it happens the opened ticket cannot be executed by
 *     any agent (see feedbackSpec / evaluateTaskAutoRun).
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { feedbackCollectors, projects } from '../../infrastructure/database/schema';
import { generateApiKey, hashSecret } from '../../infrastructure/auth/HashService';
import { normalizeFeedback } from '../../application/feedback/feedbackSpec';
import { submitFeedback, reviewFeedbackSubmission } from '../../application/feedback/feedbackEngine';
import {
  listFeedbackSubmissions, countFeedbackByStatus, parseFeedbackStatus,
} from '../../application/feedback/feedbackQueries';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

/** Postgres unique-constraint violation (a second collector for one project). */
function isUniqueViolation(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e);
  return /duplicate key|unique constraint|23505/i.test(s);
}

/** Assert a project belongs to the caller's tenant; returns its name or null. */
async function ownedProjectName(db: Db, tenantId: number, projectId: number): Promise<string | null> {
  const [row] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  return row?.name ?? null;
}

export function createFeedbackRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── Collectors ────────────────────────────────────────────────────────────

  router.get('/collectors', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db
      .select({
        id: feedbackCollectors.id, name: feedbackCollectors.name, projectId: feedbackCollectors.projectId,
        enabled: feedbackCollectors.enabled, autoCreateTask: feedbackCollectors.autoCreateTask,
        dailyLimit: feedbackCollectors.dailyLimit, allowedOrigins: feedbackCollectors.allowedOrigins,
        lastSubmissionAt: feedbackCollectors.lastSubmissionAt, createdAt: feedbackCollectors.createdAt,
      })
      .from(feedbackCollectors)
      .where(eq(feedbackCollectors.tenantId, tenantId))
      .orderBy(desc(feedbackCollectors.createdAt));
    return c.json({ collectors: rows });
  });

  /** Create a project's collector — mints the ingest key, shown exactly once. */
  router.post('/collectors', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<{ projectId?: number; name?: string }>();
    if (typeof body.projectId !== 'number') return c.json({ error: 'projectId is required' }, 400);

    const projectName = await ownedProjectName(db, tenantId, body.projectId);
    if (!projectName) return c.json({ error: 'Project not found' }, 404);

    const rawKey = generateApiKey('bff');
    const keyHash = await hashSecret(rawKey);

    let row;
    try {
      [row] = await db
        .insert(feedbackCollectors)
        .values({
          tenantId, projectId: body.projectId,
          name: body.name?.trim() || projectName,
          keyHash, createdBy: userId ?? null,
        })
        .returning({ id: feedbackCollectors.id, name: feedbackCollectors.name, projectId: feedbackCollectors.projectId });
    } catch (e) {
      if (isUniqueViolation(e)) return c.json({ error: 'This project already has a feedback collector' }, 409);
      throw e;
    }
    if (!row) return c.json({ error: 'Failed to create collector' }, 500);

    return c.json({
      collector: row,
      // Shown ONCE — the raw key is never stored or retrievable again.
      ingestKey: rawKey,
      submitEndpoint: '/api/feedback-ingest/submit',
      configEndpoint: '/api/feedback-ingest/config',
    }, 201);
  });

  router.patch('/collectors/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      name?: string; enabled?: boolean; autoCreateTask?: boolean; dailyLimit?: number; allowedOrigins?: string;
    }>();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.autoCreateTask !== undefined) patch.autoCreateTask = body.autoCreateTask;
    if (body.dailyLimit !== undefined) {
      if (!Number.isFinite(body.dailyLimit) || body.dailyLimit < 1 || body.dailyLimit > 10_000) {
        return c.json({ error: 'dailyLimit must be between 1 and 10000' }, 400);
      }
      patch.dailyLimit = Math.floor(body.dailyLimit);
    }
    if (body.allowedOrigins !== undefined) patch.allowedOrigins = body.allowedOrigins.trim() || '*';

    const [row] = await db
      .update(feedbackCollectors).set(patch)
      .where(and(eq(feedbackCollectors.id, c.req.param('id')), eq(feedbackCollectors.tenantId, tenantId)))
      .returning({ id: feedbackCollectors.id });
    if (!row) return c.json({ error: 'Collector not found' }, 404);
    return c.json({ ok: true });
  });

  router.delete('/collectors/:id', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [row] = await db
      .delete(feedbackCollectors)
      .where(and(eq(feedbackCollectors.id, c.req.param('id')), eq(feedbackCollectors.tenantId, tenantId)))
      .returning({ id: feedbackCollectors.id });
    if (!row) return c.json({ error: 'Collector not found' }, 404);
    return c.json({ ok: true });
  });

  // ── In-app submission (the right-edge feedback panel) ──────────────────────

  /**
   * A signed-in user's feedback. Same engine as the public snippet, but the
   * session supplies the tenant + submitter, so no ingest key and no collector
   * row are needed — a workspace can gather internal feedback before it has ever
   * configured a snippet.
   */
  router.post('/submissions', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<{ projectId?: number }>().catch(() => null);
    if (!body || typeof body.projectId !== 'number') return c.json({ error: 'projectId is required' }, 400);
    if (!(await ownedProjectName(db, tenantId, body.projectId))) return c.json({ error: 'Project not found' }, 404);

    const normalized = normalizeFeedback(body);
    if (!normalized.ok) return c.json({ error: normalized.error }, 400);

    // A project collector's settings govern in-app submissions too when one
    // exists, so "don't open tickets yet" is honoured on both channels.
    const [collector] = await db
      .select({ id: feedbackCollectors.id, autoCreateTask: feedbackCollectors.autoCreateTask, enabled: feedbackCollectors.enabled })
      .from(feedbackCollectors)
      .where(and(eq(feedbackCollectors.tenantId, tenantId), eq(feedbackCollectors.projectId, body.projectId)))
      .limit(1);

    const result = await submitFeedback(
      db,
      c.env as Env,
      {
        // Deliberately NOT attributed to the collector: an in-app submission is
        // not snippet traffic and must not consume the snippet's abuse budget.
        collectorId: null,
        tenantId,
        projectId: body.projectId,
        autoCreateTask: collector ? collector.autoCreateTask && collector.enabled : true,
        dailyLimit: null,
      },
      { ...normalized.value, userAgent: c.req.header('User-Agent')?.slice(0, 1000) ?? null },
      { userId },
    );
    if ('rateLimited' in result && result.rateLimited) return c.json({ error: 'Rate limited' }, 429);
    return c.json(result, 201);
  });

  // ── Triage ────────────────────────────────────────────────────────────────

  router.get('/submissions', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const projectParam = c.req.query('projectId');
    const projectId = projectParam ? Number(projectParam) : null;
    if (projectId != null && !Number.isFinite(projectId)) return c.json({ error: 'Invalid projectId' }, 400);

    const filter = {
      tenantId,
      projectId,
      status: parseFeedbackStatus(c.req.query('status')),
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      before: c.req.query('before') ?? null,
    };
    const [submissions, counts] = await Promise.all([
      listFeedbackSubmissions(db, c.env as Env, filter),
      countFeedbackByStatus(db, c.env as Env, { tenantId, projectId }),
    ]);
    return c.json({ submissions, counts });
  });

  /**
   * The human gate. Approving un-gates the linked ticket (its `source` flips to
   * `feedback_approved`, which is the only thing that makes it executable);
   * declining archives it off the board.
   */
  router.post('/submissions/:id/review', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const body = await c.req.json<{ decision?: string }>().catch(() => null);
    const decision = body?.decision;
    if (decision !== 'approved' && decision !== 'declined') {
      return c.json({ error: "decision must be 'approved' or 'declined'" }, 400);
    }

    const result = await reviewFeedbackSubmission(db, c.env as Env, {
      tenantId, submissionId: c.req.param('id'), decision, reviewerUserId: userId ?? null,
    });
    if (!result.ok) return c.json({ error: 'Submission not found' }, 404);
    return c.json({ ok: true, taskId: result.taskId });
  });

  return router;
}
