/**
 * The seller-earning + platform-fee ledger pair for ONE catalogue sale.
 *
 * Knowledge listings, marketplace listings and marketplace skills each wrote the same
 * two `ledger_entries` rows by hand, differing only in the reference prefix, the memo
 * wording and the id key in the metadata. The rows carry two invariants a copy could
 * drop: the TENANT is the SELLER's (the earning must land in the books it is paid out
 * of) and both references derive from the sale id, so the unique index on `reference`
 * refuses a replayed pair whole (`onConflictDoNothing`).
 *
 * Lives beside `platformFees` rather than inside it: `platformFees` imports
 * `listingCommerce`, which is one of this function's callers.
 */
import type { Db } from '../../infrastructure/database/connection';
import { ledgerEntries } from '../../infrastructure/database/schema';
import { USD_CENTS } from '../kernel/denominations';

export interface SaleSplit {
  sellerTenantId: number;
  sellerRef: string;
  /** Reference prefix: entries are `<prefix>-sale:<saleId>` and `<prefix>-fee:<saleId>`. */
  referencePrefix: string;
  saleId: string | number;
  /** The metadata key the sale id is stored under (`purchaseId`, `orderId`). */
  saleIdKey: string;
  /** Metadata `source`. */
  source: string;
  /** Memo lead for the seller line, e.g. "Marketplace sale". */
  saleLabel: string;
  /** The thing sold, appended to both memos. */
  subject: string;
  sellerCents: number;
  commissionCents: number;
}

export async function recordSaleSplit(db: Db, input: SaleSplit): Promise<void> {
  const metadata = { source: input.source, [input.saleIdKey]: input.saleId };
  await db.insert(ledgerEntries).values([
    {
      tenantId: input.sellerTenantId,
      // The seller's balance is a USER balance, because that is the account the
      // payout subsystem already pays from (`PayoutAccountService.paidCents`).
      // A separate 'seller' account would make earned and paid unsubtractable.
      accountKind: 'user',
      accountRef: input.sellerRef,
      denomination: USD_CENTS,
      amount: String(input.sellerCents),
      entryKind: 'commission',
      reference: `${input.referencePrefix}-sale:${input.saleId}`,
      memo: `${input.saleLabel} — ${input.subject}`,
      metadata,
    },
    {
      tenantId: input.sellerTenantId,
      accountKind: 'partner',
      accountRef: 'platform',
      denomination: USD_CENTS,
      amount: String(input.commissionCents),
      entryKind: 'commission',
      reference: `${input.referencePrefix}-fee:${input.saleId}`,
      memo: `Platform fee — ${input.subject}`,
      metadata,
    },
  ]).onConflictDoNothing();
}
