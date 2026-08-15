/**
 * PAYING THE PERSON WHO BUILT THE APP YOU USE.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * The only way money reached a builder was a one-time marketplace purchase BY
 * ANOTHER WORKSPACE. The people actually using their app — signed in as
 * `site_users` on the creator's own address — could not pay them a penny, and
 * `site_users` carried no entitlement of any kind. That is the whole gap between
 * "publishing" and "selling".
 *
 * ── NO SECOND ACCOUNT, NO SECOND INVOICE ─────────────────────────────────────
 * The buyer here is a `site_user`: a person with no Builderforce account, no
 * tenant and no workspace, whose entire reach is their own rows in one site.
 * They never create an account with the seller either — they already have one,
 * on the app. Every extra signup and every extra card is a conversion cliff, and
 * this path exists to have neither.
 *
 * ── ONE MONEY PATH, NOT TWO ──────────────────────────────────────────────────
 * A subscription settles through the SAME `orders`, `order_line_items` and
 * `ledger_entries` a one-time sale writes, at the SAME per-seller resolved rate,
 * stamped onto the line. `site_subscriptions` records the recurring
 * RELATIONSHIP — status, period end, the processor's id — and no money at all.
 * A second money path is how a seller's balance and the platform's books stop
 * agreeing, and the one that is wrong is always the one somebody is owed.
 *
 * ── THE PAID PATH HAS EXACTLY ONE DOOR, AND IT VERIFIES ──────────────────────
 * Same rule as `listingCommerce`: nothing is granted from a redirect. The
 * session id arrives from the subscriber's address bar, so everything that
 * authorises the grant is read back from the processor — that it was paid, what
 * it was for, and that the subscriber completing it is the one it was created
 * for. Without that last check one person's paid session subscribes whoever
 * pastes its id.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  catalogItems,
  ledgerEntries,
  orderLineItems,
  orders,
  siteSubscriptions,
  siteUsers,
} from '../../infrastructure/database/schema';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { registerObject } from '../kernel/ObjectRegistry';
import { ListingError, invalidateListingCaches, recordInstall } from './creationListings';
import { resolveTakeRateBps } from './listingCommerce';

const USD_CENTS = 'usd_cents';

/** The states a subscription can hold. `cancelled` rows are KEPT — they are the
 *  record that somebody used to pay. */
export const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** The metadata key that says a checkout session is one of ours. */
const PURCHASE_KIND = 'site_subscription';

export interface SiteSubscriptionView {
  id: number;
  status: SubscriptionStatus;
  priceCents: number;
  currency: string;
  /** The version this subscriber holds. They are OFFERED updates, never moved. */
  snapshotId: string | null;
  currentPeriodEndISO: string | null;
}

/**
 * IS THIS END USER ENTITLED RIGHT NOW?
 *
 * Deliberately NOT cached. It is the gate in front of a paid product, and a
 * cache is how a cancelled subscription keeps working for a TTL — the same
 * reasoning `holdsLicence` applies to a one-time purchase, and the same
 * reasoning the kernel applies to share tokens.
 *
 * Returns the row rather than a boolean because every caller outside a bare
 * "may they in" needs the extra fact: WHICH VERSION they hold. Two reads asking
 * the same question is how "do they have access" and "what do they have access
 * to" drift apart.
 */
export async function activeSiteSubscription(
  db: Db,
  siteId: number,
  siteUserId: number,
): Promise<SiteSubscriptionView | null> {
  const [row] = await db
    .select({
      id: siteSubscriptions.id,
      status: siteSubscriptions.status,
      priceCents: siteSubscriptions.priceCents,
      currency: siteSubscriptions.currency,
      snapshotId: siteSubscriptions.snapshotId,
      currentPeriodEnd: siteSubscriptions.currentPeriodEnd,
      cancelledAt: siteSubscriptions.cancelledAt,
    })
    .from(siteSubscriptions)
    .where(and(
      eq(siteSubscriptions.siteId, siteId),
      eq(siteSubscriptions.siteUserId, siteUserId),
    ))
    .limit(1);
  if (!row || row.cancelledAt || row.status === 'cancelled') return null;
  // A lapsed period is not access. The renewal webhook moves `current_period_end`
  // forward; until it does, an expired row is refused here rather than being
  // trusted because its status still reads 'active'.
  if (row.currentPeriodEnd && row.currentPeriodEnd <= new Date()) return null;
  return {
    id: row.id,
    status: row.status as SubscriptionStatus,
    priceCents: row.priceCents,
    currency: row.currency,
    snapshotId: row.snapshotId,
    currentPeriodEndISO: row.currentPeriodEnd?.toISOString() ?? null,
  };
}

/**
 * Send an end user to the processor to subscribe to the app they are on.
 *
 * Nothing is granted here — the session is only an invitation to pay, and
 * `completeSiteSubscription` decides whether it was paid.
 */
export async function startSiteSubscriptionCheckout(
  db: Db,
  env: Env,
  input: {
    siteId: number;
    tenantId: number;
    siteUserId: number;
    slug: string;
    returnUrl: string;
  },
): Promise<{ checkoutUrl: string }> {
  if (!env.STRIPE_SECRET_KEY) {
    throw new ListingError('Payments are not configured on this deployment', 400);
  }

  // Cross-tenant by design and by necessity: the listing belongs to the SELLER's
  // workspace, and the person subscribing has no workspace at all.
  const [listing] = await db
    .select()
    .from(catalogItems)
    .where(acrossTenants(catalogItems, 'public_catalogue',
      eq(catalogItems.slug, input.slug), eq(catalogItems.visibility, 'public')))
    .limit(1);
  if (!listing) throw new ListingError('Listing not found', 404);

  const priceCents = listing.priceCents ?? 0;
  if (priceCents <= 0) throw new ListingError('This app is free — no checkout is needed', 400);

  if (await activeSiteSubscription(db, input.siteId, input.siteUserId)) {
    throw new ListingError('You are already subscribed', 400);
  }

  const [user] = await db
    .select({ email: siteUsers.email })
    .from(siteUsers)
    .where(and(eq(siteUsers.id, input.siteUserId), eq(siteUsers.siteId, input.siteId)))
    .limit(1);
  if (!user) throw new ListingError('Sign in first', 403);

  const base = new URL(input.returnUrl);
  const session = await buildPaymentProvider(env).createSubscriptionCheckoutSession({
    amountCents: priceCents,
    currency: listing.currency ?? 'USD',
    // The APP's name, not ours: this charge appears on a consumer's statement
    // and they have never heard of Builderforce.
    productName: listing.name,
    billingEmail: user.email,
    interval: 'month',
    successUrl: `${base.origin}${base.pathname}?subscribed={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base.origin}${base.pathname}?subscribed=cancelled`,
    metadata: {
      purchaseKind: PURCHASE_KIND,
      listingId: listing.id,
      listingSlug: listing.slug,
      siteId: String(input.siteId),
      siteUserId: String(input.siteUserId),
    },
    idempotencyKey: `site-sub:${listing.id}:${input.siteId}:${input.siteUserId}`,
  });
  return { checkoutUrl: session.checkoutUrl };
}

/**
 * Finish a subscription.
 *
 * THE VERIFICATION IS THE POINT — see the module header. Everything that
 * authorises the grant is read back from the processor, including that the
 * subscriber completing the session is the one it was created for.
 */
export async function completeSiteSubscription(
  db: Db,
  env: Env,
  input: {
    siteId: number;
    /** The SELLER's tenant — where the earning lands. */
    tenantId: number;
    siteUserId: number;
    checkoutSessionId: string;
  },
): Promise<SiteSubscriptionView> {
  if (!env.STRIPE_SECRET_KEY) {
    throw new ListingError('Payments are not configured on this deployment', 400);
  }
  const session = await buildPaymentProvider(env).retrieveCheckoutSession(input.checkoutSessionId);
  if (!session) throw new ListingError('That checkout could not be found', 404);
  if (session.paymentStatus !== 'paid') throw new ListingError('That checkout has not been paid', 400);
  if (session.metadata.purchaseKind !== PURCHASE_KIND) {
    throw new ListingError('That checkout was not for an app subscription', 400);
  }
  // WITHOUT THIS, one person's paid session subscribes whoever pastes its id.
  if (session.metadata.siteId !== String(input.siteId)
    || session.metadata.siteUserId !== String(input.siteUserId)) {
    throw new ListingError('That checkout belongs to someone else', 403);
  }
  const slug = session.metadata.listingSlug;
  if (!slug) throw new ListingError('That checkout names no listing', 400);

  const [listing] = await db
    .select()
    .from(catalogItems)
    .where(acrossTenants(catalogItems, 'public_catalogue', eq(catalogItems.slug, slug)))
    .limit(1);
  if (!listing) throw new ListingError('Listing not found', 404);

  const priceCents = listing.priceCents ?? 0;
  // The amount the processor actually captured must cover what is being granted,
  // or a subscriber could open checkout at $1 and complete it after the seller
  // raised the price.
  if (session.amountTotalCents < priceCents) {
    throw new ListingError('The payment does not cover this subscription', 400);
  }

  const sellerRef = listing.publisherRef
    ?? (listing.body as { seller?: { userId?: string } } | null)?.seller?.userId
    ?? null;
  // A hosted app is somebody's running project, so it always has a seller
  // workspace. A listing with none is platform-owned — there is nothing to
  // subscribe to and nobody to credit, and inventing a tenant for it would put
  // money in a workspace that does not exist.
  const sellerTenantId = listing.tenantId;
  if (sellerTenantId == null) {
    throw new ListingError('This listing cannot be subscribed to', 400);
  }
  const { bps } = await resolveTakeRateBps(db, env, { tenantId: sellerTenantId, ref: sellerRef });
  const commissionCents = Math.round((priceCents * bps) / 10_000);
  const sellerCents = Math.max(0, priceCents - commissionCents);

  // WHICH VERSION THEY HOLD, pinned at the moment of sale — the same rule a
  // one-time licence keeps. A subscriber is OFFERED an update and is never moved
  // without accepting, so a seller who ships a bad release cannot take every
  // paying customer with them.
  const heldSnapshotId = (listing.body as { snapshotId?: string } | null)?.snapshotId ?? null;

  const orderNumber = `SUB-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  const [order] = await db
    .insert(orders)
    .values({
      // The order belongs to the SELLER's workspace here, unlike a one-time
      // marketplace sale: there is no buyer workspace to put it in, because the
      // buyer is a consumer with no tenant. Their identity is `buyerRef`.
      tenantId: sellerTenantId,
      orderNumber,
      buyerRef: `site_user:${input.siteUserId}`,
      buyerEmail: session.customerEmail,
      currency: listing.currency ?? 'USD',
      subtotalCents: priceCents,
      totalCents: priceCents,
      status: 'paid',
      provider: 'stripe',
      providerRef: session.subscriptionId ?? session.id,
      fulfilledAt: new Date(),
    })
    .returning();
  if (!order) throw new ListingError('Could not record the order', 400);

  await registerObject(db, env, {
    tenantId: sellerTenantId,
    kind: 'order',
    refId: order.id,
    domain: 'commerce',
    title: `${listing.name} — ${orderNumber}`,
  });

  await db.insert(orderLineItems).values({
    tenantId: sellerTenantId,
    orderId: order.id,
    catalogItemId: listing.id,
    description: `${listing.name} — monthly`,
    quantity: 1,
    unitCents: priceCents,
    amountCents: priceCents,
    sellerRef,
    // Stamped, never derived at read time: a seller crossing the fee threshold
    // tomorrow must not re-price what was sold today.
    commissionCents,
  });

  const [row] = await db
    .insert(siteSubscriptions)
    .values({
      siteId: input.siteId,
      tenantId: sellerTenantId,
      siteUserId: input.siteUserId,
      catalogItemId: listing.id,
      status: 'active',
      priceCents,
      currency: listing.currency ?? 'USD',
      providerRef: session.subscriptionId,
      snapshotId: heldSnapshotId,
      currentPeriodEnd: null,
    })
    .onConflictDoUpdate({
      // Re-subscribing after a cancellation restores the row rather than failing
      // — somebody coming back is a customer, not a conflict. Re-pinned to what
      // is on sale NOW, because that is what they have just paid for.
      target: [siteSubscriptions.siteId, siteSubscriptions.siteUserId],
      set: {
        status: 'active',
        cancelledAt: null,
        catalogItemId: listing.id,
        priceCents,
        providerRef: session.subscriptionId,
        snapshotId: heldSnapshotId,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new ListingError('Could not record the subscription', 400);

  if (sellerRef && sellerCents > 0) {
    // The SAME two-row ledger a one-time sale writes, with a reference derived
    // from the order — so a retried request, a double-clicked button and a
    // replayed webhook all collide on the unique index rather than on a check
    // somebody remembered to write.
    await db.insert(ledgerEntries).values([
      {
        tenantId: sellerTenantId,
        accountKind: 'user',
        accountRef: sellerRef,
        denomination: USD_CENTS,
        amount: String(sellerCents),
        entryKind: 'commission',
        reference: `site-sub:${order.id}`,
        memo: `App subscription — ${listing.name}`,
        metadata: { source: PURCHASE_KIND, orderId: order.id },
      },
      {
        tenantId: sellerTenantId,
        accountKind: 'partner',
        accountRef: 'platform',
        denomination: USD_CENTS,
        amount: String(commissionCents),
        entryKind: 'commission',
        reference: `site-sub-fee:${order.id}`,
        memo: `Platform fee — ${listing.name}`,
        metadata: { source: PURCHASE_KIND, orderId: order.id },
      },
    ]).onConflictDoNothing();
  }

  await recordInstall(db, env, listing.id);
  await invalidateListingCaches(env, listing.slug);

  return {
    id: row.id,
    status: 'active',
    priceCents,
    currency: row.currency,
    snapshotId: heldSnapshotId,
    currentPeriodEndISO: null,
  };
}

/**
 * Stop a subscription.
 *
 * The row is kept and marked, never deleted: it is the record that somebody used
 * to pay, and removing it would silently rewrite both the creator's history and
 * the platform's. Access ends immediately — `activeSiteSubscription` refuses a
 * cancelled row — which is the honest reading of "cancel" for a consumer who
 * asked to stop.
 */
export async function cancelSiteSubscription(
  db: Db,
  siteId: number,
  siteUserId: number,
): Promise<{ ok: boolean }> {
  const [row] = await db
    .update(siteSubscriptions)
    .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(siteSubscriptions.siteId, siteId),
      eq(siteSubscriptions.siteUserId, siteUserId),
    ))
    .returning({ id: siteSubscriptions.id });
  return { ok: Boolean(row) };
}

/**
 * What an app's creator is earning from it, and from how many people.
 *
 * ONE grouped query, never a row per subscriber: an app with four thousand
 * subscribers must not pull four thousand rows to show one number on a panel.
 */
export async function siteSubscriptionSummary(
  db: Db,
  tenantId: number,
  siteId: number,
): Promise<{ activeCount: number; monthlyCents: number }> {
  const [row] = await db
    .select({
      activeCount: sql<string>`count(*) filter (where ${siteSubscriptions.status} = 'active')`,
      monthlyCents: sql<string>`coalesce(sum(${siteSubscriptions.priceCents}) filter (where ${siteSubscriptions.status} = 'active'), 0)`,
    })
    .from(siteSubscriptions)
    .where(and(
      eq(siteSubscriptions.tenantId, tenantId),
      eq(siteSubscriptions.siteId, siteId),
    ));
  return {
    activeCount: Number(row?.activeCount ?? 0),
    monthlyCents: Number(row?.monthlyCents ?? 0),
  };
}
