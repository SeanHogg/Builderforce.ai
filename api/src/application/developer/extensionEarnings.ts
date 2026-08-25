/**
 * WHAT A PAID EXTENSION EARNS, AND WHO IS CHARGED FOR IT — written once.
 *
 * Two things produce money on a published extension: a tenant subscribing to a
 * plan (`extensionCommerce.ts`) and a month's metered usage being closed
 * (`extensionBilling.ts`). They are DIFFERENT transactions — one is a hosted
 * checkout a person completes, the other a sweep with nobody watching — and they
 * settle IDENTICALLY: an order on the buyer's workspace, a line stamped with the
 * commission resolved at that instant, and two ledger rows crediting the
 * publisher and the platform.
 *
 * Having one body under both is the whole point of this module. A second
 * settlement would be a second place the take rate is applied, a second reference
 * namespace for the idempotency index to protect, and a second answer to "what has
 * this publisher earned" — and the wrong one is always the one somebody is owed
 * money from.
 *
 * ── THE REV-SHARE (PRD 24 §9 decision 1) ────────────────────────────────────
 * `resolveTakeRateBps` — the SAME resolver, threshold and env vars every other
 * seller on this platform is measured against. The PRD asks whether the threshold
 * should be $200k lifetime; the platform already answered that question for
 * creations, agents and hosted apps (`MARKETPLACE_TAKE_RATE_THRESHOLD_CENTS`,
 * defaulting to $200,000), and giving extensions a second number would be a second
 * fee schedule a publisher has to reconcile against the one on their earnings page.
 *
 * ── THE ACCOUNT ─────────────────────────────────────────────────────────────
 * The publishing WORKSPACE, not a person. `extension_packages` names no author —
 * exactly as `ide_agents` names none — so there is nobody to credit, and crediting
 * the workspace's current owner would make the money follow whoever holds that
 * role rather than the company that earned it. The rate is resolved against the
 * SAME account the credit lands in, which is the invariant `ledgerAccount.ts`
 * exists to make unrepresentable.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ledgerEntries, orderLineItems, orders, tenants } from '../../infrastructure/database/schema';
import { registerObject } from '../kernel/ObjectRegistry';
import { resolveTakeRateBps } from '../marketplace/listingCommerce';
import { USD_CENTS } from '../kernel/denominations';
import { workspaceAccount } from '../kernel/ledgerAccount';
import { PayoutAccountService } from '../payouts/PayoutAccountService';
import { PublisherError } from './publishers';

/** Where the money came from. Stamped on the ledger metadata and the reference. */
export type ExtensionSaleKind = 'subscription' | 'usage';

/**
 * The most an occurrence may be.
 *
 * `orders.order_number` is `varchar(48)` and the prefix costs four characters.
 * Anything longer would be truncated into the column, and two truncated
 * occurrences that share a tail would share an order number — see the field doc
 * on {@link ExtensionSaleInput.occurrence} for why that is the worst available
 * failure rather than a cosmetic one.
 */
const MAX_OCCURRENCE = 44;

/**
 * A METERED PERIOD's identity: the install, and the window that is closing.
 *
 * The window START and not the close INSTANT. Deriving it from `now` would give a
 * retry a few seconds later a different key, and the whole idempotency argument
 * would be worth nothing — the customer would be billed twice for one month. The
 * watermark does not move until the close succeeds, so every attempt at the same
 * period composes the same value, and the next period gets a new one for free.
 *
 * Base 36 on the epoch SECONDS keeps it seven characters until the year 5000,
 * which is what makes the whole thing fit the column with room to spare.
 */
export function usageOccurrence(installId: string, windowStartMs: number): string {
  const id = installId.replace(/-/g, '').slice(0, 32);
  return `U${id}${Math.floor(Math.max(0, windowStartMs) / 1000).toString(36)}`.toUpperCase();
}

/**
 * A SUBSCRIPTION's identity: the processor's checkout session.
 *
 * The tail rather than the head, because the entropy is at the tail — every
 * session id this platform sees begins `cs_live_` or `cs_test_`, so a leading
 * slice would be the same forty characters for every customer on the platform.
 */
export function subscriptionOccurrence(sessionId: string): string {
  return `S${sessionId.replace(/[^A-Za-z0-9]/g, '').slice(-(MAX_OCCURRENCE - 1))}`.toUpperCase();
}

/**
 * The order number an occurrence produces, and the check that it can.
 *
 * Throws rather than truncating. A truncated order number is a silently dropped
 * charge; a thrown one is a failed sweep tick that retries and an error somebody
 * reads. Between a wrong answer and no answer, money takes no answer.
 */
export function orderNumberFor(occurrence: string): string {
  assertOccurrence(occurrence);
  return `EXT-${occurrence}`;
}

/** Refuse anything the constructors above did not build. */
export function assertOccurrence(occurrence: string): void {
  if (!/^[A-Z0-9]+$/.test(occurrence) || occurrence.length > MAX_OCCURRENCE) {
    throw new PublisherError(
      `an occurrence must be up to ${MAX_OCCURRENCE} uppercase alphanumerics — build it with usageOccurrence or subscriptionOccurrence`,
      400,
    );
  }
}

export interface ExtensionSaleInput {
  /** The INSTALLING workspace — the order and its line belong here. */
  buyerTenantId: number;
  buyerUserRef: string | null;
  buyerEmail?: string | null;
  /** The PUBLISHER's workspace — the earning and the platform's cut land here. */
  publisherTenantId: number;
  catalogItemId: string | null;
  /** The line as it reads on the order. Names the package and what was bought. */
  description: string;
  amountCents: number;
  currency: string;
  kind: ExtensionSaleKind;
  /**
   * The occurrence this sale IS, unique per occurrence.
   *
   * It becomes the order number AND both ledger references, which is what makes
   * a retried checkout completion, a double-clicked button and a re-run sweep
   * collide on `uq_orders_number` and `uq_ledger_entries_reference` rather than
   * on a check somebody remembered to write.
   *
   * Build it with {@link usageOccurrence} or {@link subscriptionOccurrence} —
   * never by hand. `orders.order_number` is `varchar(48)`, so an occurrence long
   * enough to be truncated into it would make two DIFFERENT sales share an order
   * number, and `onConflictDoNothing` would then silently drop the second one.
   * That is a charge a customer made and a publisher never got paid for, and it
   * would leave no trace at all — which is why the constructors below are total
   * and why {@link assertOccurrence} refuses anything they did not build.
   */
  occurrence: string;
  /** The processor's id for the money, when there is one. NULL for a usage close,
   *  which is invoiced rather than captured. */
  providerRef?: string | null;
}

export interface ExtensionSale {
  orderId: number;
  orderNumber: string;
  amountCents: number;
  commissionCents: number;
  sellerCents: number;
  takeRateBps: number;
}

/**
 * Settle one extension sale.
 *
 * `amountCents` of 0 is a legitimate outcome — a free plan period, or a metered
 * month inside the included allowance — and it produces NOTHING: no order, no
 * line, no ledger row. Writing a zero-value order per install per month would put
 * a row nobody reads in front of every real one on the publisher's earnings page.
 */
export async function recordExtensionSale(
  db: Db,
  env: Env,
  input: ExtensionSaleInput,
): Promise<ExtensionSale | null> {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) return null;
  const amountCents = Math.round(input.amountCents);

  const seller = workspaceAccount(input.publisherTenantId);
  // Resolved per publisher and NOT read from a constant: a vendor under the
  // lifetime threshold pays nothing. Stamped onto the line below, so the sale
  // that carries them over never re-prices the ones before it.
  const { bps } = await resolveTakeRateBps(db, env, {
    tenantId: input.publisherTenantId,
    ref: seller.ref,
    // The SAME account the credit lands in. Reading the default 'user' account
    // here would find nothing, hold every publisher under the threshold forever,
    // and charge the platform's cut to nobody.
    accountKind: seller.kind,
  });
  const commissionCents = Math.round((amountCents * bps) / 10_000);
  const sellerCents = Math.max(0, amountCents - commissionCents);

  const orderNumber = orderNumberFor(input.occurrence);
  const [order] = await db
    .insert(orders)
    .values({
      // The BUYER's workspace, like every other marketplace order: an order is
      // the agreement, and the agreement is the customer's record as much as
      // ours. The ledger below is the seller's — see `creditSeller` in
      // `listingCommerce`, where taking the buyer's tenant for the ledger too was
      // the bug that made every payout balance on the platform read zero.
      tenantId: input.buyerTenantId,
      orderNumber,
      buyerRef: input.buyerUserRef,
      buyerEmail: input.buyerEmail ?? null,
      currency: input.currency,
      subtotalCents: amountCents,
      totalCents: amountCents,
      // A subscription arrives with the charge already captured. A usage close is
      // INVOICED — the money has not moved yet — and saying `paid` would be the
      // platform asserting a payment it has not received.
      status: input.kind === 'subscription' ? 'paid' : 'pending',
      provider: 'stripe',
      providerRef: input.providerRef ?? null,
      fulfilledAt: input.kind === 'subscription' ? new Date() : null,
    })
    .onConflictDoNothing({ target: [orders.tenantId, orders.orderNumber] })
    .returning();

  // NO ROW BACK MEANS THIS OCCURRENCE ALREADY SETTLED — the unique index on
  // (tenant, order_number) caught a retry, which is exactly what `occurrence` is
  // for. Nothing is written a second time and `null` says so; the caller treats
  // it as "already done" rather than "failed", which is what lets a re-run sweep
  // still advance its watermark past a period it had already billed.
  if (!order) return null;

  await registerObject(db, env, {
    tenantId: input.buyerTenantId,
    kind: 'order',
    refId: order.id,
    domain: 'commerce',
    title: `${input.description} — ${orderNumber}`,
  });

  await db.insert(orderLineItems).values({
    tenantId: input.buyerTenantId,
    orderId: order.id,
    catalogItemId: input.catalogItemId,
    description: input.description.slice(0, 500),
    quantity: 1,
    unitCents: amountCents,
    amountCents,
    sellerRef: seller.ref,
    // Stamped, never derived at read time: a publisher crossing the fee threshold
    // tomorrow must not re-price what was sold today.
    commissionCents,
  });

  if (sellerCents > 0 || commissionCents > 0) {
    // ONE insert of two rows, so the publisher's earning and the platform's cut
    // cannot land separately. Both references derive from the occurrence, so the
    // unique index refuses a replayed pair whole.
    await db.insert(ledgerEntries).values([
      {
        tenantId: input.publisherTenantId,
        accountKind: seller.kind,
        accountRef: seller.ref,
        denomination: USD_CENTS,
        amount: String(sellerCents),
        entryKind: 'commission',
        reference: `ext-sale:${input.occurrence}`,
        memo: `Extension ${input.kind} — ${input.description}`.slice(0, 500),
        metadata: { source: `extension_${input.kind}`, orderId: order.id },
      },
      {
        tenantId: input.publisherTenantId,
        accountKind: 'partner',
        accountRef: 'platform',
        denomination: USD_CENTS,
        amount: String(commissionCents),
        entryKind: 'commission',
        reference: `ext-fee:${input.occurrence}`,
        memo: `Platform fee — ${input.description}`.slice(0, 500),
        metadata: { source: `extension_${input.kind}`, orderId: order.id },
      },
    ]).onConflictDoNothing();
  }

  return { orderId: order.id, orderNumber, amountCents, commissionCents, sellerCents, takeRateBps: bps };
}

export interface PublisherEarnings {
  /** Gross, net of refunds — the same number the take-rate threshold reads. */
  earnedCents: number;
  paidCents: number;
  availableCents: number;
  /** The rate this publisher pays on their NEXT sale, and how far from the
   *  threshold they are. Returned with the balance because a vendor reading their
   *  earnings is exactly the person asking "when does the fee start". */
  takeRateBps: number;
  thresholdCents: number;
  underThreshold: boolean;
  /** Whether a destination is nominated at all — the difference between "nothing
   *  to pay out" and "nowhere to pay it to", which a surface must not conflate. */
  payoutConnected: boolean;
}

/**
 * What a publishing workspace has earned, and what is left to send.
 *
 * Earned − paid, where "paid" is the ledger's record of money that actually left.
 * The subtraction cannot drift because there is nothing to keep in sync — the
 * split `PayoutAccountService` documents, read here against the WORKSPACE account
 * rather than a person's.
 */
export async function publisherEarnings(
  db: Db,
  env: Env,
  publisherTenantId: number,
): Promise<PublisherEarnings> {
  const seller = workspaceAccount(publisherTenantId);
  const rate = await resolveTakeRateBps(db, env, {
    tenantId: publisherTenantId,
    ref: seller.ref,
    accountKind: seller.kind,
  });
  const balance = await new PayoutAccountService(db, env)
    .balance(publisherTenantId, seller, rate.lifetimeCents);
  const [row] = await db
    .select({ connectionId: tenants.publisherPayoutConnectionId })
    .from(tenants)
    .where(eq(tenants.id, publisherTenantId))
    .limit(1);

  return {
    earnedCents: rate.lifetimeCents,
    paidCents: balance.paidCents,
    availableCents: balance.availableCents,
    takeRateBps: rate.bps,
    thresholdCents: rate.thresholdCents,
    underThreshold: rate.underThreshold,
    payoutConnected: Boolean(row?.connectionId),
  };
}

/**
 * Pay a publishing workspace out.
 *
 * The amount is the AVAILABLE balance computed here, never a number the caller
 * supplied — a payout endpoint that accepts an amount is an endpoint that pays
 * whatever a crafted request asks for.
 *
 * The destination is the connection the workspace NOMINATED
 * (`tenants.publisher_payout_connection_id`), not a person's default. A workspace
 * has no `connections.user_id` of its own, and inferring one from whoever happens
 * to be pressing the button would send a company's revenue to an employee.
 */
export async function payoutPublisherBalance(
  db: Db,
  env: Env,
  publisherTenantId: number,
): Promise<{ ok: boolean; amountCents: number; error?: string }> {
  const earnings = await publisherEarnings(db, env, publisherTenantId);
  if (earnings.availableCents <= 0) {
    return { ok: false, amountCents: 0, error: 'There is nothing available to pay out' };
  }
  const [row] = await db
    .select({ connectionId: tenants.publisherPayoutConnectionId })
    .from(tenants)
    .where(eq(tenants.id, publisherTenantId))
    .limit(1);
  const connectionId = row?.connectionId ? Number(row.connectionId) : NaN;
  if (!Number.isInteger(connectionId)) {
    throw new PublisherError('Nominate a payout destination for this workspace first', 409);
  }

  const result = await new PayoutAccountService(db, env).pay({
    tenantId: publisherTenantId,
    account: workspaceAccount(publisherTenantId),
    destination: { connectionId },
    amountCents: earnings.availableCents,
    // The idempotency key end to end: the vendor gets it and the ledger's unique
    // index refuses a second row for it, so a double-clicked button cannot pay
    // twice at either layer. Keyed on the lifetime total, which changes with
    // every sale — so the NEXT payout has a different key and is not refused.
    reference: `ext-payout:${publisherTenantId}:${earnings.earnedCents}`,
    memo: 'Extension marketplace earnings',
  });
  return result.ok
    ? { ok: true, amountCents: earnings.availableCents }
    : { ok: false, amountCents: 0, error: result.error };
}
