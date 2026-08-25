/**
 * WHOSE balance a `ledger_entries` row belongs to — the pair of columns, named
 * once.
 *
 * `accountKind` + `accountRef` decide which balance a movement lands in, and
 * getting them wrong does not fail: it silently opens a SECOND balance under a
 * name no query reads, exactly as a misspelt denomination does. That is why
 * `denominations.ts` exists, and this is the same argument applied to the other
 * half of the key.
 *
 * ── THE TWO KINDS THAT EARN, AND WHY BOTH ───────────────────────────────────
 * A person sells a canvas creation and a WORKSPACE publishes an extension or a
 * marketplace agent. `extension_packages.tenant_id` and `ide_agents` name no
 * author, so there is no person to credit — and crediting the workspace's current
 * owner would mean the money follows whoever happens to hold that role rather than
 * the company that earned it.
 *
 * The rule that makes the pair safe: **the account a seller's LIFETIME TOTAL is
 * read from and the account their earning is CREDITED to must be the same
 * account.** Reading one and writing the other is not a rounding error — it holds
 * a seller under the rev-share threshold forever in one query while the other
 * says they passed it, so the platform's cut is charged to nobody and the seller's
 * balance is never found. Building both from these two constructors is what makes
 * that mistake unrepresentable rather than merely unlikely.
 */

/** The `ledger_entries.account_kind` values a SELLER's balance can be held under. */
export type LedgerAccountKind = 'user' | 'tenant';

/** One ledger account — the `(account_kind, account_ref)` pair as one value. */
export interface LedgerAccount {
  kind: LedgerAccountKind;
  ref: string;
}

/** A PERSON's balance. What a creation sale and a freelance engagement credit. */
export const userAccount = (userId: string): LedgerAccount => ({ kind: 'user', ref: userId });

/**
 * A WORKSPACE's balance. What a published extension and a marketplace agent
 * credit, because neither names an author.
 *
 * The `tenant:` prefix is deliberate and load-bearing: `account_ref` is one
 * varchar shared by both kinds, and an unprefixed numeric id could collide with a
 * user id in any deployment whose user ids are numeric.
 */
export const workspaceAccount = (tenantId: number): LedgerAccount => ({ kind: 'tenant', ref: `tenant:${tenantId}` });
