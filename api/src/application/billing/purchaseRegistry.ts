/**
 * WHO SETTLES A SELF-NAMED PURCHASE THAT ARRIVED BY WEBHOOK.
 *
 * Every flow that opens its own checkout stamps a `purchaseKind` on it. The
 * webhook parser turns those sessions into `checkout.completed` (pay-once) and
 * `addon.*` (recurring) events instead of plan activations, and this registry is
 * where each kind says how it is settled. A new flow is a row here, not another
 * branch in the webhook route.
 *
 * A kind with no row is acknowledged and left alone: its redirect leg is the
 * only door it has, which is a deliberate choice for that flow, not an error.
 *
 * One-off settlers return `null` when the signed metadata does not name what they
 * need (unretryable — acknowledged), otherwise whether the settlement applied.
 * They re-read the session from the processor themselves, so a webhook can never
 * grant what the processor does not confirm.
 *
 * ORDER REFUNDERS are the other direction: the one refund route
 * (`refundListingOrder`) hands an order whose number names a self-settled flow to
 * that flow's refunder, so a refund reverses what the flow granted — a recording
 * pack's unused credits — rather than revoking a marketplace licence it never sold.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { WebhookEvent } from '../../infrastructure/payment/PaymentProvider';
import { completeCommsTopUp, COMMS_TOPUP_KIND } from '../phone/commsTopUp';
import { AGENT_PURCHASE_KIND, completeAgentCheckout } from '../marketplace/agentCommerce';
import { SKILL_PURCHASE_KIND, completeSkillCheckout } from '../marketplace/skillCommerce';
import {
  MARKETPLACE_LISTING_KIND,
  completeListingCheckout,
  recordMarketplaceListingEvent,
} from '../marketplace/listingCommerce';
import { recordBusinessPhoneEvent } from '../tenant/businessPhoneSubscription';
import { recordManagedAgentHostEvent, MANAGED_AGENT_HOST_KIND } from '../tenant/managedAgentHostSubscription';
import { deprovisionOccupyingManagedAgentHosts } from '../tenant/managedAgentHostProvision';
import { managedAgentHostContainerRuntime } from '../tenant/managedAgentHostRuntime';
import { completeSpawnTopUp, SPAWN_TOKENS_KIND } from '../spawn/spawnTopUp';
import { recordSpawnPlanEvent, SPAWN_PLAN_KIND } from '../spawn/spawnMembership';
import { REPLAY_PACK_KIND } from '../commerce/replayPacks';
import { KNOWLEDGE_PURCHASE_KIND, completeKnowledgeCheckout } from '../knowledge/knowledgeCommerce';
import { TENANT_INVOICE_KIND, settleInvoiceCheckout } from '../finance/receivables';
import { REPLAY_PACK_ORDER_PREFIX, refundReplayPackOrder, settleReplayPack } from '../commerce/replayPackSettlement';

export interface OneOffSettlement {
  checkoutSessionId: string;
  tenantId?: number;
  metadata: Record<string, string>;
}

type OneOffSettler = (db: Db, env: Env, settlement: OneOffSettlement) => Promise<boolean | null>;
type AddonRecorder = (db: Db, env: Env, event: WebhookEvent) => Promise<boolean>;
export type OrderRefunder = (
  db: Db,
  env: Env,
  input: { tenantId: number; orderId: number; actorRef: string },
) => Promise<{ refundedCents: number }>;

const ONE_OFF_SETTLERS: Readonly<Record<string, OneOffSettler>> = {
  [COMMS_TOPUP_KIND]: async (db, env, { checkoutSessionId, tenantId }) => {
    if (!tenantId) return null;
    return (await completeCommsTopUp(db, env, { tenantId, checkoutSessionId })).applied;
  },
  [SPAWN_TOKENS_KIND]: async (db, env, { checkoutSessionId, tenantId }) => {
    if (!tenantId) return null;
    return (await completeSpawnTopUp(db, env, { tenantId, checkoutSessionId })).applied;
  },
  [AGENT_PURCHASE_KIND]: async (db, env, { checkoutSessionId, metadata }) => {
    const tenantId = Number(metadata.buyerTenantId);
    const buyerUserId = metadata.buyerUserId;
    if (!Number.isInteger(tenantId) || tenantId <= 0 || !buyerUserId) return null;
    await completeAgentCheckout(db, env, { tenantId, buyerUserId, checkoutSessionId });
    return true;
  },
  // USER-scoped: a skill/persona is bought by a person from the marketing
  // marketplace, where no workspace need exist. The settler reads buyerUserId
  // from signed metadata rather than requiring a tenant id.
  [SKILL_PURCHASE_KIND]: async (db, env, { checkoutSessionId, metadata }) => {
    const buyerUserId = metadata.buyerUserId;
    if (!buyerUserId) return null;
    await completeSkillCheckout(db, env, { buyerUserId, checkoutSessionId });
    return true;
  },
  [MARKETPLACE_LISTING_KIND]: async (db, env, { checkoutSessionId, metadata }) => {
    const tenantId = Number(metadata.buyerTenantId ?? metadata.tenantId);
    const buyerRef = metadata.buyerRef;
    if (!Number.isInteger(tenantId) || tenantId <= 0 || !buyerRef) return null;
    await completeListingCheckout(db, env, { tenantId, buyerRef, checkoutSessionId });
    return true;
  },
  // A knowledge listing is bought by a USER on behalf of a workspace; both are
  // in the signed metadata, and both must match on the redirect leg too.
  [KNOWLEDGE_PURCHASE_KIND]: async (db, env, { checkoutSessionId, metadata }) => {
    const tenantId = Number(metadata.buyerTenantId);
    const buyerUserId = metadata.buyerUserId;
    if (!Number.isInteger(tenantId) || tenantId <= 0 || !buyerUserId) return null;
    await completeKnowledgeCheckout(db, env, { tenantId, buyerUserId, checkoutSessionId });
    return true;
  },
  // A TENANT's own invoice paid by THEIR customer (FO-C4). The tenant here is the
  // SELLER (`invoiceTenantId`), never a buyer workspace; reports whether it applied
  // because a second arrival of a settled receivable applies nothing.
  [TENANT_INVOICE_KIND]: async (db, env, { checkoutSessionId, metadata }) => {
    const tenantId = Number(metadata.invoiceTenantId);
    const invoiceRef = metadata.invoiceRef;
    if (!Number.isInteger(tenantId) || tenantId <= 0 || !invoiceRef) return null;
    return (await settleInvoiceCheckout(db, env, { tenantId, invoiceRef, checkoutSessionId })).applied;
  },
  // Insights recording packs (PRD 33 D4): credits on the tenant's
  // `replay_recordings` ledger, keyed on the checkout so redirect + webhook = one row.
  [REPLAY_PACK_KIND]: (db, env, settlement) => settleReplayPack(db, env, settlement),
};

/** Order-number prefix → the flow that refunds such an order. */
const ORDER_REFUNDERS: Readonly<Record<string, OrderRefunder>> = {
  [REPLAY_PACK_ORDER_PREFIX]: (db, env, input) => refundReplayPackOrder(db, env, input),
};

const ADDON_RECORDERS: Readonly<Record<string, AddonRecorder>> = {
  business_phone: async (db, _env, event) => {
    await recordBusinessPhoneEvent(db, event);
    return true;
  },
  [MANAGED_AGENT_HOST_KIND]: async (db, env, event) => {
    await recordManagedAgentHostEvent(db, event);
    if (event.type === 'addon.cancelled' && event.tenantId) {
      await deprovisionOccupyingManagedAgentHosts(db, event.tenantId, {
        runtime: managedAgentHostContainerRuntime(env),
        env,
      });
    }
    return true;
  },
  [SPAWN_PLAN_KIND]: recordSpawnPlanEvent,
  // Pay-once listings settle on `checkout.completed` via the one-off settler.
  // This recorder is the close-the-tab path for an `addon.*` event that still
  // names the kind — same grant, re-read from Stripe.
  [MARKETPLACE_LISTING_KIND]: recordMarketplaceListingEvent,
};

/** The settler for a pay-once kind, or null when it settles only on its redirect. */
export function oneOffSettlerFor(kind: string | undefined): OneOffSettler | null {
  return (kind && ONE_OFF_SETTLERS[kind]) || null;
}

/** The recorder for a recurring add-on kind, or null when nothing listens for it. */
export function addonRecorderFor(kind: string | undefined): AddonRecorder | null {
  return (kind && ADDON_RECORDERS[kind]) || null;
}

/** The refunder for an order a self-settled flow wrote, or null for a marketplace sale. */
export function orderRefunderFor(orderNumber: string | null | undefined): OrderRefunder | null {
  if (!orderNumber) return null;
  for (const [prefix, refunder] of Object.entries(ORDER_REFUNDERS)) {
    if (orderNumber.startsWith(prefix)) return refunder;
  }
  return null;
}
