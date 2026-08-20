/**
 * BUYING A MARKETPLACE AGENT — the paid half of the agent marketplace.
 *
 * `ide_agents` has carried `price_cents`, `pricing_model` and `price_unit` since
 * the marketplace shipped, and `POST /agents/:id/hire` never read any of them. An
 * owner could publish an agent at $99, a buyer could press Hire, and the only
 * effect was a row in `agent_purchases` and `hire_count + 1`. The price was
 * decoration: no checkout, no ledger entry, no entitlement, and — because the
 * seller was never credited — no way for anyone to make money on the surface the
 * marketing pages call a marketplace.
 *
 * ── ONE PAYMENT MACHINE, NOT A FOURTH ONE ────────────────────────────────────
 * The processor round-trip is `finance/verifiedCheckout`, the same primitive the
 * creation listing, the knowledge listing, the tenant invoice and the hosted-app
 * subscription go through. This module contributes only what is genuinely its
 * own: which agent, who may buy it, and what a purchase entitles them to.
 *
 * ── ONE PURCHASE LEDGER, NOT A FOURTH TABLE ──────────────────────────────────
 * The row lands in `marketplace_purchases`, which already existed to record
 * "somebody bought this artifact" and which migration 0982 taught the value
 * `'agent'`. A dedicated `agent_purchases_paid` table would have been a second
 * answer to a question the schema already answers, and would have split
 * "what has this workspace bought" across two places forever.
 *
 * `agent_purchases` is NOT that table and is not replaced by it: it records the
 * HIRE — which workspace currently holds the agent as a member of its workforce,
 * revocable by unhire — while `marketplace_purchases` records the SALE, which is
 * permanent and is what a re-hire is checked against. A buyer who unhires and
 * re-hires must not pay twice.
 *
 * ── NOTHING IS GRANTED BEFORE THE PROCESSOR SAYS SO ──────────────────────────
 * `startAgentCheckout` mints an invitation to pay and records nothing.
 * `completeAgentCheckout` re-reads the session FROM the processor and only then
 * writes the purchase. The partial unique index on
 * `(tenant_id, artifact_type, artifact_slug)` makes a replayed redirect land on
 * the row that is already there rather than on a second charge.
 *
 * ── THE SELLER GETS PAID ─────────────────────────────────────────────────────
 * A sale credits the seller's workspace and the platform's cut as two
 * `ledger_entries` rows in ONE insert, keyed on the purchase so a retry collides
 * in the database. The take rate is resolved through the marketplace's own
 * `resolveTakeRateBps`, so an agent author under the lifetime threshold pays
 * nothing on an agent exactly as they pay nothing on a creation or a runbook.
 * Two rate rules on one platform is how a seller gets charged differently
 * depending on which page they published from.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  ideAgents,
  ledgerEntries,
  marketplacePurchases,
} from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { ListingError } from './creationListings';
import { resolveTakeRateBps } from './listingCommerce';
import { verifyPaidCheckout, assertCovers } from '../finance/verifiedCheckout';

const USD_CENTS = 'usd_cents';

/** What this flow calls itself in checkout metadata. */
export const AGENT_PURCHASE_KIND = 'workforce_agent';

/** The `artifact_type` an agent sale is recorded under (migration 0982). */
const AGENT_ARTIFACT_TYPE = 'agent' as const;

const refuse = (message: string, status: 400 | 403 | 404) => new ListingError(message, status);

export interface AgentPurchase {
  purchaseId: number;
  agentId: string;
  priceCents: number;
  /** Zero while the seller is under the lifetime threshold. */
  commissionCents: number;
  sellerCents: number;
}

/** The fields a sale needs off the agent row. */
interface PurchasableAgent {
  id: string;
  name: string;
  tenantId: number | null;
  priceCents: number;
}

/**
 * The agent a buyer is asking about.
 *
 * CROSS-TENANT BY DESIGN, and declared as such: a published agent is bought FROM
 * another workspace, so filtering by the buyer's tenant would make every agent on
 * the market invisible to everyone who might pay for it. `published` + `status`
 * are the access predicate that replaces the tenant one — exactly the pair the
 * public `GET /api/workforce/agents` listing is built on.
 */
async function loadPurchasableAgent(db: Db, agentId: string): Promise<PurchasableAgent | null> {
  const [agent] = await db
    .select({
      id: ideAgents.id,
      name: ideAgents.name,
      tenantId: ideAgents.tenantId,
      priceCents: ideAgents.priceCents,
    })
    .from(ideAgents)
    .where(acrossTenants(ideAgents, 'public_catalogue',
      eq(ideAgents.id, agentId),
      eq(ideAgents.published, true),
      eq(ideAgents.status, 'active')))
    .limit(1);
  return agent ?? null;
}

/**
 * Has this workspace already bought this agent? The gate `/hire` reads.
 *
 * Deliberately NOT a read of `agent_purchases`: that row is cleared to
 * "unhired" when a buyer releases the agent, and a released agent is still a
 * PAID-FOR agent. Reading the hire row here would charge a buyer a second time
 * for re-hiring something they own.
 */
export async function holdsAgentPurchase(
  db: Db,
  tenantId: number,
  agentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: marketplacePurchases.id })
    .from(marketplacePurchases)
    .where(scopedToTenant(marketplacePurchases, tenantId,
      eq(marketplacePurchases.artifactType, AGENT_ARTIFACT_TYPE),
      eq(marketplacePurchases.artifactSlug, agentId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Send a buyer to the processor's hosted page for a priced agent.
 *
 * Grants nothing. Every refusal here is one that would otherwise become a charge
 * for something the buyer already has, cannot use, or published themselves.
 */
export async function startAgentCheckout(
  db: Db,
  env: Env,
  input: { tenantId: number; buyerUserId: string; buyerEmail?: string | null; agentId: string; returnUrl: string },
): Promise<{ checkoutUrl: string }> {
  const agent = await loadPurchasableAgent(db, input.agentId);
  if (!agent) throw new ListingError('Agent not found', 404);
  if (agent.priceCents <= 0) throw new ListingError('This agent is free — no checkout is needed', 400);
  if (Number(agent.tenantId) === Number(input.tenantId)) {
    throw new ListingError('You already own what you published', 400);
  }
  if (await holdsAgentPurchase(db, input.tenantId, agent.id)) {
    throw new ListingError('You already own this', 400);
  }
  if (!env.STRIPE_SECRET_KEY) {
    throw new ListingError('Payments are not configured on this deployment', 400);
  }

  const base = new URL(input.returnUrl);
  const session = await buildPaymentProvider(env).createOneTimeCheckoutSession({
    amountCents: agent.priceCents,
    currency: 'USD',
    productName: agent.name,
    billingEmail: input.buyerEmail ?? null,
    // Only the ORIGIN and PATH of the caller's url are kept, so a return url
    // cannot smuggle a query string back through the processor. The agent id is
    // re-attached here, from the row, because the buyer comes back needing to say
    // WHICH purchase to complete and the processor substitutes only the session id.
    successUrl: `${base.origin}${base.pathname}?checkout={CHECKOUT_SESSION_ID}&agent=${agent.id}`,
    cancelUrl: `${base.origin}${base.pathname}?checkout=cancelled`,
    metadata: {
      purchaseKind: AGENT_PURCHASE_KIND,
      agentId: agent.id,
      buyerTenantId: String(input.tenantId),
      // Carried because the WEBHOOK leg has no session to read it from, and the
      // purchase row records who bought it. The redirect leg has both and agrees.
      buyerUserId: input.buyerUserId,
    },
    idempotencyKey: `wf-checkout:${agent.id}:${input.tenantId}`,
  });
  return { checkoutUrl: session.checkoutUrl };
}

/**
 * Finish a paid agent acquisition.
 *
 * The session id arrives from the buyer's address bar, so everything that
 * authorises the purchase is read back from the processor — including that the
 * workspace completing it is the workspace it was created for.
 */
export async function completeAgentCheckout(
  db: Db,
  env: Env,
  input: { tenantId: number; buyerUserId: string; checkoutSessionId: string },
): Promise<AgentPurchase> {
  const verified = await verifyPaidCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: AGENT_PURCHASE_KIND,
    owner: { buyerTenantId: input.tenantId },
    messages: {
      notConfigured: 'Payments are not configured on this deployment',
      notFound: 'That checkout could not be found',
      notPaid: 'That checkout has not been paid',
      wrongKind: 'That checkout was not for a marketplace agent',
      notYours: 'That checkout belongs to someone else',
    },
    refuse,
  });

  const agentId = verified.metadata.agentId;
  if (!agentId) throw new ListingError('That checkout names no agent', 400);
  const agent = await loadPurchasableAgent(db, agentId);
  if (!agent) throw new ListingError('Agent not found', 404);
  // A buyer must not be able to open checkout at the old price and complete it
  // after the owner raised it.
  assertCovers(verified, agent.priceCents, 'The payment does not cover this agent', refuse);

  return recordAgentPurchase(db, env, {
    tenantId: input.tenantId,
    buyerUserId: input.buyerUserId,
    agent,
    priceCents: agent.priceCents,
    provider: 'stripe',
    externalRef: verified.paymentRef,
  });
}

/**
 * Write the purchase and pay the seller.
 *
 * `onConflictDoNothing` on `(tenant_id, artifact_type, artifact_slug)` is what
 * makes a replayed redirect idempotent, and the re-read after it is what lets
 * this still return the purchase rather than nothing when the replay loses that
 * race.
 */
async function recordAgentPurchase(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    buyerUserId: string;
    agent: PurchasableAgent;
    priceCents: number;
    provider: string;
    externalRef: string | null;
  },
): Promise<AgentPurchase> {
  const [inserted] = await db
    .insert(marketplacePurchases)
    .values({
      userId: input.buyerUserId,
      tenantId: input.tenantId,
      artifactType: AGENT_ARTIFACT_TYPE,
      artifactSlug: input.agent.id,
      priceCents: input.priceCents,
      pricingModel: 'flat_fee',
      provider: input.provider,
      externalRef: input.externalRef,
    })
    .onConflictDoNothing()
    .returning({ id: marketplacePurchases.id });

  let purchaseId = inserted?.id ?? null;
  if (purchaseId == null) {
    const [existing] = await db
      .select({ id: marketplacePurchases.id })
      .from(marketplacePurchases)
      .where(scopedToTenant(marketplacePurchases, input.tenantId,
        eq(marketplacePurchases.artifactType, AGENT_ARTIFACT_TYPE),
        eq(marketplacePurchases.artifactSlug, input.agent.id)))
      .limit(1);
    purchaseId = existing?.id ?? null;
  }
  if (purchaseId == null) throw new ListingError('Could not record the purchase', 400);

  const { commissionCents, sellerCents } = await splitAgentSale(db, env, input.agent, input.priceCents);
  // Only a sale with an identifiable seller WORKSPACE can be credited; a
  // platform-owned agent (tenant_id NULL) still transfers, it just has nobody to
  // pay. The seller account is the workspace itself rather than a user, because
  // `ide_agents` records no author — the workspace is the only party the money
  // can be attributed to without inventing one.
  if (input.priceCents > 0 && input.agent.tenantId != null) {
    await creditAgentSeller(db, {
      sellerTenantId: Number(input.agent.tenantId),
      purchaseId,
      agentName: input.agent.name,
      sellerCents,
      commissionCents,
    });
  }

  return { purchaseId, agentId: input.agent.id, priceCents: input.priceCents, commissionCents, sellerCents };
}

/**
 * The platform's cut of this sale.
 *
 * Reuses the marketplace's own threshold rule rather than restating a rate. The
 * seller `ref` is the workspace id because `ide_agents` names no author; the
 * lifetime total is therefore the workspace's, which is also the account the
 * credit below lands in — the two must agree or a seller crosses the threshold
 * in one query and not the other.
 */
async function splitAgentSale(
  db: Db,
  env: Env,
  agent: { tenantId: number | null },
  priceCents: number,
): Promise<{ commissionCents: number; sellerCents: number }> {
  if (priceCents <= 0 || agent.tenantId == null) return { commissionCents: 0, sellerCents: priceCents };
  const { bps } = await resolveTakeRateBps(db, env, {
    tenantId: Number(agent.tenantId),
    ref: sellerAccountRef(Number(agent.tenantId)),
    // The SAME account the credit below lands in. Reading the default 'user'
    // account here would find nothing, hold every agent seller under the
    // threshold forever and charge the platform's cut to nobody.
    accountKind: 'tenant',
  });
  const commissionCents = Math.round((priceCents * bps) / 10_000);
  return { commissionCents, sellerCents: priceCents - commissionCents };
}

/** The ledger account an agent's earnings accrue to: the publishing workspace. */
const sellerAccountRef = (tenantId: number): string => `tenant:${tenantId}`;

/**
 * The two ledger rows a sale produces, as ONE insert.
 *
 * THE TENANT ON THESE ROWS IS THE SELLER'S, NOT THE BUYER'S — the earning has to
 * land in the books it will be paid out of. Both references derive from the
 * purchase, so the unique index on `reference` refuses a replayed pair whole.
 */
async function creditAgentSeller(db: Db, input: {
  sellerTenantId: number;
  purchaseId: number;
  agentName: string;
  sellerCents: number;
  commissionCents: number;
}): Promise<void> {
  await db.insert(ledgerEntries).values([
    {
      tenantId: input.sellerTenantId,
      accountKind: 'tenant',
      accountRef: sellerAccountRef(input.sellerTenantId),
      denomination: USD_CENTS,
      amount: String(input.sellerCents),
      entryKind: 'commission',
      reference: `wf-sale:${input.purchaseId}`,
      memo: `Agent sale — ${input.agentName}`,
      metadata: { source: 'workforce_agent', purchaseId: input.purchaseId },
    },
    {
      tenantId: input.sellerTenantId,
      accountKind: 'partner',
      accountRef: 'platform',
      denomination: USD_CENTS,
      amount: String(input.commissionCents),
      entryKind: 'commission',
      reference: `wf-fee:${input.purchaseId}`,
      memo: `Platform fee — ${input.agentName}`,
      metadata: { source: 'workforce_agent', purchaseId: input.purchaseId },
    },
  ]).onConflictDoNothing();
}

/** Re-exported so a route can answer 402 without a second import. */
export { ListingError };
