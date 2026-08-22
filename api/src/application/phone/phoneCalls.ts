/**
 * CALLS — placing them, logging them, and billing the minutes.
 *
 * ── WHY THERE IS NO `call_logs` TABLE ────────────────────────────────────────
 * A call is an EVENT: an actor did a thing to a target at a time, with a
 * duration and an outcome. `activity_log` is that shape and is this platform's
 * ONE audit store (0295), so a call log lands there with `verb='phone.call'` and
 * the same reader, retention and export as everything else that happened. A
 * second event table beside it would be a second place to look for "what did this
 * number do", and the two would answer differently the first time one of them was
 * swept.
 *
 * The coverage map agrees — `HV call_logs → event_log`.
 *
 * ── BILLING HAPPENS ON COMPLETION, NOT ON DIAL ───────────────────────────────
 * A call's cost is its duration, which is not known when it starts. So the dial
 * checks affordability against ONE minute (the minimum billable unit), and the
 * status callback debits the real duration when the call ends. A caller with no
 * credit is refused up front; a caller with a minute's worth cannot run up an
 * hour, because {@link applyCallStatus} debits what actually happened and the
 * next dial sees the resulting balance.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { activityLog } from '../../infrastructure/database/schema';
import { recordActivity } from '../activity/activityLog';
import { executeConnectorAction } from '../connectors/connectorRuntime';
import { debitComms, reserveComms, type CommsRefusal } from './commsBalance';
import { rateFor, voiceMinutes, type CommsRateOverride } from './commsRates';
import { defaultSendingNumber } from './phoneNumbers';
import { phonePlan, requireActivePhonePlan, type PlanRefusal } from './phonePlan';

const VENDOR = 'twilio';

/** The verb every call event is filed under. One constant, so the writer and
 *  every reader agree without a string literal in two places. */
export const CALL_VERB = 'phone.call';

export type PlaceCallRefusal =
  | CommsRefusal
  | PlanRefusal
  | { ok: false; reason: 'no_sending_number' | 'vendor_refused'; detail?: string };

export interface PlacedCall {
  providerRef: string | null;
  to: string;
  from: string;
}

/**
 * Place an outbound call.
 *
 * `twiml` is what the callee hears. It is a required parameter rather than a
 * default because a call that connects to silence is worse than no call: the
 * caller pays for the minute and the callee learns nothing.
 */
export async function placeCall(
  db: Db, env: Env,
  input: {
    tenantId: number; to: string; twimlUrl: string; from?: string;
    actorRef?: string | null; rateOverride?: CommsRateOverride | null;
  },
): Promise<{ ok: true; call: PlacedCall } | PlaceCallRefusal> {
  const gate = await requireActivePhonePlan(db, env, input.tenantId);
  if (!gate.ok) return gate;

  const from = input.from ?? (await defaultSendingNumber(db, input.tenantId))?.e164;
  if (!from) return { ok: false, reason: 'no_sending_number' };

  // One minute is the minimum billable unit, so it is also the minimum a caller
  // must be able to afford before the line opens.
  const minute = rateFor('voice_minute', input.rateOverride ?? gate.plan.rates);
  const affordable = await reserveComms(db, env, input.tenantId, minute);
  if (!affordable.ok) return affordable;

  const result = await executeConnectorAction({
    db, env, tenantId: input.tenantId,
    connectorKey: VENDOR, actionKey: 'make_call',
    actorKind: 'user',
    input: { To: input.to, From: from, Url: input.twimlUrl },
  });

  if (!result.ok) return { ok: false, reason: 'vendor_refused', detail: result.error };

  const vendor = (result.data ?? {}) as Record<string, unknown>;
  const providerRef = typeof vendor.sid === 'string' ? vendor.sid : null;

  await recordActivity(env, db, {
    tenantId: input.tenantId,
    actor: { type: input.actorRef ? 'human' : 'system', ref: input.actorRef ?? null },
    verb: CALL_VERB,
    targetType: 'phone_number',
    targetId: providerRef ?? input.to,
    targetLabel: input.to,
    summary: `Called ${input.to} from ${from}`,
    metadata: { direction: 'outbound', to: input.to, from, status: 'initiated', providerRef },
  });

  return { ok: true, call: { providerRef, to: input.to, from } };
}

/**
 * Settle a call that has ended: record the outcome and bill the minutes.
 *
 * Idempotent on the call SID — `debitComms` refuses a duplicate reference, so a
 * retried status callback cannot bill twice, and the event row is written only
 * when the debit was the first one.
 */
export async function applyCallStatus(
  db: Db, env: Env,
  input: {
    tenantId: number; providerRef: string; to: string; from: string;
    status: string; durationSeconds: number; direction: 'inbound' | 'outbound';
    rateOverride?: CommsRateOverride | null;
  },
): Promise<boolean> {
  // Only a completed call has billable minutes. `busy`, `no-answer` and `failed`
  // cost nothing and are still worth recording — "we tried and they did not pick
  // up" is the answer somebody is looking for.
  const billable = input.status === 'completed' && input.durationSeconds > 0;
  const minutes = billable ? voiceMinutes(input.durationSeconds) : 0;
  // NOT gated on an active plan, deliberately: this is the settlement of a call
  // that already happened, and a subscription that lapsed while somebody was
  // talking does not make the carrier's invoice go away. It reads the plan only
  // for the RATE, which stays whatever the customer was quoted.
  const rates = input.rateOverride ?? (await phonePlan(db, env, input.tenantId)).rates;
  const costCents = minutes * rateFor('voice_minute', rates);

  const fresh = billable
    ? await debitComms(db, env, {
      tenantId: input.tenantId,
      cents: costCents,
      reference: `phone:call:${input.providerRef}`,
      memo: `${input.direction === 'inbound' ? 'Call from' : 'Call to'} ${input.direction === 'inbound' ? input.from : input.to} (${minutes} min)`,
      metadata: { providerRef: input.providerRef, minutes, direction: input.direction },
    })
    : true;

  if (!fresh) return false;

  await recordActivity(env, db, {
    tenantId: input.tenantId,
    actor: { type: 'system', ref: null },
    verb: CALL_VERB,
    targetType: 'phone_number',
    targetId: input.providerRef,
    targetLabel: input.direction === 'inbound' ? input.from : input.to,
    summary: `${input.direction === 'inbound' ? 'Inbound' : 'Outbound'} call ${input.status}${minutes ? ` — ${minutes} min` : ''}`,
    metadata: {
      direction: input.direction, to: input.to, from: input.from,
      status: input.status, durationSeconds: input.durationSeconds,
      minutes, costCents, providerRef: input.providerRef,
    },
  });
  return true;
}

export interface CallLogRow {
  id: number;
  direction: string;
  counterparty: string;
  status: string;
  durationSeconds: number;
  costCents: number;
  occurredAt: string;
}

/**
 * The call log.
 *
 * Reads `activity_log` filtered to this verb — the same store every other event
 * on the platform uses, which is why there is no join here and no second table to
 * keep in step.
 */
export async function callLog(db: Db, tenantId: number, limit = 50): Promise<CallLogRow[]> {
  const rows = await db.select({
    id: activityLog.id,
    targetLabel: activityLog.targetLabel,
    metadata: activityLog.metadata,
    occurredAt: activityLog.occurredAt,
  })
    .from(activityLog)
    .where(and(
      eq(activityLog.tenantId, tenantId),
      eq(activityLog.verb, CALL_VERB),
      // Only settled rows. The `initiated` row written at dial time is superseded
      // by the completion row, and showing both makes one call look like two.
      sql`${activityLog.metadata}->>'status' <> 'initiated'`,
    ))
    .orderBy(desc(activityLog.occurredAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      id: Number(row.id),
      direction: String(meta.direction ?? 'outbound'),
      counterparty: row.targetLabel ?? '',
      status: String(meta.status ?? 'unknown'),
      durationSeconds: Number(meta.durationSeconds ?? 0),
      costCents: Number(meta.costCents ?? 0),
      occurredAt: (row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt)).toISOString(),
    };
  });
}
