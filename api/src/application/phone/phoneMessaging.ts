/**
 * SMS — sending, receiving, and the metering that makes it billed rather than free.
 *
 * ── WHY THERE IS NO `sms_messages` TABLE ─────────────────────────────────────
 * A message this platform sends to a recipient, with a template, a status, a
 * provider and a provider reference, is a `deliveries` row. That table already
 * declares `'sms'` in its channel list and already carries the queued → sent →
 * delivered → bounced lifecycle, the attempt counter and the retry flag. The
 * coverage map files `HV sms_messages` onto `message`; `deliveries` is the closer
 * fit and the one whose lifecycle is the message's, so that is where it lands —
 * an inbound message is the same row with a direction.
 *
 * ── SEGMENTS ARE THE UNIT, AND THE COUNT IS NOT `length / 160` ───────────────
 * One emoji in a 90-character body takes it from one segment to two, because the
 * encoding falls back to UCS-2 and the per-segment budget drops from 160 to 70.
 * `smsSegments` is that rule; charging by `length / 160` would under-bill exactly
 * the messages that cost most.
 *
 * ── CHARGE BEFORE SEND ───────────────────────────────────────────────────────
 * The affordability check runs before the vendor call and the debit runs after a
 * successful hand-off. Debiting only on the delivery receipt would let a tenant
 * at zero blast an unbounded number of messages that are already paid for by us
 * before any of them settles.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { deliveries } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { executeConnectorAction } from '../connectors/connectorRuntime';
import { debitComms, reserveComms, type CommsRefusal } from './commsBalance';
import { rateFor, smsSegments, type CommsRateOverride } from './commsRates';
import { defaultSendingNumber } from './phoneNumbers';

const VENDOR = 'twilio';

/** The `deliveries.template` value that marks a row as belonging to the phone
 *  product. One constant, so the send path and every read filter agree. */
export const SMS_TEMPLATE = 'phone.sms';
export const SMS_INBOUND_TEMPLATE = 'phone.sms.inbound';

export type SendSmsRefusal =
  | CommsRefusal
  | { ok: false; reason: 'no_sending_number' | 'vendor_refused' | 'delivery_not_recorded'; detail?: string };

export interface SentSms {
  id: number;
  to: string;
  from: string;
  body: string;
  segments: number;
  costCents: number;
  providerRef: string | null;
}

export async function sendSms(
  db: Db, env: Env,
  input: { tenantId: number; to: string; body: string; from?: string; rateOverride?: CommsRateOverride | null },
): Promise<{ ok: true; message: SentSms } | SendSmsRefusal> {
  const from = input.from ?? (await defaultSendingNumber(db, input.tenantId))?.e164;
  if (!from) return { ok: false, reason: 'no_sending_number' };

  const segments = smsSegments(input.body);
  const costCents = segments * rateFor('sms_segment', input.rateOverride);

  const affordable = await reserveComms(db, env, input.tenantId, costCents);
  if (!affordable.ok) return affordable;

  // The row is written FIRST, as `queued`, so a message that the vendor accepts
  // but whose response we never see is still a row somebody can find. A send with
  // no local trace is the failure mode that makes a phone bill unexplainable.
  const [row] = await db.insert(deliveries).values({
    tenantId: input.tenantId,
    channel: 'sms',
    recipient: input.to,
    template: SMS_TEMPLATE,
    payload: { body: input.body, from, segments, direction: 'outbound' },
    status: 'queued',
    provider: VENDOR,
    retryable: false,
  }).returning({ id: deliveries.id });

  // `.returning()` is typed as an array, so the row is optional to the compiler. It is
  // not optional to this flow: the comment above is the entire reason the row is written
  // BEFORE the vendor call, and the failure update, the debit reference and the returned
  // id are all keyed on it. Refusing here beats sending an SMS with no local trace — the
  // failure this ordering exists to prevent. Nothing is held at this point (`reserveComms`
  // checks affordability and reserves nothing), so there is nothing to unwind.
  if (!row) return { ok: false, reason: 'delivery_not_recorded' };

  const result = await executeConnectorAction({
    db, env, tenantId: input.tenantId,
    connectorKey: VENDOR, actionKey: 'send_sms',
    actorKind: 'user',
    input: { To: input.to, From: from, Body: input.body },
  });

  if (!result.ok) {
    await db.update(deliveries)
      .set({ status: 'failed', error: result.error ?? `Vendor refused with ${result.status}`, attempts: 1, updatedAt: new Date() })
      .where(scopedToTenant(deliveries, input.tenantId, eq(deliveries.id, row.id)));
    return { ok: false, reason: 'vendor_refused', detail: result.error };
  }

  const vendor = (result.data ?? {}) as Record<string, unknown>;
  const providerRef = typeof vendor.sid === 'string' ? vendor.sid : null;

  await db.update(deliveries)
    .set({ status: 'sent', sentAt: new Date(), attempts: 1, providerRef, updatedAt: new Date() })
    .where(scopedToTenant(deliveries, input.tenantId, eq(deliveries.id, row.id)));

  await debitComms(db, env, {
    tenantId: input.tenantId,
    cents: costCents,
    reference: `phone:sms:${providerRef ?? row.id}`,
    memo: `SMS to ${input.to} (${segments} segment${segments === 1 ? '' : 's'})`,
    metadata: { deliveryId: Number(row.id), segments, to: input.to, from },
  });

  return {
    ok: true,
    message: { id: Number(row.id), to: input.to, from, body: input.body, segments, costCents, providerRef },
  };
}

/**
 * Record a message that arrived.
 *
 * Inbound is free — the vendor bills a fraction of a cent for receipt and passing
 * that through would mean charging a tenant for spam sent TO them. It is recorded
 * as `delivered` because from this platform's point of view it already arrived;
 * there is no lifecycle left to run.
 *
 * Idempotent on the vendor's message SID, because a webhook retry is normal.
 */
export async function recordInboundSms(
  db: Db,
  input: { tenantId: number; from: string; to: string; body: string; providerRef: string },
): Promise<boolean> {
  const [existing] = await db.select({ id: deliveries.id })
    .from(deliveries)
    .where(and(
      eq(deliveries.tenantId, input.tenantId),
      eq(deliveries.provider, VENDOR),
      eq(deliveries.providerRef, input.providerRef),
    ))
    .limit(1);
  if (existing) return false;

  await db.insert(deliveries).values({
    tenantId: input.tenantId,
    channel: 'sms',
    recipient: input.to,
    template: SMS_INBOUND_TEMPLATE,
    payload: { body: input.body, from: input.from, direction: 'inbound' },
    status: 'delivered',
    provider: VENDOR,
    providerRef: input.providerRef,
    retryable: false,
    deliveredAt: new Date(),
  });
  return true;
}

/**
 * Apply a delivery receipt.
 *
 * Twilio reports `delivered`, `undelivered` and `failed` after the fact. The
 * charge is NOT reversed on a failure: the carrier billed us for the attempt, so
 * refunding it would mean paying for every message to a disconnected number.
 * The row records what happened; the money already moved and stays moved.
 */
export async function applySmsStatus(
  db: Db,
  input: { tenantId: number; providerRef: string; status: string; error?: string | null },
): Promise<boolean> {
  const mapped = input.status === 'delivered' ? 'delivered'
    : input.status === 'undelivered' || input.status === 'failed' ? 'bounced'
      : input.status === 'sent' ? 'sent'
        : null;
  if (!mapped) return false;

  const updated = await db.update(deliveries)
    .set({
      status: mapped,
      ...(mapped === 'delivered' ? { deliveredAt: new Date() } : {}),
      ...(input.error ? { error: input.error } : {}),
      updatedAt: new Date(),
    })
    .where(and(
      eq(deliveries.tenantId, input.tenantId),
      eq(deliveries.provider, VENDOR),
      eq(deliveries.providerRef, input.providerRef),
    ))
    .returning({ id: deliveries.id });
  return updated.length > 0;
}

export interface SmsThreadRow {
  id: number;
  direction: 'inbound' | 'outbound';
  counterparty: string;
  body: string;
  status: string;
  occurredAt: string;
}

/** The message log, newest first. Both directions in one list — a conversation
 *  read as two separate lists is not a conversation. */
export async function smsLog(db: Db, tenantId: number, limit = 50): Promise<SmsThreadRow[]> {
  const rows = await db.select()
    .from(deliveries)
    .where(and(eq(deliveries.tenantId, tenantId), eq(deliveries.channel, 'sms')))
    .orderBy(desc(deliveries.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const inbound = row.template === SMS_INBOUND_TEMPLATE;
    return {
      id: Number(row.id),
      direction: inbound ? 'inbound' as const : 'outbound' as const,
      counterparty: inbound ? String(payload.from ?? '') : row.recipient,
      body: String(payload.body ?? ''),
      status: row.status,
      occurredAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
    };
  });
}
