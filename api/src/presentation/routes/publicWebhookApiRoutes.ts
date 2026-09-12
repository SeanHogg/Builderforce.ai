/**
 * The PUBLIC webhook surface — subscribe, verify, and read back what we sent.
 *
 * ── THE SAME PRIMITIVE, NOT A SECOND ONE ─────────────────────────────────────────
 * Every row this file writes is a `webhook_subscriptions` row, and every delivery
 * it reports was sent by `application/seams/webhookService`: the same HMAC over
 * `${deliveryId}.${timestamp}.${body}`, the same `X-BF-*` headers, the same capped
 * exponential backoff, the same six-attempt dead letter, and the same cron sweep
 * that redelivers under the original nonce. What was added for canvas was a wider
 * event vocabulary and a board-scoped subscription — never a second delivery loop,
 * because two delivery loops means two backoff curves and only one of them ever
 * gets the next fix.
 *
 * ── THE HEADER SCHEME, WRITTEN DOWN ──────────────────────────────────────────────
 * Documented on the wire, not just in prose: `GET /api/v1/webhooks/spec` returns
 * the header names, the exact signed string, the tolerance and the events, so an
 * integrator implements verification against the same constants the sender uses.
 *
 *   POST <your url>
 *   X-BF-Webhook-Id:        <delivery uuid — the replay nonce>
 *   X-BF-Webhook-Timestamp: <unix seconds>
 *   X-BF-Signature:         sha256=<hex HMAC-SHA256(secret, `${id}.${timestamp}.${rawBody}`)>
 *
 * A receiver rejects when |now − timestamp| exceeds the tolerance, when the HMAC
 * does not match under a constant-time compare, or when the id has been seen. The
 * SENDER side of that last one is a unique index rather than a promise — see
 * `uq_webhook_delivery_event` (migration 1100).
 *
 * ── WHY THE SECRET IS RETURNED EXACTLY ONCE ──────────────────────────────────────
 * It is the verification key. Returning it on list would put it in every log,
 * every proxy cache and every screenshot of an integration settings page, and a
 * signing secret that is readable is a signature that proves nothing. Lost secret
 * ⇒ rotate, which is a PATCH that mints a new one.
 */

import { Hono } from 'hono';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_ID_HEADER,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  webhookRetryDelaySec,
} from '../../application/seams/webhookService';
import { requirePublicApiKey, type PublicApiContext } from '../../application/publicApi/publicApiAuth';
import { touchTenantApiKey } from '../../application/llm/tenantApiKeyService';
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  findWebhookSubscriptionId,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  patchWebhookSubscription,
  webhookSubscriptionView,
} from '../../application/publicApi/publicWebhookSubscriptionService';
import { limitParam } from '../../domain/shared/boundedInt';
import { parseOptionalBody, z } from './requestBody';

/** The receiver contract, served as data so an integrator's verification code and
 *  ours are written against the same constants. */
export const WEBHOOK_SPEC = {
  signature: {
    algorithm: 'HMAC-SHA256',
    /** `${deliveryId}.${timestampSeconds}.${rawBody}` — the raw body, byte for byte. */
    signedString: '{id}.{timestamp}.{body}',
    encoding: 'hex',
    headers: {
      id: WEBHOOK_ID_HEADER,
      timestamp: WEBHOOK_TIMESTAMP_HEADER,
      signature: WEBHOOK_SIGNATURE_HEADER,
    },
    signatureFormat: 'sha256={hex}',
    /** Reject a delivery whose timestamp is further than this from now. */
    toleranceSeconds: 300,
  },
  retry: {
    maxAttempts: WEBHOOK_MAX_ATTEMPTS,
    /** The published curve, generated from the same function the sweep uses. */
    backoffSeconds: Array.from({ length: WEBHOOK_MAX_ATTEMPTS - 1 }, (_, i) => webhookRetryDelaySec(i + 1)),
    /** 2xx = delivered. Anything else is retried until the attempt budget is spent. */
    successStatuses: '2xx',
  },
  replay: {
    /** The nonce a receiver dedupes on; also the id in the deliveries log. */
    nonceHeader: WEBHOOK_ID_HEADER,
    note: 'One delivery row per (subscription, event type, event id), enforced by a unique index. A retried API call that resolves to the same board revision produces the same event id and is never sent twice.',
  },
  events: WEBHOOK_EVENTS,
} as const;

/**
 * A subscribe / patch body. The handlers own the domain refusals (https-only url,
 * at least one known event, secret length) with their own messages; the schema
 * only refuses a field sent as the wrong type. `events` stays `unknown` so a
 * non-array still gets the "must include at least one of" answer.
 */
const SubscriptionBodySchema = z.object({
  url: z.string().optional(),
  events: z.unknown().optional(),
  secret: z.string().optional(),
  boardId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  active: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
});

export function createPublicWebhookRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  async function auth(c: PublicApiContext) {
    const resolved = await requirePublicApiKey(
      db, c.req.header('Authorization'), c.req.header('Origin') ?? null, 'webhooks:manage',
    );
    if (resolved.ok) c.executionCtx.waitUntil(touchTenantApiKey(db, resolved.keyId));
    return resolved;
  }

  /** GET /api/v1/webhooks/spec — the verification contract. No secrets involved,
   *  but still key-gated: the event vocabulary is product surface. */
  router.get('/webhooks/spec', async (c) => {
    const resolved = await auth(c);
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    return c.json(WEBHOOK_SPEC);
  });

  /** GET /api/v1/webhooks — this tenant's subscriptions. Never the secret. */
  router.get('/webhooks', async (c) => {
    const resolved = await auth(c);
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const rows = await listWebhookSubscriptions(db, resolved.tenantId);
    return c.json({ subscriptions: rows.map(webhookSubscriptionView), availableEvents: WEBHOOK_EVENTS });
  });

  /** POST /api/v1/webhooks — subscribe. Returns the signing secret ONCE. */
  router.post('/webhooks', async (c) => {
    const resolved = await auth(c);
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const body = await parseOptionalBody(c, SubscriptionBodySchema);

    const result = await createWebhookSubscription(db, {
      tenantId: resolved.tenantId,
      keyId: resolved.keyId,
      url: body.url ?? '',
      events: body.events,
      secret: body.secret,
      boardId: body.boardId,
      description: body.description,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);

    return c.json({
      subscription: webhookSubscriptionView(result.subscription),
      // Once. See the header.
      secret: result.secret,
      spec: WEBHOOK_SPEC.signature,
    }, 201);
  });

  /** PATCH /api/v1/webhooks/:id — pause, re-target, re-scope, or rotate the secret. */
  router.patch('/webhooks/:id', async (c) => {
    const resolved = await auth(c);
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const body = await parseOptionalBody(c, SubscriptionBodySchema);

    const result = await patchWebhookSubscription(db, {
      tenantId: resolved.tenantId,
      id: c.req.param('id'),
      url: body.url,
      events: body.events,
      active: body.active,
      description: body.description,
      rotateSecret: body.rotateSecret,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({
      subscription: webhookSubscriptionView(result.subscription),
      ...(result.secret ? { secret: result.secret } : {}),
    });
  });

  /** DELETE /api/v1/webhooks/:id */
  router.delete('/webhooks/:id', async (c) => {
    const resolved = await auth(c);
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const deleted = await deleteWebhookSubscription(db, resolved.tenantId, c.req.param('id'));
    if (!deleted) return c.json({ error: 'Subscription not found' }, 404);
    return c.json({ ok: true, id: c.req.param('id') });
  });

  /**
   * GET /api/v1/webhooks/:id/deliveries — what we sent, and what happened.
   *
   * The log is the answer to "your webhook is broken": it carries the attempt
   * count, the response status, the last error and when the next retry is due, so
   * an integrator can tell a 500 on their side from a subscription we dead-lettered
   * without opening a support ticket. The signed BODY is included because a receiver
   * debugging a signature mismatch needs the exact bytes that were signed.
   */
  router.get('/webhooks/:id/deliveries', async (c) => {
    const resolved = await auth(c);
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const subscriptionId = await findWebhookSubscriptionId(db, resolved.tenantId, c.req.param('id'));
    if (!subscriptionId) return c.json({ error: 'Subscription not found' }, 404);

    const limit = limitParam(c.req.query('limit'), 50, 100);
    const rows = await listWebhookDeliveries(db, resolved.tenantId, subscriptionId, limit);

    return c.json({
      subscriptionId,
      deliveries: rows.map((r) => ({
        ...r,
        // A dead-lettered row is `failed` with no next retry, which is a different
        // thing from "failing and still trying" and is the distinction an integrator
        // actually needs. Named rather than left to be inferred from two nulls.
        exhausted: r.status === 'failed' && r.nextRetryAt == null,
        nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
      })),
      maxAttempts: WEBHOOK_MAX_ATTEMPTS,
    });
  });

  return router;
}
