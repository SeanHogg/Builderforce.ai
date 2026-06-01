/**
 * Outbound webhook emitter for the cross-domain (channel-3) seams (spec 05 §4.3).
 *
 * BuilderForce emits a small set of events the host (BurnRateOS) can subscribe
 * to. Each delivery is:
 *   - HMAC-SHA256 signed with the subscription's secret, and
 *   - REPLAY-PROTECTED: the signature covers `${deliveryId}.${timestamp}.${body}`,
 *     and the headers carry the delivery id (a unique nonce) + timestamp so the
 *     receiver rejects stale (old-timestamp) or duplicate (seen-nonce) deliveries.
 *
 * Receiver contract (host side):
 *   1. read X-BF-Webhook-Id, X-BF-Webhook-Timestamp, X-BF-Signature;
 *   2. reject if |now - timestamp| > tolerance (default 300s);
 *   3. recompute sha256=HMAC(secret, `${id}.${timestamp}.${rawBody}`), constant-time compare;
 *   4. reject if the id (nonce) was already processed.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { webhookSubscriptions, webhookDeliveries } from '../../infrastructure/database/schema';

export const WEBHOOK_EVENTS = [
  'workitem.released',
  'sprint.completed',
  'roadmap.published',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(v: unknown): v is WebhookEvent {
  return typeof v === 'string' && (WEBHOOK_EVENTS as readonly string[]).includes(v);
}

export const WEBHOOK_SIGNATURE_HEADER = 'X-BF-Signature';
export const WEBHOOK_ID_HEADER = 'X-BF-Webhook-Id';
export const WEBHOOK_TIMESTAMP_HEADER = 'X-BF-Webhook-Timestamp';

/**
 * Compute the lowercase-hex HMAC-SHA256 of the signed string
 * `${deliveryId}.${timestamp}.${body}`. Pure + Worker-compatible (Web Crypto) so
 * it is unit-testable without a network. Mirrors webhookIngest's verify side.
 */
export async function signWebhook(
  secret: string,
  deliveryId: string,
  timestampSec: number,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = `${deliveryId}.${timestampSec}.${body}`;
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface EmitInput {
  tenantId: number;
  segmentId: string;
  eventType: WebhookEvent;
  /** Logical source id (e.g. the roadmap item id) — lets the receiver dedupe. */
  eventId: string;
  /** Event payload; serialized as the POST body. */
  data: Record<string, unknown>;
}

export interface EmitDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable clock (seconds); defaults to Date.now()/1000. */
  nowSec?: () => number;
}

/**
 * Deliver an event to every active subscription in the segment that subscribed
 * to it. Best-effort: a failing endpoint is recorded as `failed` and never
 * throws to the caller (the emit is fire-and-forget from a mutation path).
 * Returns the number of endpoints attempted.
 */
export async function emitWebhookEvent(db: Db, input: EmitInput, deps: EmitDeps = {}): Promise<number> {
  const doFetch = deps.fetchImpl ?? fetch;
  const nowSec = deps.nowSec ?? (() => Math.floor(Date.now() / 1000));

  const subs = await db
    .select({
      id: webhookSubscriptions.id,
      url: webhookSubscriptions.url,
      secret: webhookSubscriptions.secret,
      events: webhookSubscriptions.events,
    })
    .from(webhookSubscriptions)
    .where(and(
      eq(webhookSubscriptions.segmentId, input.segmentId),
      eq(webhookSubscriptions.active, true),
    ));

  const targets = subs.filter((s) => parseEvents(s.events).includes(input.eventType));
  if (targets.length === 0) return 0;

  const body = JSON.stringify({
    type: input.eventType,
    id: input.eventId,
    data: input.data,
  });
  const timestamp = nowSec();

  await Promise.all(
    targets.map(async (sub) => {
      // Create the delivery row first so its id is the signed nonce.
      const [delivery] = await db
        .insert(webhookDeliveries)
        .values({
          subscriptionId: sub.id,
          tenantId: input.tenantId,
          segmentId: input.segmentId,
          eventType: input.eventType,
          eventId: input.eventId,
          status: 'pending',
          attempts: 1,
        })
        .returning({ id: webhookDeliveries.id });
      if (!delivery) return;

      try {
        const signature = await signWebhook(sub.secret, delivery.id, timestamp, body);
        const res = await doFetch(sub.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [WEBHOOK_ID_HEADER]: delivery.id,
            [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
            [WEBHOOK_SIGNATURE_HEADER]: `sha256=${signature}`,
          },
          body,
        });
        await db
          .update(webhookDeliveries)
          .set({
            status: res.ok ? 'delivered' : 'failed',
            responseStatus: res.status,
            deliveredAt: new Date(),
          })
          .where(eq(webhookDeliveries.id, delivery.id));
      } catch {
        await db
          .update(webhookDeliveries)
          .set({ status: 'failed' })
          .where(eq(webhookDeliveries.id, delivery.id))
          .catch(() => { /* never let bookkeeping throw into the emit path */ });
      }
    }),
  );

  return targets.length;
}

/** Parse a subscription's stored events JSON array, tolerating malformed data. */
export function parseEvents(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}
