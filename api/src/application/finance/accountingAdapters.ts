/**
 * The five LEDGER adapters — the `fetch*` half `accountingProviders.ts` declared
 * and nothing implemented.
 *
 * ── WHY THIS IS A SECOND FILE AND NOT MORE OF THE PORT ──────────────────────────
 * The port states it plainly: it is the registry, the normalized shapes and the
 * capability declaration, and it is "deliberately NOT a vendor HTTP client". That
 * sentence is the reason this module exists rather than another 700 lines appended
 * to it. The port is the thing every other layer reads and it has to stay readable;
 * the vendor quirks — QuickBooks' SQL-ish query language, Xero's `/Date(…)/`
 * timestamps, NetSuite's OAuth 1.0a signing, Plaid's inverted sign, Stripe's cursor
 * — belong behind it. `accountingProviders.ts` imports the registry below and
 * attaches it; the import back the other way is TYPE-ONLY, so there is no runtime
 * cycle.
 *
 * ── THE ONE RULE EVERY ADAPTER HERE OBEYS ───────────────────────────────────────
 * `LedgerTransaction.amount` is POSITIVE for money coming IN and NEGATIVE for money
 * going OUT, from the connected company's point of view; `LedgerDocument.amount` is
 * ALWAYS positive and `direction` carries the sign. No vendor agrees with all of
 * that and exactly one (Stripe) agrees with the first half, so each adapter states
 * its conversion at the point it makes it. Getting this wrong does not produce a
 * missing number, it produces a CONFIDENT BACKWARDS one: `financeRollup` divides
 * cash by net burn, and a burn that came out negative reads as a profitable company
 * with infinite runway.
 *
 * The conversions, in one place so they can be checked against each other:
 *
 *   | vendor     | native                                   | → ours              |
 *   |------------|------------------------------------------|---------------------|
 *   | QuickBooks | `Purchase.TotalAmt` positive = spend      | negate              |
 *   | QuickBooks | `Deposit.TotalAmt`  positive = receipt     | keep                |
 *   | Xero       | `BankTransaction.Type` SPEND/RECEIVE      | sign from the type  |
 *   | NetSuite   | `foreigntotal` unsigned, type says which  | sign from the type  |
 *   | Plaid      | positive = money LEFT the account         | negate              |
 *   | Stripe     | signed, positive = credited to you        | keep, ÷100          |
 *
 * ── AND THE ONE THAT IS NOT VERIFIED ────────────────────────────────────────────
 * No sandbox credential for any of the five exists in this environment, so every
 * conversion above is written from the vendors' documented shapes and checked
 * against recorded payloads in `accountingAdapters.test.ts`. None has been
 * confirmed against a real book.
 */

import type {
  AccountingProviderName,
  LedgerBalance,
  LedgerDocument,
  LedgerPage,
  LedgerQuery,
  LedgerTransaction,
} from './accountingProviders';

/* ── credential ──────────────────────────────────────────────────────────────── */

/**
 * The stored credential, opened. One shape for all five because the SEALING is one
 * mechanism (`oauthTokenVault`) — an OAuth provider fills `accessToken`, NetSuite
 * fills `fields`, and both arrive here through the same vault rather than through
 * two storage paths.
 */
export interface AccountingCredential {
  accessToken?: string;
  refreshToken?: string;
  /** Typed fields — NetSuite's TBA key pair, and Plaid's client credentials. */
  fields?: Record<string, string>;
  /**
   * The vendor's own id for the connected BOOK, which is not the same thing as an
   * account inside it: a QuickBooks `realmId`, a Xero tenant id, a Plaid `item_id`,
   * a Stripe `acct_…`. Every one of the five needs it in the request and none of
   * them carries it in the token.
   */
  externalAccountId?: string;
}

/**
 * A vendor call that failed, with the one bit the caller acts on.
 *
 * `retryable` is decided here rather than by the sweep, because only the adapter
 * knows that a Xero 429 carries a `Retry-After` and a QuickBooks 401 means the
 * grant is gone. The sweep re-queues a retryable failure and marks the connection
 * for reconnection on a terminal one — the same split `MailboxProvider` makes.
 */
export class AccountingProviderError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
    this.name = 'AccountingProviderError';
  }
}

/** A 5xx or a rate limit is the vendor's problem and will pass; a 4xx is ours and
 *  will not, and retrying it forever is how a sweep becomes a hot loop. */
export const retryableStatus = (status: number): boolean => status === 429 || status >= 500;

/* ── the adapter interface ───────────────────────────────────────────────────── */

/**
 * What a vendor client provides. Every member is optional for exactly the reason
 * the port declares capabilities at all: Plaid has no invoices and Stripe has no
 * bank balance, and an adapter that answered those questions with an empty array
 * would render a permanently empty tab with nothing to explain it.
 *
 * `accountingProviders.test.ts` asserts this the other way round — a provider that
 * DECLARES a capability must implement the read behind it.
 */
export interface AccountingAdapter {
  fetchTransactions?(credential: AccountingCredential, query: LedgerQuery): Promise<LedgerPage<LedgerTransaction>>;
  fetchDocuments?(credential: AccountingCredential, query: LedgerQuery): Promise<LedgerPage<LedgerDocument>>;
  fetchBalances?(credential: AccountingCredential): Promise<LedgerBalance[]>;
}

/* ── shared helpers ──────────────────────────────────────────────────────────── */

/** One page. Kept modest: a Worker has a bounded subrequest allowance and the sweep
 *  walks the cursor, so a larger page buys nothing and risks a timeout. */
const PAGE_SIZE = 100;

const money = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const text = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));

const nullableText = (value: unknown): string | null => {
  const asText = text(value).trim();
  return asText ? asText : null;
};

const upperCurrency = (value: unknown, fallback = 'USD'): string => {
  const code = text(value).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
};

/** A day, as the ledger stores it. Everything above this file buckets by month, so
 *  a date with no time is stamped at UTC midnight rather than at the local one —
 *  a `2026-07-01` parsed as local time lands in June for half the planet. */
function isoDay(value: unknown, fallbackISO?: string): string {
  const raw = text(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return fallbackISO ?? new Date(0).toISOString();
}

/** Just the `YYYY-MM-DD`, for the vendors whose query language wants one. */
export const dayOnly = (iso: string): string => iso.slice(0, 10);

async function vendorFail(label: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => '');
  throw new AccountingProviderError(
    `${label} failed (${res.status}): ${body.slice(0, 240)}`,
    res.status,
    retryableStatus(res.status),
  );
}

/** A JSON call that turns every failure into an {@link AccountingProviderError}, so
 *  no caller ever has to branch on a `Response`. */
async function jsonCall<T>(label: string, url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) await vendorFail(label, res);
  return (await res.json().catch(() => ({}))) as T;
}

function requireToken(credential: AccountingCredential, label: string): string {
  if (!credential.accessToken) {
    throw new AccountingProviderError(`${label} is not connected — reconnect the account.`, 401, false);
  }
  return credential.accessToken;
}

function requireBook(credential: AccountingCredential, label: string, noun: string): string {
  if (!credential.externalAccountId) {
    throw new AccountingProviderError(`${label} connection is missing its ${noun}.`, 400, false);
  }
  return credential.externalAccountId;
}

/**
 * The document status every vendor spells differently, decided ONCE.
 *
 * `overdue` is not a status any of them stores — it is a fact about today against
 * the due date — so it is derived here rather than trusted from a vendor field that
 * was true when the record was written and has been wrong ever since.
 */
export function documentStatus(input: {
  amount: number;
  paidAmount: number;
  dueAtISO: string | null;
  voided?: boolean;
  draft?: boolean;
  now?: number;
}): LedgerDocument['status'] {
  if (input.voided) return 'void';
  if (input.draft) return 'draft';
  if (input.paidAmount >= input.amount - 0.005) return 'paid';
  const due = input.dueAtISO ? Date.parse(input.dueAtISO) : Number.NaN;
  if (Number.isFinite(due) && due < (input.now ?? Date.now())) return 'overdue';
  return input.paidAmount > 0 ? 'part-paid' : 'open';
}

/* ══ QuickBooks Online ═══════════════════════════════════════════════════════════
 *
 * One endpoint for everything: `/v3/company/{realmId}/query`, carrying a SQL-ish
 * string. Paging is `STARTPOSITION`/`MAXRESULTS` inside that string rather than a
 * query parameter, and a short page is the only end-of-data signal — QuickBooks
 * returns no total and no cursor, so the walk below stops when a page comes back
 * shorter than it asked for.
 *
 * TWO entities make up "transactions" because QuickBooks has no one table of money
 * movement: `Purchase` is money out and `Deposit` is money in. The cursor therefore
 * names WHICH entity it is partway through, and rolls over to the next when the
 * first is exhausted. Reading only `Purchase` would give a burn with no revenue
 * beside it, which is the shape of an error that looks like a working feature.
 */

const QBO_BASE = 'https://quickbooks.api.intuit.com/v3/company';
/** Pinned rather than floating: Intuit changes response shapes between minor
 *  versions, and an un-pinned call silently becomes a different contract. */
const QBO_MINOR_VERSION = '70';

interface QboRef { value?: string; name?: string }
interface QboLine {
  Amount?: number;
  Description?: string;
  DetailType?: string;
  SalesItemLineDetail?: { Qty?: number; UnitPrice?: number; ItemRef?: QboRef };
  AccountBasedExpenseLineDetail?: { AccountRef?: QboRef };
  ItemBasedExpenseLineDetail?: { Qty?: number; UnitPrice?: number };
}
interface QboTxn {
  Id?: string;
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  Balance?: number;
  PrivateNote?: string;
  /** QuickBooks marks a REFUNDED purchase with `Credit: true` rather than by
   *  negating the total — the one place its own sign is implicit. */
  Credit?: boolean;
  EntityRef?: QboRef;
  CustomerRef?: QboRef;
  VendorRef?: QboRef;
  AccountRef?: QboRef;
  CurrencyRef?: QboRef;
  Line?: QboLine[];
}
type QboQueryResponse = {
  QueryResponse?: Record<string, unknown> & { startPosition?: number; maxResults?: number };
};

/** `'Purchase:101'` — the entity being walked and where the next page starts. */
function parseQboCursor(cursor: string | undefined): { entity: 'Purchase' | 'Deposit'; start: number } {
  const [entity, start] = (cursor ?? '').split(':');
  const position = Number(start);
  return {
    entity: entity === 'Deposit' ? 'Deposit' : 'Purchase',
    start: Number.isFinite(position) && position >= 1 ? position : 1,
  };
}

async function qboQuery(credential: AccountingCredential, statement: string): Promise<QboQueryResponse> {
  const token = requireToken(credential, 'QuickBooks');
  const realmId = requireBook(credential, 'QuickBooks', 'company (realm) id');
  const url = `${QBO_BASE}/${encodeURIComponent(realmId)}/query`
    + `?minorversion=${QBO_MINOR_VERSION}&query=${encodeURIComponent(statement)}`;
  return jsonCall<QboQueryResponse>('QuickBooks query', url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
}

/** QuickBooks returns the rows under a key named after the entity, and OMITS the
 *  key entirely on an empty result rather than returning `[]`. */
function qboRows(response: QboQueryResponse, entity: string): QboTxn[] {
  const rows = response.QueryResponse?.[entity];
  return Array.isArray(rows) ? (rows as QboTxn[]) : [];
}

function qboLineItems(lines: readonly QboLine[] | undefined): LedgerDocument['lineItems'] {
  return (lines ?? [])
    .filter((line) => line.DetailType !== 'SubTotalLineDetail')
    .map((line) => {
      const quantity = money(line.SalesItemLineDetail?.Qty ?? line.ItemBasedExpenseLineDetail?.Qty ?? 1) || 1;
      const amount = money(line.Amount);
      const unit = money(line.SalesItemLineDetail?.UnitPrice ?? line.ItemBasedExpenseLineDetail?.UnitPrice);
      return {
        description: text(line.Description || line.SalesItemLineDetail?.ItemRef?.name),
        quantity,
        unitAmount: unit || (quantity ? amount / quantity : amount),
        amount,
      };
    });
}

const quickbooksAdapter: AccountingAdapter = {
  async fetchTransactions(credential, query) {
    const { entity, start } = parseQboCursor(query.cursor);
    const limit = Math.min(query.limit ?? PAGE_SIZE, PAGE_SIZE);
    const statement = `SELECT * FROM ${entity}`
      + ` WHERE TxnDate >= '${dayOnly(query.fromISO)}' AND TxnDate <= '${dayOnly(query.toISO)}'`
      + ` ORDER BY TxnDate STARTPOSITION ${start} MAXRESULTS ${limit}`;
    const rows = qboRows(await qboQuery(credential, statement), entity);

    const items = rows.map((row): LedgerTransaction => {
      const total = Math.abs(money(row.TotalAmt));
      // THE CONVERSION. A `Purchase` is money leaving and QuickBooks reports its
      // total unsigned, so it is negated here; `Credit: true` marks the refund of
      // one, which is the same money coming back and keeps its positive sign. A
      // `Deposit` is money arriving and needs no flip.
      const signed = entity === 'Deposit' ? total : row.Credit === true ? total : -total;
      return {
        id: `${entity}:${text(row.Id)}`,
        occurredAtISO: isoDay(row.TxnDate),
        amount: signed,
        currency: upperCurrency(row.CurrencyRef?.value),
        description: text(row.PrivateNote || row.DocNumber || entity),
        counterparty: nullableText(row.EntityRef?.name),
        category: nullableText(row.Line?.[0]?.AccountBasedExpenseLineDetail?.AccountRef?.name ?? row.AccountRef?.name),
        accountId: nullableText(row.AccountRef?.value),
        // Everything the query returns is a POSTED book entry. QuickBooks has no
        // pending state on these two entities — an unposted purchase is simply not
        // in the ledger yet — so claiming one would invent a status the book has.
        status: 'posted',
        recurring: false,
      };
    });

    // A short page means this entity is exhausted: roll to `Deposit`, or stop.
    const exhausted = items.length < limit;
    const cursor = !exhausted
      ? `${entity}:${start + items.length}`
      : entity === 'Purchase' ? 'Deposit:1' : undefined;
    return cursor ? { items, cursor } : { items };
  },

  async fetchDocuments(credential, query) {
    const { entity, start } = (() => {
      const [name, position] = (query.cursor ?? '').split(':');
      const parsed = Number(position);
      return {
        entity: name === 'Bill' ? 'Bill' : 'Invoice',
        start: Number.isFinite(parsed) && parsed >= 1 ? parsed : 1,
      } as const;
    })();
    const limit = Math.min(query.limit ?? PAGE_SIZE, PAGE_SIZE);
    const statement = `SELECT * FROM ${entity}`
      + ` WHERE TxnDate >= '${dayOnly(query.fromISO)}' AND TxnDate <= '${dayOnly(query.toISO)}'`
      + ` ORDER BY TxnDate STARTPOSITION ${start} MAXRESULTS ${limit}`;
    const rows = qboRows(await qboQuery(credential, statement), entity);

    const items = rows.map((row): LedgerDocument => {
      // A QuickBooks `Bill` and a Xero `ACCPAY` invoice are the same fact reported
      // with opposite signs. Neither sign survives here: the amount is the absolute
      // value and `direction` carries the meaning, so no caller can net a payable
      // against a receivable by summing a column.
      const amount = Math.abs(money(row.TotalAmt));
      const outstanding = Math.abs(money(row.Balance));
      const dueAtISO = row.DueDate ? isoDay(row.DueDate) : null;
      return {
        id: `${entity}:${text(row.Id)}`,
        direction: entity === 'Bill' ? 'payable' : 'receivable',
        reference: text(row.DocNumber || row.Id),
        counterparty: text((entity === 'Bill' ? row.VendorRef : row.CustomerRef)?.name || row.EntityRef?.name),
        amount,
        paidAmount: Math.max(0, amount - outstanding),
        currency: upperCurrency(row.CurrencyRef?.value),
        issuedAtISO: row.TxnDate ? isoDay(row.TxnDate) : null,
        dueAtISO,
        status: documentStatus({ amount, paidAmount: Math.max(0, amount - outstanding), dueAtISO }),
        lineItems: qboLineItems(row.Line),
      };
    });

    const exhausted = items.length < limit;
    const cursor = !exhausted
      ? `${entity}:${start + items.length}`
      : entity === 'Invoice' ? 'Bill:1' : undefined;
    return cursor ? { items, cursor } : { items };
  },

  async fetchBalances(credential) {
    // QuickBooks' `Account` is the chart-of-accounts node AND carries the running
    // book balance, which is why one read answers both `accounts` and `balances`.
    // Worth being precise about what that number is: it is the BOOK balance, what
    // the ledger says the account holds, not a figure the bank confirmed. For a
    // reconciled book they agree; for an unreconciled one the book is what the
    // company's own accountant would quote, which is the right answer for a runway.
    const rows = qboRows(
      await qboQuery(credential, "SELECT * FROM Account WHERE AccountType IN ('Bank', 'Credit Card') MAXRESULTS 500"),
      'Account',
    ) as Array<QboTxn & { Name?: string; AccountType?: string; CurrentBalance?: number }>;
    const asOfISO = new Date().toISOString();
    return rows.map((row): LedgerBalance => {
      const credit = text(row.AccountType) === 'Credit Card';
      const current = money(row.CurrentBalance);
      return {
        accountId: text(row.Id),
        accountName: text(row.Name),
        accountKind: credit ? 'credit' : 'bank',
        // QuickBooks reports a credit card's balance as a POSITIVE liability. It is
        // money owed, not money held, so it is negated into the cash position for
        // the same reason Plaid's is.
        balance: credit ? -Math.abs(current) : current,
        currency: upperCurrency(row.CurrencyRef?.value),
        asOfISO,
      };
    });
  },
};

/* ══ Xero ════════════════════════════════════════════════════════════════════════
 *
 * Three things Xero does that nobody else does, all of them load-bearing:
 *
 *   • Every request carries `Xero-Tenant-Id`. One grant can reach several
 *     organisations and the token alone does not say which, so a missing header is
 *     not an auth failure — it is a 403 that reads like one.
 *   • Paging is `?page=N`, 100 rows a page, and `If-Modified-Since` narrows a page
 *     to what CHANGED. The sweep sends it on every re-read of a window it has seen
 *     before, which is what keeps a 24-month backfill from being re-downloaded
 *     nightly against a Neon-Free budget.
 *   • Dates come back as `/Date(1518685950940+0000)/`. `Date.parse` returns NaN on
 *     that, so an adapter that forgot would stamp every transaction at the epoch
 *     and put a decade of burn into January 1970.
 */

const XERO_BASE = 'https://api.xero.com/api.xro/2.0';

interface XeroContact { Name?: string }
interface XeroLineItem { Description?: string; Quantity?: number; UnitAmount?: number; LineAmount?: number; AccountCode?: string }
interface XeroBankTransaction {
  BankTransactionID?: string;
  Type?: string;
  Total?: number;
  Date?: string;
  Status?: string;
  Reference?: string;
  CurrencyCode?: string;
  IsReconciled?: boolean;
  Contact?: XeroContact;
  BankAccount?: { AccountID?: string; Name?: string };
  LineItems?: XeroLineItem[];
}
interface XeroInvoice {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Type?: string;
  Total?: number;
  AmountPaid?: number;
  AmountDue?: number;
  Date?: string;
  DueDate?: string;
  Status?: string;
  CurrencyCode?: string;
  Contact?: XeroContact;
  LineItems?: XeroLineItem[];
}

/** `/Date(1518685950940+0000)/` → ISO. Falls through to a plain ISO string, which
 *  is what the Reports endpoints return for the same concept. */
export function parseXeroDate(value: unknown): string | null {
  const raw = text(value).trim();
  if (!raw) return null;
  const dotNet = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(raw);
  if (dotNet) {
    const ms = Number(dotNet[1]);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function xeroHeaders(credential: AccountingCredential, sinceISO?: string): Record<string, string> {
  const token = requireToken(credential, 'Xero');
  const tenant = requireBook(credential, 'Xero', 'organisation (tenant) id');
  return {
    Authorization: `Bearer ${token}`,
    'Xero-Tenant-Id': tenant,
    Accept: 'application/json',
    // Xero wants RFC1123 without the timezone suffix; it is documented as UTC.
    ...(sinceISO ? { 'If-Modified-Since': sinceISO.replace(/\.\d{3}Z$/, '') } : {}),
  };
}

/** Xero's `where` grammar takes `DateTime(y,m,d)` literals rather than quoted
 *  dates — a quoted one is accepted and silently matches nothing. */
const xeroDateLiteral = (iso: string): string => {
  const [y, m, d] = dayOnly(iso).split('-');
  return `DateTime(${Number(y)},${Number(m)},${Number(d)})`;
};

const xeroPage = (cursor: string | undefined): number => {
  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
};

function xeroLineItems(lines: readonly XeroLineItem[] | undefined): LedgerDocument['lineItems'] {
  return (lines ?? []).map((line) => ({
    description: text(line.Description),
    quantity: money(line.Quantity) || 1,
    unitAmount: money(line.UnitAmount),
    amount: money(line.LineAmount),
  }));
}

const xeroAdapter: AccountingAdapter = {
  async fetchTransactions(credential, query) {
    const page = xeroPage(query.cursor);
    const where = `Date>=${xeroDateLiteral(query.fromISO)}&&Date<=${xeroDateLiteral(query.toISO)}`;
    const url = `${XERO_BASE}/BankTransactions?page=${page}&where=${encodeURIComponent(where)}`;
    const body = await jsonCall<{ BankTransactions?: XeroBankTransaction[] }>(
      'Xero bank transactions', url, { method: 'GET', headers: xeroHeaders(credential) },
    );
    const rows = body.BankTransactions ?? [];

    const items = rows.map((row): LedgerTransaction => {
      const total = Math.abs(money(row.Total));
      const type = text(row.Type).toUpperCase();
      // THE CONVERSION. Xero reports `Total` unsigned and puts the direction in the
      // TYPE: `RECEIVE`, `RECEIVE-OVERPAYMENT` and `RECEIVE-PREPAYMENT` are money
      // in; every `SPEND-*` is money out. Reading the prefix rather than listing the
      // six exact values is deliberate — Xero has added variants before, and an
      // unknown `SPEND-…` defaulting to POSITIVE would add a cost to revenue.
      const incoming = type.startsWith('RECEIVE');
      return {
        id: text(row.BankTransactionID),
        occurredAtISO: parseXeroDate(row.Date) ?? new Date(0).toISOString(),
        amount: incoming ? total : -total,
        currency: upperCurrency(row.CurrencyCode),
        description: text(row.Reference || row.Contact?.Name || type),
        counterparty: nullableText(row.Contact?.Name),
        category: nullableText(row.LineItems?.[0]?.AccountCode),
        accountId: nullableText(row.BankAccount?.AccountID),
        // `AUTHORISED` is the only state Xero considers real. A `DELETED` or
        // `VOIDED` row is money that did not move, and `foldTransactionsToMonths`
        // drops anything not `posted` — which is exactly where it belongs.
        status: text(row.Status).toUpperCase() === 'AUTHORISED' ? 'posted' : 'pending',
        recurring: false,
      };
    });

    // Xero pages are exactly 100 rows until the last one.
    return rows.length >= PAGE_SIZE ? { items, cursor: String(page + 1) } : { items };
  },

  async fetchDocuments(credential, query) {
    const page = xeroPage(query.cursor);
    const where = `Date>=${xeroDateLiteral(query.fromISO)}&&Date<=${xeroDateLiteral(query.toISO)}`;
    const url = `${XERO_BASE}/Invoices?page=${page}&where=${encodeURIComponent(where)}`;
    const body = await jsonCall<{ Invoices?: XeroInvoice[] }>(
      'Xero invoices', url, { method: 'GET', headers: xeroHeaders(credential) },
    );
    const rows = body.Invoices ?? [];

    const items = rows.map((row): LedgerDocument => {
      const status = text(row.Status).toUpperCase();
      const amount = Math.abs(money(row.Total));
      const paidAmount = Math.abs(money(row.AmountPaid));
      const dueAtISO = parseXeroDate(row.DueDate);
      return {
        id: text(row.InvoiceID),
        // `ACCREC` is owed TO the company and `ACCPAY` is owed BY it — the two
        // words this whole normalisation exists for. Both amounts are made
        // positive; the direction is the only thing carrying the sign.
        direction: text(row.Type).toUpperCase() === 'ACCPAY' ? 'payable' : 'receivable',
        reference: text(row.InvoiceNumber || row.InvoiceID),
        counterparty: text(row.Contact?.Name),
        amount,
        paidAmount,
        currency: upperCurrency(row.CurrencyCode),
        issuedAtISO: parseXeroDate(row.Date),
        dueAtISO,
        status: documentStatus({
          amount,
          paidAmount,
          dueAtISO,
          voided: status === 'VOIDED' || status === 'DELETED',
          draft: status === 'DRAFT' || status === 'SUBMITTED',
        }),
        lineItems: xeroLineItems(row.LineItems),
      };
    });

    return rows.length >= PAGE_SIZE ? { items, cursor: String(page + 1) } : { items };
  },

  async fetchBalances(credential) {
    // Xero's `Accounts` endpoint returns the chart of accounts and NO balance —
    // the balance lives in the Bank Summary report, which is why this is a
    // `Reports/` call and not the obvious one.
    const body = await jsonCall<{
      Reports?: Array<{ Rows?: Array<{ RowType?: string; Rows?: Array<{ RowType?: string; Cells?: Array<{ Value?: unknown; Attributes?: Array<{ Value?: string; Id?: string }> }> }> }> }>;
    }>('Xero bank summary', `${XERO_BASE}/Reports/BankSummary`, {
      method: 'GET',
      headers: xeroHeaders(credential),
    });

    const asOfISO = new Date().toISOString();
    const balances: LedgerBalance[] = [];
    for (const section of body.Reports?.[0]?.Rows ?? []) {
      if (section.RowType !== 'Section') continue;
      for (const row of section.Rows ?? []) {
        if (row.RowType !== 'Row') continue;
        const cells = row.Cells ?? [];
        const accountId = cells[0]?.Attributes?.find((attribute) => attribute.Id === 'account')?.Value;
        const name = text(cells[0]?.Value);
        if (!accountId || !name) continue;
        balances.push({
          accountId,
          accountName: name,
          // Bank Summary reports BANK accounts only, by definition — which is why
          // this is the one adapter that does not have to guess a kind.
          accountKind: 'bank',
          // Cells are [account, opening, cash received, cash spent, CLOSING].
          balance: money(cells[4]?.Value),
          currency: 'USD',
          asOfISO,
        });
      }
    }
    return balances;
  },
};

/* ══ NetSuite ════════════════════════════════════════════════════════════════════
 *
 * SuiteTalk REST, authenticated with TOKEN-BASED AUTH — OAuth 1.0a HMAC-SHA256 over
 * a consumer key/secret plus a token id/secret, all four typed by the administrator
 * who provisioned the integration record. There is no refresh and no consent screen,
 * which is exactly why the port declares NetSuite `connect: 'fields'`.
 *
 * Reads go through SuiteQL (`POST /query/v1/suiteql`, `Prefer: transient`) rather
 * than the record endpoints. The record API pages one record type at a time and
 * cannot express "every money movement in a window"; SuiteQL can, in one statement,
 * which on a bounded-subrequest Worker is the difference between one call and
 * several hundred.
 */

interface NetSuiteRow { [column: string]: unknown }

/**
 * NetSuite transaction types, split by which way the money goes.
 *
 * THE CONVERSION, and it is a lookup rather than a sign because `foreigntotal` is
 * reported unsigned for some types and signed-by-posting-convention for others —
 * a rule that reads the number cannot tell a vendor bill from a customer payment.
 * An UNKNOWN type is skipped rather than guessed: a journal entry or an inventory
 * adjustment is not cash, and defaulting it either way would move a burn figure by
 * a number nobody chose.
 */
const NETSUITE_OUTFLOW_TYPES = new Set(['VendBill', 'VendPymt', 'Check', 'CardChrg', 'ExpRept', 'Paycheck', 'PaycheckJournal']);
const NETSUITE_INFLOW_TYPES = new Set(['CustPymt', 'CashSale', 'Deposit', 'CardRfnd', 'CustDep']);

function netsuiteBaseUrl(accountId: string): string {
  // `1234567_SB1` → `1234567-sb1.suitetalk.api.netsuite.com`. NetSuite's own
  // documentation states the underscore becomes a hyphen and the host is lowercase;
  // sending the raw account id resolves to nothing at all.
  const host = accountId.trim().toLowerCase().replace(/_/g, '-');
  return `https://${host}.suitetalk.api.netsuite.com/services/rest`;
}

/** RFC3986 percent-encoding. `encodeURIComponent` leaves `!*'()` alone and OAuth 1.0a
 *  requires them encoded — the single most common reason a hand-rolled signature is
 *  rejected with no useful message. */
export function oauthEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * An OAuth 1.0a `Authorization` header for one NetSuite request.
 *
 * Exported for its unit test: a signature is either exactly right or completely
 * rejected, and there is no sandbox here to find out against.
 */
export async function netsuiteAuthHeader(
  fields: Record<string, string>,
  method: string,
  url: string,
  nonce: string,
  timestampSeconds: number,
): Promise<string> {
  const params: Record<string, string> = {
    oauth_consumer_key: fields.consumerKey ?? '',
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: String(timestampSeconds),
    oauth_token: fields.tokenId ?? '',
    oauth_version: '1.0',
  };
  // The query string is part of what is signed; the base string uses the URL with
  // its query REMOVED and the parameters merged into the sorted list.
  const parsed = new URL(url);
  for (const [key, value] of parsed.searchParams) params[key] = value;
  const normalized = Object.keys(params)
    .sort()
    .map((key) => `${oauthEncode(key)}=${oauthEncode(params[key] ?? '')}`)
    .join('&');
  const baseString = [
    method.toUpperCase(),
    oauthEncode(`${parsed.origin}${parsed.pathname}`),
    oauthEncode(normalized),
  ].join('&');
  const signingKey = `${oauthEncode(fields.consumerSecret ?? '')}&${oauthEncode(fields.tokenSecret ?? '')}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseString));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)));

  const header: Record<string, string> = {
    realm: fields.accountId ?? '',
    oauth_consumer_key: params.oauth_consumer_key ?? '',
    oauth_token: params.oauth_token ?? '',
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: params.oauth_timestamp ?? '',
    oauth_nonce: nonce,
    oauth_version: '1.0',
    oauth_signature: encoded,
  };
  return `OAuth ${Object.entries(header).map(([k, v]) => `${oauthEncode(k)}="${oauthEncode(v)}"`).join(', ')}`;
}

function netsuiteFields(credential: AccountingCredential): Record<string, string> {
  const fields = credential.fields ?? {};
  for (const key of ['accountId', 'consumerKey', 'consumerSecret', 'tokenId', 'tokenSecret']) {
    if (!fields[key]) {
      throw new AccountingProviderError(`NetSuite connection is missing its ${key}.`, 400, false);
    }
  }
  return fields;
}

async function suiteQl(credential: AccountingCredential, statement: string, offset: number, limit: number): Promise<NetSuiteRow[]> {
  const fields = netsuiteFields(credential);
  const url = `${netsuiteBaseUrl(fields.accountId!)}/query/v1/suiteql?limit=${limit}&offset=${offset}`;
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const authorization = await netsuiteAuthHeader(fields, 'POST', url, nonce, Math.floor(Date.now() / 1000));
  const body = await jsonCall<{ items?: NetSuiteRow[] }>('NetSuite SuiteQL', url, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Without this NetSuite rejects the query outright — it is not an optimisation.
      Prefer: 'transient',
    },
    body: JSON.stringify({ q: statement }),
  });
  return body.items ?? [];
}

const netsuiteOffset = (cursor: string | undefined): number => {
  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

const netsuiteAdapter: AccountingAdapter = {
  async fetchTransactions(credential, query) {
    const offset = netsuiteOffset(query.cursor);
    const limit = Math.min(query.limit ?? PAGE_SIZE, PAGE_SIZE);
    const types = [...NETSUITE_OUTFLOW_TYPES, ...NETSUITE_INFLOW_TYPES].map((type) => `'${type}'`).join(', ');
    const statement = `
      SELECT t.id, t.tranid, t.trandate, t.type, t.memo, t.foreigntotal, t.currency,
             BUILTIN.DF(t.entity) AS entityname, BUILTIN.DF(t.currency) AS currencyname
        FROM transaction t
       WHERE t.trandate BETWEEN TO_DATE('${dayOnly(query.fromISO)}', 'YYYY-MM-DD')
                            AND TO_DATE('${dayOnly(query.toISO)}', 'YYYY-MM-DD')
         AND t.type IN (${types})
       ORDER BY t.trandate, t.id`;
    const rows = await suiteQl(credential, statement, offset, limit);

    const items = rows.flatMap((row): LedgerTransaction[] => {
      const type = text(row.type);
      const outflow = NETSUITE_OUTFLOW_TYPES.has(type);
      // An unrecognised type reaching here would mean the `IN (…)` filter and this
      // map disagreed; dropping it is the safe half of that disagreement.
      if (!outflow && !NETSUITE_INFLOW_TYPES.has(type)) return [];
      const total = Math.abs(money(row.foreigntotal));
      return [{
        id: text(row.id),
        occurredAtISO: isoDay(row.trandate),
        amount: outflow ? -total : total,
        currency: upperCurrency(row.currencyname),
        description: text(row.memo || row.tranid || type),
        counterparty: nullableText(row.entityname),
        category: nullableText(type),
        accountId: null,
        status: 'posted',
        recurring: false,
      }];
    });

    return rows.length >= limit ? { items, cursor: String(offset + rows.length) } : { items };
  },

  async fetchDocuments(credential, query) {
    const offset = netsuiteOffset(query.cursor);
    const limit = Math.min(query.limit ?? PAGE_SIZE, PAGE_SIZE);
    const statement = `
      SELECT t.id, t.tranid, t.trandate, t.duedate, t.type, t.status,
             t.foreigntotal, t.foreignamountunpaid,
             BUILTIN.DF(t.entity) AS entityname, BUILTIN.DF(t.currency) AS currencyname
        FROM transaction t
       WHERE t.trandate BETWEEN TO_DATE('${dayOnly(query.fromISO)}', 'YYYY-MM-DD')
                            AND TO_DATE('${dayOnly(query.toISO)}', 'YYYY-MM-DD')
         AND t.type IN ('CustInvc', 'VendBill')
       ORDER BY t.trandate, t.id`;
    const rows = await suiteQl(credential, statement, offset, limit);

    const items = rows.map((row): LedgerDocument => {
      const amount = Math.abs(money(row.foreigntotal));
      const unpaid = Math.abs(money(row.foreignamountunpaid));
      const dueAtISO = row.duedate ? isoDay(row.duedate) : null;
      const paidAmount = Math.max(0, amount - unpaid);
      return {
        id: text(row.id),
        direction: text(row.type) === 'VendBill' ? 'payable' : 'receivable',
        reference: text(row.tranid || row.id),
        counterparty: text(row.entityname),
        amount,
        paidAmount,
        currency: upperCurrency(row.currencyname),
        issuedAtISO: row.trandate ? isoDay(row.trandate) : null,
        dueAtISO,
        status: documentStatus({
          amount,
          paidAmount,
          dueAtISO,
          voided: /voided|rejected/i.test(text(row.status)),
        }),
        lineItems: [],
      };
    });

    return rows.length >= limit ? { items, cursor: String(offset + rows.length) } : { items };
  },

  async fetchBalances(credential) {
    // The account list and its running total in ONE statement. Splitting it would
    // be one SuiteQL call per account, and a chart of accounts has hundreds.
    const statement = `
      SELECT a.id, a.acctname, a.accttype, SUM(tal.amount) AS balance
        FROM account a
        LEFT JOIN transactionaccountingline tal ON tal.account = a.id
       WHERE a.accttype IN ('Bank', 'CredCard')
       GROUP BY a.id, a.acctname, a.accttype`;
    const rows = await suiteQl(credential, statement, 0, PAGE_SIZE);
    const asOfISO = new Date().toISOString();
    return rows.map((row): LedgerBalance => ({
      accountId: text(row.id),
      accountName: text(row.acctname),
      accountKind: text(row.accttype) === 'CredCard' ? 'credit' : 'bank',
      balance: money(row.balance),
      currency: 'USD',
      asOfISO,
    }));
  },
};

/* ══ Plaid ═══════════════════════════════════════════════════════════════════════
 *
 * `/transactions/sync` is a CURSOR, not a window: it returns everything that has
 * changed since the cursor as three lists — `added`, `modified`, `removed` — and a
 * `next_cursor` to hand back next time.
 *
 * THE REMOVALS ARE NOT OPTIONAL. Plaid removes a transaction when the bank
 * reverses or de-duplicates one, and a caller that reads `added` and ignores
 * `removed` leaves a GHOST in the ledger: an expense that the bank says never
 * happened, permanently in the burn, permanently lowering the runway, and
 * invisible because it looks exactly like every other synced row. So the page
 * carries `removedIds` and the sync deletes them in the same pass.
 *
 * The query WINDOW is ignored on purpose — a cursor and a window are two different
 * ways to ask, and mixing them would re-read the whole history every sweep.
 */

const PLAID_HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

export function plaidHost(environment: string | undefined): string {
  return PLAID_HOSTS[text(environment).trim().toLowerCase()] ?? PLAID_HOSTS.production!;
}

interface PlaidTransaction {
  transaction_id?: string;
  account_id?: string;
  date?: string;
  authorized_date?: string;
  amount?: number;
  iso_currency_code?: string;
  unofficial_currency_code?: string;
  name?: string;
  merchant_name?: string;
  pending?: boolean;
  category?: string[];
  personal_finance_category?: { primary?: string; detailed?: string };
}

interface PlaidAccount {
  account_id?: string;
  name?: string;
  official_name?: string;
  type?: string;
  subtype?: string;
  balances?: { current?: number; available?: number; iso_currency_code?: string };
}

/** Plaid authenticates with the client credentials IN THE BODY, not a header — the
 *  one vendor of the five that does. */
function plaidBody(credential: AccountingCredential, extra: Record<string, unknown>): string {
  const fields = credential.fields ?? {};
  if (!fields.clientId || !fields.secret) {
    throw new AccountingProviderError('Plaid is not configured on this deployment.', 503, false);
  }
  return JSON.stringify({
    client_id: fields.clientId,
    secret: fields.secret,
    access_token: requireToken(credential, 'Plaid'),
    ...extra,
  });
}

/** Turn one Plaid row into ours. Exported because the removal replay and the added/
 *  modified lists all go through it, and the sign flip must not be written twice. */
export function plaidTransaction(row: PlaidTransaction): LedgerTransaction {
  const native = money(row.amount);
  return {
    id: text(row.transaction_id),
    occurredAtISO: isoDay(row.date ?? row.authorized_date),
    // THE CONVERSION, and it is the one most likely to be got backwards. Plaid
    // signs from the ACCOUNT's point of view: a POSITIVE amount is money that LEFT
    // the account. Ours is the company's point of view, where money leaving is
    // negative — so every Plaid amount is negated, without exception.
    amount: -native,
    currency: upperCurrency(row.iso_currency_code ?? row.unofficial_currency_code),
    description: text(row.name || row.merchant_name),
    counterparty: nullableText(row.merchant_name),
    category: nullableText(row.personal_finance_category?.primary ?? row.category?.[0]),
    accountId: nullableText(row.account_id),
    // A pending charge can still vanish, and `foldTransactionsToMonths` drops it.
    // This is the field that keeps a hold on a card out of a runway figure.
    status: row.pending === true ? 'pending' : 'posted',
    recurring: false,
  };
}

/**
 * Trade a Plaid Link `public_token` for the long-lived `access_token`.
 *
 * ── WHY THE LEDGER PORT HAS ONE PROVIDER-SHAPED EXCEPTION ──────────────────────
 * The other three OAuth providers hand back an authorization CODE which
 * `completeProviderOAuthCallback` trades at a token endpoint with a form-encoded
 * body. Plaid does not: Link hands back a `public_token`, and the exchange is a
 * JSON body carrying the deployment's client credentials. It is the same STEP with
 * a different wire format, so it lives here — behind the adapter, like every other
 * vendor quirk — rather than as a branch in the shared connect primitive, which
 * would make every other port carry Plaid's shape.
 *
 * What does NOT differ is what happens next: the result is sealed by the same
 * `oauthTokenVault` into the same `credentials` row as the other four. One storage
 * path, which is the invariant that actually matters.
 */
export async function exchangePlaidPublicToken(
  config: { clientId: string; secret: string; environment?: string },
  publicToken: string,
): Promise<{ accessToken: string; itemId: string }> {
  const body = await jsonCall<{ access_token?: string; item_id?: string }>(
    'Plaid public token exchange',
    `${plaidHost(config.environment)}/item/public_token/exchange`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: config.clientId, secret: config.secret, public_token: publicToken }),
    },
  );
  if (!body.access_token) {
    throw new AccountingProviderError('Plaid returned no access token for that link.', 502, false);
  }
  return { accessToken: body.access_token, itemId: text(body.item_id) };
}

const plaidAdapter: AccountingAdapter = {
  async fetchTransactions(credential, query) {
    const fields = credential.fields ?? {};
    const url = `${plaidHost(fields.environment)}/transactions/sync`;
    const body = await jsonCall<{
      added?: PlaidTransaction[];
      modified?: PlaidTransaction[];
      removed?: Array<{ transaction_id?: string }>;
      next_cursor?: string;
      has_more?: boolean;
    }>('Plaid transactions sync', url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: plaidBody(credential, {
        // Absent on the first call rather than empty-string: Plaid treats a missing
        // cursor as "from the beginning" and an empty string as a malformed one.
        ...(query.cursor ? { cursor: query.cursor } : {}),
        count: Math.min(query.limit ?? 500, 500),
      }),
    });

    // `added` and `modified` are normalised identically: a modification is the same
    // transaction with new values, and the sync upserts on the provider id, so one
    // list of rows is all the caller needs.
    const items = [...(body.added ?? []), ...(body.modified ?? [])].map(plaidTransaction);
    const removedIds = (body.removed ?? []).map((row) => text(row.transaction_id)).filter(Boolean);

    return {
      items,
      ...(removedIds.length ? { removedIds } : {}),
      // `cursor` means "there is more, call again". Plaid says so explicitly, and
      // returning one on the LAST page would make the sweep spend a round trip per
      // connection per night discovering an empty result.
      ...(body.has_more && body.next_cursor ? { cursor: body.next_cursor } : {}),
      // `checkpoint` means "store this". It is set on EVERY page including the last
      // one, because the final cursor is where tomorrow's sweep has to start — and
      // a cursor that is only stored while there is more data would restart the
      // whole item history every night.
      ...(body.next_cursor ? { checkpoint: body.next_cursor } : {}),
    };
  },

  async fetchBalances(credential) {
    const fields = credential.fields ?? {};
    const body = await jsonCall<{ accounts?: PlaidAccount[] }>(
      'Plaid balances',
      `${plaidHost(fields.environment)}/accounts/balance/get`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: plaidBody(credential, {}) },
    );
    const asOfISO = new Date().toISOString();
    return (body.accounts ?? []).map((account): LedgerBalance => {
      const kind = text(account.type) === 'depository' ? 'bank'
        : text(account.type) === 'credit' ? 'credit' : 'other';
      const current = money(account.balances?.current);
      return {
        accountId: text(account.account_id),
        accountName: text(account.official_name || account.name),
        accountKind: kind,
        // A CREDIT account's `current` is what is OWED, reported positive. It is a
        // liability against the cash position, so it is negated here — a company
        // with $50k in the bank and $10k on the card has $40k, and the alternative
        // reads its debt as money it can spend.
        balance: kind === 'credit' ? -current : current,
        currency: upperCurrency(account.balances?.iso_currency_code),
        asOfISO,
      };
    });
  },
};

/* ══ Stripe (revenue) ════════════════════════════════════════════════════════════
 *
 * Balance transactions rather than charges, and the difference matters: a charge is
 * what a customer was billed, a balance transaction is what actually landed in the
 * Stripe balance — which is the charge MINUS the processing fee, plus the refunds,
 * the disputes and the payouts that took the money out again. Reading charges alone
 * would report gross revenue as cash, which for a company on card payments is
 * roughly 3% too high, every month, in the flattering direction.
 *
 * Stripe is also the ONE vendor here whose sign already agrees with ours: positive
 * is credited to the account, negative is debited. So this adapter's job is the
 * opposite of the others' — it must NOT flip anything, and only divides by 100.
 */

const STRIPE_BASE = 'https://api.stripe.com/v1';

interface StripeBalanceTransaction {
  id?: string;
  created?: number;
  amount?: number;
  currency?: string;
  description?: string;
  type?: string;
  status?: string;
  source?: string | { id?: string; invoice?: string | { id?: string; subscription?: string | null } };
}

interface StripeInvoice {
  id?: string;
  number?: string;
  customer_name?: string;
  customer_email?: string;
  total?: number;
  amount_paid?: number;
  currency?: string;
  created?: number;
  due_date?: number | null;
  status?: string;
  subscription?: string | null;
  lines?: { data?: Array<{ description?: string | null; quantity?: number | null; amount?: number; price?: { unit_amount?: number | null } }> };
}

const stripeTime = (seconds: unknown): string => {
  const value = money(seconds);
  return value > 0 ? new Date(value * 1000).toISOString() : new Date(0).toISOString();
};

async function stripeGet<T>(credential: AccountingCredential, path: string, params: URLSearchParams): Promise<T> {
  const token = requireToken(credential, 'Stripe');
  return jsonCall<T>(`Stripe ${path}`, `${STRIPE_BASE}${path}?${params}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      // Connect: the grant is for the connected account, and the header is what
      // makes the read run against THEIR book rather than the platform's.
      ...(credential.externalAccountId ? { 'Stripe-Account': credential.externalAccountId } : {}),
    },
  });
}

const stripeAdapter: AccountingAdapter = {
  async fetchTransactions(credential, query) {
    const params = new URLSearchParams({
      limit: String(Math.min(query.limit ?? PAGE_SIZE, PAGE_SIZE)),
      'created[gte]': String(Math.floor(Date.parse(query.fromISO) / 1000)),
      'created[lte]': String(Math.floor(Date.parse(query.toISO) / 1000)),
    });
    if (query.cursor) params.set('starting_after', query.cursor);
    // Two levels of expansion so a charge's invoice comes back with the row. It is
    // the only way to know whether a payment is SUBSCRIPTION revenue, which is the
    // difference between `finance.mrr` and `finance.revenue`.
    params.append('expand[]', 'data.source.invoice');

    const body = await stripeGet<{ data?: StripeBalanceTransaction[]; has_more?: boolean }>(
      credential, '/balance_transactions', params,
    );
    const rows = body.data ?? [];

    const items = rows.map((row): LedgerTransaction => {
      const source = typeof row.source === 'object' && row.source ? row.source : undefined;
      const invoice = source && typeof source.invoice === 'object' && source.invoice ? source.invoice : undefined;
      return {
        id: text(row.id),
        occurredAtISO: stripeTime(row.created),
        // NO FLIP. Stripe already signs from the account's point of view, which is
        // the company's here — a refund arrives as a negative amount and a charge as
        // a positive one. Negating this would report every month's revenue as burn.
        amount: money(row.amount) / 100,
        currency: upperCurrency(row.currency),
        description: text(row.description || row.type),
        counterparty: null,
        category: nullableText(row.type),
        accountId: nullableText(credential.externalAccountId),
        // `available` is settled money; `pending` has not cleared and must not move
        // a runway.
        status: text(row.status) === 'available' ? 'posted' : 'pending',
        // A charge against an invoice that belongs to a subscription is committed,
        // recurring revenue. Anything else — a one-off charge, a fee, a payout — is
        // not, and calling it recurring would put a single sale into MRR.
        recurring: !!(invoice && invoice.subscription),
      };
    });

    const last = rows[rows.length - 1]?.id;
    return body.has_more && last ? { items, cursor: last } : { items };
  },

  async fetchDocuments(credential, query) {
    const params = new URLSearchParams({
      limit: String(Math.min(query.limit ?? PAGE_SIZE, PAGE_SIZE)),
      'created[gte]': String(Math.floor(Date.parse(query.fromISO) / 1000)),
      'created[lte]': String(Math.floor(Date.parse(query.toISO) / 1000)),
    });
    if (query.cursor) params.set('starting_after', query.cursor);

    const body = await stripeGet<{ data?: StripeInvoice[]; has_more?: boolean }>(credential, '/invoices', params);
    const rows = body.data ?? [];

    const items = rows.map((row): LedgerDocument => {
      const amount = Math.abs(money(row.total)) / 100;
      const paidAmount = Math.abs(money(row.amount_paid)) / 100;
      const status = text(row.status);
      const dueAtISO = row.due_date ? stripeTime(row.due_date) : null;
      return {
        id: text(row.id),
        // Stripe issues invoices to CUSTOMERS and never to the company, so every
        // one of these is a receivable. There is no payable half to get wrong —
        // which is why the port declares `invoices` and deliberately not `bills`.
        direction: 'receivable',
        reference: text(row.number || row.id),
        counterparty: text(row.customer_name || row.customer_email),
        amount,
        paidAmount,
        currency: upperCurrency(row.currency),
        issuedAtISO: stripeTime(row.created),
        dueAtISO,
        status: documentStatus({
          amount,
          paidAmount,
          dueAtISO,
          voided: status === 'void' || status === 'uncollectible',
          draft: status === 'draft',
        }),
        lineItems: (row.lines?.data ?? []).map((line) => ({
          description: text(line.description),
          quantity: money(line.quantity) || 1,
          unitAmount: money(line.price?.unit_amount) / 100,
          amount: money(line.amount) / 100,
        })),
      };
    });

    const last = rows[rows.length - 1]?.id;
    return body.has_more && last ? { items, cursor: last } : { items };
  },
};

/* ── registry ────────────────────────────────────────────────────────────────── */

/**
 * The five, by name. `accountingProviders.ts` spreads these onto its registry
 * entries, which is what turns `descriptor.live` on — derived from whether a read
 * EXISTS rather than declared, so an adapter landing publishes itself and nobody
 * has to remember to edit a page.
 */
export const ACCOUNTING_ADAPTERS: Record<AccountingProviderName, AccountingAdapter> = {
  quickbooks: quickbooksAdapter,
  xero: xeroAdapter,
  netsuite: netsuiteAdapter,
  plaid: plaidAdapter,
  'stripe-revenue': stripeAdapter,
};
