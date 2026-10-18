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

  return router;
}
