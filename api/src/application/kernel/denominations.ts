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

/** Every denomination the platform recognises. A writer using a string outside
 *  this set is a bug, and {@link isDenomination} is how a boundary says so. */
export const DENOMINATIONS = [USD_CENTS, POINTS, AI_CREDITS, CAMPAIGN_CREDITS, COMM_CREDITS] as const;

export type Denomination = (typeof DENOMINATIONS)[number];

export function isDenomination(value: unknown): value is Denomination {
  return typeof value === 'string' && (DENOMINATIONS as readonly string[]).includes(value);
}
