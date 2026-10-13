/**
 * BUYING SESSION-REPLAY RECORDING PACKS — the checkout half (PRD 33 §8 S6 / D4).
 *
 * The only door that puts paid recordings on a tenant's ledger, in the same three
 * moves as `commsTopUp.ts` / `spawnTopUp.ts`:
 *
 *   1. {@link startReplayPackCheckout} (here) opens a hosted checkout for a
 *      published pack and stamps `purchaseKind: replay_pack` plus the tenant and
 *      pack into the session metadata.
 *   2. The processor takes the money.
 *   3. `replayPackSettlement.ts` reads the session BACK from the processor via
 *      `verifyPaidCheckout` and only then inserts the order and credits
 *      `replay_recordings` — from the redirect or from the webhook
 *      (`ONE_OFF_SETTLERS['replay_pack']` in `purchaseRegistry.ts`).
 *
 * Auto-recharge (an emailed top-up link — the provider has no off-session charge)
 * lives in `replayAutorecharge.ts`. Charging units for kept recordings is the data
 * plane's (`application/replay/replayUsage.ts`); nothing here debits.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { buildPaymentProvider, PaymentNotConfiguredError } from '../../infrastructure/payment';
import { recordReplayTrace, REPLAY_TRACE_VERBS } from '../replay/replayTrace';
import {
  loadReplayCatalog,
  replayCheckoutIdempotencyKey,
  replayPack,
  type ReplayPack,
} from './replayCatalog';

/** The `purchaseKind` stamped on a recording-pack session. */
export const REPLAY_PACK_KIND = 'replay_pack';

export class ReplayCommerceError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 402 | 503 = 400) {
    super(message);
    this.name = 'ReplayCommerceError';
  }
}

/** The packs on sale right now (the published listing's body, else the D4 ladder). */
export async function loadReplayPacks(env: Env | undefined, db: Db): Promise<readonly ReplayPack[]> {
  return (await loadReplayCatalog(env, db)).packs;
}

/**
 * The app's own origins: every entry of `APP_URL` (it may hold a comma-separated
 * allow-list; the first is canonical — `resolveAppBaseUrl`). A checkout may return
 * only there.
 */
function appOrigins(env: Pick<Env, 'APP_URL'>): Set<string> {
  const origins = new Set<string>();
  for (const entry of (env.APP_URL ?? 'https://builderforce.ai').split(',')) {
    try {
      origins.add(new URL(entry.trim()).origin);
    } catch {
      // A malformed entry names no origin.
    }
  }
  return origins;
}

/**
 * The processor's success/cancel URLs. 400 unless `returnUrl` is absolute AND on
 * the app's own origin: the processor redirects the buyer there after payment, so
 * an arbitrary origin would make the checkout an open redirect.
 */
function checkoutUrls(env: Pick<Env, 'APP_URL'>, returnUrl: string): { successUrl: string; cancelUrl: string } {
  let base: URL;
  try {
    base = new URL(returnUrl);
  } catch {
    throw new ReplayCommerceError('returnUrl must be an absolute URL', 400);
  }
  if (!appOrigins(env).has(base.origin)) {
    throw new ReplayCommerceError('returnUrl must be on the app origin', 400);
  }
  return {
    // Only origin + path: a return url cannot smuggle a query string back
    // through the processor. The session id is what settlement needs.
    successUrl: `${base.origin}${base.pathname}?replay_pack={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base.origin}${base.pathname}?replay_pack=cancelled`,
  };
}

export async function startReplayPackCheckout(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    buyerRef: string;
    packId: string;
    billingEmail?: string | null;
    returnUrl: string;
    now?: Date;
    /** The member who pressed Buy; null for the auto-recharge offer. */
    actorId?: string | null;
  },
): Promise<{ checkoutUrl: string; sessionId: string; pack: ReplayPack }> {
  const packs = await loadReplayPacks(env, db);
  const pack = replayPack(input.packId, packs);
  if (!pack) throw new ReplayCommerceError('That recording pack does not exist', 404);
  const urls = checkoutUrls(env, input.returnUrl);

  await recordReplayTrace(env, db, {
    tenantId: input.tenantId,
    verb: REPLAY_TRACE_VERBS.checkoutStarted,
    actorId: input.actorId ?? null,
    summary: `Started checkout for ${pack.id}`,
    metadata: { packId: pack.id, units: pack.units, amountCents: pack.amountCents, buyerRef: input.buyerRef },
  });

  try {
    const session = await buildPaymentProvider(env).createOneTimeCheckoutSession({
      amountCents: pack.amountCents,
      currency: 'USD',
      productName: `Session replay recordings — ${pack.units.toLocaleString('en-US')}`,
      billingEmail: input.billingEmail ?? null,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
      metadata: {
        purchaseKind: REPLAY_PACK_KIND,
        tenantId: String(input.tenantId),
        packId: pack.id,
        amountCents: String(pack.amountCents),
        buyerRef: input.buyerRef,
      },
      idempotencyKey: replayCheckoutIdempotencyKey(input.tenantId, pack.id, input.now),
    });

    await recordReplayTrace(env, db, {
      tenantId: input.tenantId,
      verb: REPLAY_TRACE_VERBS.checkoutSessionCreated,
      actorId: input.actorId ?? null,
      summary: `Opened checkout ${session.sessionId}`,
      metadata: { packId: pack.id, sessionId: session.sessionId, amountCents: pack.amountCents },
    });

    return { checkoutUrl: session.checkoutUrl, sessionId: session.sessionId, pack };
  } catch (err) {
    if (err instanceof PaymentNotConfiguredError) {
      throw new ReplayCommerceError('Payments are not configured', 503);
    }
    throw err;
  }
}
