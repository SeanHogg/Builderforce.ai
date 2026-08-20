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
 */

import { Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { feedbackCollectorIntegrations, feedbackCollectors, projects } from '../../infrastructure/database/schema';
import { generateApiKey, hashSecret } from '../../infrastructure/auth/HashService';
import { normalizeFeedback } from '../../application/feedback/feedbackSpec';
import { getFeedbackProvider, listFeedbackProviders } from '../../application/feedback/feedbackProviders';
import { credentialSecret, encryptCredentials } from '../../application/integrations/credentialCrypto';
import { submitFeedback, reviewFeedbackSubmission } from '../../application/feedback/feedbackEngine';
import { respondToFeedbackSubmit } from './feedbackHttp';
import {
  listFeedbackSubmissions, countFeedbackByStatus, parseFeedbackStatus,
} from '../../application/feedback/feedbackQueries';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { isUniqueViolation } from '../../infrastructure/database/uniqueViolation';

/**
 * The public webhook address for one (collector, provider). Built in ONE place so
 * the URL an operator pastes into Sentry is the URL the router actually serves —
 * a second copy of this string is a support ticket that reads "deliveries never
 * arrive" with nothing wrong on either end.
 */
function webhookUrlFor(collectorId: string, provider: string): string {
  return `/api/feedback-ingest/webhooks/${collectorId}/${provider}`;
}

/** Assert a collector belongs to the caller's tenant. Every integration route
 *  starts here: the collector id is the only tenant anchor those paths carry. */
async function ownedCollector(db: Db, tenantId: number, collectorId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: feedbackCollectors.id })
    .from(feedbackCollectors)
    .where(and(eq(feedbackCollectors.id, collectorId), eq(feedbackCollectors.tenantId, tenantId)))
    .limit(1);
  return Boolean(row);
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
      webhookBase: `/api/feedback-ingest/webhooks/${row.id}`,
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

  // ── Provider webhooks (import from Sentry / PostHog) ───────────────────────


  /**
   * The webhook configuration for a collector: the provider CATALOGUE (rendered
   * straight from the adapter registry, so the picker can never offer a provider
   * with no adapter behind it) alongside whatever this collector has connected.
   *
   * Secrets are NEVER returned — only `hasSecret`. A stored webhook secret is
   * write-once-then-rotate by design: an endpoint that could read one back turns
   * every read-scoped token into a credential exfiltration path.
   */
  router.get('/collectors/:id/integrations', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');
    if (!(await ownedCollector(db, tenantId, id))) return c.json({ error: 'Collector not found' }, 404);

    const integrations = await db
      .select({
        provider:    feedbackCollectorIntegrations.provider,
        enabled:     feedbackCollectorIntegrations.enabled,
        hasSecret:   sql<boolean>`${feedbackCollectorIntegrations.secretEnc} IS NOT NULL`,
        lastEventAt: feedbackCollectorIntegrations.lastEventAt,
        createdAt:   feedbackCollectorIntegrations.createdAt,
      })
      .from(feedbackCollectorIntegrations)
      .where(and(
        eq(feedbackCollectorIntegrations.collectorId, id),
        eq(feedbackCollectorIntegrations.tenantId, tenantId),
      ));

    return c.json({
      providers: listFeedbackProviders(),
      integrations: integrations.map((row) => ({ ...row, webhookUrl: webhookUrlFor(id, row.provider) })),
    });
  });

  /**
   * Connect a provider, or rotate its secret — one endpoint, because they are the
   * same write and splitting them would let a "connect" on an existing row silently
   * do nothing while the operator pasted a new secret into the provider's console.
   *
   * The secret is MINTED here when the caller does not supply one, and returned
   * exactly once. That is the difference between an operator who copies a strong
   * random value into Sentry and one who types their pet's name into both ends.
   */
  router.post('/collectors/:id/integrations', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId = c.get('userId') as string | undefined;
    const id = c.req.param('id');
    if (!(await ownedCollector(db, tenantId, id))) return c.json({ error: 'Collector not found' }, 404);

    const body = await c.req.json<{ provider?: string; secret?: string }>().catch(() => null);
    const adapter = body?.provider ? getFeedbackProvider(body.provider) : null;
    if (!adapter) {
      return c.json({ error: `provider must be one of: ${listFeedbackProviders().map((p) => p.id).join(', ')}` }, 400);
    }

    const supplied = typeof body?.secret === 'string' ? body.secret.trim() : '';
    // A short secret is worse than no secret, because it LOOKS configured. 16 chars
    // is the floor for a hand-typed value; a minted one is far longer.
    if (supplied && supplied.length < 16) {
      return c.json({ error: 'secret must be at least 16 characters' }, 400);
    }
    const secret = supplied || generateApiKey('whsec');
    const sealed = await encryptCredentials({ secret }, credentialSecret(c.env as Env), tenantId);

    await db
      .insert(feedbackCollectorIntegrations)
      .values({
        tenantId, collectorId: id, provider: adapter.id,
        secretEnc: sealed.enc, secretIv: sealed.iv, createdBy: userId ?? null,
      })
      .onConflictDoUpdate({
        target: [feedbackCollectorIntegrations.collectorId, feedbackCollectorIntegrations.provider],
        set: { secretEnc: sealed.enc, secretIv: sealed.iv, enabled: true, updatedAt: new Date() },
      });

    return c.json({
      ok: true,
      provider: adapter.id,
      signatureHeader: adapter.signatureHeader,
      webhookUrl: webhookUrlFor(id, adapter.id),
      // Shown ONCE — never retrievable again, only rotatable.
      secret,
    }, 201);
  });

  /** Pause or resume imports without discarding the secret. */
  router.patch('/collectors/:id/integrations/:provider', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{ enabled?: boolean }>().catch(() => null);
    if (typeof body?.enabled !== 'boolean') return c.json({ error: 'enabled must be a boolean' }, 400);

    const [row] = await db
      .update(feedbackCollectorIntegrations)
      .set({ enabled: body.enabled, updatedAt: new Date() })
      .where(and(
        eq(feedbackCollectorIntegrations.tenantId, tenantId),
        eq(feedbackCollectorIntegrations.collectorId, c.req.param('id')),
        eq(feedbackCollectorIntegrations.provider, c.req.param('provider')),
      ))
      .returning({ id: feedbackCollectorIntegrations.id });
    if (!row) return c.json({ error: 'Integration not found' }, 404);
    return c.json({ ok: true });
  });

  /** Disconnect a provider entirely (the secret goes with it). */
  router.delete('/collectors/:id/integrations/:provider', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const [row] = await db
      .delete(feedbackCollectorIntegrations)
      .where(and(
        eq(feedbackCollectorIntegrations.tenantId, tenantId),
        eq(feedbackCollectorIntegrations.collectorId, c.req.param('id')),
        eq(feedbackCollectorIntegrations.provider, c.req.param('provider')),
      ))
      .returning({ id: feedbackCollectorIntegrations.id });
    if (!row) return c.json({ error: 'Integration not found' }, 404);
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
    return respondToFeedbackSubmit(c, result, 201);
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
