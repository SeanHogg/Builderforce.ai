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
import { and, desc, eq } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authenticateServiceToken } from '../middleware/serviceTokenAuth';
import { respondToAccessError } from './llmRoutes';
import { customerFeedback, webhookSubscriptions } from '../../infrastructure/database/schema';
import { isWebhookEvent, WEBHOOK_EVENTS } from '../../application/seams/webhookService';
import { generateApiKey } from '../../infrastructure/auth/HashService';

export function createSeamRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // ── Feedback ingest (host → BuilderForce) ──────────────────────────────────
  router.post('/ingest/feedback', async (c) => {
    const body = await c.req.json<{
      accountId?: string; companyId?: string;
      eventId?: string; widgetId?: string; text?: string;
      sentiment?: string; contact?: string;
    }>().catch(() => ({}));

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

    // Idempotent on (segment, external_ref): a re-delivered event returns the
    // existing candidate rather than creating a duplicate.
    const [row] = await db
      .insert(customerFeedback)
      .values({
        tenantId: svc.tenantId,
        segmentId: svc.segmentId,
        externalRef: eventId,
        widgetId: body.widgetId ?? null,
        text,
        sentiment: body.sentiment ?? null,
        contact: body.contact ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: customerFeedback.id, status: customerFeedback.status });

    if (!row) {
      const [existing] = await db
        .select({ id: customerFeedback.id, status: customerFeedback.status })
        .from(customerFeedback)
        .where(and(eq(customerFeedback.segmentId, svc.segmentId), eq(customerFeedback.externalRef, eventId)))
        .limit(1);
      return c.json({ id: existing?.id ?? null, status: existing?.status ?? 'new', deduped: true }, 200);
    }
    return c.json({ id: row.id, status: row.status, deduped: false }, 201);
  });

  // ── Outbound-webhook subscriptions (host manages its own) ──────────────────
  router.get('/webhooks', async (c) => {
    let svc;
    try {
      svc = await authenticateServiceToken(c, 'webhooks:manage', {
        accountId: c.req.query('accountId'), companyId: c.req.query('companyId'),
      });
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const rows = await db
      .select({
        id: webhookSubscriptions.id,
        url: webhookSubscriptions.url,
        events: webhookSubscriptions.events,
        active: webhookSubscriptions.active,
        createdAt: webhookSubscriptions.createdAt,
      })
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.segmentId, svc.segmentId))
      .orderBy(desc(webhookSubscriptions.createdAt));
    // The secret is never returned after creation.
    return c.json({ subscriptions: rows, availableEvents: WEBHOOK_EVENTS });
  });

  router.post('/webhooks', async (c) => {
    const body = await c.req.json<{
      accountId?: string; companyId?: string;
      url?: string; events?: unknown; secret?: string;
    }>().catch(() => ({}));

    let svc;
    try {
      svc = await authenticateServiceToken(c, 'webhooks:manage', { accountId: body.accountId, companyId: body.companyId });
    } catch (err) {
      return respondToAccessError(c, err);
    }

    const url = (body.url ?? '').trim();
    if (!/^https:\/\/[^\s]+$/.test(url)) {
      return c.json({ error: 'url must be an https URL' }, 400);
    }
    const events = Array.isArray(body.events) ? body.events.filter(isWebhookEvent) : [];
    if (events.length === 0) {
      return c.json({ error: `events must include at least one of: ${WEBHOOK_EVENTS.join(', ')}` }, 400);
    }
    // Caller may supply a secret (to verify deliveries) or we mint one and
    // return it ONCE. It is never returned again on list.
    const secret = (body.secret ?? '').trim() || generateApiKey('whsec');

    const [row] = await db
      .insert(webhookSubscriptions)
      .values({
        tenantId: svc.tenantId,
        segmentId: svc.segmentId,
        url,
        secret,
        events: JSON.stringify(events),
      })
      .returning({ id: webhookSubscriptions.id, createdAt: webhookSubscriptions.createdAt });

    return c.json({ id: row?.id, url, events, secret, createdAt: row?.createdAt }, 201);
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
    const [deleted] = await db
      .delete(webhookSubscriptions)
      .where(and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.segmentId, svc.segmentId)))
      .returning({ id: webhookSubscriptions.id });
    if (!deleted) return c.json({ error: 'subscription not found' }, 404);
    return c.json({ ok: true, id: deleted.id });
  });

  return router;
}
