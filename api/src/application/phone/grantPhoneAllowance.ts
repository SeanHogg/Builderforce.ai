/**
 * THE MONTHLY ALLOWANCE — the credit the subscription actually buys.
 *
 * ── WHY A SWEEP AND NOT A RENEWAL WEBHOOK ────────────────────────────────────
 * The processor does send a renewal event, and hanging the grant off it would be
 * one fewer moving part. It would also mean that a webhook the platform never
 * received is a month a paying customer silently got nothing — and the failure is
 * invisible, because the phone still works right up until the balance runs out.
 * A sweep keyed on the CALENDAR month is self-healing: whatever it missed, it
 * grants the next time it runs, and the unique reference makes the webhook and
 * the sweep land on the same single row if both ever fire.
 *
 * ── ONE MONTH, ONE GRANT, NO PRORATION ───────────────────────────────────────
 * A tenant who activates on the 28th gets the full allowance for that month.
 * Prorating it would be arithmetically fairer and would also mean the first
 * experience of a paid phone product is a fraction of what the pricing page
 * promised. The platform absorbs at most one partial month per customer, once.
 *
 * ── UNSPENT CREDIT DOES NOT EXPIRE ───────────────────────────────────────────
 * Deliberately, and stated here because the alternative is easy to add later by
 * accident: an expiry would need a monthly debit that claws back the unused
 * portion, which is a second money-moving sweep whose bugs are invisible to the
 * customer until their balance is wrong. Credit rolls over. A tenant who under-
 * uses the product for six months accumulates six months of allowance, which is
 * a cost the platform accepts in exchange for never having to explain a
 * disappearing balance.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { settings } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { getPublishedPricing } from '../tenant/pricingConfiguration';
import { topUpComms } from './commsBalance';
import { allowanceCents, BUSINESS_PHONE_FEATURE } from './phonePlan';

export interface AllowanceGrantResult {
  subscriptionsChecked: number;
  granted: number;
  centsGranted: number;
}

export async function runPhoneAllowanceSweep(db: Db, env: Env): Promise<AllowanceGrantResult> {
  const monthKey = new Date().toISOString().slice(0, 7);
  const result: AllowanceGrantResult = { subscriptionsChecked: 0, granted: 0, centsGranted: 0 };

  // Every tenant's entitlement, DECLARED: an allowance is a platform-wide
  // obligation and a sweep scoped to one tenant would pay one customer what they
  // are owed and quietly stiff the rest. The access predicate is the feature key
  // and the status inside the value.
  const rows = await db.select({ tenantId: settings.tenantId })
    .from(settings)
    .where(acrossTenants(
      settings, 'scheduled_sweep',
      and(
        eq(settings.scope, 'tenant'),
        eq(settings.feature, BUSINESS_PHONE_FEATURE),
        sql`${settings.value}->>'status' = 'active'`,
      )!,
    ));

  if (rows.length === 0) return result;

  // Read the price list ONCE. It is the same document for every tenant, and
  // re-reading it per row would turn a cached lookup into an N-query sweep.
  const cents = allowanceCents((await getPublishedPricing(db, env)).businessPhone);
  if (cents <= 0) return result;

  for (const row of rows) {
    result.subscriptionsChecked += 1;
    const applied = await topUpComms(db, env, {
      tenantId: row.tenantId,
      cents,
      reference: `phone:allowance:${row.tenantId}:${monthKey}`,
      memo: `Business Phone allowance — ${monthKey}`,
      metadata: { monthKey, kind: 'allowance' },
    });
    if (applied) {
      result.granted += 1;
      result.centsGranted += cents;
    }
  }

  return result;
}

/** The sweep's log line, or null when nothing moved. */
export function describeAllowanceGrant(result: AllowanceGrantResult): string | null {
  if (result.granted === 0) return null;
  return `subscriptions=${result.subscriptionsChecked} granted=${result.granted} cents=${result.centsGranted}`;
}
