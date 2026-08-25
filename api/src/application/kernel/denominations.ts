/**
 * THE LEDGER'S DENOMINATIONS — the column that replaces sixty balance tables.
 *
 * `ledger_entries.denomination` is the single decision PRD 20 §3.2 rests on: a
 * new currency, credit type or unit is a VALUE, not DDL. That argument only holds
 * if the values themselves are written once. Before this module the string
 * `'usd_cents'` was declared in nine separate files — one exported from a feature
 * module and eight private copies — which is the same fact stored nine times and
 * nine chances for a typo to open an account nobody can find. A misspelt
 * denomination does not fail: it silently opens a SECOND balance under a name no
 * reader queries, and the money is not lost so much as invisible.
 *
 * So: every denomination this platform recognises is named here, and every writer
 * imports it. Adding one is a line in this file.
 *
 * ── WHY `points` AND `usd_cents` ARE NOT INTERCHANGEABLE ─────────────────────
 * They share a table and nothing else. Points are earned, suspendable and
 * reversible by the fraud path; cash is not. A redemption is a `points` debit AND
 * a grant in the destination denomination — two rows, deliberately, so a fraud
 * rollback can reverse the points without clawing back money that has already
 * left. Keeping them in one table with distinct denominations is what makes that
 * pair expressible; merging them would not.
 */

/** United States cents. The platform's money denomination: every payout,
 *  commission, escrow movement and marketplace sale. */
export const USD_CENTS = 'usd_cents';

/** Earned reputation points. Suspendable and reversible — see the module note. */
export const POINTS = 'points';

/** Prepaid AI inference credits, granted by purchase or by points redemption. */
export const AI_CREDITS = 'ai_credits';

/** Prepaid advertising / boost spend, redeemable only against platform
 *  inventory. Distinct from `usd_cents` because it is not cash-equivalent and
 *  must not be reported as though it were. */
export const CAMPAIGN_CREDITS = 'campaign_credits';

/** Prepaid communication balance — phone numbers, calls and SMS meter against
 *  this rather than against a per-tenant balance table. */
export const COMM_CREDITS = 'comm_credits';

/**
 * METERED UNITS OF A PUBLISHED EXTENSION, reported by the vendor that runs it.
 *
 * A unit's MEANING is the vendor's — a document signed, a payroll run, a lookup —
 * and it is declared on the plan (`ExtensionPlan.unitLabel`), never here. What is
 * platform-wide is that a unit is a countable thing one tenant consumed under one
 * install, which is exactly what this ledger absorbs.
 *
 * It is a denomination rather than an `extension_usage_records` table for the
 * reason the module header gives: a meter needs an append-only history, an
 * idempotency key (`reference` — the vendor's own usage id, so a retried report
 * cannot double-bill), a per-account sum and a period window. `ledger_entries`
 * has all four, and its unique index makes the idempotency a database fact rather
 * than a check somebody remembered to write.
 *
 * The ACCOUNT is the installing tenant and the REF is the install id, so a
 * workspace running two paid extensions has two meters that cannot be confused for
 * one another. Pricing happens once per period in `extensionBilling.ts`, which is
 * the only place a unit ever meets a currency — a unit is not money and must never
 * be reported as though it were.
 */
export const EXTENSION_UNITS = 'extension_units';

/** Every denomination the platform recognises. A writer using a string outside
 *  this set is a bug, and {@link isDenomination} is how a boundary says so. */
export const DENOMINATIONS = [USD_CENTS, POINTS, AI_CREDITS, CAMPAIGN_CREDITS, COMM_CREDITS, EXTENSION_UNITS] as const;

export type Denomination = (typeof DENOMINATIONS)[number];

export function isDenomination(value: unknown): value is Denomination {
  return typeof value === 'string' && (DENOMINATIONS as readonly string[]).includes(value);
}
