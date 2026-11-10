/**
 * Cross-domain (channel-3) seams — mounted under /v1 (spec 05 §4).
 *
 * These are SERVER-TO-SERVER endpoints the host (BurnRateOS) calls with a scoped
 * tenant API key (bfk_*), NOT an end-user JWT. authenticateServiceToken enforces
 * the key + scope and resolves the (tenantId, segmentId) for the named end-client
 * (accountId/companyId carried in the request, spec §2.3).
 *
 *   POST   /v1/ingest/feedback   (scope ingest:feedback) — host pushes VoC feedback
 *   GET    /v1/webhooks          (scope webhooks:manage)  — list subscriptions
 *   POST   /v1/webhooks          (scope webhooks:manage)  — subscribe to events
 *   DELETE /v1/webhooks/:id      (scope webhooks:manage)  — unsubscribe
 *   POST/PUT/DELETE /v1/admin/segments[/:id] (scope segments:manage)
 *
 * A host OIDC token (X-IdP-Token) is segment-bound: on the admin/segments routes
 * it may act only on its own resolved segment (authorizeSegmentTarget → 403);
 * a bfk_* key keeps tenant-wide segment management.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authenticateServiceToken } from '../middleware/serviceTokenAuth';
import { respondToAccessError } from './llmRoutes';
import { ingestCustomerFeedback } from '../../application/reports/customerFeedbackInbox';
import { parseEvents, WEBHOOK_EVENTS } from '../../application/seams/webhookService';
import {
  createWebhookSubscription,
  deleteSegmentWebhookSubscription,
  listSegmentWebhookSubscriptions,
} from '../../application/publicApi/publicWebhookSubscriptionService';
import { parseOptionalBody, z } from './requestBody';
import {
  authorizeSegmentTarget,
  eraseSegment,
  findSegmentByExternalIds,
  isSegmentStatus,
  provisionSegment,
  SEGMENT_STATUSES,
  updateSegment,
  type SegmentPatch,
} from '../../application/tenant/segmentLifecycle';

/**
 * Host (third-party) payloads: loose, only the fields read, each as optional as the
 * handler treated it — the required ones answer their own 400 AFTER the service
 * token is checked. `null` coordinates read as absent, exactly as `?? ''` did.
 */
const segmentCoordinates = {
  accountId: z.string().nullish().transform((value) => value ?? undefined),
  companyId: z.string().nullish().transform((value) => value ?? undefined),
};

const FeedbackIngestBody = z.looseObject({
  ...segmentCoordinates,
  eventId: z.string().nullish(),
  widgetId: z.string().nullish(),
  text: z.string().nullish(),
  sentiment: z.string().nullish(),
  contact: z.string().nullish(),
});

/** `events` is filtered to known events by the use case, so unknown entries are dropped, not refused. */
const WebhookSubscribeBody = z.looseObject({
  ...segmentCoordinates,
  url: z.string().nullish(),
  events: z.unknown().optional(),
  secret: z.string().nullish(),
});

export function createSeamRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── Feedback ingest (host → BuilderForce) ──────────────────────────────────
  router.post('/ingest/feedback', async (c) => {
    const body = await parseOptionalBody(c, FeedbackIngestBody);

    let svc;
    try {
      svc = await authenticateServiceToken(c, 'ingest:feedback', { accountId: body.accountId, companyId: body.companyId });
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const eventId = (body.eventId ?? '').trim();
    const text = (body.text ?? '').trim();
    if (!eventId) return c.json({ error: 'eventId is required' }, 400);
    if (!text) return c.json({ error: 'text is required' }, 400);

    // Idempotent on (segment, external_ref) — the VoC use case owns the rule.
    const result = await ingestCustomerFeedback(db, {
      tenantId: svc.tenantId,
      segmentId: svc.segmentId,
      eventId,
      text,
      widgetId: body.widgetId,
      sentiment: body.sentiment,
      contact: body.contact,
    });
    return c.json(result, result.deduped ? 200 : 201);
  });

  // ── Outbound-webhook subscriptions (host manages its own) ──────────────────
  // Thin adapters over THE subscription use case (publicWebhookSubscriptionService),
  // the same one `/api/v1/webhooks` calls. What stays here is only what makes this
  // door different: the service token resolves ONE end-client segment, and the
  // response keeps the shape the host integration already parses.
  router.get('/webhooks', async (c) => {
    let svc;
    try {
      svc = await authenticateServiceToken(c, 'webhooks:manage', {
        accountId: c.req.query('accountId'), companyId: c.req.query('companyId'),
      });
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const rows = await listSegmentWebhookSubscriptions(db, svc.tenantId, svc.segmentId);
    // The secret is never returned after creation.
    return c.json({ subscriptions: rows, availableEvents: WEBHOOK_EVENTS });
  });

  router.post('/webhooks', async (c) => {
    const body = await parseOptionalBody(c, WebhookSubscribeBody);

    let svc;
    try {
      svc = await authenticateServiceToken(c, 'webhooks:manage', { accountId: body.accountId, companyId: body.companyId });
    } catch (err) {
      return respondToAccessError(c, err);
    }

    // Caller may supply a secret (to verify deliveries) or the use case mints one;
    // either way it is returned ONCE and never again on list.
    const result = await createWebhookSubscription(db, {
      tenantId: svc.tenantId,
      segmentId: svc.segmentId,
      keyId: svc.tenantApiKeyId,
      url: body.url ?? '',
      events: body.events,
      secret: body.secret ?? undefined,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    const row = result.subscription;
    return c.json({ id: row.id, url: row.url, events: parseEvents(row.events), secret: result.secret, createdAt: row.createdAt }, 201);
  });

  router.delete('/webhooks/:id', async (c) => {
    let svc;
    try {
      svc = await authenticateServiceToken(c, 'webhooks:manage', {
        accountId: c.req.query('accountId'), companyId: c.req.query('companyId'),
      });
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const id = c.req.param('id');
    const deleted = await deleteSegmentWebhookSubscription(db, svc.tenantId, svc.segmentId, id);
    if (!deleted) return c.json({ error: 'subscription not found' }, 404);
    return c.json({ ok: true, id });
  });

  // ── Segment provisioning handshake (spec 05 §3) — host pre-warms / updates /
  //    erases an end-client Segment server-to-server. Same lifecycle rules as
  //    /api/segments, but behind the `segments:manage` scope so a host key that
  //    may provision segments cannot also ingest feedback (and vice versa).

  // Eager provisioning: pre-warm a Segment (default board/deck seeding is a
  // deployment concern; the row + plan is what BuilderForce owns here).
  router.post('/admin/segments', async (c) => {
    const body = await parseOptionalBody(c, z.looseObject({
      accountId: z.string().nullish(),
      companyId: z.string().nullish(),
      displayName: z.string().nullish(),
      plan: z.string().nullish(),
    }));

    let svc;
    try {
      svc = await authenticateServiceToken(c, 'segments:manage', {
        accountId: body.accountId ?? undefined, companyId: body.companyId ?? undefined,
      });
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const accountId = (body.accountId ?? '').trim();
    const companyId = (body.companyId ?? '').trim();
    if (!accountId) return c.json({ error: 'accountId is required' }, 400);
    if (!companyId) return c.json({ error: 'companyId is required' }, 400);

    // Eager provisioning is idempotent on the (tenant, account, company) unique
    // key — a host that re-POSTs on every company-enable converges to one row.
    const existing = await findSegmentByExternalIds(db, svc.tenantId, accountId, companyId);
    // A segment-bound (host OIDC) caller may only "provision" its own, already
    // resolved segment — never create or read another end-client's.
    const target = authorizeSegmentTarget(svc, existing?.id ?? null);
    if (!target.ok) return c.json({ error: target.error }, target.status);
    if (existing) return c.json(existing, 200);

    const seg = await provisionSegment(db, svc.tenantId, {
      externalAccountId: accountId,
      externalCompanyId: companyId,
      displayName: body.displayName?.trim() || companyId,
      slug: `${accountId}-${companyId}`.slice(0, 255),
      plan: body.plan ?? 'free',
    });
    return c.json(seg, 201);
  });

  // Plan / status propagation from the host (spec 05 §3.3).
  router.put('/admin/segments/:id', async (c) => {
    let svc;
    try {
      svc = await authenticateServiceToken(c, 'segments:manage', {
        accountId: c.req.query('accountId'), companyId: c.req.query('companyId'),
      });
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const body = await parseOptionalBody(c, z.looseObject({
      plan: z.string().nullish(),
      status: z.string().nullish(),
      displayName: z.string().nullish(),
    }));

    const patch: SegmentPatch = {};
    if (body.plan !== null && body.plan !== undefined) patch.plan = body.plan;
    if (body.status !== null && body.status !== undefined) {
      if (!isSegmentStatus(body.status)) {
        return c.json({ error: `status must be one of ${SEGMENT_STATUSES.join(', ')}` }, 400);
      }
      patch.status = body.status;
    }
    if (body.displayName?.trim()) patch.displayName = body.displayName.trim();
    if (Object.keys(patch).length === 0) return c.json({ error: 'nothing to update' }, 400);

    const target = authorizeSegmentTarget(svc, c.req.param('id'));
    if (!target.ok) return c.json({ error: target.error }, target.status);

    const updated = await updateSegment(db, c.env, svc.tenantId, c.req.param('id'), patch);
    if (!updated) return c.json({ error: 'segment not found, not yours, or is the default segment' }, 404);
    return c.json(updated);
  });

  // Company deletion / GDPR erasure (spec 05 §3.4): cascades every Segment-scoped
  // row (migrations 0056–0061+ carry segment_id ON DELETE CASCADE) and the run
  // telemetry that lives beyond the core cascade.
  router.delete('/admin/segments/:id', async (c) => {
    let svc;
    try {
      svc = await authenticateServiceToken(c, 'segments:manage', {
        accountId: c.req.query('accountId'), companyId: c.req.query('companyId'),
      });
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const target = authorizeSegmentTarget(svc, c.req.param('id'));
    if (!target.ok) return c.json({ error: target.error }, target.status);

    const erased = await eraseSegment(db, c.env, svc.tenantId, c.req.param('id'));
    if (!erased) return c.json({ error: 'segment not found, not yours, or is the default segment' }, 404);
    return c.json({ ok: true, id: erased });
  });

  return router;
}
