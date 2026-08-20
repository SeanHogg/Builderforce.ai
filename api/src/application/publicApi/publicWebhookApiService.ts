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
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';
import {
  creationSessions,
  webhookDeliveries,
  webhookSubscriptions,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { generateApiKey } from '../../infrastructure/auth/HashService';
import {
  isWebhookEvent,
  parseEvents,
  WEBHOOK_EVENTS,
  WEBHOOK_ID_HEADER,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  webhookRetryDelaySec,
} from '../seams/webhookService';
import { requirePublicApiKey, type PublicApiContext } from './publicApiAuth';
import { touchTenantApiKey } from '../llm/tenantApiKeyService';
import { CREATION_UUID_RE as UUID_RE } from '../creation/creationGraphWriter';

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

interface SubscriptionBody {
  url?: string;
  events?: unknown;
  secret?: string;
  boardId?: string | null;
  description?: string;
  active?: boolean;
  rotateSecret?: boolean;
}

function subscriptionView(row: {
  id: string; url: string; events: string; active: boolean; sessionId: string | null;
  description: string | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id: row.id,
    url: row.url,
    events: parseEvents(row.events),
    active: row.active,
    boardId: row.sessionId,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

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
    const rows = await db
      .select()
      .from(webhookSubscriptions)
      .where(scopedToTenant(webhookSubscriptions, resolved.tenantId))
      .orderBy(desc(webhookSubscriptions.createdAt))
      .limit(200);
    return c.json({ subscriptions: rows.map(subscriptionView), availableEvents: WEBHOOK_EVENTS });
  });

  /** POST /api/v1/webhooks — subscribe. Returns the signing secret ONCE. */
  router.post('/webhooks', async (c) => {
    const resolved = await auth(c);
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const body = await c.req.json<SubscriptionBody>().catch(() => ({} as SubscriptionBody));

    const url = (body.url ?? '').trim();
    // https only. A signature proves who sent the body; it does nothing about who
    // READ it, and board content on the wire in plaintext is the same leak whether
    // or not it was signed.
    if (!/^https:\/\/[^\s]+$/.test(url) || url.length > 2000) {
      return c.json({ error: 'url must be an https URL of at most 2000 characters' }, 400);
    }
    const events = Array.isArray(body.events) ? [...new Set(body.events.filter(isWebhookEvent))] : [];
    if (events.length === 0) {
      return c.json({ error: `events must include at least one of: ${WEBHOOK_EVENTS.join(', ')}` }, 400);
    }

    // A board-scoped subscription must name a board in the KEY'S tenant — checked
    // with the tenant predicate in the query, so a foreign board id is "not found"
    // rather than a confirmation that it exists somewhere.
    let sessionId: string | null = null;
    if (body.boardId) {
      if (!UUID_RE.test(body.boardId)) return c.json({ error: 'Board not found' }, 404);
      const [board] = await db
        .select({ id: creationSessions.id })
        .from(creationSessions)
        .where(scopedToTenant(creationSessions, resolved.tenantId, eq(creationSessions.id, body.boardId)))
        .limit(1);
      if (!board) return c.json({ error: 'Board not found' }, 404);
      sessionId = board.id;
    }

    const secret = (body.secret ?? '').trim() || generateApiKey('whsec');
    if (secret.length < 16 || secret.length > 128) {
      return c.json({ error: 'secret must be 16–128 characters' }, 400);
    }

    const [row] = await db
      .insert(webhookSubscriptions)
      .values({
        tenantId: resolved.tenantId,
        // NULL: a `/api/v1` subscription is tenant-wide unless it named a board.
        // The seam subscriptions still set it; see the column's comment.
        segmentId: null,
        sessionId,
        url,
        secret,
        events: JSON.stringify(events),
        description: body.description?.slice(0, 255) || null,
        createdByKeyId: resolved.keyId,
      })
      .returning();
    if (!row) return c.json({ error: 'Could not create the subscription' }, 500);

    return c.json({
      subscription: subscriptionView(row),
      // Once. See the header.
      secret,
      spec: WEBHOOK_SPEC.signature,
    }, 201);
  });

  /** PATCH /api/v1/webhooks/:id — pause, re-target, re-scope, or rotate the secret. */
  router.patch('/webhooks/:id', async (c) => {
    const resolved = await auth(c);
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Subscription not found' }, 404);
    const body = await c.req.json<SubscriptionBody>().catch(() => ({} as SubscriptionBody));

    const patch: Partial<typeof webhookSubscriptions.$inferInsert> = { updatedAt: new Date() };
    if (body.url !== undefined) {
      const url = String(body.url).trim();
      if (!/^https:\/\/[^\s]+$/.test(url) || url.length > 2000) {
        return c.json({ error: 'url must be an https URL of at most 2000 characters' }, 400);
      }
      patch.url = url;
    }
    if (body.events !== undefined) {
      const events = Array.isArray(body.events) ? [...new Set(body.events.filter(isWebhookEvent))] : [];
      if (!events.length) return c.json({ error: `events must include at least one of: ${WEBHOOK_EVENTS.join(', ')}` }, 400);
      patch.events = JSON.stringify(events);
    }
    if (body.active !== undefined) patch.active = Boolean(body.active);
    if (body.description !== undefined) patch.description = body.description?.slice(0, 255) || null;

    let rotated: string | null = null;
    if (body.rotateSecret) {
      rotated = generateApiKey('whsec');
      patch.secret = rotated;
    }

    const [row] = await db
      .update(webhookSubscriptions)
      .set(patch)
      .where(scopedToTenant(webhookSubscriptions, resolved.tenantId, eq(webhookSubscriptions.id, id)))
      .returning();
    if (!row) return c.json({ error: 'Subscription not found' }, 404);
    return c.json({ subscription: subscriptionView(row), ...(rotated ? { secret: rotated } : {}) });
  });

  /** DELETE /api/v1/webhooks/:id */
  router.delete('/webhooks/:id', async (c) => {
    const resolved = await auth(c);
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Subscription not found' }, 404);
    const [row] = await db
      .delete(webhookSubscriptions)
      .where(scopedToTenant(webhookSubscriptions, resolved.tenantId, eq(webhookSubscriptions.id, id)))
      .returning({ id: webhookSubscriptions.id });
    if (!row) return c.json({ error: 'Subscription not found' }, 404);
    return c.json({ ok: true, id: row.id });
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
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: 'Subscription not found' }, 404);

    // Ownership first, and as its own tenant-scoped query: joining the deliveries to
    // the subscription and filtering on the delivery's tenant would let a caller
    // learn that a subscription id exists by getting an empty list instead of a 404.
    const [sub] = await db
      .select({ id: webhookSubscriptions.id })
      .from(webhookSubscriptions)
      .where(scopedToTenant(webhookSubscriptions, resolved.tenantId, eq(webhookSubscriptions.id, id)))
      .limit(1);
    if (!sub) return c.json({ error: 'Subscription not found' }, 404);

    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 50));
    const rows = await db
      .select({
        id: webhookDeliveries.id,
        eventType: webhookDeliveries.eventType,
        eventId: webhookDeliveries.eventId,
        status: webhookDeliveries.status,
        attempts: webhookDeliveries.attempts,
        responseStatus: webhookDeliveries.responseStatus,
        lastError: webhookDeliveries.lastError,
        nextRetryAt: webhookDeliveries.nextRetryAt,
        payload: webhookDeliveries.payload,
        createdAt: webhookDeliveries.createdAt,
        deliveredAt: webhookDeliveries.deliveredAt,
      })
      .from(webhookDeliveries)
      .where(and(
        eq(webhookDeliveries.subscriptionId, sub.id),
        eq(webhookDeliveries.tenantId, resolved.tenantId),
      ))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit);

    return c.json({
      subscriptionId: sub.id,
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
