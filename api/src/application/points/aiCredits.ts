/**
 * AI-TOKEN CREDITS — what redeemed points actually buy, and how they deplete.
 *
 * ── THE PROBLEM A REDEMPTION CATALOG USUALLY HAS ─────────────────────────────
 * A points economy is only real if the points buy something. The source product
 * catalogued four rewards and could fulfil one: gift cards were dead (its rail
 * refused the account), campaign dollars needed an ad-spend balance, and the
 * premium month needed a plan grant with an expiry. Its catalog therefore
 * promised things the server hard-rejected at redeem time.
 *
 * This platform's own scarce resource is inference, and it already meters it, so
 * that is what points buy. One reward, wired end to end, beats four that are not.
 *
 * ── THE ACCOUNTING, IN FULL ──────────────────────────────────────────────────
 * A credit is a `ledger_entries` row in the `ai_credits` denomination on the
 * TENANT account. Balance = grants − debits. Three parts make it depletable:
 *
 *   1. REDEEM writes a `grant` (+N tokens).
 *   2. The GATE lifts both token caps by the balance, so the tenant can spend it
 *      (`resolveTokenLimits.bonusTokens` — see the argument there for why both).
 *   3. The month-end RECONCILE writes a `spend` for what the month actually drew:
 *      `min(balance, max(0, monthUsage − planMonthlyLimit))`.
 *
 * Part 3 is the one that is easy to leave out and fatal to leave out: without it
 * the balance never falls, the cap stays lifted forever, and a hundred redeemed
 * points buy unlimited inference. It is idempotent on a per-month reference and
 * it reconciles EVERY unsettled month, not just the last one, so a sweep that
 * fails to run for a while settles the backlog instead of forgiving it.
 *
 * ── WHY THE CAP LIFT IS BOUNDED ──────────────────────────────────────────────
 * Because earning is. Every rule that pays more than trivially carries a daily
 * ceiling (`pointsCatalog`), so the maximum credit a tenant can mint per day is a
 * known number rather than an open question — which is what makes it safe for the
 * gate to honour credits without a second approval step.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ledgerEntries } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { AI_CREDITS } from '../kernel/denominations';

const balanceKey = (tenantId: number) => `ai-credits:balance:t:${tenantId}`;

function creditAccount(tenantId: number) {
  return and(
    eq(ledgerEntries.tenantId, tenantId),
    eq(ledgerEntries.accountKind, 'tenant'),
    eq(ledgerEntries.accountRef, String(tenantId)),
    eq(ledgerEntries.denomination, AI_CREDITS),
  );
}

/**
 * Unspent credits, in tokens. Cached 60s and invalidated by both writers.
 *
 * Read on the token gate's path, so it must be cheap; it is a sum over a table
 * that takes at most a handful of rows per tenant per month (one grant per
 * redemption, one debit per month), which is why this is a sum and not yet
 * another materialised balance.
 */
// `env` is optional for the same reason `getOrSetCached` accepts an optional one:
// the balance is a sum the caller needs whether or not a KV binding is in reach.
// Requiring it here made the consumption meter — which holds `env?: Env` — unable
// to add redeemed credits, which is the disagreement `meters.ts` warns about.
export async function aiCreditBalance(db: Db, env: Env | undefined, tenantId: number): Promise<number> {
  return getOrSetCached(env, balanceKey(tenantId), async () => {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
      .from(ledgerEntries)
      .where(creditAccount(tenantId));
    return Math.max(0, Math.round(Number(row?.total ?? 0)));
  }, { kvTtlSeconds: 60 });
}

/** Grant credits. `reference` is the redemption's own id, so a retried
 *  fulfilment cannot mint twice. Returns false when it had already been granted. */
export async function grantAiCredits(
  db: Db, env: Env,
  input: { tenantId: number; tokens: number; reference: string; memo: string; metadata?: Record<string, unknown> },
): Promise<boolean> {
  if (input.tokens <= 0) return false;
  const inserted = await db.insert(ledgerEntries).values({
    tenantId: input.tenantId,
    accountKind: 'tenant',
    accountRef: String(input.tenantId),
    denomination: AI_CREDITS,
    amount: String(input.tokens),
    entryKind: 'grant',
    reference: input.reference,
    memo: input.memo,
    metadata: input.metadata ?? null,
  }).onConflictDoNothing().returning({ id: ledgerEntries.id });

  if (inserted.length === 0) return false;
  await invalidateCached(env, balanceKey(input.tenantId));
  return true;
}

/**
 * Settle ONE past month: debit whatever of that month's overage the credits
 * actually covered.
 *
 * `monthKey` is `YYYY-MM` and must be a month that has ENDED — settling the
 * current month would debit usage that is still growing and lower the cap under
 * a tenant mid-use. The caller (`cronSweeps`) is what enforces that.
 *
 * Returns the tokens debited, which is 0 both when nothing was drawn and when
 * the month was already settled — the reference makes the second case a no-op
 * rather than a double debit.
 */
export async function reconcileAiCreditMonth(
  db: Db, env: Env,
  input: { tenantId: number; monthKey: string; monthUsage: number; planMonthlyLimit: number },
): Promise<number> {
  // An unlimited plan cannot have drawn on credits: there was no ceiling to pass.
  if (input.planMonthlyLimit <= 0) return 0;

  const overage = Math.max(0, input.monthUsage - input.planMonthlyLimit);
  if (overage <= 0) return 0;

  const balance = await aiCreditBalance(db, env, input.tenantId);
  const debit = Math.min(balance, overage);
  if (debit <= 0) return 0;

  const inserted = await db.insert(ledgerEntries).values({
    tenantId: input.tenantId,
    accountKind: 'tenant',
    accountRef: String(input.tenantId),
    denomination: AI_CREDITS,
    amount: String(-debit),
    entryKind: 'spend',
    reference: aiCreditReconcileReference(input.tenantId, input.monthKey),
    memo: `AI credits drawn in ${input.monthKey}`,
    metadata: { monthKey: input.monthKey, monthUsage: input.monthUsage, planMonthlyLimit: input.planMonthlyLimit },
  }).onConflictDoNothing().returning({ id: ledgerEntries.id });

  if (inserted.length === 0) return 0;
  await invalidateCached(env, balanceKey(input.tenantId));
  return debit;
}

export function aiCreditReconcileReference(tenantId: number, monthKey: string): string {
  return `ai-credits:reconcile:${tenantId}:${monthKey}`;
}

/** Months this tenant has been granted credits in but never settled — the
 *  reconcile sweep's work list. Bounded by the number of months since the first
 *  redemption, so a sweep that has not run for a year still terminates. */
export async function unsettledCreditMonths(db: Db, tenantId: number, before: string): Promise<string[]> {
  const [first] = await db
    .select({ at: sql<string>`min(${ledgerEntries.occurredAt})` })
    .from(ledgerEntries)
    .where(and(creditAccount(tenantId), eq(ledgerEntries.entryKind, 'grant')));
  if (!first?.at) return [];

  const settled = await db
    .select({ reference: ledgerEntries.reference })
    .from(ledgerEntries)
    .where(and(creditAccount(tenantId), eq(ledgerEntries.entryKind, 'spend')));
  const done = new Set(settled.map((row) => row.reference ?? ''));

  const months: string[] = [];
  const cursor = new Date(`${String(first.at).slice(0, 7)}-01T00:00:00Z`);
  while (Number.isFinite(cursor.getTime())) {
    const key = cursor.toISOString().slice(0, 7);
    if (key >= before) break;
    if (!done.has(aiCreditReconcileReference(tenantId, key))) months.push(key);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
