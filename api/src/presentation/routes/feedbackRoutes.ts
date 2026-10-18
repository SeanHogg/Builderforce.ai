/**
 * Feedback management routes — /api/feedback (tenant JWT).
 *
 * The authenticated half of the Product Feedback pillar:
 *   - Collectors: ONE per project (one ingest key = one embeddable snippet), so any
 *     application carrying the snippet feeds that project's backlog.
 *   - In-app submissions: the signed-in right-edge feedback panel posts here; it is
 *     the SAME engine the public snippet uses, just authenticated by session instead
 *     of by ingest key (this is the dogfooding surface).
 *   - Provider webhooks: connect Sentry / PostHog so requests already gathered in
 *     another tool import through the SAME ingest path, meter and human gate as the
 *     snippet. This half owns the CONFIGURATION (which provider, whose secret); the
 *     deliveries themselves land on the public feedbackWebhookRoutes.
 *   - Triage: review the queue and APPROVE or DECLINE each external request. Approval
 *     is the human gate — until it happens the opened ticket cannot be executed by
 *     any agent (see feedbackSpec / evaluateTaskAutoRun).
 *
 * Every row belongs to the application layer: collectors + integrations to
 * `feedbackCollectors`, the queue to `loadFeedbackQueue` (shared with the
 * superadmin roll-up at /api/admin/feedback), submit/review to `feedbackEngine`.
 * This file decides who may call, parses the request, and picks a status code.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { normalizeFeedback } from '../../application/feedback/feedbackSpec';
import { listFeedbackProviders } from '../../application/feedback/feedbackProviders';
import { submitFeedback, reviewFeedbackSubmission } from '../../application/feedback/feedbackEngine';
import {
  FEEDBACK_INGEST_PATHS, connectCollectorIntegration, createCollector, deleteCollector,
  deleteCollectorIntegration, inAppTarget, listCollectorIntegrations, listCollectors,
  ownedProjectName, setCollectorIntegrationEnabled, updateCollector,
} from '../../application/feedback/feedbackCollectors';
import { loadFeedbackQueue } from '../../application/feedback/feedbackQueries';
import {
  FEEDBACK_DECISION_ERROR, feedbackQueueFilter, isFeedbackDecision, respondToFeedbackSubmit,
} from './feedbackHttp';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { parseBody, parseOptionalBody, z } from './requestBody';

/** `projectId` stays optional so the handler's own "projectId is required" wins. */
const CreateCollectorBody = z.object({
  projectId: z.number().optional(),
  name: z.string().nullish(),
});

/** Each field is written only when present; the dailyLimit range stays a hand check. */
const UpdateCollectorBody = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  autoCreateTask: z.boolean().optional(),
  dailyLimit: z.number().optional(),
  allowedOrigins: z.string().optional(),
});

/**
 * `provider` is checked against the adapter registry by the use case. `secret` is
 * read only when it is a string (anything else mints one), so its shape is left
 * to that guard.
 */
const ConnectIntegrationBody = z.object({
  provider: z.string().nullish(),
  secret: z.unknown().optional(),
});

/** Absent → the handler's own "enabled must be a boolean" answer. */
const IntegrationToggleBody = z.object({ enabled: z.boolean().optional() });

/**
 * The whole body is handed to `normalizeFeedback`, which owns every other field's
 * rules — so unknown keys are KEPT. Only the tenant anchor is typed here.
 */
const InAppSubmissionBody = z.looseObject({ projectId: z.number().optional() });

/** The handler answers any value other than 'approved' / 'declined' itself. */
const ReviewBody = z.object({ decision: z.string().optional() });

export function createFeedbackRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── Collectors ────────────────────────────────────────────────────────────

  router.get('/collectors', async (c) =>
    c.json({ collectors: await listCollectors(db, c.get('tenantId') as number) }));

  /** Create a project's collector — mints the ingest key, shown exactly once. */
  router.post('/collectors', async (c) => {
    const body = await parseBody(c, CreateCollectorBody);
    if (typeof body.projectId !== 'number') return c.json({ error: 'projectId is required' }, 400);

    const result = await createCollector(db, {
      tenantId: c.get('tenantId') as number,
      projectId: body.projectId,
      name: body.name,
      createdBy: (c.get('userId') as string | undefined) ?? null,
    });
    if (!result.ok) {
      return result.reason === 'project_not_found'
        ? c.json({ error: 'Project not found' }, 404)
        : c.json({ error: 'This project already has a feedback collector' }, 409);
    }
    return c.json({
      collector: result.collector,
      // Shown ONCE — the raw key is never stored or retrievable again.
      ingestKey: result.ingestKey,
      submitEndpoint: FEEDBACK_INGEST_PATHS.submit,
      configEndpoint: FEEDBACK_INGEST_PATHS.config,
      webhookBase: FEEDBACK_INGEST_PATHS.webhookBase(result.collector.id),
    }, 201);
  });

  router.patch('/collectors/:id', async (c) => {
    const body = await parseBody(c, UpdateCollectorBody);
    if (body.dailyLimit !== undefined
      && (!Number.isFinite(body.dailyLimit) || body.dailyLimit < 1 || body.dailyLimit > 10_000)) {
      return c.json({ error: 'dailyLimit must be between 1 and 10000' }, 400);
    }
    const updated = await updateCollector(db, c.get('tenantId') as number, c.req.param('id'), body);
    if (!updated) return c.json({ error: 'Collector not found' }, 404);
    return c.json({ ok: true });
  });

  router.delete('/collectors/:id', async (c) => {
    if (!(await deleteCollector(db, c.get('tenantId') as number, c.req.param('id')))) {
      return c.json({ error: 'Collector not found' }, 404);
    }
    return c.json({ ok: true });
  });

  // ── Provider webhooks (import from Sentry / PostHog) ───────────────────────
  // Configuration only; deliveries land on the public feedbackWebhookRoutes.
  // Secrets are never read back — write-once-then-rotate (see feedbackCollectors).

  router.get('/collectors/:id/integrations', async (c) => {
    const result = await listCollectorIntegrations(db, c.get('tenantId') as number, c.req.param('id'));
    if (!result) return c.json({ error: 'Collector not found' }, 404);
    return c.json(result);
  });

  /** Connect a provider, or rotate its secret (minted when not supplied, shown ONCE). */
  router.post('/collectors/:id/integrations', async (c) => {
    const body = await parseOptionalBody(c, ConnectIntegrationBody);
    const result = await connectCollectorIntegration(db, c.env as Env, {
      tenantId: c.get('tenantId') as number,
      collectorId: c.req.param('id'),
      provider: body.provider,
      secret: body.secret,
      createdBy: (c.get('userId') as string | undefined) ?? null,
    });
    if (!result.ok) {
      if (result.reason === 'collector_not_found') return c.json({ error: 'Collector not found' }, 404);
      if (result.reason === 'secret_too_short') return c.json({ error: 'secret must be at least 16 characters' }, 400);
      return c.json({ error: `provider must be one of: ${listFeedbackProviders().map((p) => p.id).join(', ')}` }, 400);
    }
    return c.json(result, 201);
  });

  /** Pause or resume imports without discarding the secret. */
  router.patch('/collectors/:id/integrations/:provider', async (c) => {
    const body = await parseOptionalBody(c, IntegrationToggleBody);
    if (typeof body.enabled !== 'boolean') return c.json({ error: 'enabled must be a boolean' }, 400);
    const found = await setCollectorIntegrationEnabled(db, {
      tenantId: c.get('tenantId') as number, collectorId: c.req.param('id'),
      provider: c.req.param('provider'), enabled: body.enabled,
    });
    if (!found) return c.json({ error: 'Integration not found' }, 404);
    return c.json({ ok: true });
  });

  /** Disconnect a provider entirely (the secret goes with it). */
  router.delete('/collectors/:id/integrations/:provider', async (c) => {
    const found = await deleteCollectorIntegration(db, {
      tenantId: c.get('tenantId') as number, collectorId: c.req.param('id'), provider: c.req.param('provider'),
    });
    if (!found) return c.json({ error: 'Integration not found' }, 404);
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
    const body = await parseOptionalBody(c, InAppSubmissionBody);
    if (typeof body.projectId !== 'number') return c.json({ error: 'projectId is required' }, 400);
    if (!(await ownedProjectName(db, tenantId, body.projectId))) return c.json({ error: 'Project not found' }, 404);

    const normalized = normalizeFeedback(body);
    if (!normalized.ok) return c.json({ error: normalized.error }, 400);

    const result = await submitFeedback(
      db,
      c.env as Env,
      await inAppTarget(db, tenantId, body.projectId),
      { ...normalized.value, userAgent: c.req.header('User-Agent')?.slice(0, 1000) ?? null },
      { userId },
    );
    return respondToFeedbackSubmit(c, result, 201);
  });

  // ── Triage ────────────────────────────────────────────────────────────────

  /** The workspace queue: the ONE queue read (loadFeedbackQueue) scoped to this tenant. */
  router.get('/submissions', async (c) => {
    const projectParam = c.req.query('projectId');
    const projectId = projectParam ? Number(projectParam) : null;
    if (projectId != null && !Number.isFinite(projectId)) return c.json({ error: 'Invalid projectId' }, 400);
    const filter = feedbackQueueFilter(c, { tenantId: c.get('tenantId') as number, projectId });
    return c.json(await loadFeedbackQueue(db, c.env as Env, filter));
  });

  /**
   * The human gate. Approving un-gates the linked ticket (its `source` flips to
   * `feedback_approved`, which is the only thing that makes it executable);
   * declining archives it off the board.
   */
  router.post('/submissions/:id/review', async (c) => {
    const body = await parseOptionalBody(c, ReviewBody);
    if (!isFeedbackDecision(body.decision)) return c.json({ error: FEEDBACK_DECISION_ERROR }, 400);

    const result = await reviewFeedbackSubmission(db, c.env as Env, {
      tenantId: c.get('tenantId') as number,
      submissionId: c.req.param('id'),
      decision: body.decision,
      reviewerUserId: (c.get('userId') as string | undefined) ?? null,
    });
    if (!result.ok) return c.json({ error: 'Submission not found' }, 404);
    return c.json({ ok: true, taskId: result.taskId });
  });

  return router;
}
