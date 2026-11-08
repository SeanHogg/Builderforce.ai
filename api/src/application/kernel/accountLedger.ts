/**
 * ONE ACCOUNT'S BALANCE in one ledger denomination — the machine under
 * {@link prepaidBalance} with the account named by the caller instead of fixed to
 * "the tenant".
 *
 * A prepaid wallet (comms credit, Spawn tokens) is one tenant's account; a board's
 * earned budget is one BOARD's account inside a tenant. The sequence is identical —
 * an idempotent insert keyed on `reference`, a cached SUM, invalidate on write — and
 * the second copy is exactly where one forgets the cache invalidation, so the
 * sequence lives here once and `prepaidBalance` is this with the tenant account.
 *
 * Movements are whole numbers of the denomination's unit; amounts round UP so a
 * fractional price never bills below cost.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ledgerEntries } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Denomination } from './denominations';
import type { LedgerAccount } from './ledgerAccount';

export interface AccountMovement {
  tenantId: number;
  amount: number;
  /** Idempotency key: unique per (tenant, denomination). */
  reference: string;
  memo: string;
  metadata?: Record<string, unknown>;
}

export interface AccountStatementRow {
  id: number;
  amount: number;
  kind: string;
  memo: string | null;
  occurredAt: string;
}

export interface AccountLedger {
  balance(db: Db, env: Env | undefined, tenantId: number, account: LedgerAccount): Promise<number>;
  /** Add to the balance. False when `reference` was already applied. */
  credit(db: Db, env: Env, account: LedgerAccount, input: AccountMovement): Promise<boolean>;
  /** Take from the balance. False when `reference` was already applied. */
  debit(db: Db, env: Env, account: LedgerAccount, input: AccountMovement): Promise<boolean>;
  /** Newest first. */
  statement(db: Db, tenantId: number, account: LedgerAccount, limit?: number): Promise<AccountStatementRow[]>;
}

export function accountLedger(
  denomination: Denomination,
  cachePrefix: string,
  /** Override only to keep a pre-existing cache key stable. */
  cacheKeyOf: (tenantId: number, account: LedgerAccount) => string =
    (tenantId, account) => `${cachePrefix}:balance:${tenantId}:${account.kind}:${account.ref}`,
): AccountLedger {
  const where = (tenantId: number, account: LedgerAccount) => and(
    eq(ledgerEntries.tenantId, tenantId),
    eq(ledgerEntries.accountKind, account.kind),
    eq(ledgerEntries.accountRef, account.ref),
    eq(ledgerEntries.denomination, denomination),
  );

  async function move(db: Db, env: Env, account: LedgerAccount, input: AccountMovement, sign: 1 | -1): Promise<boolean> {
    const amount = Math.ceil(input.amount);
    if (amount <= 0) return false;
    const inserted = await db.insert(ledgerEntries).values({
      tenantId: input.tenantId,
      accountKind: account.kind,
      accountRef: account.ref,
      denomination,
      amount: String(sign * amount),
      entryKind: sign > 0 ? 'grant' : 'spend',
      reference: input.reference,
      memo: input.memo,
      metadata: input.metadata ?? null,
    }).onConflictDoNothing().returning({ id: ledgerEntries.id });

    if (inserted.length === 0) return false;
    await invalidateCached(env, cacheKeyOf(input.tenantId, account));
    return true;
  }

  return {
    balance: (db, env, tenantId, account) =>
      getOrSetCached(env, cacheKeyOf(tenantId, account), async () => {
        const [row] = await db
          .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
          .from(ledgerEntries)
          .where(where(tenantId, account));
        return Math.round(Number(row?.total ?? 0));
      }, { kvTtlSeconds: 30 }),
    credit: (db, env, account, input) => move(db, env, account, input, 1),
    debit: (db, env, account, input) => move(db, env, account, input, -1),
    async statement(db, tenantId, account, limit = 50) {
      const rows = await db
        .select({
          id: ledgerEntries.id,
          amount: ledgerEntries.amount,
          entryKind: ledgerEntries.entryKind,
          memo: ledgerEntries.memo,
          occurredAt: ledgerEntries.occurredAt,
        })
        .from(ledgerEntries)
        .where(where(tenantId, account))
        .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.id))
        .limit(Math.min(Math.max(limit, 1), 200));

      return rows.map((row) => ({
        id: Number(row.id),
        amount: Math.round(Number(row.amount)),
        kind: row.entryKind,
        memo: row.memo,
        occurredAt: (row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt)).toISOString(),
      }));
    },
  };
}
