/**
 * CLOSING A METERED PERIOD — the second half of PRD 24 §5.4 step 4.
 *
 * `extensionUsage.ts` counts units. This is the only place a unit ever meets a
 * currency: it reads the window since the install's watermark, prices it on the
 * plan the customer agreed to, puts ONE line on the invoice they already receive,
 * credits the publisher through the same rails every other seller is paid
 * through, and moves the watermark.
 *
 * ── WHY THE CHARGE IS AN INVOICE ITEM AND NOT A CHECKOUT ────────────────────
 * The whole Vercel argument (§2.4): every extra invoice is a conversion cliff.
 * A customer who picked a plan once should not be sent to a payment page for
 * $4.12 of API calls a month later. `PaymentProvider.addInvoiceItem` puts a
 * pending line on the subscription invoice they were already going to get, which
 * is what "billed on the tenant's invoice" actually means.
 *
 * ── WHY THE PUBLISHER IS CREDITED AT CLOSE, NOT AT COLLECTION ───────────────
 * PRD 24 §5.4 step 5 says the vendor is paid "on the normal cycle", and that is
 * the honest shape: the platform is the merchant of record, so the collection risk
 * on a customer's card is the platform's, not the vendor's. A vendor whose earning
 * appeared only once a customer's invoice cleared would be carrying a credit risk
 * they cannot see, cannot price and did not agree to.
 *
 * ── THE THREE THINGS THAT MAKE A RE-RUN SAFE ────────────────────────────────
 * A sweep retries. Every step here collides rather than repeats:
 *   · the order number and both ledger references derive from (install, periodEnd);
 *   · the processor gets the same `Idempotency-Key` for the same period;
 *   · the watermark moves only after the close succeeds, and moving it twice is
 *     a no-op because the second pass finds zero units in an empty window.
 */

import { eq, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  extensionPackages,
  extensionVersions,
  tenantExtensionInstalls,
  tenants,
} from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { packagePricing, findPlan } from './extensionPlans';
import { meteredUnits } from './extensionUsage';
import { recordExtensionSale, usageOccurrence } from './extensionEarnings';
import { invalidateInstalls } from './extensionRepository';
import { subscriptionEntitles, meteredChargeCents, planMeters } from './extensionContract';

/**
 * How long a metered window runs before it is closed.
 *
 * Thirty days rather than a calendar month, because the window opens when the
 * install does — a workspace that subscribed on the 31st has no monthly anniversary
 * in February, and inventing one is how a period silently doubles in length.
 */
const PERIOD_DAYS = 30;
const PERIOD_MS = PERIOD_DAYS * 24 * 60 * 60 * 1000;

/** Most installs one sweep tick closes. Bounds the cron's subrequest cost. */
const SWEEP_BATCH = 40;

export interface PeriodClose {
  installId: string;
  units: number;
  chargeCents: number;
  /** False when there was nothing to bill — the normal outcome inside an
   *  allowance. Distinguished from a failure so a sweep can report honestly. */
  billed: boolean;
  /** Null when the charge could not be placed on an invoice. The money is still
   *  recorded as owed — see `invoiceItemFailed`. */
  invoiceItemId: string | null;
  /** Set when the units were priced and credited but could not be invoiced: no
   *  Stripe customer on the workspace, or payments unconfigured here. */
  invoiceItemFailed: string | null;
}

/**
 * Close the open metered period on one install.
 *
 * Safe to call at any time and from anywhere — cancellation calls it so a
 * customer cannot get a free month by cancelling on its last day, and the sweep
 * calls it when the window is old enough. Closing early is not a partial month
 * that gets billed twice: the watermark moves to exactly where the sum stopped.
 */
export async function closeMeteredPeriod(
  db: Db,
  env: Env,
  installId: string,
): Promise<PeriodClose | null> {
  // Cross-tenant: the sweep has no tenant of its own, and a close is addressed by
  // the install rather than by the workspace it belongs to. `scheduled_sweep` is
  // the reason exactly — this runs with no session and no caller.
  const [row] = await db
    .select({
      install: tenantExtensionInstalls,
      pkg: extensionPackages,
      version: extensionVersions,
      buyer: tenants,
    })
    .from(tenantExtensionInstalls)
    .innerJoin(extensionPackages, eq(extensionPackages.id, tenantExtensionInstalls.packageId))
    .innerJoin(extensionVersions, eq(extensionVersions.id, tenantExtensionInstalls.versionId))
    .innerJoin(tenants, eq(tenants.id, tenantExtensionInstalls.tenantId))
    .where(acrossTenants(
      tenantExtensionInstalls,
      'scheduled_sweep',
      eq(tenantExtensionInstalls.id, installId),
    ))
    .limit(1);
  if (!row) return null;

  const { install, pkg, buyer } = row;
  // `none` means a free install and there is nothing to meter. A `cancelled` one
  // is closed on the way out (see `cancelPlan`) and must not be closed again
  // afterwards, which the empty window below would make a no-op anyway — but
  // refusing here keeps the sweep from reading rows it can never bill.
  if (install.subscriptionState === 'none') return null;

  const pricing = await packagePricing(db, pkg);
  const plan = findPlan(pricing.plans, install.planCode);
  if (!plan || !planMeters(plan)) {
    // The publisher removed or de-metered the plan this customer is on. Their
    // `plan_code` is NOT rewritten — see `setPackagePlans` — so the honest action
    // is to bill nothing and move the watermark, which stops usage accruing
    // against a price that no longer exists rather than guessing a new one.
    await moveWatermark(db, install.tenantId, install.id, new Date());
    return { installId: install.id, units: 0, chargeCents: 0, billed: false, invoiceItemId: null, invoiceItemFailed: null };
  }

  const periodEnd = new Date();
  const units = await meteredUnits(db, install.tenantId, install.id, install.meteredSince, periodEnd);
  const chargeCents = meteredChargeCents(plan, units);

  if (chargeCents <= 0) {
    // Inside the allowance, or no usage at all. The watermark still moves —
    // included units are included in THIS period, and carrying them forward would
    // give a quiet month's allowance away to a busy one.
    await moveWatermark(db, install.tenantId, install.id, periodEnd);
    return { installId: install.id, units, chargeCents: 0, billed: false, invoiceItemId: null, invoiceItemFailed: null };
  }

  // THE OCCURRENCE IS THE WINDOW, NOT THE INSTANT.
  //
  // Deriving it from `periodEnd` (i.e. from `now`) would give a retry a few
  // seconds later a DIFFERENT key, and the whole idempotency argument in the
  // header would be worth nothing — the customer would be billed twice for one
  // month. The watermark is the stable identity of the OPEN PERIOD: it does not
  // move until this close succeeds, so every attempt at the same period composes
  // the same key, and the next period gets a new one for free.
  const windowStart = install.meteredSince ? install.meteredSince.getTime() : 0;
  const occurrence = usageOccurrence(install.id, windowStart);
  const billableUnits = Math.max(0, units - plan.includedUnits);
  const description = `${pkg.name} — ${billableUnits} ${plan.unitLabel}${billableUnits === 1 ? '' : 's'}`;

  const sale = await recordExtensionSale(db, env, {
    buyerTenantId: install.tenantId,
    buyerUserRef: install.installedByUserId,
    buyerEmail: null,
    publisherTenantId: pkg.tenantId,
    catalogItemId: pricing.catalogItemId,
    description,
    amountCents: chargeCents,
    currency: pricing.currency,
    kind: 'usage',
    occurrence,
    providerRef: null,
  });
  // Null means this exact period already settled. The watermark may still be
  // behind (that is how a retry gets here), so it is moved and nothing is
  // charged a second time.
  if (!sale) {
    await moveWatermark(db, install.tenantId, install.id, periodEnd);
    return { installId: install.id, units, chargeCents, billed: false, invoiceItemId: null, invoiceItemFailed: null };
  }

  let invoiceItemId: string | null = null;
  let invoiceItemFailed: string | null = null;
  if (!buyer.externalCustomerId) {
    // The usage is real and the publisher has been credited; the platform simply
    // has nowhere to put the line. Recorded as a named failure rather than
    // swallowed, because somebody still owes for it and the order row above says
    // so — `status: 'pending'` is exactly that statement.
    invoiceItemFailed = 'no_billing_customer';
  } else {
    try {
      const item = await buildPaymentProvider(env).addInvoiceItem({
        externalCustomerId: buyer.externalCustomerId,
        amountCents: chargeCents,
        currency: pricing.currency,
        // The line the CUSTOMER reads. It names the extension and the units,
        // because "Builderforce — $4.12" is a line they have to ring somebody about.
        description,
        metadata: {
          purchaseKind: 'extension_usage',
          installId: install.id,
          packageSlug: pkg.slug,
          orderId: String(sale.orderId),
          units: String(billableUnits),
        },
        idempotencyKey: occurrence,
      });
      invoiceItemId = item?.itemId ?? null;
      if (!item) invoiceItemFailed = 'payments_not_configured';
    } catch (error) {
      invoiceItemFailed = error instanceof Error ? error.message.slice(0, 200) : 'invoice_item_failed';
      reportCaughtError(error, {
        source: 'application/developer/extensionBilling.ts',
        operation: `addInvoiceItem:${install.id}`,
      });
    }
  }

  await db
    .update(tenantExtensionInstalls)
    .set({ meteredSince: periodEnd, lastOrderId: sale.orderId, updatedAt: new Date() })
    .where(scopedToTenant(tenantExtensionInstalls, install.tenantId, eq(tenantExtensionInstalls.id, install.id)));

  return { installId: install.id, units, chargeCents, billed: true, invoiceItemId, invoiceItemFailed };
}

/** Move the metering watermark. Scoped per statement, as the guard's rule requires. */
async function moveWatermark(db: Db, tenantId: number, installId: string, to: Date): Promise<void> {
  await db
    .update(tenantExtensionInstalls)
    .set({ meteredSince: to, updatedAt: new Date() })
    .where(scopedToTenant(tenantExtensionInstalls, tenantId, eq(tenantExtensionInstalls.id, installId)));
}

export interface BillingSweepResult {
  considered: number;
  closed: number;
  billedCents: number;
  /** Closes that priced and credited but could not reach an invoice. Reported
   *  separately because it is an operator problem, not a customer one. */
  uninvoiced: number;
}

/**
 * Close every metered period that is old enough.
 *
 * ── WHY THE PREDICATE IS `metered_since <= now - 30d` AND NOT A DUE DATE ────
 * A stored `next_billing_at` would be a second fact about the same thing the
 * watermark already says, and the two would disagree the first time a close
 * happened off-cycle (a cancellation does exactly that). The watermark IS the
 * schedule: a period is due when the window that opened at the watermark is old
 * enough, and closing early simply moves it, which re-schedules the next one
 * correctly with nothing to keep in sync.
 *
 * Best-effort per install, like every sweep here: one publisher's unreachable
 * processor must not stop the other thirty-nine closing.
 */
export async function runExtensionBillingSweep(
  env: Env,
  nowMs: number = Date.now(),
  deps: { db?: Db } = {},
): Promise<BillingSweepResult> {
  const db = deps.db ?? buildDatabase(env);
  const cutoff = new Date(nowMs - PERIOD_MS);

  const due = await db
    .select({ id: tenantExtensionInstalls.id })
    .from(tenantExtensionInstalls)
    .where(acrossTenants(
      tenantExtensionInstalls,
      'scheduled_sweep',
      // `subscription_state <> 'none'` matches the partial index this read exists
      // for (`idx_tenant_extension_installs_billing`), so the scan is over paid
      // installs rather than over every install ever made.
      ne(tenantExtensionInstalls.subscriptionState, 'none'),
      // And a CANCELLED install is finished with. `cancelPlan` closes its open
      // period before it sets the state — and fails the cancellation outright if
      // that close throws — so there is nothing left here to bill. Without this
      // predicate every cancelled install would be re-read every thirty days
      // forever, to move a watermark over an empty window: a queue that only
      // grows, doing nothing, in front of the installs that do need closing.
      ne(tenantExtensionInstalls.subscriptionState, 'cancelled'),
      isNotNull(tenantExtensionInstalls.meteredSince),
      lte(tenantExtensionInstalls.meteredSince, cutoff),
      sql`${tenantExtensionInstalls.disabledAt} is null`,
    ))
    .orderBy(tenantExtensionInstalls.meteredSince)
    .limit(SWEEP_BATCH);

  const result: BillingSweepResult = { considered: due.length, closed: 0, billedCents: 0, uninvoiced: 0 };
  for (const row of due) {
    try {
      const close = await closeMeteredPeriod(db, env, row.id);
      if (!close) continue;
      if (close.billed) {
        result.closed += 1;
        result.billedCents += close.chargeCents;
        if (close.invoiceItemFailed) result.uninvoiced += 1;
      }
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/developer/extensionBilling.ts',
        operation: `runExtensionBillingSweep:${row.id}`,
      });
    }
  }
  return result;
}

export interface OpenPeriod {
  installId: string;
  planCode: string | null;
  unitLabel: string;
  units: number;
  includedUnits: number;
  /** What the period would cost if it closed now. The number a customer wants
   *  BEFORE the invoice, which is the whole reason usage billing is frightening. */
  projectedCents: number;
  currency: string;
  since: string | null;
}

/**
 * What one install's open period looks like right now.
 *
 * Read through the SAME pricing function the close uses, so the figure a customer
 * is shown mid-month and the figure they are charged at the end cannot be
 * computed two different ways.
 */
export async function openPeriodFor(
  db: Db,
  tenantId: number,
  installId: string,
): Promise<OpenPeriod | null> {
  const [row] = await db
    .select({ install: tenantExtensionInstalls, pkg: extensionPackages })
    .from(tenantExtensionInstalls)
    .innerJoin(extensionPackages, eq(extensionPackages.id, tenantExtensionInstalls.packageId))
    .where(scopedToTenant(tenantExtensionInstalls, tenantId, eq(tenantExtensionInstalls.id, installId)))
    .limit(1);
  if (!row) return null;

  const pricing = await packagePricing(db, row.pkg);
  const plan = findPlan(pricing.plans, row.install.planCode);
  const units = await meteredUnits(db, tenantId, installId, row.install.meteredSince, new Date());

  return {
    installId,
    planCode: row.install.planCode,
    unitLabel: plan?.unitLabel ?? 'unit',
    units,
    includedUnits: plan?.includedUnits ?? 0,
    projectedCents: plan ? meteredChargeCents(plan, units) : 0,
    currency: pricing.currency,
    since: row.install.meteredSince ? row.install.meteredSince.toISOString() : null,
  };
}

/**
 * Mark an install past due, or bring it back.
 *
 * Called from the payment webhook when a renewal fails or later succeeds. It is a
 * state change and nothing else: `past_due` deliberately keeps the extension
 * working (`subscriptionEntitles`), because switching somebody's payroll
 * integration off the hour their card expired loses the customer AND the vendor.
 * What ends the relationship is a cancellation, which is a decision somebody makes.
 */
export async function setSubscriptionState(
  db: Db,
  env: Env,
  input: { subscriptionRef: string; state: 'active' | 'past_due' | 'cancelled'; currentPeriodEnd?: Date | null },
): Promise<number> {
  const rows = await db
    .update(tenantExtensionInstalls)
    .set({
      subscriptionState: input.state,
      currentPeriodEnd: input.currentPeriodEnd ?? undefined,
      updatedAt: new Date(),
    })
    // Addressed by the PROCESSOR's subscription id, which is what a webhook
    // carries. Cross-tenant because a webhook has no session and no tenant — the
    // subscription ref is the identity, and it is one the processor minted.
    .where(acrossTenants(
      tenantExtensionInstalls,
      'scheduled_sweep',
      eq(tenantExtensionInstalls.subscriptionRef, input.subscriptionRef),
    ))
    .returning({ id: tenantExtensionInstalls.id, tenantId: tenantExtensionInstalls.tenantId });

  for (const row of rows) await invalidateInstalls(env, row.tenantId);
  return rows.length;
}

/** Re-exported so a caller reading a period does not need a second import for
 *  the predicate that decides whether the install may still be metered. */
export { subscriptionEntitles };

/** Exported for the sweep's own tests. Never for a caller to tune. */
export const EXTENSION_PERIOD_DAYS = PERIOD_DAYS;
