/**
 * BUYING SESSION-REPLAY RECORDING PACKS — the only door that puts paid
 * recordings on a tenant's ledger (PRD 33a §8 / D4).
 *
 * Same three moves as `commsTopUp.ts` / `spawnTopUp.ts`:
 *
 *   1. {@link startReplayPackCheckout} opens a hosted checkout for a published
 *      pack and stamps `purchaseKind: replay_pack` plus the tenant and pack
 *      into the session metadata.
 *   2. The processor takes the money.
 *   3. {@link completeReplayPack} / {@link settleReplayPack} read the session
 *      BACK from the processor via `verifyPaidCheckout` and only then insert
 *      the order and credit `replay_recordings`.
 *
 * The credit is keyed on `replay-pack:${checkoutSessionId}`, so the redirect
 * and the webhook land on one ledger row. The money agreement is the `orders`
 * row (`total_cents`); we do not write `usd_cents` onto the tenant account
 * (that denomination is payout-shaped and would look like cash to send).
 *
 * `ONE_OFF_SETTLERS['replay_pack']` is owned by `purchaseRegistry.ts` (out of
 * this slice). {@link settleReplayPack} is the settler those rows call: same
 * `(db, env, settlement)` shape as comms/spawn.
 *
 * Auto-recharge cannot charge a saved card — `PaymentProvider` has no
 * off-session capture. When the wallet drops below 10% of the chosen pack we
 * mint a hosted checkout and return an email payload. Do not fake a charge.
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { catalogItems, orderLineItems, orders, settings, templateLicenses } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { buildPaymentProvider, PaymentNotConfiguredError } from '../../infrastructure/payment';
import { recordActivity, SYSTEM_ACTOR, type ActorIdentity } from '../activity/activityLog';
import { verifyPaidCheckout, assertCovers } from '../finance/verifiedCheckout';
import { registerObject } from '../kernel/ObjectRegistry';
import {
  DEFAULT_REPLAY_CATALOG_BODY,
  packsFromCatalogBody,
  replayCheckoutIdempotencyKey,
  replayPack,
  REPLAY_AUTORECHARGE_THRESHOLD,
  REPLAY_FREE_MONTHLY_UNITS,
  REPLAY_PACKS,
  SESSION_REPLAY_SLUG,
  unitsForBytes,
  type ReplayPack,
} from './replayCatalog';
import {
  creditReplayPack,
  debitReplayCredits,
  debitReplayFree,
  loadGrantRows,
  refundReplayCredits,
  remainingOfGrant,
  replayWalletSnapshot,
  visitAlreadyBilled,
} from './replayWallet';

/** The `purchaseKind` stamped on a recording-pack session. */
export const REPLAY_PACK_KIND = 'replay_pack';

export const REPLAY_AUTORECHARGE_FEATURE = 'replay_autorecharge';

export class ReplayCommerceError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 402 | 503 = 400) {
    super(message);
    this.name = 'ReplayCommerceError';
  }
}

const refuse = (message: string, status: 400 | 403 | 404 = 400) => new ReplayCommerceError(message, status);

export interface ReplayAutorechargeSettings {
  packId: string;
  threshold: number;
}

export interface ReplayUpgradePrompt {
  reason: 'not_installed' | 'exhausted';
  title: string;
  body: string;
  cta: 'install' | 'buy_pack';
  packs: readonly ReplayPack[];
}

export interface ReplayAccess {
  entitled: boolean;
  installed: boolean;
  superadmin: boolean;
  credits: number;
  freeRemaining: number;
  freeUsed: number;
  period: string;
  canRecord: boolean;
  upgrade: ReplayUpgradePrompt | null;
}

export interface ReplayConsumeOk {
  ok: true;
  applied: boolean;
  units: number;
  source: 'free' | 'credits' | 'mixed';
  credits: number;
  freeRemaining: number;
}

export interface ReplayConsumeRefused {
  ok: false;
  reason: 'not_entitled' | 'exhausted';
  units: number;
  credits: number;
  freeRemaining: number;
  upgrade: ReplayUpgradePrompt | null;
}

export type ReplayConsumeResult = ReplayConsumeOk | ReplayConsumeRefused;

export interface ReplayAutorechargeNotice {
  /** Hosted checkout — there is no off-session charge on PaymentProvider. */
  kind: 'email_topup';
  reason: 'no_off_session_charge';
  packId: string;
  checkoutUrl: string;
  sessionId: string;
  to: string | null;
  subject: string;
  body: string;
}

interface ListingRow {
  id: string;
  body: unknown;
}

async function loadReplayListing(db: Db): Promise<ListingRow | null> {
  const [row] = await db
    .select({ id: catalogItems.id, body: catalogItems.body })
    .from(catalogItems)
    .where(acrossTenants(
      catalogItems,
      'public_catalogue',
      eq(catalogItems.slug, SESSION_REPLAY_SLUG),
    ))
    .limit(1);
  return row ?? null;
}

export async function loadReplayPacks(db: Db): Promise<readonly ReplayPack[]> {
  const listing = await loadReplayListing(db);
  const fromBody = listing ? packsFromCatalogBody(listing.body) : null;
  return fromBody ?? REPLAY_PACKS;
}

function checkoutUrls(returnUrl: string): { successUrl: string; cancelUrl: string } {
  const base = new URL(returnUrl);
  return {
    // Only origin + path: a return url cannot smuggle a query string back
    // through the processor. The session id is what complete needs.
    successUrl: `${base.origin}${base.pathname}?replay_pack={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base.origin}${base.pathname}?replay_pack=cancelled`,
  };
}

async function trace(
  env: Env,
  db: Db,
  tenantId: number,
  verb: string,
  summary: string,
  metadata: Record<string, unknown>,
  actor: ActorIdentity = SYSTEM_ACTOR,
): Promise<void> {
  await recordActivity(env, db, {
    tenantId,
    actor,
    verb,
    targetType: 'replay_pack',
    targetId: String(metadata.packId ?? metadata.checkoutSessionId ?? tenantId),
    summary,
    metadata,
  });
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
    actor?: ActorIdentity;
  },
): Promise<{ checkoutUrl: string; sessionId: string; pack: ReplayPack }> {
  const packs = await loadReplayPacks(db);
  const pack = replayPack(input.packId, packs);
  if (!pack) throw new ReplayCommerceError('That recording pack does not exist', 404);

  await trace(env, db, input.tenantId, 'replay.checkout.started', `Started checkout for ${pack.id}`, {
    packId: pack.id,
    units: pack.units,
    cents: pack.cents,
    buyerRef: input.buyerRef,
  }, input.actor ?? SYSTEM_ACTOR);

  const urls = checkoutUrls(input.returnUrl);
  try {
    const session = await buildPaymentProvider(env).createOneTimeCheckoutSession({
      amountCents: pack.cents,
      currency: 'USD',
      productName: `Session replay recordings — ${pack.units.toLocaleString('en-US')}`,
      billingEmail: input.billingEmail ?? null,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
      metadata: {
        purchaseKind: REPLAY_PACK_KIND,
        tenantId: String(input.tenantId),
        packId: pack.id,
        cents: String(pack.cents),
        buyerRef: input.buyerRef,
      },
      idempotencyKey: replayCheckoutIdempotencyKey(input.tenantId, pack.id, input.now),
    });

    await trace(env, db, input.tenantId, 'replay.checkout.session_created', `Opened checkout ${session.sessionId}`, {
      packId: pack.id,
      sessionId: session.sessionId,
      cents: pack.cents,
    }, input.actor ?? SYSTEM_ACTOR);

    return { checkoutUrl: session.checkoutUrl, sessionId: session.sessionId, pack };
  } catch (err) {
    if (err instanceof PaymentNotConfiguredError) {
      throw new ReplayCommerceError('Payments are not configured', 503);
    }
    throw err;
  }
}

async function insertPaidOrder(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    buyerRef: string | null;
    buyerEmail: string | null;
    pack: ReplayPack;
    checkoutSessionId: string;
    paymentRef: string;
    catalogItemId: string | null;
  },
): Promise<{ id: number; created: boolean }> {
  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(scopedToTenant(orders, input.tenantId, eq(orders.providerRef, input.checkoutSessionId)))
    .limit(1);
  if (existing) return { id: existing.id, created: false };

  const orderNumber = `RP-${input.checkoutSessionId.replace(/[^a-zA-Z0-9]/g, '').slice(-36)}`.slice(0, 48);
  const [inserted] = await db.insert(orders).values({
    tenantId: input.tenantId,
    orderNumber,
    buyerRef: input.buyerRef,
    buyerEmail: input.buyerEmail,
    currency: 'USD',
    subtotalCents: input.pack.cents,
    taxCents: 0,
    totalCents: input.pack.cents,
    status: 'paid',
    provider: 'stripe',
    providerRef: input.checkoutSessionId,
    fulfilledAt: new Date(),
  }).onConflictDoNothing().returning({ id: orders.id });

  if (!inserted) {
    const [again] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(scopedToTenant(orders, input.tenantId, eq(orders.providerRef, input.checkoutSessionId)))
      .limit(1);
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
    unitCents: input.pack.cents,
    amountCents: input.pack.cents,
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

  const packs = await loadReplayPacks(db);
  const pack = replayPack(verified.metadata.packId ?? '', packs);
  if (!pack) throw refuse('That recording pack no longer exists', 404);
  assertCovers(verified, pack.cents, 'That payment did not cover the recording pack', refuse);

  const listing = await loadReplayListing(db);
  const order = await insertPaidOrder(db, env, {
    tenantId: input.tenantId,
    buyerRef: verified.metadata.buyerRef ?? null,
    buyerEmail: null,
    pack,
    checkoutSessionId: input.checkoutSessionId,
    paymentRef: verified.paymentRef,
    catalogItemId: listing?.id ?? null,
  });

  const applied = await creditReplayPack(db, env, {
    tenantId: input.tenantId,
    units: pack.units,
    reference: `replay-pack:${input.checkoutSessionId}`,
    packId: pack.id,
    paymentRef: verified.paymentRef,
    now: input.now,
  });

  if (applied) {
    await trace(env, db, input.tenantId, 'replay.payment.completed', `Paid ${pack.id} (${pack.units} recordings)`, {
      packId: pack.id,
      checkoutSessionId: input.checkoutSessionId,
      paymentRef: verified.paymentRef,
      orderId: order.id,
      cents: pack.cents,
      units: pack.units,
    });
    await trace(env, db, input.tenantId, 'replay.credits.added', `Credited ${pack.units} recordings`, {
      packId: pack.id,
      checkoutSessionId: input.checkoutSessionId,
      units: pack.units,
    });
  }

  const snapshot = await replayWalletSnapshot(db, env, input.tenantId, { now: input.now });
  return { applied, creditedUnits: pack.units, credits: snapshot.credits, orderId: order.id };
}

/**
 * Webhook-shaped settler. Drop-in for `ONE_OFF_SETTLERS[REPLAY_PACK_KIND]`.
 * Returns null when metadata does not name a tenant (unretryable).
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
  input: { tenantId: number; checkoutSessionId: string; now?: Date },
): Promise<{ refunded: boolean; unitsReturned: number; credits: number }> {
  const [order] = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(scopedToTenant(orders, input.tenantId, eq(orders.providerRef, input.checkoutSessionId)))
    .limit(1);
  if (!order) throw new ReplayCommerceError('That recording pack purchase was not found', 404);

  const now = input.now ?? new Date();
  const rows = await loadGrantRows(db, input.tenantId);
  const remainder = remainingOfGrant(rows, `replay-pack:${input.checkoutSessionId}`, now);

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

  if (order.status !== 'refunded') {
    await db.update(orders).set({
      status: 'refunded',
      refundedAt: now,
      updatedAt: now,
    }).where(scopedToTenant(orders, input.tenantId, eq(orders.id, order.id)));
  }

  await trace(env, db, input.tenantId, 'replay.payment.refunded', `Refunded unused ${unitsReturned} recordings`, {
    checkoutSessionId: input.checkoutSessionId,
    orderId: order.id,
    unitsReturned,
  });

  const snapshot = await replayWalletSnapshot(db, env, input.tenantId, { now });
  return { refunded: wrote || order.status !== 'refunded', unitsReturned, credits: snapshot.credits };
}

export async function tenantInstalledReplay(db: Db, tenantId: number): Promise<boolean> {
  const listing = await loadReplayListing(db);
  if (!listing) return false;
  const [licence] = await db
    .select({ id: templateLicenses.id })
    .from(templateLicenses)
    .where(scopedToTenant(
      templateLicenses,
      tenantId,
      eq(templateLicenses.catalogItemId, listing.id),
      isNull(templateLicenses.revokedAt),
      or(isNull(templateLicenses.expiresAt), sql`${templateLicenses.expiresAt} > now()`)!,
    ))
    .limit(1);
  return Boolean(licence);
}

export function replayUpgradePrompt(reason: ReplayUpgradePrompt['reason']): ReplayUpgradePrompt {
  if (reason === 'not_installed') {
    return {
      reason,
      title: 'Install session replay',
      body: 'Session replay is a free install. Add the capability to start recording visits — 5,000 recordings a month are included, and packs cover anything past that.',
      cta: 'install',
      packs: REPLAY_PACKS,
    };
  }
  return {
    reason,
    title: 'Recording allowance used up',
    body: 'This workspace has used its free recordings for the month and has no paid credits left. Buy a pack to keep recording.',
    cta: 'buy_pack',
    packs: REPLAY_PACKS,
  };
}

export async function replayAccess(
  db: Db,
  env: Env | undefined,
  tenantId: number,
  opts: { superadmin?: boolean; now?: Date } = {},
): Promise<ReplayAccess> {
  const superadmin = opts.superadmin === true;
  const installed = await tenantInstalledReplay(db, tenantId);
  const entitled = installed || superadmin;
  const snapshot = await replayWalletSnapshot(db, env, tenantId, { now: opts.now });
  const canRecord = entitled && (snapshot.freeRemaining > 0 || snapshot.credits > 0);
  let upgrade: ReplayUpgradePrompt | null = null;
  if (!entitled) upgrade = replayUpgradePrompt('not_installed');
  else if (!canRecord) upgrade = replayUpgradePrompt('exhausted');
  return {
    entitled,
    installed,
    superadmin,
    credits: snapshot.credits,
    freeRemaining: snapshot.freeRemaining,
    freeUsed: snapshot.freeUsed,
    period: snapshot.period,
    canRecord,
    upgrade,
  };
}

export async function consumeReplayRecording(
  db: Db,
  env: Env | undefined,
  input: {
    tenantId: number;
    visitId: string;
    bytes: number;
    superadmin?: boolean;
    now?: Date;
  },
): Promise<ReplayConsumeResult> {
  const units = unitsForBytes(input.bytes);
  const access = await replayAccess(db, env, input.tenantId, input);
  if (!access.entitled) {
    return {
      ok: false,
      reason: 'not_entitled',
      units,
      credits: access.credits,
      freeRemaining: access.freeRemaining,
      upgrade: access.upgrade,
    };
  }

  if (await visitAlreadyBilled(db, input.tenantId, input.visitId)) {
    return {
      ok: true,
      applied: false,
      units,
      source: 'credits',
      credits: access.credits,
      freeRemaining: access.freeRemaining,
    };
  }

  const freeTake = Math.min(access.freeRemaining, units);
  const creditTake = units - freeTake;
  if (creditTake > access.credits) {
    return {
      ok: false,
      reason: 'exhausted',
      units,
      credits: access.credits,
      freeRemaining: access.freeRemaining,
      upgrade: replayUpgradePrompt('exhausted'),
    };
  }

  const period = access.period;
  if (freeTake > 0) {
    await debitReplayFree(db, env, {
      tenantId: input.tenantId,
      units: freeTake,
      reference: creditTake > 0 ? `replay-visit:${input.visitId}:free` : `replay-visit:${input.visitId}`,
      period,
      memo: `Session replay visit ${input.visitId}`,
      metadata: { visitId: input.visitId, bytes: input.bytes, source: 'free' },
    });
  }
  if (creditTake > 0) {
    const hadPaidSpend = (await loadGrantRows(db, input.tenantId)).some((row) => row.amount < 0);
    await debitReplayCredits(db, env, {
      tenantId: input.tenantId,
      units: creditTake,
      reference: freeTake > 0 ? `replay-visit:${input.visitId}:credits` : `replay-visit:${input.visitId}`,
      memo: `Session replay visit ${input.visitId}`,
      metadata: { visitId: input.visitId, bytes: input.bytes, source: 'credits' },
    });
    if (!hadPaidSpend && env) {
      await trace(env, db, input.tenantId, 'replay.credits.first_debit', `First paid recording debit (${creditTake})`, {
        visitId: input.visitId,
        units: creditTake,
      });
    }
  }

  const snapshot = await replayWalletSnapshot(db, env, input.tenantId, { now: input.now });
  if (snapshot.freeRemaining === 0 && snapshot.credits === 0 && env) {
    await trace(env, db, input.tenantId, 'replay.allowance.exhausted', 'Recording allowance exhausted', {
      visitId: input.visitId,
      units,
    });
  }

  const source: ReplayConsumeOk['source'] = freeTake > 0 && creditTake > 0 ? 'mixed' : creditTake > 0 ? 'credits' : 'free';
  return {
    ok: true,
    applied: true,
    units,
    source,
    credits: snapshot.credits,
    freeRemaining: snapshot.freeRemaining,
  };
}

export async function getReplayAutorecharge(
  db: Db,
  tenantId: number,
): Promise<ReplayAutorechargeSettings | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(
      eq(settings.tenantId, tenantId),
      eq(settings.scope, 'tenant'),
      eq(settings.scopeRef, ''),
      eq(settings.feature, REPLAY_AUTORECHARGE_FEATURE),
    ))
    .limit(1);
  if (!row || !row.value || typeof row.value !== 'object') return null;
  const value = row.value as { packId?: unknown; threshold?: unknown };
  if (typeof value.packId !== 'string' || value.packId.length === 0) return null;
  const threshold = typeof value.threshold === 'number' && Number.isFinite(value.threshold)
    ? value.threshold
    : REPLAY_AUTORECHARGE_THRESHOLD;
  return { packId: value.packId, threshold };
}

export async function setReplayAutorecharge(
  db: Db,
  tenantId: number,
  value: ReplayAutorechargeSettings | null,
): Promise<void> {
  if (value === null) {
    await db.delete(settings).where(and(
      eq(settings.tenantId, tenantId),
      eq(settings.scope, 'tenant'),
      eq(settings.scopeRef, ''),
      eq(settings.feature, REPLAY_AUTORECHARGE_FEATURE),
    ));
    return;
  }
  const pack = replayPack(value.packId);
  if (!pack) throw new ReplayCommerceError('That recording pack does not exist', 404);
  const stored: ReplayAutorechargeSettings = {
    packId: pack.id,
    threshold: value.threshold > 0 && value.threshold < 1 ? value.threshold : REPLAY_AUTORECHARGE_THRESHOLD,
  };
  await db.insert(settings).values({
    tenantId,
    scope: 'tenant',
    scopeRef: '',
    feature: REPLAY_AUTORECHARGE_FEATURE,
    value: stored,
  }).onConflictDoUpdate({
    target: [settings.tenantId, settings.scope, settings.scopeRef, settings.feature],
    set: { value: stored, updatedAt: sql`now()` },
  });
}

/**
 * When paid credits drop below `threshold` of the chosen pack, mint a hosted
 * checkout and return the email the operator should receive. There is no
 * off-session charge on PaymentProvider — faking one would take money the
 * buyer did not present a card for.
 *
 * Returns null when auto-recharge is off, the pack is unknown, credits are
 * still above the threshold, or payments are not configured.
 */
export async function maybeOfferReplayAutorecharge(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    billingEmail?: string | null;
    returnUrl: string;
    now?: Date;
  },
): Promise<ReplayAutorechargeNotice | null> {
  const settingsRow = await getReplayAutorecharge(db, input.tenantId);
  if (!settingsRow) return null;
  const packs = await loadReplayPacks(db);
  const pack = replayPack(settingsRow.packId, packs);
  if (!pack) return null;
  const snapshot = await replayWalletSnapshot(db, env, input.tenantId, { now: input.now });
  if (snapshot.credits >= pack.units * settingsRow.threshold) return null;

  try {
    const started = await startReplayPackCheckout(db, env, {
      tenantId: input.tenantId,
      buyerRef: 'autorecharge',
      packId: pack.id,
      billingEmail: input.billingEmail ?? null,
      returnUrl: input.returnUrl,
      now: input.now,
    });
    const to = input.billingEmail ?? null;
    return {
      kind: 'email_topup',
      reason: 'no_off_session_charge',
      packId: pack.id,
      checkoutUrl: started.checkoutUrl,
      sessionId: started.sessionId,
      to,
      subject: 'Session replay recordings running low',
      body: `Your workspace is below ${(settingsRow.threshold * 100).toFixed(0)}% of the ${pack.id} pack. PaymentProvider cannot charge a saved card, so this is a top-up link rather than an automatic charge:\n\n${started.checkoutUrl}\n`,
    };
  } catch (err) {
    if (err instanceof ReplayCommerceError && err.status === 503) return null;
    throw err;
  }
}

export { DEFAULT_REPLAY_CATALOG_BODY, REPLAY_PACKS, unitsForBytes };
