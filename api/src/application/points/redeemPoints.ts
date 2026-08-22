/**
 * SPENDING POINTS — debit, record, fulfil, and what happens when fulfilment fails.
 *
 * ── THE ORDER, AND WHY IT IS NOT THE OBVIOUS ONE ─────────────────────────────
 * Fulfil-then-debit loses money on a crash between the two: the reward is granted
 * and the points are still there. Debit-then-fulfil loses the USER's money on the
 * same crash. Neither is acceptable, so the sequence is:
 *
 *   1. write the `point_redemptions` row as `pending` — the INTENT, with its own id
 *   2. debit the points, referenced to that id (idempotent at the unique index)
 *   3. fulfil, referenced to the same id (idempotent in the adapter)
 *   4. mark `fulfilled`
 *
 * A crash after 2 leaves a `pending` row with the points already taken, which is
 * recoverable — {@link retryPendingRedemption} finishes it, and because both the
 * debit and the grant key off the redemption id, re-running any step is a no-op
 * rather than a duplicate. A crash before 2 leaves a pending row and full points,
 * which {@link cancelRedemption} clears. Nothing is lost in either direction, and
 * that is the whole reason the intent is written first.
 *
 * ── WHY THE ROW EXISTS AT ALL ────────────────────────────────────────────────
 * `point_redemptions` says WHAT was redeemed for; the ledger says how many points
 * moved. Its own docstring makes the argument — without it the ledger's memo
 * would have to carry the reward as prose, and "what did people actually spend on"
 * would be a text search.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { pointRedemptions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { grantAiCredits } from './aiCredits';
import { pointsBalance, writePointsEntry } from './pointsLedger';
import { readPointsProfile } from './pointsProfile';
import {
  getRedemptionSku,
  isRedemptionAvailable,
  registerFulfilmentKind,
  type RedemptionSku,
} from './redemptionCatalog';

export type RedeemRefusal =
  | 'unknown_sku' | 'unavailable' | 'insufficient_points' | 'suspended' | 'fulfilment_failed';

export type RedeemResult =
  | { ok: true; redemptionId: number; pointsSpent: number; balance: number }
  | { ok: false; reason: RedeemRefusal };

/** The reference both the debit and the grant key off, so every step of one
 *  redemption is idempotent against the same identity. */
function redemptionReference(redemptionId: number): string {
  return `redeem:${redemptionId}`;
}

/**
 * Fulfilment adapters. A kind is advertised as available exactly when it has one
 * — see the note in `redemptionCatalog.ts` about the catalog and the guard being
 * one answer rather than two lists.
 */
const ADAPTERS: Record<string, (db: Db, env: Env, ctx: FulfilContext) => Promise<boolean>> = {
  ai_tokens: async (db, env, ctx) => grantAiCredits(db, env, {
    tenantId: ctx.tenantId,
    tokens: ctx.sku.grant.tokens ?? 0,
    reference: redemptionReference(ctx.redemptionId),
    memo: `Redeemed — ${ctx.sku.label}`,
    metadata: { redemptionId: ctx.redemptionId, userId: ctx.userId, skuId: ctx.sku.id },
  }),
};

interface FulfilContext {
  tenantId: number;
  userId: string;
  sku: RedemptionSku;
  redemptionId: number;
}

// Registered at module load, so the catalog's availability and this table are the
// same fact. Adding a reward = writing an adapter and registering its kind.
for (const kind of Object.keys(ADAPTERS)) registerFulfilmentKind(kind as 'ai_tokens');

export async function redeemPoints(
  db: Db, env: Env,
  input: { tenantId: number; userId: string; skuId: string },
): Promise<RedeemResult> {
  const sku = getRedemptionSku(input.skuId);
  if (!sku) return { ok: false, reason: 'unknown_sku' };
  if (!isRedemptionAvailable(sku.kind)) return { ok: false, reason: 'unavailable' };

  const profile = await readPointsProfile(db, input.tenantId, input.userId);
  if (profile.suspended) return { ok: false, reason: 'suspended' };

  const balance = await pointsBalance(db, env, input.tenantId, input.userId);
  if (balance < sku.pointsCost) return { ok: false, reason: 'insufficient_points' };

  // 1 · the intent
  const [row] = await db.insert(pointRedemptions).values({
    tenantId: input.tenantId,
    memberRef: input.userId,
    rewardKey: sku.id,
    pointsSpent: sku.pointsCost,
    status: 'pending',
  }).returning({ id: pointRedemptions.id });

  // `.returning()` is typed as an array, so the row is optional to the compiler.
  // It is not optional to this flow: everything after it references the intent,
  // and debiting points against a redemption that was never recorded is the one
  // outcome worse than refusing. Refuse instead of dereferencing a maybe.
  if (!row) return { ok: false, reason: 'fulfilment_failed' };

  const redemptionId = row.id;
  const reference = redemptionReference(redemptionId);

  // 2 · the debit, referenced to the intent
  await writePointsEntry(db, env, {
    tenantId: input.tenantId,
    userId: input.userId,
    amount: -sku.pointsCost,
    entryKind: 'spend',
    action: 'points.redeem',
    source: 'redeem',
    refId: String(redemptionId),
    memo: `Redeemed — ${sku.label}`,
    metadata: { skuId: sku.id, redemptionId },
  });
  await db.update(pointRedemptions)
    .set({ ledgerRef: reference })
    .where(scopedToTenant(pointRedemptions, input.tenantId, eq(pointRedemptions.id, redemptionId)));

  // 3 + 4 · fulfil and settle
  const settled = await fulfil(db, env, { tenantId: input.tenantId, userId: input.userId, sku, redemptionId });
  if (!settled) return { ok: false, reason: 'fulfilment_failed' };

  return {
    ok: true,
    redemptionId,
    pointsSpent: sku.pointsCost,
    balance: await pointsBalance(db, env, input.tenantId, input.userId),
  };
}

/** Run the adapter and mark the row. Never throws: a fulfilment fault leaves the
 *  row `pending` for {@link retryPendingRedemption}, which is recoverable, rather
 *  than propagating and leaving the caller unsure whether the points were taken. */
async function fulfil(db: Db, env: Env, ctx: FulfilContext): Promise<boolean> {
  const adapter = ADAPTERS[ctx.sku.kind];
  if (!adapter) return false;
  try {
    await adapter(db, env, ctx);
    await db.update(pointRedemptions)
      .set({ status: 'fulfilled', fulfilledAt: new Date() })
      .where(scopedToTenant(pointRedemptions, ctx.tenantId, eq(pointRedemptions.id, ctx.redemptionId)));
    return true;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/points/redeemPoints.ts',
      operation: 'fulfil',
      context: { redemptionId: ctx.redemptionId, skuId: ctx.sku.id },
    });
    return false;
  }
}

/** Finish a redemption whose points were taken but whose reward never landed.
 *  Safe to call repeatedly — the grant is idempotent on the redemption id. */
export async function retryPendingRedemption(
  db: Db, env: Env, tenantId: number, redemptionId: number,
): Promise<boolean> {
  const [row] = await db.select()
    .from(pointRedemptions)
    .where(scopedToTenant(pointRedemptions, tenantId, eq(pointRedemptions.id, redemptionId)))
    .limit(1);
  if (!row || row.status !== 'pending') return false;

  const sku = getRedemptionSku(row.rewardKey);
  if (!sku) return false;
  return fulfil(db, env, { tenantId, userId: row.memberRef, sku, redemptionId });
}

/**
 * Cancel a pending redemption and return the points.
 *
 * The refund is a separate ledger row rather than a deletion of the debit: the
 * ledger is append-only, and a cancelled redemption is something that HAPPENED —
 * removing the evidence is how a balance stops being explicable.
 */
export async function cancelRedemption(
  db: Db, env: Env, tenantId: number, userId: string, redemptionId: number,
): Promise<boolean> {
  // Scoped to the OWNER, not just the workspace. A tenant filter alone would let
  // any colleague cancel somebody else's redemption and hand them back points
  // they did not spend — the redemption belongs to a person, so the predicate
  // names the person.
  const [row] = await db.select()
    .from(pointRedemptions)
    .where(scopedToTenant(
      pointRedemptions, tenantId,
      eq(pointRedemptions.memberRef, userId),
      eq(pointRedemptions.id, redemptionId),
    ))
    .limit(1);
  if (!row || row.status !== 'pending') return false;

  await writePointsEntry(db, env, {
    tenantId,
    userId: row.memberRef,
    amount: row.pointsSpent,
    entryKind: 'refund',
    action: 'points.redeem.cancelled',
    source: 'redeem',
    refId: String(redemptionId),
    memo: `Cancelled — ${row.rewardKey}`,
    metadata: { redemptionId, skuId: row.rewardKey },
  });
  await db.update(pointRedemptions)
    .set({ status: 'cancelled' })
    .where(scopedToTenant(pointRedemptions, tenantId, eq(pointRedemptions.id, redemptionId)));
  return true;
}
