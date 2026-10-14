/**
 * SETTLING AND REFUNDING SESSION-REPLAY PACKS (PRD 33 §8 S6 / D4).
 *
 * {@link completeReplayPack} / {@link settleReplayPack} read the checkout BACK from
 * the processor (`verifyPaidCheckout`) and only then write the order and credit
 * `replay_recordings`. The credit is keyed on `replay-pack:${checkoutSessionId}`,
 * so the redirect and the webhook (`ONE_OFF_SETTLERS['replay_pack']`) land on one
 * ledger row. The money agreement is the `orders` row (`total_cents`); no
 * `usd_cents` entry is written on the tenant account (that denomination is
 * payout-shaped and would look like cash to send).
 *
 * {@link refundReplayPack} claws back only the UNUSED remainder of that pack's
 * grant and marks the order refunded. It is reached from the one refund route
 * through `orderRefunderFor` (orders numbered `RP-…`), never by revoking a licence:
 * a pack is credits, and refunding it must not uninstall Insights.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { orderLineItems, orders } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { registerObject } from '../kernel/ObjectRegistry';
import { verifyPaidCheckout, assertCovers } from '../finance/verifiedCheckout';
import { recordReplayTrace, REPLAY_TRACE_VERBS } from '../replay/replayTrace';
import { loadReplayCatalog, replayPack, type ReplayPack } from './replayCatalog';
import {
  creditReplayPack,
  loadGrantRows,
  refundReplayCredits,
  remainingOfGrant,
  replayWalletSnapshot,
} from './replayWallet';
import { REPLAY_PACK_KIND, ReplayCommerceError } from './replayPacks';

/** Order numbers this module writes start with this — the refund registry's key. */
export const REPLAY_PACK_ORDER_PREFIX = 'RP-';

const refuse = (message: string, status: 400 | 403 | 404 = 400) => new ReplayCommerceError(message, status);

export const replayPackCreditReference = (checkoutSessionId: string) => `replay-pack:${checkoutSessionId}`;

async function insertPaidOrder(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    buyerRef: string | null;
    pack: ReplayPack;
    checkoutSessionId: string;
    catalogItemId: string | null;
  },
): Promise<{ id: number; created: boolean }> {
  const findExisting = async () => {
    const [row] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(scopedToTenant(orders, input.tenantId, eq(orders.providerRef, input.checkoutSessionId)))
      .limit(1);
    return row ?? null;
  };
  const existing = await findExisting();
  if (existing) return { id: existing.id, created: false };

  const orderNumber = `${REPLAY_PACK_ORDER_PREFIX}${input.checkoutSessionId.replace(/[^a-zA-Z0-9]/g, '').slice(-36)}`.slice(0, 48);
  const [inserted] = await db.insert(orders).values({
    tenantId: input.tenantId,
    orderNumber,
    buyerRef: input.buyerRef,
    buyerEmail: null,
    currency: 'USD',
    subtotalCents: input.pack.amountCents,
    taxCents: 0,
    totalCents: input.pack.amountCents,
    status: 'paid',
    provider: 'stripe',
    providerRef: input.checkoutSessionId,
    fulfilledAt: new Date(),
  }).onConflictDoNothing().returning({ id: orders.id });

  if (!inserted) {
    const again = await findExisting();
    if (!again) throw new ReplayCommerceError('Could not record the order', 400);
    return { id: again.id, created: false };
  }

  await registerObject(db, env, {
    tenantId: input.tenantId,
    kind: 'order',
    refId: inserted.id,
    domain: 'commerce',
    title: `Session replay ${input.pack.id}`,
  });

  await db.insert(orderLineItems).values({
    tenantId: input.tenantId,
    orderId: inserted.id,
    catalogItemId: input.catalogItemId,
    description: `Session replay recordings — ${input.pack.units.toLocaleString('en-US')} (${input.pack.id})`,
    quantity: 1,
    unitCents: input.pack.amountCents,
    amountCents: input.pack.amountCents,
    sellerRef: 'builderforce',
    commissionCents: 0,
    position: 0,
  });

  return { id: inserted.id, created: true };
}

export async function completeReplayPack(
  db: Db,
  env: Env,
  input: { tenantId: number; checkoutSessionId: string; now?: Date },
): Promise<{ applied: boolean; creditedUnits: number; credits: number; orderId: number | null }> {
  const verified = await verifyPaidCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: REPLAY_PACK_KIND,
    owner: { tenantId: input.tenantId },
    messages: {
      notConfigured: 'Payments are not configured',
      notFound: 'That payment could not be found',
      notPaid: 'That payment has not completed',
      wrongKind: 'That payment was not for a session-replay pack',
      notYours: 'That payment belongs to a different workspace',
    },
    refuse,
  });

  const catalog = await loadReplayCatalog(env, db);
  const pack = replayPack(verified.metadata.packId ?? '', catalog.packs);
  if (!pack) throw refuse('That recording pack no longer exists', 404);
  assertCovers(verified, pack.amountCents, 'That payment did not cover the recording pack', refuse);

  const order = await insertPaidOrder(db, env, {
    tenantId: input.tenantId,
    buyerRef: verified.metadata.buyerRef ?? null,
    pack,
    checkoutSessionId: input.checkoutSessionId,
    catalogItemId: catalog.listingId,
  });

  const applied = await creditReplayPack(db, env, {
    tenantId: input.tenantId,
    units: pack.units,
    reference: replayPackCreditReference(input.checkoutSessionId),
    packId: pack.id,
    paymentRef: verified.paymentRef,
    now: input.now,
  });

  if (applied) {
    await recordReplayTrace(env, db, {
      tenantId: input.tenantId,
      verb: REPLAY_TRACE_VERBS.paymentCompleted,
      summary: `Paid ${pack.id} (${pack.units} recordings)`,
      metadata: {
        packId: pack.id,
        checkoutSessionId: input.checkoutSessionId,
        paymentRef: verified.paymentRef,
        orderId: order.id,
        amountCents: pack.amountCents,
        units: pack.units,
      },
    });
    await recordReplayTrace(env, db, {
      tenantId: input.tenantId,
      verb: REPLAY_TRACE_VERBS.creditsAdded,
      summary: `Credited ${pack.units} recordings`,
      metadata: { packId: pack.id, checkoutSessionId: input.checkoutSessionId, units: pack.units },
    });
  }

  const snapshot = await replayWalletSnapshot(db, env, input.tenantId, { now: input.now });
  return { applied, creditedUnits: pack.units, credits: snapshot.credits, orderId: order.id };
}

/**
 * Webhook settler — the `ONE_OFF_SETTLERS[REPLAY_PACK_KIND]` row. Returns null when
 * the signed metadata names no tenant (unretryable — acknowledged).
 */
export async function settleReplayPack(
  db: Db,
  env: Env,
  settlement: { checkoutSessionId: string; tenantId?: number; metadata: Record<string, string> },
): Promise<boolean | null> {
  const tenantId = settlement.tenantId ?? Number(settlement.metadata.tenantId);
  if (!Number.isInteger(tenantId) || tenantId <= 0) return null;
  return (await completeReplayPack(db, env, {
    tenantId,
    checkoutSessionId: settlement.checkoutSessionId,
  })).applied;
}

export async function refundReplayPack(
  db: Db,
  env: Env,
  input: { tenantId: number; checkoutSessionId: string; actorId?: string | null; now?: Date },
): Promise<{ refunded: boolean; unitsReturned: number; credits: number; refundedCents: number }> {
  const [order] = await db
    .select({ id: orders.id, status: orders.status, totalCents: orders.totalCents })
    .from(orders)
    .where(scopedToTenant(orders, input.tenantId, eq(orders.providerRef, input.checkoutSessionId)))
    .limit(1);
  if (!order) throw new ReplayCommerceError('That recording pack purchase was not found', 404);

  const now = input.now ?? new Date();
  const rows = await loadGrantRows(db, input.tenantId);
  const remainder = remainingOfGrant(rows, replayPackCreditReference(input.checkoutSessionId), now);

  let unitsReturned = 0;
  let wrote = false;
  if (remainder > 0) {
    wrote = await refundReplayCredits(db, env, {
      tenantId: input.tenantId,
      units: remainder,
      reference: `replay-pack-refund:${input.checkoutSessionId}`,
      memo: `Refund unused session-replay recordings (${remainder})`,
      metadata: { checkoutSessionId: input.checkoutSessionId, units: remainder },
    });
    if (wrote) unitsReturned = remainder;
  }

  const alreadyRefunded = order.status === 'refunded';
  if (!alreadyRefunded) {
    await db.update(orders).set({
      status: 'refunded',
      refundedAt: now,
      updatedAt: now,
    }).where(scopedToTenant(orders, input.tenantId, eq(orders.id, order.id)));

    await recordReplayTrace(env, db, {
      tenantId: input.tenantId,
      verb: REPLAY_TRACE_VERBS.paymentRefunded,
      actorId: input.actorId ?? null,
      summary: `Refunded unused ${unitsReturned} recordings`,
      metadata: { checkoutSessionId: input.checkoutSessionId, orderId: order.id, unitsReturned },
    });
  }

  const snapshot = await replayWalletSnapshot(db, env, input.tenantId, { now });
  return {
    refunded: wrote || !alreadyRefunded,
    unitsReturned,
    credits: snapshot.credits,
    refundedCents: order.totalCents,
  };
}

/**
 * The refund-registry entry: the one refund route hands over an ORDER id; this
 * finds the checkout the order was paid by and refunds the pack's remainder.
 */
export async function refundReplayPackOrder(
  db: Db,
  env: Env,
  input: { tenantId: number; orderId: number; actorRef: string },
): Promise<{ refundedCents: number }> {
  const [order] = await db
    .select({ providerRef: orders.providerRef })
    .from(orders)
    .where(scopedToTenant(orders, input.tenantId, eq(orders.id, input.orderId)))
    .limit(1);
  if (!order?.providerRef) throw new ReplayCommerceError('That recording pack purchase was not found', 404);
  const result = await refundReplayPack(db, env, {
    tenantId: input.tenantId,
    checkoutSessionId: order.providerRef,
    actorId: input.actorRef,
  });
  return { refundedCents: result.refundedCents };
}
