/**
 * PROVISIONING A REAL NUMBER — search, buy, configure, release.
 *
 * ── WHAT MAKES THIS A PRODUCT RATHER THAN A CONNECTOR ────────────────────────
 * The Twilio connector could always CALL the numbers API. What it could not do is
 * own the result: nothing recorded which tenant a number belonged to, nothing
 * charged for it, and nothing pointed it back at this platform's webhooks, so a
 * bought number sat inert until somebody configured it by hand in a console.
 * This module is those three things, and `business_phone_numbers` — which already
 * existed with one feature path — is where the answer lives.
 *
 * ── THE VENDOR CALL GOES THROUGH THE CONNECTOR PORT ──────────────────────────
 * `executeConnectorAction`, not a hand-rolled fetch. That is not a style
 * preference: the port holds the credential seal, the SSRF guard on the resolved
 * URL, the call log and the per-tenant connection. A direct fetch here would be a
 * second, unaudited path to the same vendor with its own copy of the auth.
 *
 * ── BUYING IS A RACE, AND IT IS HANDLED ──────────────────────────────────────
 * A search result is not a reservation. Twilio hands out the number to whoever
 * buys first and answers everybody else with 21422. So {@link purchaseNumber}
 * treats that as a NORMAL outcome with its own refusal reason rather than an
 * error — the caller re-searches — and the local row is written only after the
 * vendor confirms.
 *
 * ── ORDER OF WRITES ──────────────────────────────────────────────────────────
 * charge → buy → record. The charge is first because a tenant who cannot afford
 * the number must not cause a purchase that then bills the platform monthly
 * forever; the local row is last because a row for a number the vendor refused is
 * a number this platform believes it owns and does not.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { businessPhoneNumbers } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { executeConnectorAction } from '../connectors/connectorRuntime';
import { debitComms, reserveComms, type CommsRefusal } from './commsBalance';
import { rateFor, type CommsRateOverride } from './commsRates';
import { requireActivePhonePlan, type PlanRefusal } from './phonePlan';

const VENDOR = 'twilio';

export interface AvailableNumber {
  e164: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
}

export interface ProvisionedNumber {
  id: number;
  e164: string;
  provider: string;
  providerRef: string | null;
  country: string | null;
  status: string;
  monthlyCents: number;
  capabilities: unknown;
}

export type PurchaseRefusal =
  | CommsRefusal
  | PlanRefusal
  | { ok: false; reason: 'number_taken' | 'vendor_refused'; detail: string };

/** Search purchasable numbers. Read-only and uncached — an availability list is
 *  stale the moment it is returned, and caching it would hand two tenants the
 *  same number and let the second discover it at purchase. */
export async function searchAvailableNumbers(
  db: Db, env: Env,
  input: { tenantId: number; country?: string; areaCode?: number; contains?: string; limit?: number },
): Promise<AvailableNumber[]> {
  const result = await executeConnectorAction({
    db, env, tenantId: input.tenantId,
    connectorKey: VENDOR, actionKey: 'search_available_numbers',
    actorKind: 'user',
    input: {
      CountryCode: (input.country ?? 'US').toUpperCase(),
      ...(input.areaCode ? { AreaCode: input.areaCode } : {}),
      ...(input.contains ? { Contains: input.contains } : {}),
      SmsEnabled: 'true',
      VoiceEnabled: 'true',
      PageSize: Math.min(Math.max(input.limit ?? 20, 1), 50),
    },
  });
  if (!result.ok) return [];
  return normaliseAvailable(result.data);
}

function normaliseAvailable(data: unknown): AvailableNumber[] {
  const rows = Array.isArray(data) ? data : [];
  return rows.flatMap((raw) => {
    const row = raw as Record<string, unknown>;
    const e164 = typeof row.phone_number === 'string' ? row.phone_number : null;
    if (!e164) return [];
    const caps = (row.capabilities ?? {}) as Record<string, unknown>;
    return [{
      e164,
      friendlyName: typeof row.friendly_name === 'string' ? row.friendly_name : e164,
      locality: typeof row.locality === 'string' ? row.locality : null,
      region: typeof row.region === 'string' ? row.region : null,
      capabilities: { voice: caps.voice === true, sms: caps.SMS === true || caps.sms === true, mms: caps.MMS === true || caps.mms === true },
    }];
  });
}

/**
 * Buy a number, charge for its first month, point it at this platform, and
 * record it.
 *
 * `webhookBase` is the public origin the vendor will call back on. It is a
 * parameter rather than an env read so the caller — which already knows the
 * request's own origin — supplies it, and a staging tenant cannot end up with a
 * production number pointed at production webhooks.
 */
export async function purchaseNumber(
  db: Db, env: Env,
  input: {
    tenantId: number; e164: string; webhookBase: string;
    label?: string; rateOverride?: CommsRateOverride | null;
  },
): Promise<{ ok: true; number: ProvisionedNumber } | PurchaseRefusal> {
  const gate = await requireActivePhonePlan(db, env, input.tenantId);
  if (!gate.ok) return gate;

  const monthlyCents = rateFor('number_month', input.rateOverride ?? gate.plan.rates);

  const affordable = await reserveComms(db, env, input.tenantId, monthlyCents);
  if (!affordable.ok) return affordable;

  const result = await executeConnectorAction({
    db, env, tenantId: input.tenantId,
    connectorKey: VENDOR, actionKey: 'buy_phone_number',
    actorKind: 'user',
    input: {
      PhoneNumber: input.e164,
      FriendlyName: input.label ?? `Builderforce ${input.e164}`,
      SmsUrl: `${input.webhookBase}/api/phone/webhooks/sms`,
      VoiceUrl: `${input.webhookBase}/api/phone/webhooks/voice`,
      StatusCallback: `${input.webhookBase}/api/phone/webhooks/status`,
    },
  });

  if (!result.ok) {
    const detail = result.error ?? `Vendor refused with ${result.status}`;
    // 21422 = "that number is not available for purchase", i.e. somebody took it
    // between the search and the buy. A normal outcome; the caller re-searches.
    const taken = result.status === 400 && /21422|not available/i.test(detail);
    return { ok: false, reason: taken ? 'number_taken' : 'vendor_refused', detail };
  }

  const vendor = (result.data ?? {}) as Record<string, unknown>;
  const providerRef = typeof vendor.sid === 'string' ? vendor.sid : null;
  const e164 = typeof vendor.phone_number === 'string' ? vendor.phone_number : input.e164;

  const [row] = await db.insert(businessPhoneNumbers).values({
    tenantId: input.tenantId,
    e164,
    provider: VENDOR,
    providerRef,
    country: (typeof vendor.iso_country === 'string' ? vendor.iso_country : 'US').slice(0, 2),
    capabilities: vendor.capabilities ?? null,
    status: 'active',
    monthlyCents,
  }).returning();

  // `.returning()` is typed as an array, so the row is optional to the compiler. Unlike
  // the SMS path, refusing here would be a LIE with a cost attached: the number is already
  // bought, and telling the caller the purchase failed makes them buy a second one. The
  // vendor side effect is irreversible, so this throws — loudly, with the provider ref
  // needed to reconcile by hand — rather than returning a refusal or a half-built object.
  if (!row) {
    throw new Error(
      `phone number ${e164} was purchased from ${VENDOR} (ref ${providerRef ?? 'unknown'}) `
        + `but no business_phone_numbers row came back; reconcile before re-provisioning`,
    );
  }

  await debitComms(db, env, {
    tenantId: input.tenantId,
    cents: monthlyCents,
    reference: `phone:number:${providerRef ?? e164}:first-month`,
    memo: `Phone number ${e164} — first month`,
    metadata: { e164, providerRef },
  });

  return { ok: true, number: toProvisioned(row) };
}

/** The tenant's numbers. */
export async function listNumbers(db: Db, tenantId: number): Promise<ProvisionedNumber[]> {
  const rows = await db.select()
    .from(businessPhoneNumbers)
    .where(and(eq(businessPhoneNumbers.tenantId, tenantId), sql`${businessPhoneNumbers.status} <> 'released'`));
  return rows.map(toProvisioned);
}

/** The number a tenant sends FROM. First active number, deliberately: a tenant
 *  with several picks explicitly, and one with a single number should never have
 *  to. */
export async function defaultSendingNumber(db: Db, tenantId: number): Promise<ProvisionedNumber | null> {
  const [row] = await db.select()
    .from(businessPhoneNumbers)
    .where(and(eq(businessPhoneNumbers.tenantId, tenantId), eq(businessPhoneNumbers.status, 'active')))
    .orderBy(businessPhoneNumbers.id)
    .limit(1);
  return row ? toProvisioned(row) : null;
}

/**
 * Give a number back.
 *
 * The local row is marked `released` rather than deleted: the calls and messages
 * that went through it are still in the log referencing this number, and deleting
 * the row would leave that history pointing at nothing. Billing stops because
 * `chargeMonthlyNumbers` only bills `active` rows.
 */
export async function releaseNumber(
  db: Db, env: Env, tenantId: number, numberId: number,
): Promise<boolean> {
  const [row] = await db.select()
    .from(businessPhoneNumbers)
    .where(scopedToTenant(businessPhoneNumbers, tenantId, eq(businessPhoneNumbers.id, numberId)))
    .limit(1);
  if (!row || row.status === 'released') return false;

  if (row.providerRef) {
    await executeConnectorAction({
      db, env, tenantId,
      connectorKey: VENDOR, actionKey: 'release_phone_number',
      actorKind: 'user', input: { Sid: row.providerRef },
    });
  }

  await db.update(businessPhoneNumbers)
    .set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(businessPhoneNumbers, tenantId, eq(businessPhoneNumbers.id, numberId)));
  return true;
}

function toProvisioned(row: typeof businessPhoneNumbers.$inferSelect): ProvisionedNumber {
  return {
    id: row.id,
    e164: row.e164,
    provider: row.provider,
    providerRef: row.providerRef,
    country: row.country,
    status: row.status,
    monthlyCents: row.monthlyCents,
    capabilities: row.capabilities,
  };
}
