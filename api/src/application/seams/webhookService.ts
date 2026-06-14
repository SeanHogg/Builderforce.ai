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

import { and, eq, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
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

/** Total delivery attempts (initial + retries) before a row is dead-lettered. */
export const WEBHOOK_MAX_ATTEMPTS = 6;
/** Most rows the retry sweep processes per tick (bounds cron subrequest cost). */
export const WEBHOOK_SWEEP_BATCH = 50;

/**
 * Capped exponential backoff (seconds) to wait before the next retry, given how
 * many attempts have already been made. Base = 5 min (the cron tick granularity),
 * doubling, capped at 6 h: 5m → 10m → 20m → 40m → 80m. Pure + deterministic.
 */
export function webhookRetryDelaySec(attempts: number): number {
  const BASE_SEC = 300;
  const MAX_SEC = 6 * 60 * 60;
  return Math.min(BASE_SEC * 2 ** Math.max(0, attempts - 1), MAX_SEC);
}

/** Extract a short, safe error string for the `last_error` audit column. */
function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 1000);
}

/**
 * Record a failed attempt on a delivery row, scheduling the next retry with
 * backoff — or dead-lettering it (`next_retry_at = NULL`) once the attempt budget
 * is spent. Shared by the initial emit and the retry sweep (DRY). `attempts` is
 * the count INCLUDING this just-failed attempt; `nowSec` is the failure time.
 */
async function recordDeliveryFailure(
  db: Db,
  deliveryId: string,
  attempts: number,
  nowSec: number,
  err: unknown,
  responseStatus: number | null = null,
): Promise<void> {
  const exhausted = attempts >= WEBHOOK_MAX_ATTEMPTS;
  await db
    .update(webhookDeliveries)
    .set({
      status: 'failed',
      attempts,
      responseStatus,
      lastError: errorText(err),
      nextRetryAt: exhausted ? null : new Date((nowSec + webhookRetryDelaySec(attempts)) * 1000),
    })
    .where(eq(webhookDeliveries.id, deliveryId));
}

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
      // Create the delivery row first so its id is the signed nonce. Persist the
      // exact body so the retry sweep can re-send identical bytes under the same
      // nonce (the receiver dedupes on the nonce, so a retry is idempotent).
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
          payload: body,
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
        if (res.ok) {
          await db
            .update(webhookDeliveries)
            .set({ status: 'delivered', responseStatus: res.status, nextRetryAt: null, deliveredAt: new Date(timestamp * 1000) })
            .where(eq(webhookDeliveries.id, delivery.id));
        } else {
          // Non-2xx — schedule a retry (or dead-letter once exhausted).
          await recordDeliveryFailure(db, delivery.id, 1, timestamp, `HTTP ${res.status}`, res.status);
        }
      } catch (err) {
        await recordDeliveryFailure(db, delivery.id, 1, timestamp, err)
          .catch(() => { /* never let bookkeeping throw into the emit path */ });
      }
    }),
  );

  return targets.length;
}

export interface SweepDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable DB; defaults to one built from `env` (the cron path). */
  db?: Db;
}

/**
 * Redeliver due webhook deliveries with capped exponential backoff. Selects
 * non-terminal rows (`next_retry_at IS NOT NULL AND next_retry_at <= now`),
 * joined to a still-active subscription, re-signs the persisted payload with a
 * fresh timestamp under the original delivery-id nonce, and re-POSTs. On success
 * the row is `delivered`; on failure it is rescheduled (or dead-lettered once
 * `WEBHOOK_MAX_ATTEMPTS` is reached). A delivery whose subscription was
 * deactivated, or whose payload predates the payload column, is dead-lettered so
 * it can't loop forever. Best-effort per row; returns the count attempted.
 *
 * Wired into the frequent-tick `scheduled()` cron in index.ts — mirrors
 * runRetentionPurge / reapStaleExecutions.
 */
export async function runWebhookRetrySweep(env: Env, nowMs: number = Date.now(), deps: SweepDeps = {}): Promise<number> {
  const db = deps.db ?? buildDatabase(env);
  const doFetch = deps.fetchImpl ?? fetch;
  const now = new Date(nowMs);
  const nowSec = Math.floor(nowMs / 1000);

  const due = await db
    .select({
      id: webhookDeliveries.id,
      attempts: webhookDeliveries.attempts,
      payload: webhookDeliveries.payload,
      url: webhookSubscriptions.url,
      secret: webhookSubscriptions.secret,
      active: webhookSubscriptions.active,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookSubscriptions, eq(webhookDeliveries.subscriptionId, webhookSubscriptions.id))
    .where(and(
      isNotNull(webhookDeliveries.nextRetryAt),
      lte(webhookDeliveries.nextRetryAt, now),
    ))
    .limit(WEBHOOK_SWEEP_BATCH);

  let attempted = 0;
  for (const row of due) {
    // Dead-letter rows we can never deliver: inactive subscription, or a legacy
    // row with no stored payload to re-sign.
    if (!row.active || !row.payload) {
      await db
        .update(webhookDeliveries)
        .set({ nextRetryAt: null, lastError: !row.active ? 'subscription inactive' : 'no stored payload' })
        .where(eq(webhookDeliveries.id, row.id))
        .catch(() => { /* bookkeeping best-effort */ });
      continue;
    }

    attempted += 1;
    const attempts = row.attempts + 1;
    try {
      const signature = await signWebhook(row.secret, row.id, nowSec, row.payload);
      const res = await doFetch(row.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [WEBHOOK_ID_HEADER]: row.id,
          [WEBHOOK_TIMESTAMP_HEADER]: String(nowSec),
          [WEBHOOK_SIGNATURE_HEADER]: `sha256=${signature}`,
        },
        body: row.payload,
      });
      if (res.ok) {
        await db
          .update(webhookDeliveries)
          .set({ status: 'delivered', attempts, responseStatus: res.status, nextRetryAt: null, deliveredAt: now })
          .where(eq(webhookDeliveries.id, row.id));
      } else {
        await recordDeliveryFailure(db, row.id, attempts, nowSec, `HTTP ${res.status}`, res.status);
      }
    } catch (err) {
      await recordDeliveryFailure(db, row.id, attempts, nowSec, err)
        .catch(() => { /* never let bookkeeping throw into the sweep */ });
    }
  }

  return attempted;
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
