/**
 * BUYING A PUBLISHED EXTENSION — the Vercel move (PRD 24 §5.4), end to end.
 *
 * The two frictions this exists to remove, stated as the PRD states them:
 *
 *   1. the customer does not create an account on the vendor's site;
 *   2. the customer picks a plan and is billed through us, on the invoice they
 *      already have.
 *
 * So the whole purchase is: pick a plan on the listing → one hosted checkout (or
 * none at all, for a pure usage plan on a workspace that already has a card) →
 * the install exists, the scopes are granted, and the vendor is told. There is no
 * second signup, no second card and no vendor-side onboarding link.
 *
 * ── WHY INSTALL AND SUBSCRIBE ARE ONE TRANSACTION FOR A PAID PACKAGE ────────
 * A free package installs directly (`extensionInstalls.installPackage`). A PAID
 * one cannot: installing first would leave a workspace holding a live scope grant
 * on an extension nobody has paid for, and the obvious repair — installing in a
 * disabled state and enabling on payment — is a fourth install state that every
 * consumer of `listInstalls` would have to learn. Instead the scopes the admin
 * approved ride through the checkout as metadata and the install is CREATED when
 * the money is confirmed. An abandoned checkout leaves nothing behind, which is
 * the correct outcome for a purchase nobody completed.
 *
 * ── THE PAID PATH HAS EXACTLY ONE DOOR, AND IT VERIFIES ─────────────────────
 * The same rule `listingCommerce` and `siteSubscriptions` keep, for the same
 * reason: the session id arrives from the buyer's address bar, so everything that
 * authorises the grant is read back from the processor — that it was paid, what it
 * was for, and that the workspace completing it is the one it was created for.
 * Without that last check, one workspace's paid session installs a paid extension
 * for whoever pastes its id.
 */

import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { extensionPackages, tenantExtensionInstalls, tenants, users } from '../../infrastructure/database/schema';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { assertCovers, verifyPaidCheckout } from '../finance/verifiedCheckout';
import { PublisherError } from './publishers';
import { invalidateInstalls, invalidatePublicCatalog, loadPackage, loadVersion } from './extensionRepository';
import { findPlan, packagePricing } from './extensionPlans';
import { recordExtensionSale, subscriptionOccurrence } from './extensionEarnings';
import { emitInstallEvent } from './vendorEvents';
import { closeMeteredPeriod } from './extensionBilling';
import { mayCharge, type ExtensionPlan } from './extensionContract';

/** The metadata key that says a checkout session is one of ours. */
const PURCHASE_KIND = 'extension_plan';

export interface PlanCheckoutStart {
  /** Present when the processor has to take money. */
  checkoutUrl: string | null;
  /** Present when it does not — a usage-only plan on a card-validated workspace. */
  installId: string | null;
}

export interface PlanSubscriptionView {
  installId: string;
  planCode: string;
  planName: string;
  subscriptionState: string;
  priceCents: number;
  currency: string;
  interval: string;
  meteredRateCents: number;
  includedUnits: number;
  unitLabel: string;
  currentPeriodEndISO: string | null;
}

/**
 * Everything a purchase needs, resolved and checked once.
 *
 * Assembled in one place because the checks are the same for starting a checkout
 * and for completing one, and a completion that re-derived them differently is
 * how a delisted package gets installed by a session opened before it was pulled.
 */
async function resolvePurchase(
  db: Db,
  input: { packageId: string; planCode: string; approvedScopes: readonly string[] },
): Promise<{
  pkg: Awaited<ReturnType<typeof loadPackage>>;
  version: Awaited<ReturnType<typeof loadVersion>>;
  publisherName: string;
  plan: ExtensionPlan;
  catalogItemId: string | null;
  currency: string;
  grantedScopes: string[];
}> {
  const pkg = await loadPackage(db, input.packageId);
  if (pkg.listingState !== 'listed' || !pkg.currentVersionId) {
    throw new PublisherError('this package is not available', 404);
  }
  const version = await loadVersion(db, pkg.currentVersionId);

  // `tenants` is the tenant, so the id IS the scope. Read for the publisher's
  // name (it appears on the customer's statement) and its suspension, which hides
  // a listing from everybody at once.
  const [publisher] = await db.select().from(tenants).where(eq(tenants.id, pkg.tenantId)).limit(1);
  if (!publisher || publisher.publisherSuspendedAt) {
    throw new PublisherError('this package is not available', 404);
  }
  // The gate, again and on purpose. `setPackagePlans` refuses to publish a price
  // without identity verification and `packageReview` refuses to approve a paid
  // version without it — but a publisher can be DEMOTED after both, and the
  // moment money would actually move is the last honest place to check.
  if (!mayCharge(publisher.publisherState)) {
    throw new PublisherError('this publisher is not currently able to take payments', 409);
  }

  const pricing = await packagePricing(db, pkg);
  const plan = findPlan(pricing.plans, input.planCode);
  if (!plan) throw new PublisherError('that plan is not offered', 404);

  const requested = version.requestedScopes ?? [];
  const granted = requested.filter((s) => input.approvedScopes.includes(s));
  if (granted.length !== requested.length) {
    // The same refusal `installPackage` makes, for the same reason: partial
    // consent is not a supported state, and an extension that fails at call time
    // because a scope was withheld is one the installer cannot debug.
    throw new PublisherError('approve every scope the extension requests, or do not install it', 400);
  }

  return {
    pkg,
    version,
    publisherName: publisher.name,
    plan,
    catalogItemId: pricing.catalogItemId,
    currency: pricing.currency,
    grantedScopes: granted,
  };
}

/**
 * Start a paid install.
 *
 * ── THE TWO OUTCOMES, AND WHY BOTH ──────────────────────────────────────────
 * A plan with a recurring price goes to the processor's hosted page, exactly as
 * every other paid purchase on this platform does. A PURE USAGE plan ($0/month,
 * priced per unit) has nothing to charge today — and sending somebody to a
 * checkout page for $0.00 is a page that cannot be completed. What such a plan
 * genuinely needs is a card the metered charge can land on later, which this
 * platform already has a concept of: `card_validated_at`. So the requirement is
 * stated as itself — validate a card first — rather than faked with a nominal
 * charge nobody agreed to.
 */
export async function startPlanCheckout(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    userId: string;
    packageId: string;
    planCode: string;
    approvedScopes: string[];
    returnUrl: string;
  },
): Promise<PlanCheckoutStart> {
  const resolved = await resolvePurchase(db, input);

  const [existing] = await db
    .select({ id: tenantExtensionInstalls.id, state: tenantExtensionInstalls.subscriptionState })
    .from(tenantExtensionInstalls)
    .where(scopedToTenant(
      tenantExtensionInstalls,
      input.tenantId,
      eq(tenantExtensionInstalls.packageId, resolved.pkg.id),
      sql`${tenantExtensionInstalls.disabledAt} is null`,
    ))
    .limit(1);
  if (existing && existing.state === 'active') {
    throw new PublisherError('this workspace is already subscribed to this extension', 409);
  }

  // A pure usage plan: no money moves today, so there is nothing to check out.
  if (resolved.plan.priceCents <= 0) {
    const [buyer] = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
    if (!buyer?.externalCustomerId || buyer.cardValidationStatus !== 'validated') {
      throw new PublisherError(
        'this plan bills by usage — add and validate a card on this workspace before installing it',
        409,
      );
    }
    const install = await activateInstall(db, env, {
      tenantId: input.tenantId,
      userId: input.userId,
      resolved,
      subscriptionRef: null,
      currentPeriodEnd: null,
      // Nothing was captured, so nothing settles. The FIRST money this install
      // produces is its first metered period close.
      sale: null,
    });
    return { checkoutUrl: null, installId: install };
  }

  if (!env.STRIPE_SECRET_KEY) {
    throw new PublisherError('payments are not configured on this deployment', 400);
  }

  // The billing email is READ, not taken from the request. It is the address the
  // processor's receipt goes to, and an endpoint that accepted one would send a
  // paid receipt for this workspace to whatever address the caller typed.
  const [buyerUser] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  const base = new URL(input.returnUrl);
  const session = await buildPaymentProvider(env).createSubscriptionCheckoutSession({
    amountCents: resolved.plan.priceCents,
    currency: resolved.currency,
    // The EXTENSION's name and its publisher's, not ours: this line appears on
    // the customer's statement and "Builderforce" would not tell them what it was.
    productName: `${resolved.pkg.name} — ${resolved.plan.name}`,
    billingEmail: buyerUser?.email ?? null,
    interval: resolved.plan.interval,
    successUrl: `${base.origin}${base.pathname}?extension={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base.origin}${base.pathname}?extension=cancelled`,
    metadata: {
      purchaseKind: PURCHASE_KIND,
      packageId: resolved.pkg.id,
      packageSlug: resolved.pkg.slug,
      planCode: resolved.plan.code,
      buyerTenantId: String(input.tenantId),
      buyerRef: input.userId,
      // The consent, carried through the round trip. It is re-INTERSECTED with the
      // version's request on completion rather than trusted, so a tampered value
      // can only ever narrow what is granted — never widen it.
      scopes: resolved.grantedScopes.join(','),
    },
    idempotencyKey: `ext-plan:${resolved.pkg.id}:${input.tenantId}:${resolved.plan.code}`,
  });
  return { checkoutUrl: session.checkoutUrl, installId: null };
}

/**
 * Finish a paid install.
 *
 * The owner check is the WORKSPACE and the person: without it, one workspace's
 * paid session installs a paid extension for whoever pastes its id.
 */
export async function completePlanCheckout(
  db: Db,
  env: Env,
  input: { tenantId: number; userId: string; checkoutSessionId: string },
): Promise<PlanSubscriptionView> {
  const verified = await verifyPaidCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: PURCHASE_KIND,
    owner: { buyerTenantId: input.tenantId, buyerRef: input.userId },
    messages: {
      notConfigured: 'Payments are not configured on this deployment',
      notFound: 'That checkout could not be found',
      notPaid: 'That checkout has not been paid',
      wrongKind: 'That checkout was not for an extension plan',
      notYours: 'That checkout belongs to someone else',
    },
    refuse: (message, status) => new PublisherError(message, status),
  });

  const packageId = verified.metadata.packageId;
  const planCode = verified.metadata.planCode;
  if (!packageId || !planCode) throw new PublisherError('that checkout names no plan', 400);

  const resolved = await resolvePurchase(db, {
    packageId,
    planCode,
    approvedScopes: (verified.metadata.scopes ?? '').split(',').filter(Boolean),
  });

  // The amount the processor actually captured must cover what is being granted,
  // or a buyer could open checkout at $9 and complete it after the publisher
  // raised the plan to $99.
  assertCovers(verified, resolved.plan.priceCents, 'The payment does not cover this plan',
    (message, status) => new PublisherError(message, status));

  const installId = await activateInstall(db, env, {
    tenantId: input.tenantId,
    userId: input.userId,
    resolved,
    subscriptionRef: verified.session.subscriptionId,
    currentPeriodEnd: null,
    sale: {
      amountCents: resolved.plan.priceCents,
      occurrence: subscriptionOccurrence(verified.session.id),
      providerRef: verified.session.subscriptionId ?? verified.session.id,
      buyerEmail: verified.customerEmail,
    },
  });

  return {
    installId,
    planCode: resolved.plan.code,
    planName: resolved.plan.name,
    subscriptionState: 'active',
    priceCents: resolved.plan.priceCents,
    currency: resolved.currency,
    interval: resolved.plan.interval,
    meteredRateCents: resolved.plan.meteredRateCents,
    includedUnits: resolved.plan.includedUnits,
    unitLabel: resolved.plan.unitLabel,
    currentPeriodEndISO: null,
  };
}

/**
 * Create (or re-enable) the install, settle the money, and tell the vendor.
 *
 * ── ORDER OF OPERATIONS ─────────────────────────────────────────────────────
 * Install, then settle, then notify — and each step is independently idempotent
 * rather than wrapped in a transaction, because the settle and the notify reach
 * outside the database and a transaction cannot include them. What makes that
 * safe is that every step collides on a unique index if repeated: the install on
 * `uq_tenant_extension_install`, the sale on the order number and the ledger
 * reference, the delivery on `uq_webhook_delivery_event`.
 */
async function activateInstall(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    userId: string;
    resolved: Awaited<ReturnType<typeof resolvePurchase>>;
    subscriptionRef: string | null;
    currentPeriodEnd: Date | null;
    sale: { amountCents: number; occurrence: string; providerRef: string | null; buyerEmail: string | null } | null;
  },
): Promise<string> {
  const { pkg, version, plan, grantedScopes } = input.resolved;
  const now = new Date();

  const [prior] = await db
    .select({ id: tenantExtensionInstalls.id })
    .from(tenantExtensionInstalls)
    .where(scopedToTenant(tenantExtensionInstalls, input.tenantId, eq(tenantExtensionInstalls.packageId, pkg.id)))
    .limit(1);

  const [row] = await db
    .insert(tenantExtensionInstalls)
    .values({
      tenantId: input.tenantId,
      packageId: pkg.id,
      versionId: version.id,
      grantedScopes,
      installedByUserId: input.userId,
      planCode: plan.code,
      subscriptionState: 'active',
      subscriptionRef: input.subscriptionRef,
      currentPeriodEnd: input.currentPeriodEnd,
      // The meter opens NOW. Everything the vendor reports from this instant is
      // inside the first billable period; anything they reported before it (they
      // could not have — there was no install) is not silently swept in.
      meteredSince: now,
    })
    .onConflictDoUpdate({
      target: [tenantExtensionInstalls.tenantId, tenantExtensionInstalls.packageId],
      set: {
        versionId: version.id,
        grantedScopes,
        planCode: plan.code,
        subscriptionState: 'active',
        subscriptionRef: input.subscriptionRef,
        currentPeriodEnd: input.currentPeriodEnd,
        meteredSince: now,
        disabledAt: null,
        updatedAt: now,
      },
    })
    .returning({ id: tenantExtensionInstalls.id });
  if (!row) throw new PublisherError('failed to install', 409);

  if (!prior) {
    // A counter on somebody ELSE's row — the install count is a public fact about
    // a listing, not about the installing workspace, so it cannot live scoped.
    await db
      .update(extensionPackages)
      .set({ installCount: sql`${extensionPackages.installCount} + 1` })
      .where(acrossTenants(extensionPackages, 'public_catalogue', eq(extensionPackages.id, pkg.id)));
    await invalidatePublicCatalog(env);
  }

  if (input.sale) {
    const sale = await recordExtensionSale(db, env, {
      buyerTenantId: input.tenantId,
      buyerUserRef: input.userId,
      buyerEmail: input.sale.buyerEmail,
      publisherTenantId: pkg.tenantId,
      catalogItemId: input.resolved.catalogItemId,
      description: `${pkg.name} — ${plan.name}`,
      amountCents: input.sale.amountCents,
      currency: input.resolved.currency,
      kind: 'subscription',
      occurrence: input.sale.occurrence,
      providerRef: input.sale.providerRef,
    });
    if (sale) {
      await db
        .update(tenantExtensionInstalls)
        .set({ lastOrderId: sale.orderId, updatedAt: new Date() })
        .where(scopedToTenant(tenantExtensionInstalls, input.tenantId, eq(tenantExtensionInstalls.id, row.id)));
    }
  }

  await invalidateInstalls(env, input.tenantId);

  // PRD 24 §5.4 step 3. `created` for a workspace that had never installed this
  // before, `updated` for one coming back or changing plan — a vendor
  // provisioning on `created` must not re-provision for a returning customer.
  await emitInstallEvent(db, {
    publisherTenantId: pkg.tenantId,
    event: prior ? 'extension.installation.updated' : 'extension.installation.created',
    payload: {
      installId: row.id,
      packageId: pkg.id,
      packageSlug: pkg.slug,
      versionId: version.id,
      semver: version.semver,
      grantedScopes,
      planCode: plan.code,
      subscriptionState: 'active',
    },
  });

  return row.id;
}

/**
 * Stop paying for an extension.
 *
 * The install is left in place and marked `cancelled` rather than removed. That
 * is the honest reading of "cancel my plan": the workspace keeps its
 * configuration and its connection, and can resubscribe without re-approving
 * scopes — but `subscriptionEntitles` refuses a cancelled install everywhere, so
 * no token mints, no usage is accepted and nothing the vendor runs still works.
 *
 * The open metered period is CLOSED first. Cancelling without billing what was
 * already consumed would hand the customer a free month by pressing Cancel on the
 * last day of it — and hand the vendor the bill.
 */
export async function cancelPlan(
  db: Db,
  env: Env,
  input: { tenantId: number; installId: string },
): Promise<void> {
  const [install] = await db
    .select()
    .from(tenantExtensionInstalls)
    .where(scopedToTenant(tenantExtensionInstalls, input.tenantId, eq(tenantExtensionInstalls.id, input.installId)))
    .limit(1);
  if (!install) throw new PublisherError('install not found', 404);
  if (install.subscriptionState === 'none') throw new PublisherError('this install has no plan to cancel', 409);
  if (install.subscriptionState === 'cancelled') return;

  // Bill what has already been used, before the state change makes it unbillable.
  await closeMeteredPeriod(db, env, install.id);

  if (install.subscriptionRef && env.STRIPE_SECRET_KEY) {
    // Best effort at the processor, and deliberately not fatal: a subscription
    // that cannot be reached must not stop us recording that the customer
    // cancelled. The alternative — refusing — leaves them being charged.
    await buildPaymentProvider(env).cancelSubscription(install.subscriptionRef).catch(() => undefined);
  }

  await db
    .update(tenantExtensionInstalls)
    .set({ subscriptionState: 'cancelled', updatedAt: new Date() })
    .where(scopedToTenant(tenantExtensionInstalls, input.tenantId, eq(tenantExtensionInstalls.id, install.id)));
  await invalidateInstalls(env, input.tenantId);

  const pkg = await loadPackage(db, install.packageId);
  const version = await loadVersion(db, install.versionId);
  await emitInstallEvent(db, {
    publisherTenantId: pkg.tenantId,
    event: 'extension.installation.removed',
    payload: {
      installId: install.id,
      packageId: pkg.id,
      packageSlug: pkg.slug,
      versionId: version.id,
      semver: version.semver,
      grantedScopes: install.grantedScopes ?? [],
      planCode: install.planCode,
      subscriptionState: 'cancelled',
    },
  });
}
