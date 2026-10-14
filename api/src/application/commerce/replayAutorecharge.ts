/**
 * SESSION-REPLAY AUTO-RECHARGE — an emailed top-up link, never a charge (D4).
 *
 * `PaymentProvider` has no off-session capture, so "recharge" cannot take money
 * from a saved card. When paid credits drop below `threshold` of the chosen pack,
 * {@link maybeOfferReplayAutorecharge} mints a hosted checkout and returns the
 * email the billing contact should receive. Faking a charge would take money the
 * buyer did not present a card for.
 *
 * The setting is one `settings` row (`feature = 'replay_autorecharge'`).
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { settings } from '../../infrastructure/database/schema';
import { replayPack, REPLAY_AUTORECHARGE_THRESHOLD } from './replayCatalog';
import { replayWalletSnapshot } from './replayWallet';
import { loadReplayPacks, ReplayCommerceError, startReplayPackCheckout } from './replayPacks';

export const REPLAY_AUTORECHARGE_FEATURE = 'replay_autorecharge';

export interface ReplayAutorechargeSettings {
  packId: string;
  threshold: number;
}

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

const settingsRow = (tenantId: number) => and(
  eq(settings.tenantId, tenantId),
  eq(settings.scope, 'tenant'),
  eq(settings.scopeRef, ''),
  eq(settings.feature, REPLAY_AUTORECHARGE_FEATURE),
);

export async function getReplayAutorecharge(
  db: Db,
  tenantId: number,
): Promise<ReplayAutorechargeSettings | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(settingsRow(tenantId))
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
  env: Env | undefined,
  tenantId: number,
  value: ReplayAutorechargeSettings | null,
): Promise<void> {
  if (value === null) {
    await db.delete(settings).where(settingsRow(tenantId));
    return;
  }
  const pack = replayPack(value.packId, await loadReplayPacks(env, db));
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
 * Returns null when auto-recharge is off, the pack is unknown, credits are still
 * above the threshold, or payments are not configured.
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
  const chosen = await getReplayAutorecharge(db, input.tenantId);
  if (!chosen) return null;
  const pack = replayPack(chosen.packId, await loadReplayPacks(env, db));
  if (!pack) return null;
  const snapshot = await replayWalletSnapshot(db, env, input.tenantId, { now: input.now });
  if (snapshot.credits >= pack.units * chosen.threshold) return null;

  try {
    const started = await startReplayPackCheckout(db, env, {
      tenantId: input.tenantId,
      buyerRef: 'autorecharge',
      packId: pack.id,
      billingEmail: input.billingEmail ?? null,
      returnUrl: input.returnUrl,
      now: input.now,
    });
    return {
      kind: 'email_topup',
      reason: 'no_off_session_charge',
      packId: pack.id,
      checkoutUrl: started.checkoutUrl,
      sessionId: started.sessionId,
      to: input.billingEmail ?? null,
      subject: 'Session replay recordings running low',
      body: `Your workspace is below ${(chosen.threshold * 100).toFixed(0)}% of the ${pack.id} pack. PaymentProvider cannot charge a saved card, so this is a top-up link rather than an automatic charge:\n\n${started.checkoutUrl}\n`,
    };
  } catch (err) {
    if (err instanceof ReplayCommerceError && err.status === 503) return null;
    throw err;
  }
}
