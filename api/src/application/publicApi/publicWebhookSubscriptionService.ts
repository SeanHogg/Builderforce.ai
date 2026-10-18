/**
 * THE outbound-webhook subscription use case — every row here is a
 * `webhook_subscriptions` row delivered by the same `application/seams/webhookService`
 * loop every other webhook uses. This module owns the persistence and the domain
 * refusals (https-only url, at least one known event, secret length) that go with it.
 *
 * Two doors call it, and they stay two doors on purpose:
 *   • `/api/v1/webhooks` (`publicWebhookApiRoutes.ts`) — a tenant API key, TENANT-wide
 *     subscriptions (optionally one board), PATCH/rotate and the deliveries log.
 *   • `/v1/webhooks` (`seamRoutes.ts`) — the channel-3 host seam (spec 05 §4): a
 *     service token naming an end-client, so every row is narrowed to ONE segment and
 *     the wire shape is the one the host integration already parses.
 * The scope and the response shape differ; the RULES must not. The seam used to run
 * its own insert with a weaker copy of the validation (no url length cap, any secret
 * length), so a host could register a subscription `/api/v1` would refuse. Both doors
 * now go through the functions below.
 */

import { and, desc, eq } from 'drizzle-orm';
import { InternalError } from '../../domain/shared/errors';
import type { Db } from '../../infrastructure/database/connection';
import {
  creationSessions,
  webhookDeliveries,
  webhookSubscriptions,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { generateApiKey } from '../../infrastructure/auth/HashService';
import { isWebhookEvent, WEBHOOK_EVENTS } from '../seams/webhookService';
import { CREATION_UUID_RE as UUID_RE } from '../creation/creationGraphWriter';
import { parseEvents } from '../seams/webhookService';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';

export type WebhookSubscriptionRow = typeof webhookSubscriptions.$inferSelect;

export function webhookSubscriptionView(row: WebhookSubscriptionRow) {
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

export async function listWebhookSubscriptions(db: Db, tenantId: number): Promise<WebhookSubscriptionRow[]> {
  return db
    .select()
    .from(webhookSubscriptions)
    .where(scopedToTenant(webhookSubscriptions, tenantId))
    .orderBy(desc(webhookSubscriptions.createdAt))
    .limit(200);
}

export type WebhookSubscriptionWriteResult =
  | { ok: true; subscription: WebhookSubscriptionRow; secret?: string }
  | { ok: false; error: string; status: 400 | 404 };

function validateUrl(url: string): string | null {
  // https only. A signature proves who sent the body; it does nothing about who
  // READ it, and board content on the wire in plaintext is the same leak whether
  // or not it was signed.
  if (!/^https:\/\/[^\s]+$/.test(url) || url.length > 2000) {
    return 'url must be an https URL of at most 2000 characters';
  }
  return null;
}

function validateEvents(raw: unknown): string[] | null {
  const events = Array.isArray(raw) ? [...new Set(raw.filter(isWebhookEvent))] : [];
  return events.length ? events : null;
}

export interface CreateWebhookSubscriptionArgs {
  tenantId: number;
  /** The credential that registered it. Null only for a caller with no key row. */
  keyId: string | null;
  /** Narrow to ONE end-client segment — the `/v1` seam. Omitted ⇒ tenant-wide. */
  segmentId?: string | null;
  url: string;
  events: unknown;
  secret?: string;
  boardId?: string | null;
  description?: string | null;
}

export async function createWebhookSubscription(
  db: Db,
  args: CreateWebhookSubscriptionArgs,
): Promise<WebhookSubscriptionWriteResult> {
  const url = args.url.trim();
  const urlError = validateUrl(url);
  if (urlError) return { ok: false, error: urlError, status: 400 };

  const events = validateEvents(args.events);
  if (!events) return { ok: false, error: `events must include at least one of: ${WEBHOOK_EVENTS.join(', ')}`, status: 400 };

  // A board-scoped subscription must name a board in the KEY'S tenant — checked
  // with the tenant predicate in the query, so a foreign board id is "not found"
  // rather than a confirmation that it exists somewhere.
  let sessionId: string | null = null;
  if (args.boardId) {
    if (!UUID_RE.test(args.boardId)) return { ok: false, error: 'Board not found', status: 404 };
    const [board] = await db
      .select({ id: creationSessions.id })
      .from(creationSessions)
      .where(scopedToTenant(creationSessions, args.tenantId, eq(creationSessions.id, args.boardId)))
      .limit(1);
    if (!board) return { ok: false, error: 'Board not found', status: 404 };
    sessionId = board.id;
  }

  const secret = (args.secret ?? '').trim() || generateApiKey('whsec');
  if (secret.length < 16 || secret.length > 128) {
    return { ok: false, error: 'secret must be 16–128 characters', status: 400 };
  }

  const [row] = await db
    .insert(webhookSubscriptions)
    .values({
      tenantId: args.tenantId,
      // NULL: a `/api/v1` subscription is tenant-wide unless it named a board.
      // The seam subscriptions set it; see the column's comment.
      segmentId: args.segmentId ?? null,
      sessionId,
      url,
      secret,
      events: JSON.stringify(events),
      description: args.description?.slice(0, 255) || null,
      createdByKeyId: args.keyId,
    })
    .returning();
  if (!row) throw new InternalError('Could not create the subscription');

  // Once. The route never returns `secret` on a subsequent read.
  return { ok: true, subscription: row, secret };
}

export interface PatchWebhookSubscriptionArgs {
  tenantId: number;
  id: string;
  url?: string;
  events?: unknown;
  active?: boolean;
  description?: string | null;
  rotateSecret?: boolean;
}

export async function patchWebhookSubscription(
  db: Db,
  args: PatchWebhookSubscriptionArgs,
): Promise<WebhookSubscriptionWriteResult> {
  if (!UUID_RE.test(args.id)) return { ok: false, error: 'Subscription not found', status: 404 };

  const patch: Partial<typeof webhookSubscriptions.$inferInsert> = { updatedAt: new Date() };
  if (args.url !== undefined) {
    const url = args.url.trim();
    const urlError = validateUrl(url);
    if (urlError) return { ok: false, error: urlError, status: 400 };
    patch.url = url;
  }
  if (args.events !== undefined) {
    const events = validateEvents(args.events);
    if (!events) return { ok: false, error: `events must include at least one of: ${WEBHOOK_EVENTS.join(', ')}`, status: 400 };
    patch.events = JSON.stringify(events);
  }
  if (args.active !== undefined) patch.active = args.active;
  if (args.description !== undefined) patch.description = args.description?.slice(0, 255) || null;

  let rotated: string | undefined;
  if (args.rotateSecret) {
    rotated = generateApiKey('whsec');
    patch.secret = rotated;
  }

  const [row] = await db
    .update(webhookSubscriptions)
    .set(patch)
    .where(scopedToTenant(webhookSubscriptions, args.tenantId, eq(webhookSubscriptions.id, args.id)))
    .returning();
  if (!row) return { ok: false, error: 'Subscription not found', status: 404 };
  return { ok: true, subscription: row, secret: rotated };
}

export async function deleteWebhookSubscription(db: Db, tenantId: number, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const [row] = await db
    .delete(webhookSubscriptions)
    .where(scopedToTenant(webhookSubscriptions, tenantId, eq(webhookSubscriptions.id, id)))
    .returning({ id: webhookSubscriptions.id });
  return Boolean(row);
}

/** The `/v1` seam's view of a subscription: the columns the host integration was
 *  built against (`events` is the stored JSON text, exactly as it always returned). */
export interface SegmentWebhookSubscription {
  id: string;
  url: string;
  events: string;
  active: boolean;
  createdAt: Date;
}

/** One end-client segment's subscriptions — the `/v1/webhooks` list. */
export async function listSegmentWebhookSubscriptions(
  db: Db,
  tenantId: number,
  segmentId: string,
): Promise<SegmentWebhookSubscription[]> {
  return db
    .select({
      id: webhookSubscriptions.id,
      url: webhookSubscriptions.url,
      events: webhookSubscriptions.events,
      active: webhookSubscriptions.active,
      createdAt: webhookSubscriptions.createdAt,
    })
    .from(webhookSubscriptions)
    .where(scopedToTenant(webhookSubscriptions, tenantId, eq(webhookSubscriptions.segmentId, segmentId)))
    .orderBy(desc(webhookSubscriptions.createdAt))
    .limit(LIST_ROW_CAP);
}

/** Unsubscribe within one segment. The tenant predicate rides along with the
 *  segment's so a segment id alone can never reach another tenant's row. */
export async function deleteSegmentWebhookSubscription(
  db: Db,
  tenantId: number,
  segmentId: string,
  id: string,
): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const [row] = await db
    .delete(webhookSubscriptions)
    .where(scopedToTenant(
      webhookSubscriptions,
      tenantId,
      eq(webhookSubscriptions.id, id),
      eq(webhookSubscriptions.segmentId, segmentId),
    ))
    .returning({ id: webhookSubscriptions.id });
  return Boolean(row);
}

/**
 * Ownership check as its OWN tenant-scoped query, deliberately separate from the
 * deliveries read: joining deliveries to the subscription and filtering on the
 * delivery's tenant would let a caller learn a subscription id exists by getting
 * an empty list instead of a 404.
 */
export async function findWebhookSubscriptionId(db: Db, tenantId: number, id: string): Promise<string | null> {
  if (!UUID_RE.test(id)) return null;
  const [sub] = await db
    .select({ id: webhookSubscriptions.id })
    .from(webhookSubscriptions)
    .where(scopedToTenant(webhookSubscriptions, tenantId, eq(webhookSubscriptions.id, id)))
    .limit(1);
  return sub?.id ?? null;
}

export interface WebhookDeliveryRow {
  id: string;
  eventType: string;
  eventId: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  nextRetryAt: Date | null;
  payload: unknown;
  createdAt: Date;
  deliveredAt: Date | null;
}

export async function listWebhookDeliveries(
  db: Db,
  tenantId: number,
  subscriptionId: string,
  limit: number,
): Promise<WebhookDeliveryRow[]> {
  return db
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
      eq(webhookDeliveries.subscriptionId, subscriptionId),
      eq(webhookDeliveries.tenantId, tenantId),
    ))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
}
