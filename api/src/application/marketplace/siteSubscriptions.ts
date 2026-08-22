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
import { assertCovers, verifyPaidCheckout } from '../finance/verifiedCheckout';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { registerObject } from '../kernel/ObjectRegistry';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  ListingError,
  invalidateListingCaches,
  publishedSnapshot,
  recordInstall,
} from './creationListings';
import { hostedListingStatus, type HostedListingStatus } from './creationListings.hosted';
import { resolveTakeRateBps } from './listingCommerce';
import { USD_CENTS } from '../kernel/denominations';


/**
 * The states a subscription can hold. `cancelled` rows are KEPT — they are the
 * record that somebody used to pay.
 *
 * `suspended` is the one that is not about the SUBSCRIBER at all: the app they pay
 * for stopped answering and its hosted lifecycle left the billable window, so the
 * recurring charge is cancelled at the processor while their access to what they
 * already have continues. Cancelling them outright would be the platform punishing a
 * customer for a seller's silence; leaving them `active` would be charging them for
 * nothing. It is a column VALUE rather than a second table, because it is one more
 * state of one relationship.
 */
export const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'suspended', 'cancelled'] as const;
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
  tenantId: number,
  siteId: number,
  siteUserId: number,
): Promise<SiteSubscriptionView | null> {
  const { subscription } = await siteSubscriptionState(db, tenantId, siteId, siteUserId);
  return subscription;
}

/**
 * NONE, LIVE, or LAPSED — the three answers, told apart.
 *
 * `activeSiteSubscription` collapses "never subscribed" and "subscribed and it ran
 * out" into the same null, which is right for a gate and wrong for a shop window: a
 * stranger and a lapsed customer both need to be shown the landing page, but only the
 * second is a renewal, and a free app has NO subscription at all and must not be gated
 * on one. Both facts come from one read; asking twice is how they drift.
 */
export type SiteSubscriptionState = 'none' | 'live' | 'lapsed';

export async function siteSubscriptionState(
  db: Db,
  tenantId: number,
  siteId: number,
  siteUserId: number,
): Promise<{ state: SiteSubscriptionState; subscription: SiteSubscriptionView | null }> {
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
    .where(scopedToTenant(
      siteSubscriptions,
      tenantId,
      eq(siteSubscriptions.siteId, siteId),
      eq(siteSubscriptions.siteUserId, siteUserId),
    ))
    .limit(1);
  if (!row) return { state: 'none', subscription: null };
  if (row.cancelledAt || row.status === 'cancelled') return { state: 'lapsed', subscription: null };
  // A SUSPENDED row is still access. The charge stopped because the seller's app
  // went dark, and taking the subscriber's access away as well would punish them
  // twice for something neither they nor we did — they keep what they hold, which is
  // exactly what the hosted lifecycle promised them. Checked BEFORE the period test,
  // because a suspended subscription is deliberately not renewed and its period end
  // will pass.
  if (row.status === 'suspended') {
    return {
      state: 'live',
      subscription: {
        id: row.id,
        status: 'suspended',
        priceCents: row.priceCents,
        currency: row.currency,
        snapshotId: row.snapshotId,
        currentPeriodEndISO: row.currentPeriodEnd?.toISOString() ?? null,
      },
    };
  }
  // A lapsed period is not access. The renewal webhook moves `current_period_end`
  // forward; until it does, an expired row is refused here rather than being
  // trusted because its status still reads 'active'.
  if (row.currentPeriodEnd && row.currentPeriodEnd <= new Date()) return { state: 'lapsed', subscription: null };
  return {
    state: 'live',
    subscription: {
      id: row.id,
      status: row.status as SubscriptionStatus,
      priceCents: row.priceCents,
      currency: row.currency,
      snapshotId: row.snapshotId,
      currentPeriodEndISO: row.currentPeriodEnd?.toISOString() ?? null,
    },
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

  if (await activeSiteSubscription(db, input.tenantId, input.siteId, input.siteUserId)) {
    throw new ListingError('You are already subscribed', 400);
  }

  const [user] = await db
    .select({ email: siteUsers.email })
    .from(siteUsers)
    .where(scopedToTenant(
      siteUsers,
      input.tenantId,
      eq(siteUsers.id, input.siteUserId),
      eq(siteUsers.siteId, input.siteId),
    ))
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
  // The owner check here is the site USER, not a tenant: without it, one person's
  // paid session subscribes whoever pastes its id.
  const verified = await verifyPaidCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: PURCHASE_KIND,
    owner: { siteId: input.siteId, siteUserId: input.siteUserId },
    messages: {
      notConfigured: 'Payments are not configured on this deployment',
      notFound: 'That checkout could not be found',
      notPaid: 'That checkout has not been paid',
      wrongKind: 'That checkout was not for an app subscription',
      notYours: 'That checkout belongs to someone else',
    },
    refuse: (message, status) => new ListingError(message, status),
  });
  const slug = verified.metadata.listingSlug;
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
  assertCovers(verified, priceCents, 'The payment does not cover this subscription',
    (message, status) => new ListingError(message, status));

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
      buyerEmail: verified.customerEmail,
      currency: listing.currency ?? 'USD',
      subtotalCents: priceCents,
      totalCents: priceCents,
      status: 'paid',
      provider: 'stripe',
      providerRef: verified.session.subscriptionId ?? verified.session.id,
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
      providerRef: verified.session.subscriptionId,
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
        providerRef: verified.session.subscriptionId,
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
  env: Env,
  tenantId: number,
  siteId: number,
  siteUserId: number,
): Promise<{ ok: boolean }> {
  const [row] = await db
    .update(siteSubscriptions)
    .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
    .where(scopedToTenant(
      siteSubscriptions,
      tenantId,
      eq(siteSubscriptions.siteId, siteId),
      eq(siteSubscriptions.siteUserId, siteUserId),
    ))
    .returning({ id: siteSubscriptions.id, providerRef: siteSubscriptions.providerRef });
  if (!row) return { ok: false };
  // AND AT THE PROCESSOR. Marking the row alone ended their access and left the
  // recurring charge running — a consumer pressing Cancel would have stopped
  // receiving the thing and kept paying for it every month, which is the worst
  // possible reading of the button. Best-effort and last, so a processor outage
  // cannot leave a customer who asked to stop still holding access.
  await stopRecurringCharge(env, row.providerRef, { tenantId, siteId, siteUserId });
  return { ok: true };
}

/**
 * End the recurring charge at the processor. Never throws.
 *
 * Shared by the two paths that stop money — a subscriber cancelling and the platform
 * suspending an abandoned app — because "stop charging this person" is one action and
 * two copies of it is how one of them keeps billing.
 */
async function stopRecurringCharge(
  env: Env,
  providerRef: string | null,
  context: Record<string, unknown>,
): Promise<void> {
  if (!providerRef || !env.STRIPE_SECRET_KEY) return;
  try {
    await buildPaymentProvider(env).cancelSubscription(providerRef);
  } catch (cause) {
    // Reported, never rethrown: the local record is already correct and a customer
    // must not be told their cancellation failed because a vendor was slow. A charge
    // that keeps running is a real problem, which is exactly why it is reported
    // rather than swallowed.
    reportCaughtError(cause, {
      source: 'marketplace',
      operation: 'stopRecurringCharge',
      context: { ...context, providerRef },
    });
  }
}

/**
 * STOP CHARGING EVERY SUBSCRIBER OF AN APP THAT HAS GONE DARK.
 *
 * ── WHY THIS IS THE PLATFORM'S JOB AND NOT THE SELLER'S ──────────────────────────
 * `resolveHostedLifecycle` says a hosted listing outside its grace window is not
 * `billable`. That is a promise made to a buyer BEFORE they subscribed, and the only
 * party in a position to keep it is the platform: the seller is, by definition, the
 * one who has stopped answering. A rule that only takes effect if the person it is
 * enforced against chooses to enforce it is not a rule.
 *
 * Access is left ALONE. The subscription becomes `suspended`, which
 * `siteSubscriptionState` still reads as live — they keep what they already hold, and
 * on `released` they may take the build. Cancelling them would be the platform
 * punishing a customer for a seller's silence.
 *
 * Idempotent by the `status = 'active'` predicate: a sweep that runs every day on a
 * listing that has been dark for a month suspends nobody after the first pass, and
 * therefore asks the processor nothing.
 */
export async function suspendSubscriptionsForListing(
  db: Db,
  env: Env,
  tenantId: number,
  listingId: string,
): Promise<{ suspended: number }> {
  const rows = await db
    .update(siteSubscriptions)
    .set({ status: 'suspended', updatedAt: new Date() })
    // Scoped to the SELLER's tenant, which is where both the listing and every
    // subscription to it live. The listing id alone would be enough today because it
    // is globally unique — and that is exactly the kind of reasoning that turns into
    // a cross-tenant write the day an id becomes a slug.
    .where(scopedToTenant(
      siteSubscriptions,
      tenantId,
      eq(siteSubscriptions.catalogItemId, listingId),
      eq(siteSubscriptions.status, 'active'),
    ))
    .returning({ id: siteSubscriptions.id, providerRef: siteSubscriptions.providerRef });

  // Sequential rather than a fan-out: this is a vendor API being asked to cancel
  // real subscriptions, and firing four thousand of them at once is how a rate limit
  // turns "we stopped charging them" into "we stopped charging some of them".
  for (const row of rows) {
    await stopRecurringCharge(env, row.providerRef, { listingId, subscriptionId: row.id });
  }
  return { suspended: rows.length };
}

/**
 * WHERE A SUBSCRIBER STANDS — their subscription AND the app's own lifecycle.
 *
 * ── WHY BOTH FACTS COME BACK FROM ONE CALL ───────────────────────────────────────
 * "Am I subscribed" and "is the thing I subscribed to still running" are two
 * questions with one answer between them, and a surface that asked them separately
 * would show a live subscription to a dead app — which is precisely the state the
 * hosted lifecycle exists to make visible. The flags a caller acts on
 * (`billable`, `subscriberMayExport`, `subscriberMayTake`) are DERIVED by the shared
 * contract, never restated here, so what the buyer's page says and what the platform
 * does are one rule.
 *
 * A free app has no subscription and no hosted lifecycle to report; a `copy` listing
 * never reaches this path at all. `hosted` is null in both cases rather than a
 * fabricated `operating`, so a caller can tell "fine" from "not applicable".
 */
/**
 * The version a subscriber holds, versus the version currently on sale.
 *
 * `latestSnapshotId` is null for a listing that has never carried one (nothing to
 * offer), in which case `updateAvailable` is always false — the absence of a fact
 * must never read as "an update is available".
 */
export interface VersionOffer {
  heldSnapshotId: string | null;
  latestSnapshotId: string | null;
  updateAvailable: boolean;
}

/**
 * THE ONE COMPARISON — a subscriber holds a version permanently and is OFFERED an
 * update, never moved without accepting, so "is there something to offer" can only
 * ever mean "does what they hold differ from what the seller currently sells".
 * Shared rather than restated: `siteVisitor.ts`'s entry-document fork asks this
 * same question (should this visitor see the offer at all?) from a different join
 * path (the SITE's current listing rather than the subscriber's own row), and two
 * copies of "differs from" is how one of them special-cases a null and the other
 * does not.
 */
export function subscriptionUpdateAvailable(heldSnapshotId: string | null, latestSnapshotId: string | null): boolean {
  return !!latestSnapshotId && heldSnapshotId !== latestSnapshotId;
}

export interface SubscriberStanding {
  subscription: SiteSubscriptionView | null;
  hosted: HostedListingStatus | null;
  /** Null when there is no subscription to hold a version at all — a free app
   *  (which never rows in `site_subscriptions`) has nothing to be offered. */
  versionOffer: VersionOffer | null;
}

export async function subscriberStanding(
  db: Db,
  env: Env,
  input: { tenantId: number; siteId: number; siteUserId: number },
): Promise<SubscriberStanding> {
  const { standing } = await standingWithListing(db, env, input);
  return standing;
}

/**
 * The standing AND the listing it came from, in ONE pass.
 *
 * The remedy path needs both, and reading the subscriber's row a second time to
 * recover the listing id would be a redundant round-trip on a path where somebody is
 * waiting for a download. The listing id stays out of `SubscriberStanding` itself
 * because that shape is serialised to the site user and an internal join key is not
 * theirs to receive.
 *
 * The listing is joined by the SUBSCRIBER's own `catalogItemId` rather than looked
 * up fresh from the project — `completeSiteSubscription` pins it at subscribe time
 * and a re-publish never replaces the row, only bumps `body.snapshotId`, so this is
 * the direct path to "what does this subscriber's seller currently sell" with no
 * second lookup of the site's project.
 */
async function standingWithListing(
  db: Db,
  env: Env,
  input: { tenantId: number; siteId: number; siteUserId: number },
): Promise<{ standing: SubscriberStanding; listingId: string | null }> {
  const [row] = await db
    .select({
      catalogItemId: siteSubscriptions.catalogItemId,
      heldSnapshotId: siteSubscriptions.snapshotId,
      latestBody: catalogItems.body,
    })
    .from(siteSubscriptions)
    .leftJoin(catalogItems, and(
      eq(catalogItems.id, siteSubscriptions.catalogItemId),
      eq(catalogItems.tenantId, input.tenantId),
    ))
    .where(scopedToTenant(
      siteSubscriptions,
      input.tenantId,
      eq(siteSubscriptions.siteId, input.siteId),
      eq(siteSubscriptions.siteUserId, input.siteUserId),
    ))
    .limit(1);
  const listingId = row?.catalogItemId ?? null;
  const { subscription } = await siteSubscriptionState(
    db, input.tenantId, input.siteId, input.siteUserId,
  );
  const latestSnapshotId = (row?.latestBody as { snapshotId?: string } | null)?.snapshotId ?? null;
  return {
    standing: {
      subscription,
      hosted: listingId ? await hostedListingStatus(db, env, listingId) : null,
      versionOffer: subscription ? {
        heldSnapshotId: subscription.snapshotId,
        latestSnapshotId,
        updateAvailable: subscriptionUpdateAvailable(subscription.snapshotId, latestSnapshotId),
      } : null,
    },
    listingId,
  };
}

/**
 * ACCEPT THE OFFERED UPDATE.
 *
 * Moves the subscriber onto the version the seller currently sells. Deliberately
 * the ONLY way `site_subscriptions.snapshot_id` moves outside of the initial
 * subscribe — a buyer holds a version permanently and is offered an update, never
 * moved without accepting, which is the whole reason the column exists rather than
 * every reader following the listing's live snapshot.
 */
export async function acceptSiteSubscriptionUpdate(
  db: Db,
  env: Env,
  input: { tenantId: number; siteId: number; siteUserId: number },
): Promise<SiteSubscriptionView> {
  const { standing } = await standingWithListing(db, env, input);
  if (!standing.subscription) throw new ListingError('You are not subscribed to this app', 403);
  const offer = standing.versionOffer;
  if (!offer?.updateAvailable || !offer.latestSnapshotId) {
    throw new ListingError('You are already on the latest version', 400);
  }
  const [row] = await db
    .update(siteSubscriptions)
    .set({ snapshotId: offer.latestSnapshotId, updatedAt: new Date() })
    .where(scopedToTenant(
      siteSubscriptions,
      input.tenantId,
      eq(siteSubscriptions.siteId, input.siteId),
      eq(siteSubscriptions.siteUserId, input.siteUserId),
    ))
    .returning();
  if (!row) throw new ListingError('Could not record the update', 400);
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
 * THE BUILD, HANDED TO A SUBSCRIBER OF AN ABANDONED APP.
 *
 * ── WHAT "TAKE IT" MEANS FOR SOMEBODY WITH NO WORKSPACE ──────────────────────────
 * A `copy` buyer receives the published snapshot onto a board in their own workspace.
 * A subscriber has no workspace — that is the whole point of a `site_user`, and the
 * reason a hosted purchase needs no second signup. So what they receive is the same
 * PAYLOAD, as a document they hold: the identical immutable snapshot, which they can
 * install the day they do create an account, and which is theirs regardless.
 *
 * Pinned to the version THEY hold, not the seller's latest — the same rule that
 * governs every other read of a bought thing. A subscriber offered an update they
 * never accepted must not be handed it by the remedy.
 *
 * The gate is the lifecycle and nothing else: `subscriberMayTake` is true only in
 * `released`, which is 44 days of a dark address. It is deliberately NOT a price
 * check, a status check or a role check — three ways to accidentally give a working
 * product away.
 */
export async function takeAbandonedBuild(
  db: Db,
  env: Env,
  input: { tenantId: number; siteId: number; siteUserId: number },
): Promise<{ title: string; objects: unknown[] }> {
  const { standing, listingId } = await standingWithListing(db, env, input);
  if (!standing.subscription) throw new ListingError('You are not subscribed to this app', 403);
  if (!standing.hosted?.subscriberMayTake) {
    throw new ListingError('This app is still running — there is nothing to take', 409);
  }

  const [listing] = listingId
    ? await db
        .select({ body: catalogItems.body, name: catalogItems.name })
        .from(catalogItems)
        .where(acrossTenants(catalogItems, 'public_catalogue', eq(catalogItems.id, listingId)))
        .limit(1)
    : [];
  const body = (listing?.body ?? null) as { snapshotId?: string } | null;
  const snapshotId = standing.subscription.snapshotId || body?.snapshotId;
  const payload = snapshotId ? await publishedSnapshot(db, env, snapshotId) : null;
  if (!payload) throw new ListingError('That version is no longer available', 404);
  return { title: payload.title || listing?.name || 'App', objects: payload.objects };
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
    .where(scopedToTenant(siteSubscriptions, tenantId, eq(siteSubscriptions.siteId, siteId)));
  return {
    activeCount: Number(row?.activeCount ?? 0),
    monthlyCents: Number(row?.monthlyCents ?? 0),
  };
}
