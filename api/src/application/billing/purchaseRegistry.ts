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
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { WebhookEvent } from '../../infrastructure/payment/PaymentProvider';
import { completeCommsTopUp, COMMS_TOPUP_KIND } from '../phone/commsTopUp';
import { AGENT_PURCHASE_KIND, completeAgentCheckout } from '../marketplace/agentCommerce';
import { recordBusinessPhoneEvent } from '../tenant/businessPhoneSubscription';
import { completeSpawnTopUp, SPAWN_TOKENS_KIND } from '../spawn/spawnTopUp';
import { recordSpawnPlanEvent, SPAWN_PLAN_KIND } from '../spawn/spawnMembership';

export interface OneOffSettlement {
  checkoutSessionId: string;
  tenantId?: number;
  metadata: Record<string, string>;
}

type OneOffSettler = (db: Db, env: Env, settlement: OneOffSettlement) => Promise<boolean | null>;
type AddonRecorder = (db: Db, env: Env, event: WebhookEvent) => Promise<boolean>;

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
};

const ADDON_RECORDERS: Readonly<Record<string, AddonRecorder>> = {
  business_phone: async (db, _env, event) => {
    await recordBusinessPhoneEvent(db, event);
    return true;
  },
  [SPAWN_PLAN_KIND]: recordSpawnPlanEvent,
};

/** The settler for a pay-once kind, or null when it settles only on its redirect. */
export function oneOffSettlerFor(kind: string | undefined): OneOffSettler | null {
  return (kind && ONE_OFF_SETTLERS[kind]) || null;
}

/** The recorder for a recurring add-on kind, or null when nothing listens for it. */
export function addonRecorderFor(kind: string | undefined): AddonRecorder | null {
  return (kind && ADDON_RECORDERS[kind]) || null;
}
