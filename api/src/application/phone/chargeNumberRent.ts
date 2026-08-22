/**
 * MONTHLY RENT ON A PROVISIONED NUMBER — the sweep that keeps the meter honest.
 *
 * ── WHY THIS IS NOT OPTIONAL ─────────────────────────────────────────────────
 * A number costs the platform every month it is held. `purchaseNumber` charges
 * the FIRST month; nothing else ever charges again. Without this sweep a tenant
 * pays once and keeps the number for years — the same shape of silent leak the
 * AI-credit reconcile exists to close, and equally invisible, because the feature
 * keeps working perfectly while the money runs one way.
 *
 * ── IDEMPOTENT PER NUMBER PER MONTH ──────────────────────────────────────────
 * The reference is `phone:number:<ref>:<YYYY-MM>`, unique on the ledger, so
 * running the sweep twice in a day charges once and a sweep that missed a month
 * charges that month when it next runs rather than skipping it.
 *
 * ── THE FIRST NUMBER IS ALREADY PAID FOR ─────────────────────────────────────
 * The Business Phone subscription buys a dedicated business number. Charging
 * rent for it would bill the same line twice — once on the card and once against
 * the credit balance — so `plan.includedNumbers` worth of numbers per tenant are
 * skipped, oldest first, and only the extras are metered. A tenant whose
 * subscription lapses loses the inclusion and starts paying rent on the number
 * the subscription used to cover, which is the outcome that keeps a cancelled
 * customer from holding a number the platform is still paying the carrier for.
 *
 * ── WHAT HAPPENS WHEN A TENANT CANNOT PAY ────────────────────────────────────
 * The number is SUSPENDED, not released. Suspension stops outbound use and is
 * reversible by topping up; releasing would hand the number back to the carrier
 * and it cannot be reclaimed — an irreversible consequence for a temporary
 * shortfall. The vendor still bills us while it is suspended, which is a cost
 * this platform accepts in exchange for not destroying a customer's phone number
 * over a lapsed balance. A number that stays suspended is an operator decision,
 * and `suspendedSince` in the metadata is what that decision reads.
 */

import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { businessPhoneNumbers } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { commsBalance, debitComms } from './commsBalance';
import { phonePlan } from './phonePlan';

export interface NumberRentResult {
  numbersChecked: number;
  charged: number;
  centsCharged: number;
  /** Numbers the subscription already covers — billed nothing, on purpose. */
  included: number;
  suspended: number;
  reactivated: number;
}

export async function runPhoneNumberRentSweep(db: Db, env: Env): Promise<NumberRentResult> {
  const monthKey = new Date().toISOString().slice(0, 7);
  const result: NumberRentResult = {
    numbersChecked: 0, charged: 0, centsCharged: 0, included: 0, suspended: 0, reactivated: 0,
  };

  // Every tenant's numbers, DECLARED: rent is a platform-wide obligation and a
  // sweep that filtered to one tenant would bill one customer and forget the rest.
  // The access predicate is the status — a released number is nobody's rent.
  //
  // Ordered by (tenant, id) so "the first number" means the same thing here as it
  // does to `defaultSendingNumber`: the inclusion has to land on the line the
  // tenant actually sends from, not on whichever row the planner happened to
  // return first.
  const rows = await db.select()
    .from(businessPhoneNumbers)
    .where(acrossTenants(
      businessPhoneNumbers, 'scheduled_sweep',
      sql`${businessPhoneNumbers.status} in ('active', 'suspended')`,
    ))
    .orderBy(businessPhoneNumbers.tenantId, businessPhoneNumbers.id);

  // Balances and entitlements are read once per TENANT, not once per number: a
  // tenant with eight numbers is one scan, not eight, and the running totals below
  // are what keep the decision correct across them without re-reading after every
  // debit.
  const remaining = new Map<number, number>();
  const freeLeft = new Map<number, number>();

  for (const row of rows) {
    result.numbersChecked += 1;

    if (!remaining.has(row.tenantId)) {
      const [balance, plan] = await Promise.all([
        commsBalance(db, env, row.tenantId),
        phonePlan(db, env, row.tenantId),
      ]);
      remaining.set(row.tenantId, balance);
      freeLeft.set(row.tenantId, plan.includedNumbers);
    }
    const balance = remaining.get(row.tenantId) ?? 0;

    // The subscription already paid for this one.
    const free = freeLeft.get(row.tenantId) ?? 0;
    if (free > 0) {
      freeLeft.set(row.tenantId, free - 1);
      result.included += 1;
      // An included number that was suspended during a lapse comes back the moment
      // the subscription does — the same self-healing the paid path gets below.
      if (row.status === 'suspended') {
        await setStatus(db, row.tenantId, row.id, 'active');
        result.reactivated += 1;
      }
      continue;
    }

    if (balance < row.monthlyCents) {
      if (row.status === 'active') {
        await setStatus(db, row.tenantId, row.id, 'suspended');
        result.suspended += 1;
      }
      continue;
    }

    const charged = await debitComms(db, env, {
      tenantId: row.tenantId,
      cents: row.monthlyCents,
      reference: `phone:number:${row.providerRef ?? row.e164}:${monthKey}`,
      memo: `Phone number ${row.e164} — ${monthKey}`,
      metadata: { e164: row.e164, monthKey },
    });

    if (charged) {
      remaining.set(row.tenantId, balance - row.monthlyCents);
      result.charged += 1;
      result.centsCharged += row.monthlyCents;
    }

    // Paid up — a number suspended for a shortfall comes back on its own once the
    // tenant tops up, without an operator having to notice.
    if (row.status === 'suspended') {
      await setStatus(db, row.tenantId, row.id, 'active');
      result.reactivated += 1;
    }
  }

  return result;
}

async function setStatus(
  db: Db, tenantId: number, id: number, status: 'active' | 'suspended',
): Promise<void> {
  await db.update(businessPhoneNumbers)
    .set({ status, updatedAt: new Date() })
    .where(scopedToTenant(businessPhoneNumbers, tenantId, eq(businessPhoneNumbers.id, id)));
}

/** The sweep's log line, or null when nothing moved. */
export function describeNumberRent(result: NumberRentResult): string | null {
  if (result.charged === 0 && result.suspended === 0 && result.reactivated === 0) return null;
  return `numbers=${result.numbersChecked} included=${result.included} charged=${result.charged}`
    + ` cents=${result.centsCharged} suspended=${result.suspended} reactivated=${result.reactivated}`;
}
