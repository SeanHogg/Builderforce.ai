/**
 * WHAT THE TENANT ACTUALLY BOUGHT — the bridge between the add-on and the meter.
 *
 * ── THE PROBLEM THIS EXISTS TO CLOSE ─────────────────────────────────────────
 * Business Phone is a PRODUCT that is already sold: `/api/tenants/:id/add-ons/
 * business-phone/checkout` takes an activation fee and a monthly subscription,
 * and the published pricing document quotes the customer an allowance ("200
 * minutes, 300 SMS, 15 MMS") and an overage rate per unit. The metering built on
 * top of it — `commsRates` — had its own flat card with different numbers. Two
 * price lists for one product is the shape where a customer is quoted one price
 * and billed another, and neither side is wrong on its own.
 *
 * So the RATE CARD comes from the published pricing document, and this module is
 * the only place that conversion happens. `DEFAULT_COMMS_RATES` remains the
 * fallback for the case the document cannot be read — a phone product that stops
 * metering when the pricing table is unavailable is a phone product that gives
 * itself away.
 *
 * ── THE ALLOWANCE IS CREDIT, NOT A SEPARATE COUNTER ──────────────────────────
 * "200 included minutes" could be a per-channel counter with its own reset date,
 * its own row, and its own way of disagreeing with the ledger. It is instead
 * granted monthly as `comm_credits` priced at the quoted overage rate: the
 * customer gets exactly what they were sold, spends it across whichever channel
 * they actually use, and there is still ONE number that answers "what is left".
 * A tenant who sends no SMS and talks for 300 minutes is better off than the
 * counter model would leave them, which is the right direction for that error.
 *
 * ── MONEY CROSSES INTO CENTS HERE AND NOWHERE ELSE ───────────────────────────
 * The pricing document is in dollars, because that is what an operator types.
 * Everything downstream of this file is integer-ish cents. Fractional cents
 * survive on purpose — an SMS at 1.2¢ is a real quoted price, and `debitComms`
 * rounds the TOTAL up rather than rounding each unit and compounding the error.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { settings } from '../../infrastructure/database/schema';
import { getPublishedPricing } from '../tenant/pricingConfiguration';
import type { CommsRateOverride } from './commsRates';

/** The `settings.feature` the add-on webhook writes. One constant so the writer
 *  (`recordBusinessPhoneEvent`) and every reader agree. */
export const BUSINESS_PHONE_FEATURE = 'business_phone';

export interface PhonePlan {
  /** True only while the subscription is paid and live. Everything that spends
   *  money or provisions a number is gated on this. */
  active: boolean;
  /** `active` | `past_due` | `cancelled` | `none` — what to TELL the operator,
   *  which is a different question from whether to let them send. */
  status: string;
  /** The card, quoted from the published pricing document. */
  rates: CommsRateOverride;
  /** Numbers the subscription already pays for. The monthly fee buys a dedicated
   *  business number, so charging rent for the first one would bill it twice. */
  includedNumbers: number;
  /** What one month of the subscription is worth in communications credit. */
  allowanceCents: number;
}

const INACTIVE: PhonePlan = {
  active: false, status: 'none', rates: {}, includedNumbers: 0, allowanceCents: 0,
};

/**
 * Resolve a tenant's phone entitlement and the prices that apply to it.
 *
 * Both reads are served from the shared read-through cache by their own owners
 * (`getPublishedPricing` caches for a year and invalidates on publish; the
 * entitlement row is a single indexed lookup), so this is cheap enough to call
 * on every send rather than being threaded through as a parameter — which is
 * what would let one call site forget the gate.
 */
export async function phonePlan(db: Db, env: Env, tenantId: number): Promise<PhonePlan> {
  const [row] = await db.select({ value: settings.value })
    .from(settings)
    .where(and(
      eq(settings.tenantId, tenantId),
      eq(settings.scope, 'tenant'),
      eq(settings.scopeRef, ''),
      eq(settings.feature, BUSINESS_PHONE_FEATURE),
    ))
    .limit(1);

  if (!row) return INACTIVE;
  const status = String((row.value as { status?: string } | null)?.status ?? 'unknown');

  const pricing = await getPublishedPricing(db, env);
  const phone = pricing.businessPhone;

  return {
    active: status === 'active',
    status,
    rates: ratesFromPricing(phone),
    // A cancelled or past-due plan includes nothing: the rent sweep must start
    // charging for the number the subscription used to cover, or a lapsed tenant
    // keeps a number the platform pays for indefinitely.
    includedNumbers: status === 'active' ? 1 : 0,
    allowanceCents: status === 'active' ? allowanceCents(phone) : 0,
  };
}

export type PlanRefusal = { ok: false; reason: 'addon_inactive'; status: string };

/**
 * The entitlement gate, expressed where it cannot be skipped.
 *
 * It lives in the application layer rather than as route middleware on purpose:
 * an HTTP handler is not the only caller. An MCP tool, a workflow step and a
 * campaign automation all reach `sendSms` directly, and a gate that only exists
 * at the route is a gate three other doors walk around. Every spend path calls
 * this first and passes `plan.rates` on to the meter, so the price charged and
 * the entitlement checked are read in the same breath and cannot drift.
 */
export async function requireActivePhonePlan(
  db: Db, env: Env, tenantId: number,
): Promise<{ ok: true; plan: PhonePlan } | PlanRefusal> {
  const plan = await phonePlan(db, env, tenantId);
  if (!plan.active) return { ok: false, reason: 'addon_inactive', status: plan.status };
  return { ok: true, plan };
}

type PhonePricing = Awaited<ReturnType<typeof getPublishedPricing>>['businessPhone'];

/** Dollars → cents, once. Fractional survives; see the file docstring. */
export function ratesFromPricing(phone: PhonePricing): CommsRateOverride {
  return {
    sms_segment: phone.overagePerSms * 100,
    mms_message: phone.overagePerMms * 100,
    voice_minute: phone.overagePerMinute * 100,
    // Extra numbers beyond the included one are not in the published document —
    // an operator has never quoted a price for a second business line. The card
    // default stands until they do, rather than inventing one here where nobody
    // would find it.
  };
}

/** What the monthly subscription grants, priced at the rates the customer was
 *  quoted. Rounded UP so the grant is never a cent short of the quote. */
export function allowanceCents(phone: PhonePricing): number {
  return Math.ceil(
    phone.includedMinutes * phone.overagePerMinute * 100
    + phone.includedSms * phone.overagePerSms * 100
    + phone.includedMms * phone.overagePerMms * 100,
  );
}
