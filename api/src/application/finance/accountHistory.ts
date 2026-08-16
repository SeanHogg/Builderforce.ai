/**
 * `account.history` (FO-A3) — one counterparty's real open invoices and bills,
 * read-through cached per (tenant, account).
 *
 * ── WHAT THIS DOES AND DOES NOT PROJECT ──────────────────────────────────────
 * FO-A3's brief asked for open invoices, live contract, renewal date and
 * support load. Two of the four are real here; the other two are named rather
 * than silently dropped, because "declared with no producer" is the defect
 * `founderObjects.ts` already refuses:
 *
 *   • open invoices / open bills — real, from `invoices.customerRef` and
 *     `bills.vendorRef`, both documented on the schema as `party_roles.party_ref`
 *     for the counterparty. Same ref `canvas_sync_account` already joins an
 *     `account` card by, so the join is exact, not fuzzy.
 *   • live contract / renewal — a founder `contract` object has NO backend
 *     table; it lives only as canvas-board JSON (see `founderObjects.ts`'s
 *     `contract` kind). There is nothing here to query. `contract.counterparty`
 *     already resolves the OTHER direction client-side, board-scoped, via
 *     `counterpartyAccountField` — that is where a contract's renewal is read,
 *     not this module.
 *   • support load — `support_tickets.customer_ref` is populated from the
 *     ITSM ingest's `requester` field (`boardsync/itsmIngest.ts`), a free-text
 *     CRM identity, NOT `party_roles.party_ref`. Joining it to an account by
 *     that column would be exactly the string-matching defect the counterparty
 *     work exists to close — a company sharing a support requester's name with
 *     another could see the wrong tickets on its card. Left out rather than
 *     joined on a guess.
 *
 * ── CACHING ───────────────────────────────────────────────────────────────
 * Read-through via `getOrSetCached`, keyed per (tenant, ref) with
 * `payables.accountHistoryCacheKey` — the SAME key `recordBill`, `approveBill`,
 * `scheduleBillPayment` and `disputeBill` invalidate on write, so a bill's
 * three acts are reflected on the next read rather than the next TTL.
 *
 * `invoices` is also writable through the generic entity path
 * (`domains/finance/entities.ts` — drafting one is ordinary work). That path
 * does not yet know about this key, so a fresh invoice can lag this cache by
 * its TTL (120s) until FO-C2 gives invoices their own handlers to hook precise
 * invalidation into, the way the bill acts already do. Documented rather than
 * silently accepted: a short-lived staleness on a receivable is a far smaller
 * defect than the fuzzy joins above would have been.
 */
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import { accountHistoryCacheKey, openBillsForAccount, openInvoicesForAccount, type AccountLedgerDoc } from './payables';

export interface AccountHistory {
  accountPartyRef: string;
  openInvoices: AccountLedgerDoc[];
  openInvoicesTotal: number;
  openBills: AccountLedgerDoc[];
  openBillsTotal: number;
}

const EMPTY = (ref: string): AccountHistory => ({ accountPartyRef: ref, openInvoices: [], openInvoicesTotal: 0, openBills: [], openBillsTotal: 0 });

/** One account's projected history. Empty (not an error) for a `partyRef` with
 *  no invoices or bills yet — an account can be real and simply have none. */
export async function accountHistory(db: Db, env: Env, tenantId: number, accountPartyRef: string): Promise<AccountHistory> {
  const ref = accountPartyRef.trim().slice(0, 64);
  if (!ref) return EMPTY('');

  return getOrSetCached(
    env,
    accountHistoryCacheKey(tenantId, ref),
    async () => {
      const [openInvoices, openBills] = await Promise.all([
        openInvoicesForAccount(db, tenantId, ref),
        openBillsForAccount(db, tenantId, ref),
      ]);
      return {
        accountPartyRef: ref,
        openInvoices,
        openInvoicesTotal: openInvoices.reduce((sum, doc) => sum + (doc.amount || 0), 0),
        openBills,
        openBillsTotal: openBills.reduce((sum, doc) => sum + (doc.amount || 0), 0),
      };
    },
    { kvTtlSeconds: 120, l1TtlMs: 20_000 },
  );
}
