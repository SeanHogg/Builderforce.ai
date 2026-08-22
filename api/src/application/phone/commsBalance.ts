/**
 * THE COMMUNICATIONS BALANCE — prepaid credit for numbers, calls and SMS.
 *
 * ── WHY THERE IS NO `phone_balances` TABLE ───────────────────────────────────
 * `business_phone_numbers` says so in its own docstring: "the calls are
 * `deliveries`; the balance is a `ledger_entries` denomination". The source
 * product carried `phone_balances` AND `phone_balance_transactions` — a stored
 * total and the movements that produce it, the pair the kernel ledger exists to
 * replace. Balance here is a SUM over an account in the `comm_credits`
 * denomination, cached and invalidated on write, so there is one answer and it is
 * derived from the movements that justify it.
 *
 * ── WHY `comm_credits` AND NOT `usd_cents` ───────────────────────────────────
 * Because it is not cash. A tenant tops up communications credit and cannot
 * withdraw it, so putting it in `usd_cents` would make it indistinguishable from
 * marketplace earnings that CAN be paid out — and `PayoutAccountService` sums that
 * account. One denomination per meaning is the rule that keeps a payout from
 * accidentally including somebody's unused SMS credit.
 *
 * The unit is US cents of communications spend, so a top-up of $10 is 1000 and a
 * message that costs Twilio 0.79¢ debits 1 (see {@link debitComms} on rounding).
 *
 * ── THE GATE IS "CAN AFFORD", NOT "HAS ANY" ──────────────────────────────────
 * Every spend goes through {@link reserveComms}, which refuses BEFORE the vendor
 * call. Debiting after a successful send would let a tenant at zero send an
 * unbounded number of messages, each one discovered to be unaffordable only after
 * it had already been delivered and billed to us.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ledgerEntries } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { COMM_CREDITS } from '../kernel/denominations';

const balanceKey = (tenantId: number) => `comms:balance:t:${tenantId}`;

function commsAccount(tenantId: number) {
  return and(
    eq(ledgerEntries.tenantId, tenantId),
    eq(ledgerEntries.accountKind, 'tenant'),
    eq(ledgerEntries.accountRef, String(tenantId)),
    eq(ledgerEntries.denomination, COMM_CREDITS),
  );
}

/** Unspent communications credit, in US cents. */
export async function commsBalance(db: Db, env: Env | undefined, tenantId: number): Promise<number> {
  return getOrSetCached(env, balanceKey(tenantId), async () => {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
      .from(ledgerEntries)
      .where(commsAccount(tenantId));
    return Math.round(Number(row?.total ?? 0));
  }, { kvTtlSeconds: 30 });
}

/** Credit the account. `reference` is the payment's own id, so a retried webhook
 *  cannot top up twice. Returns false when that reference was already applied. */
export async function topUpComms(
  db: Db, env: Env,
  input: { tenantId: number; cents: number; reference: string; memo: string; metadata?: Record<string, unknown> },
): Promise<boolean> {
  if (input.cents <= 0) return false;
  const inserted = await db.insert(ledgerEntries).values({
    tenantId: input.tenantId,
    accountKind: 'tenant',
    accountRef: String(input.tenantId),
    denomination: COMM_CREDITS,
    amount: String(input.cents),
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
 * Debit the account for something that has happened or is about to.
 *
 * Rounds UP, deliberately. A per-message vendor price is fractions of a cent, and
 * rounding down means every single message is billed at less than it cost — a
 * loss that scales exactly with usage. Rounding up costs a tenant at most one
 * cent per event and keeps the platform whole.
 *
 * Idempotent on `reference`: a retried status callback for the same message SID
 * debits once.
 */
export async function debitComms(
  db: Db, env: Env,
  input: { tenantId: number; cents: number; reference: string; memo: string; metadata?: Record<string, unknown> },
): Promise<boolean> {
  const amount = Math.ceil(input.cents);
  if (amount <= 0) return false;
  const inserted = await db.insert(ledgerEntries).values({
    tenantId: input.tenantId,
    accountKind: 'tenant',
    accountRef: String(input.tenantId),
    denomination: COMM_CREDITS,
    amount: String(-amount),
    entryKind: 'spend',
    reference: input.reference,
    memo: input.memo,
    metadata: input.metadata ?? null,
  }).onConflictDoNothing().returning({ id: ledgerEntries.id });

  if (inserted.length === 0) return false;
  await invalidateCached(env, balanceKey(input.tenantId));
  return true;
}

export type CommsRefusal = { ok: false; reason: 'insufficient_credit'; balance: number; required: number };
export type CommsReservation = { ok: true; balance: number };

/**
 * Can this tenant afford `cents` right now?
 *
 * Called BEFORE the vendor request. It does not hold or reserve anything — a
 * hold would need a second ledger row per attempt and a reaper for the ones that
 * never settle, which for a sub-cent unit costs more than it protects. The race
 * it leaves open is two concurrent sends both passing at a balance that covers
 * only one, which overdraws by at most one message's price.
 */
export async function reserveComms(
  db: Db, env: Env | undefined, tenantId: number, cents: number,
): Promise<CommsReservation | CommsRefusal> {
  const balance = await commsBalance(db, env, tenantId);
  const required = Math.ceil(cents);
  if (balance < required) return { ok: false, reason: 'insufficient_credit', balance, required };
  return { ok: true, balance };
}

export interface CommsLedgerRow {
  id: number;
  cents: number;
  kind: string;
  memo: string | null;
  occurredAt: string;
}

/** The statement — what the credit was spent on. */
export async function commsStatement(
  db: Db, tenantId: number, limit = 50,
): Promise<CommsLedgerRow[]> {
  const rows = await db
    .select({
      id: ledgerEntries.id,
      amount: ledgerEntries.amount,
      entryKind: ledgerEntries.entryKind,
      memo: ledgerEntries.memo,
      occurredAt: ledgerEntries.occurredAt,
    })
    .from(ledgerEntries)
    .where(commsAccount(tenantId))
    .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.id))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((row) => ({
    id: Number(row.id),
    cents: Math.round(Number(row.amount)),
    kind: row.entryKind,
    memo: row.memo,
    occurredAt: (row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt)).toISOString(),
  }));
}
