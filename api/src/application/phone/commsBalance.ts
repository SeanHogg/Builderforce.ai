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

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { COMM_CREDITS } from '../kernel/denominations';
import { prepaidBalance, type PrepaidRefusal, type PrepaidReservation } from '../kernel/prepaidBalance';

/** The comms account, in US cents — the shared prepaid-balance primitive. */
const comms = prepaidBalance(COMM_CREDITS, 'comms');

interface CommsMovement {
  tenantId: number; cents: number; reference: string; memo: string; metadata?: Record<string, unknown>;
}

const movement = ({ cents, ...rest }: CommsMovement) => ({ ...rest, amount: cents });

/** Unspent communications credit, in US cents. */
export function commsBalance(db: Db, env: Env | undefined, tenantId: number): Promise<number> {
  return comms.balance(db, env, tenantId);
}

/** Credit the account. `reference` is the payment's own id, so a retried webhook
 *  cannot top up twice. Returns false when that reference was already applied. */
export function topUpComms(db: Db, env: Env, input: CommsMovement): Promise<boolean> {
  return comms.credit(db, env, movement(input));
}

/**
 * Debit the account for something that has happened or is about to. Rounds UP
 * (see the primitive): a per-message vendor price is fractions of a cent.
 * Idempotent on `reference`: a retried status callback for the same message SID
 * debits once.
 */
export function debitComms(db: Db, env: Env, input: CommsMovement): Promise<boolean> {
  return comms.debit(db, env, movement(input));
}

export type CommsRefusal = PrepaidRefusal;
export type CommsReservation = PrepaidReservation;

/** Can this tenant afford `cents` right now? Called BEFORE the vendor request. */
export function reserveComms(
  db: Db, env: Env | undefined, tenantId: number, cents: number,
): Promise<CommsReservation | CommsRefusal> {
  return comms.reserve(db, env, tenantId, cents);
}

export interface CommsLedgerRow {
  id: number;
  cents: number;
  kind: string;
  memo: string | null;
  occurredAt: string;
}

/** The statement — what the credit was spent on. */
export async function commsStatement(db: Db, tenantId: number, limit = 50): Promise<CommsLedgerRow[]> {
  const rows = await comms.statement(db, tenantId, limit);
  return rows.map(({ amount, ...row }) => ({ ...row, cents: amount }));
}
