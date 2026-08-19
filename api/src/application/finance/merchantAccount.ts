/**
 * THE tenant's own merchant account — the direction the finance category did not have.
 *
 * ── WHAT THIS CLOSES (FO-C4) ─────────────────────────────────────────────────
 * `infrastructure/payment/PaymentProvider.ts` states there is exactly one flow and
 * it is Builderforce's own hosted subscription checkout; `marketplace/listingCommerce.ts`
 * is the only other paid door and it sells a creation on the marketplace with a
 * platform cut. Neither is the tenant charging THEIR customer. Meanwhile
 * `payoutProviders` could already send money OUT. A workspace could pay people and
 * could not be paid, which made the whole finance seat one-directional by
 * construction — a company can be run on a product that cannot collect revenue only
 * for as long as it has no revenue.
 *
 * ── WHY THERE IS NO `merchant_accounts` TABLE ────────────────────────────────
 * A tenant's connected processor is a connected third party with an external
 * account id, a status and a reconnect story. That is the kernel `connections`
 * primitive exactly (PRD 20 §6.2), and it is the SAME primitive
 * `PayoutAccountService` already uses for money going the other way — `capability
 * = 'payout'` there, `'merchant'` here. A second connection store would be the
 * collision `finops_soc_controls` exists to record, and it would need its own
 * answer to revocation, its own status vocabulary and its own reconnect flow.
 *
 * There is no `credentials` row either, and that absence is deliberate rather than
 * unfinished: a Connect account is addressed by its `acct_…` id under the
 * PLATFORM's key. There is no per-tenant secret to seal, so sealing one would be
 * ceremony around nothing. `externalAccount` holds the id; `config` holds what the
 * processor last said about it.
 *
 * ── WHY DESTINATION CHARGES AND NOT DIRECT ONES ──────────────────────────────
 * The payment link is a checkout session on the PLATFORM account with
 * `transfer_data[destination]` and `on_behalf_of` pointing at the tenant's connected
 * account. The money settles to the tenant and the tenant is the merchant of record,
 * which is what "charge my customer" has to mean. What we get in exchange is that
 * the session lives where {@link PaymentProvider.retrieveCheckoutSession} can already
 * read it and where the existing signed webhook already arrives — so the verification
 * discipline `completeListingCheckout` wrote out ("the answer to 'was this paid, for
 * what, and by whom' has to come from the party that took the money") is reused whole
 * rather than re-derived against a second webhook endpoint with a second secret.
 *
 * There is NO application fee. Builderforce takes a cut of a marketplace sale
 * because it is the marketplace; it is not a party to a tenant invoicing their own
 * customer, and a silent percentage on somebody else's revenue is not a thing this
 * platform should ever do without saying so on a pricing page.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { connections } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import type { Env } from '../../env';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { PaymentNotConfiguredError } from '../../infrastructure/payment/PaymentProvider';

/** The kernel capability that makes a `connections` row a merchant account. */
export const MERCHANT = 'merchant';

/** The only processor with a Connect implementation. Stored rather than assumed so
 *  the row says which processor holds the account, the way every other connection
 *  row does. */
const MERCHANT_VENDOR = 'stripe';

export class MerchantError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'MerchantError';
  }
}

/**
 * What a surface may see about the tenant's merchant account.
 *
 * `chargesEnabled` is the ONE field that matters and it is the processor's answer,
 * never ours: an account can exist, look connected, and be unable to take a payment
 * because a document is outstanding. Reporting "connected" off the row's own
 * existence is how an invoice gets issued with a payment link that fails at the
 * moment a customer tries to use it.
 */
export interface MerchantAccountView {
  connected: boolean;
  accountId: string | null;
  /** 'pending' | 'connected' | 'restricted' — resolved from the processor. */
  status: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  country: string | null;
  defaultCurrency: string | null;
  /** What is still outstanding, in the processor's own words. Empty when nothing is. */
  requirements: string[];
  connectedAtISO: string | null;
}

const DISCONNECTED: MerchantAccountView = {
  connected: false,
  accountId: null,
  status: 'absent',
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  country: null,
  defaultCurrency: null,
  requirements: [],
  connectedAtISO: null,
};

interface MerchantRow {
  id: number;
  externalAccount: string;
  status: string;
  config: unknown;
  createdAt: Date;
}

/** The tenant's merchant connection row, or null. Tenant-scoped, and deliberately
 *  NOT user-scoped: a merchant account belongs to the workspace — two colleagues
 *  must not each onboard their own, and an invoice issued by one must be payable
 *  after the other leaves. */
async function merchantRow(db: Db, tenantId: number): Promise<MerchantRow | null> {
  const [row] = await db
    .select({
      id: connections.id,
      externalAccount: connections.externalAccount,
      status: connections.status,
      config: connections.config,
      createdAt: connections.createdAt,
    })
    .from(connections)
    .where(scopedToTenant(connections, tenantId, and(
      eq(connections.vendor, MERCHANT_VENDOR),
      eq(connections.capability, MERCHANT),
    )))
    .limit(1);
  return row ?? null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/**
 * The account id that may be charged THROUGH, or null.
 *
 * Null both when there is no account and when the processor says it cannot take
 * charges yet. Callers therefore cannot accidentally mint a link against a
 * restricted account by checking only for presence — the check they would forget is
 * the one that is not theirs to make.
 */
export async function chargeableMerchantId(db: Db, tenantId: number): Promise<string | null> {
  const row = await merchantRow(db, tenantId);
  if (!row?.externalAccount) return null;
  return asRecord(row.config).chargesEnabled === true ? row.externalAccount : null;
}

/**
 * Read the account back FROM THE PROCESSOR and record what it said.
 *
 * The stored `config` is a CACHE of the processor's answer, refreshed on every
 * read of this view, because the thing it caches changes without telling us: an
 * account becomes restricted when a document expires, and the tenant finds out
 * from us or from a customer. Refreshing on the read that a human is looking at is
 * the cheapest correct moment — there is exactly one row per tenant and this is not
 * a hot path.
 */
export async function merchantAccount(db: Db, env: Env, tenantId: number): Promise<MerchantAccountView> {
  const row = await merchantRow(db, tenantId);
  if (!row?.externalAccount) return DISCONNECTED;

  let status: Awaited<ReturnType<ReturnType<typeof buildPaymentProvider>['connectedAccountStatus']>> | null = null;
  try {
    status = await buildPaymentProvider(env).connectedAccountStatus(row.externalAccount);
  } catch (error) {
    if (!(error instanceof PaymentNotConfiguredError)) throw error;
  }

  if (!status) {
    // The processor could not be asked. Report what was last recorded and say so
    // through `status`, rather than reporting `chargesEnabled: false` — which
    // would tell a tenant their working account is broken because our key is not
    // configured on this deployment.
    const cached = asRecord(row.config);
    return {
      connected: true,
      accountId: row.externalAccount,
      status: row.status,
      chargesEnabled: cached.chargesEnabled === true,
      payoutsEnabled: cached.payoutsEnabled === true,
      detailsSubmitted: cached.detailsSubmitted === true,
      country: typeof cached.country === 'string' ? cached.country : null,
      defaultCurrency: typeof cached.defaultCurrency === 'string' ? cached.defaultCurrency : null,
      requirements: Array.isArray(cached.requirements) ? cached.requirements.map(String) : [],
      connectedAtISO: row.createdAt.toISOString(),
    };
  }

  const resolved = status.chargesEnabled ? 'connected' : status.detailsSubmitted ? 'restricted' : 'pending';
  await db
    .update(connections)
    .set({
      status: resolved === 'connected' ? 'connected' : 'expired',
      config: { ...status, resolvedStatus: resolved },
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(scopedToTenant(connections, tenantId, eq(connections.id, row.id)));

  return {
    connected: true,
    accountId: row.externalAccount,
    status: resolved,
    chargesEnabled: status.chargesEnabled,
    payoutsEnabled: status.payoutsEnabled,
    detailsSubmitted: status.detailsSubmitted,
    country: status.country,
    defaultCurrency: status.defaultCurrency,
    requirements: status.requirements,
    connectedAtISO: row.createdAt.toISOString(),
  };
}

/**
 * Start (or resume) onboarding, and return where to send the browser.
 *
 * Resuming is the normal case and the reason this is one call rather than two: a
 * person who abandons the processor's form half way through comes back to a
 * workspace that already holds an `acct_…` with `details_submitted = false`, and
 * a second "connect" that minted a SECOND account would leave them with two, one
 * of which can never be charged through and neither of which they can tell apart.
 */
export async function startMerchantOnboarding(
  db: Db,
  env: Env,
  tenantId: number,
  input: { email?: string | null; country?: string | null; returnUrl: string; refreshUrl: string },
): Promise<{ onboardingUrl: string; accountId: string }> {
  const provider = buildPaymentProvider(env);
  const existing = await merchantRow(db, tenantId);
  let accountId = existing?.externalAccount ?? '';

  if (!accountId) {
    const created = await provider.createConnectedAccount({
      email: input.email ?? null,
      country: input.country ?? null,
      metadata: { tenantId: String(tenantId) },
    });
    accountId = created.accountId;
    await db
      .insert(connections)
      .values({
        tenantId,
        // Null user: the account belongs to the WORKSPACE, not to whoever
        // happened to click connect. See `merchantRow`.
        userId: null,
        vendor: MERCHANT_VENDOR,
        capability: MERCHANT,
        externalAccount: accountId,
        displayName: 'Card payments',
        status: 'expired',
        config: { chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false },
      })
      // A double-click must produce one account, not two. The kernel's own
      // uniqueness `(tenant, user, vendor, capability, external_account)` cannot
      // express "one merchant per tenant" on its own, so the read above is what
      // enforces it and this is the belt: a concurrent second insert of the same
      // id collides rather than duplicating.
      .onConflictDoNothing();
  }

  const link = await provider.createConnectedAccountLink({
    accountId,
    returnUrl: input.returnUrl,
    refreshUrl: input.refreshUrl,
  });
  return { onboardingUrl: link.url, accountId };
}

/**
 * Forget the merchant account.
 *
 * Deletes OUR row and nothing at the processor. An account that has taken money
 * has records, refunds and disputes attached to it that outlive our interest in
 * it, and deleting those on a click in a settings panel would be destroying
 * somebody's financial history to tidy a list. Reconnecting mints a fresh account
 * rather than resurrecting this one, which is the honest outcome: the tenant
 * explicitly said they were done with it.
 */
export async function disconnectMerchant(db: Db, tenantId: number): Promise<{ removed: boolean }> {
  const row = await merchantRow(db, tenantId);
  if (!row) return { removed: false };
  await db.delete(connections).where(scopedToTenant(connections, tenantId, eq(connections.id, row.id)));
  return { removed: true };
}
