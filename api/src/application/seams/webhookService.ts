import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * THE outbound webhook emitter — one signing scheme, one backoff curve, one log.
 *
 * It arrived for the cross-domain (channel-3) seams (spec 05 §4.3) and now also
 * carries the PUBLIC canvas API's board and item lifecycle events. That is
 * deliberate and it is the whole design note: a second emitter for canvas would
 * mean a second header scheme, a second retry policy and two answers to "did that
 * one land", and only one of the two would ever get the next fix. What canvas
 * needed was a wider event vocabulary and a subscription that can be scoped to a
 * BOARD — not a second delivery loop.
 *
 * Each delivery is:
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
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

/**
 * Events an integrator may subscribe to.
 *
 * The three seam events came first. The canvas six are namespaced `canvas.*`
 * rather than spelled `board.created` / `item.created`, because "item" and
 * "board" are words this platform already uses for a kanban board and a work
 * item — an unqualified `item.created` on a subscription list is genuinely
 * ambiguous to the person choosing which boxes to tick.
 *
 * They are one flat list rather than two, because a subscription holds one array
 * and the emitter reads one vocabulary. Splitting them would put the question
 * "which list is this event from" in front of every caller.
 */
export const WEBHOOK_EVENTS = [
  'workitem.released',
  'sprint.completed',
  'roadmap.published',
  // ── Canvas board + item lifecycle (`/api/v1`) ────────────────────────────
  'canvas.board.created',
  'canvas.board.updated',
  'canvas.board.deleted',
  'canvas.item.created',
  'canvas.item.updated',
  'canvas.item.deleted',
] as const;

/** The canvas subset, for the surfaces that only offer those (the widget docs,
 *  the `/api/v1/webhooks` catalogue). Derived from the list above so a new canvas
 *  event cannot be added to one and forgotten in the other. */
export const CANVAS_WEBHOOK_EVENTS = WEBHOOK_EVENTS.filter((e) => e.startsWith('canvas.'));

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
  /** Narrowing context, not the scope. NULL/absent = the event is not segment-bound
   *  (a canvas board's segment is optional), and only segment-agnostic subscriptions
   *  match it. */
  segmentId?: string | null;
  /** The board this event happened on, when it happened on one. A subscription that
   *  named a `sessionId` receives only its own board's events. */
  sessionId?: string | null;
  eventType: WebhookEvent;
  /**
   * The identity of this OCCURRENCE — not of the thing it happened to.
   *
   * It is half of the unique index that makes replay safety a database fact
   * (`uq_webhook_delivery_event`, migration 1100), so it has to be unique per
   * occurrence or a legitimate second event is silently swallowed as a duplicate.
   * Canvas emitters therefore compose it from the board's own monotonic revision —
   * `<sessionId>.<revision>.<objectId>` — which makes a retried API call that lands
   * on the same revision collide, and two real edits never collide.
   */
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
 * Deliver an event to every active subscription in the TENANT that subscribed to
 * it and whose segment/board narrowing (if any) matches. Best-effort: a failing
 * endpoint is recorded as `failed` and never throws to the caller (the emit is
 * fire-and-forget from a mutation path).
 *
 * Returns the number of MATCHED endpoints. A matched endpoint whose delivery row
 * collided with `uq_webhook_delivery_event` is counted but not re-sent — it is the
 * same occurrence, already enqueued.
 */
export async function emitWebhookEvent(db: Db, input: EmitInput, deps: EmitDeps = {}): Promise<number> {
  const doFetch = deps.fetchImpl ?? fetch;
  const nowSec = deps.nowSec ?? (() => Math.floor(Date.now() / 1000));

  // TENANT-scoped, which it was not before: the predicate was `segment_id = $1`
  // alone, selective by accident (a uuid) rather than by rule. Segment and board are
  // narrowing filters applied below, because a NULL in either column means "any",
  // and expressing "column IS NULL OR column = $1" twice in SQL is less legible than
  // the two lines it becomes here — the row set is one tenant's subscriptions, which
  // is small by construction.
  const subs = await db
    .select({
      id: webhookSubscriptions.id,
      url: webhookSubscriptions.url,
      secret: webhookSubscriptions.secret,
      events: webhookSubscriptions.events,
      segmentId: webhookSubscriptions.segmentId,
      sessionId: webhookSubscriptions.sessionId,
    })
    .from(webhookSubscriptions)
    .where(scopedToTenant(webhookSubscriptions, input.tenantId, eq(webhookSubscriptions.active, true)));

  const targets = subs.filter((s) => (
    parseEvents(s.events).includes(input.eventType)
    // A subscription that named a segment or a board hears only that one; a
    // subscription that named neither hears the whole workspace.
    && (s.segmentId == null || s.segmentId === input.segmentId)
    && (s.sessionId == null || s.sessionId === input.sessionId)
  ));
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
      //
      // ON CONFLICT DO NOTHING against `uq_webhook_delivery_event` is THE replay
      // guard, and it is the insert rather than a preceding read on purpose: two
      // concurrent retries both read "not seen", both pass a check, and both POST.
      // No row back therefore means "this occurrence is already enqueued or already
      // sent" — the correct outcome is to send nothing at all, not to try again.
      const [delivery] = await db
        .insert(webhookDeliveries)
        .values({
          subscriptionId: sub.id,
          tenantId: input.tenantId,
          segmentId: input.segmentId ?? null,
          eventType: input.eventType,
          eventId: input.eventId,
          status: 'pending',
          attempts: 1,
          payload: body,
        })
        .onConflictDoNothing()
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
          .catch((error) => { /* never let bookkeeping throw into the emit path */ 
            reportCaughtError(error, { source: "application/seams/webhookService.ts", operation: "emitWebhookEvent" });
          });
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
    .where(and(isNotNull(webhookDeliveries.nextRetryAt), lte(webhookDeliveries.nextRetryAt, now)))
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
        .catch((error) => { /* bookkeeping best-effort */ 
          reportCaughtError(error, { source: "application/seams/webhookService.ts", operation: "runWebhookRetrySweep" });
        });
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
        .catch((error) => { /* never let bookkeeping throw into the sweep */ 
          reportCaughtError(error, { source: "application/seams/webhookService.ts", operation: "runWebhookRetrySweep" });
        });
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
