/**
 * A PREPAID BALANCE — one tenant's spendable account in one ledger denomination.
 *
 * Communications credit and Spawn's build tokens are the same machine with a
 * different unit: money comes in as a `grant` keyed on the payment, usage goes out
 * as a `spend` keyed on the thing that used it, the balance is the SUM of those
 * rows, and a spend is refused BEFORE the vendor call when the balance cannot cover
 * it. Each used to be (or would have been) its own copy of that sequence, and a copy
 * is where one of them forgets the cache invalidation or the idempotent insert.
 *
 * A balance is a SUM over `ledger_entries`, cached and invalidated on write, so
 * there is one answer and it is derived from the movements that justify it — never
 * a stored total beside them.
 *
 * Units are whole numbers of the denomination's own unit (cents for comms, model
 * tokens for Spawn). Debits round UP: a fractional vendor price rounded down bills
 * every event at less than it cost, a loss that scales exactly with usage.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { Denomination } from './denominations';
import { accountLedger } from './accountLedger';
import type { LedgerAccount } from './ledgerAccount';

export interface PrepaidMovement {
  tenantId: number;
  amount: number;
  /** Idempotency key: the payment for a grant, the usage event for a spend. */
  reference: string;
  memo: string;
  metadata?: Record<string, unknown>;
}

export type PrepaidRefusal = { ok: false; reason: 'insufficient_credit'; balance: number; required: number };
export type PrepaidReservation = { ok: true; balance: number };

export interface PrepaidStatementRow {
  id: number;
  amount: number;
  kind: string;
  memo: string | null;
  occurredAt: string;
}

export interface PrepaidBalance {
  /** Unspent balance. */
  balance(db: Db, env: Env | undefined, tenantId: number): Promise<number>;
  /** Add to the balance. False when `reference` was already applied. */
  credit(db: Db, env: Env, input: PrepaidMovement): Promise<boolean>;
  /** Take from the balance. False when `reference` was already applied. */
  debit(db: Db, env: Env, input: PrepaidMovement): Promise<boolean>;
  /**
   * Can the tenant afford `amount` now? Called BEFORE the vendor call. Holds
   * nothing: a hold needs a second row per attempt and a reaper for the ones that
   * never settle. The race it leaves open — two concurrent spends both passing at a
   * balance that covers one — overdraws by at most one event.
   */
  reserve(db: Db, env: Env | undefined, tenantId: number, amount: number): Promise<PrepaidReservation | PrepaidRefusal>;
  /** The statement — what the balance was spent on, newest first. */
  statement(db: Db, tenantId: number, limit?: number): Promise<PrepaidStatementRow[]>;
}

/** The balance of `denomination`, cached under `cachePrefix`. The account is the
 *  tenant's own — {@link accountLedger} is the machine, this fixes whose account. */
export function prepaidBalance(denomination: Denomination, cachePrefix: string): PrepaidBalance {
  const tenantAccount = (tenantId: number): LedgerAccount => ({ kind: 'tenant', ref: String(tenantId) });
  // The cache key predates accountLedger; keep it byte-stable.
  const ledger = accountLedger(denomination, cachePrefix, (tenantId) => `${cachePrefix}:balance:t:${tenantId}`);
  const balance: PrepaidBalance['balance'] = (db, env, tenantId) => ledger.balance(db, env, tenantId, tenantAccount(tenantId));

  return {
    balance,
    credit: (db, env, input) => ledger.credit(db, env, tenantAccount(input.tenantId), input),
    debit: (db, env, input) => ledger.debit(db, env, tenantAccount(input.tenantId), input),
    async reserve(db, env, tenantId, amount) {
      const current = await balance(db, env, tenantId);
      const required = Math.ceil(amount);
      if (current < required) return { ok: false, reason: 'insufficient_credit', balance: current, required };
      return { ok: true, balance: current };
    },
    statement: (db, tenantId, limit) => ledger.statement(db, tenantId, tenantAccount(tenantId), limit),
  };
}
