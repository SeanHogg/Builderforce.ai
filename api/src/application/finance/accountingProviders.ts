/**
 * The LEDGER port — where a company's actual numbers come FROM.
 *
 * ── THE ASYMMETRY THIS CLOSES ────────────────────────────────────────────────────
 * `integrationCatalog.ts` builds its entire `finance` category from
 * `describePayoutProviders()`, every entry `direction: 'export'`. So the platform could
 * send money OUT — Stripe, PayPal, a bank account, Wise — and could not read a single
 * actual IN. There was no accounting connector, no bank feed, no payroll, and no
 * Stripe-as-revenue-source: Stripe appears elsewhere in the codebase only as webhook
 * SIGNATURE VERIFICATION for generated backends.
 *
 * The consequence was not a missing feature, it was a broken promise: "idea to REAL"
 * completes at the artifact and stops one step short of the ledger. `financeRollup.ts`
 * can compute burn, MRR and runway perfectly and has nothing to compute them FROM until
 * someone types every expense in by hand — at which point the number is stale the moment
 * it is entered, which is the exact failure `liveMetric` was introduced to end.
 *
 * ── WHY A PORT AND NOT A QUICKBOOKS CLIENT ──────────────────────────────────────
 * This is the seventh member of the family that already exists — connector, board, data,
 * drive, mailbox, calendar, payout — and it earns its place the same way they do: the
 * vendors disagree about everything above the two facts anyone actually wants.
 *
 *   • QuickBooks and Xero both have an "account" and neither means the same thing:
 *     QuickBooks `Account` is a chart-of-accounts node, Xero `Account` is too but with a
 *     different type vocabulary, and Plaid's `account` is a BANK account. One word,
 *     three meanings — the `soc_controls` collision class, one integration over.
 *   • QuickBooks paginates with `startPosition`/`maxResults` over a SQL-ish query
 *     language; Xero pages with an `page` parameter and an `If-Modified-Since` header;
 *     Plaid cursors with `next_cursor` and expects the caller to replay removals.
 *   • Sign conventions differ. A Xero `ACCPAY` invoice and a QuickBooks `Bill` are the
 *     same thing with opposite-signed totals in their respective reports.
 *
 * Everything above this file speaks {@link LedgerTransaction} and never learns which of
 * those it is talking to — the same contract `MailboxMessage` holds for mail. An adapter
 * that leaked its vendor's sign convention would put a negative burn on a founder's
 * board, and the rollup would divide by it.
 *
 * ── WHAT THIS FILE IS, AND IS NOT ───────────────────────────────────────────────
 * It is the PORT: the provider registry, the normalized shapes, the capability
 * declaration and the descriptor the public catalog projects. It is deliberately NOT a
 * vendor HTTP client — each adapter's `fetch` half lands behind
 * {@link AccountingProvider} as its credentials are configured, exactly as the payout
 * port shipped its registry before every adapter was live. What matters for correctness
 * is that the CONTRACT is one shape, decided here, before three adapters each invent one.
 */

import { isProviderOAuthConfigured, type OAuthProviderConfig } from '../shared/providerOAuthConnect';

export const ACCOUNTING_PROVIDER_NAMES = ['quickbooks', 'xero', 'netsuite', 'plaid', 'stripe-revenue'] as const;
export type AccountingProviderName = (typeof ACCOUNTING_PROVIDER_NAMES)[number];

export function isAccountingProviderName(value: unknown): value is AccountingProviderName {
  return typeof value === 'string' && (ACCOUNTING_PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * What a provider can actually answer.
 *
 * Declared rather than assumed, because the difference is load-bearing: Plaid gives BANK
 * TRANSACTIONS and no invoices, QuickBooks gives invoices and bills and a chart of
 * accounts, Stripe gives revenue and nothing payable. A surface that assumed every
 * provider answered every question would render an empty "payables" tab for a tenant on
 * a bank feed and give them no way to know why.
 */
export const LEDGER_CAPABILITIES = ['transactions', 'invoices', 'bills', 'accounts', 'balances'] as const;
export type LedgerCapability = (typeof LEDGER_CAPABILITIES)[number];

/**
 * One money movement, normalized.
 *
 * SIGN CONVENTION, stated once so no adapter has to guess: `amount` is POSITIVE for
 * money coming IN and NEGATIVE for money going OUT, from the connected company's point
 * of view. Every adapter converts to this. It is written here rather than left to each
 * vendor's own convention because the alternative is a burn figure whose sign depends on
 * which accounting package the tenant happens to use, and `financeRollup.ts` divides
 * cash by it.
 */
export interface LedgerTransaction {
  /** The provider's own id. Stable, so a re-sync updates rather than duplicates. */
  id: string;
  /** ISO date the money moved (not the date it was entered). */
  occurredAtISO: string;
  /** Positive = in, negative = out. See the note above. */
  amount: number;
  /** ISO-4217, uppercase. Never inferred from the tenant's locale. */
  currency: string;
  description: string;
  /** The other party, as the provider named them. */
  counterparty: string | null;
  /** The provider's category / chart-of-accounts name, verbatim. */
  category: string | null;
  /** Which connected account it moved through. */
  accountId: string | null;
  /** `posted` money is real; `pending` may still vanish and must not enter a rollup. */
  status: 'posted' | 'pending';
  /** True when the provider says this recurs — a committed cost, for the forecast. */
  recurring: boolean;
}

/** One receivable or payable, normalized. `direction` replaces two near-identical types. */
export interface LedgerDocument {
  id: string;
  /** `receivable` is owed TO the company, `payable` is owed BY it. */
  direction: 'receivable' | 'payable';
  reference: string;
  counterparty: string;
  /** Always POSITIVE for both directions — `direction` carries the sign, so a caller
   *  cannot accidentally net a payable against a receivable by summing a column. */
  amount: number;
  paidAmount: number;
  currency: string;
  issuedAtISO: string | null;
  dueAtISO: string | null;
  status: 'draft' | 'open' | 'part-paid' | 'paid' | 'void' | 'overdue';
  lineItems: Array<{ description: string; quantity: number; unitAmount: number; amount: number }>;
}

/** A balance a company actually holds. */
export interface LedgerBalance {
  accountId: string;
  accountName: string;
  /** `bank` and `credit` net differently into a cash position; `other` never counts. */
  accountKind: 'bank' | 'credit' | 'other';
  balance: number;
  currency: string;
  asOfISO: string;
}

/** A provider-neutral window. Both bounds inclusive. */
export interface LedgerQuery {
  fromISO: string;
  toISO: string;
  /** Provider cursor from a previous page. Opaque to every caller. */
  cursor?: string;
  limit?: number;
}

export interface LedgerPage<T> {
  items: T[];
  /** Absent when the window is fully read. */
  cursor?: string;
}

/** The interface everything above this file speaks. */
export interface AccountingProvider {
  name: AccountingProviderName;
  label: string;
  blurb: string;
  capabilities: readonly LedgerCapability[];
  /** OAuth grant, or fields the operator types (a NetSuite token pair). */
  connect: 'oauth' | 'fields';
  oauth?: OAuthProviderConfig;
  fields?: readonly { key: string; label: string; secret: boolean; required: boolean; help?: string }[];
  fetchTransactions?(credential: unknown, query: LedgerQuery): Promise<LedgerPage<LedgerTransaction>>;
  fetchDocuments?(credential: unknown, query: LedgerQuery): Promise<LedgerPage<LedgerDocument>>;
  fetchBalances?(credential: unknown): Promise<LedgerBalance[]>;
}

const PROVIDERS: Record<AccountingProviderName, AccountingProvider> = {
  quickbooks: {
    name: 'quickbooks',
    label: 'QuickBooks Online',
    blurb: 'Read expenses, invoices, bills and the chart of accounts so burn, MRR and runway compute from the books rather than from typing.',
    capabilities: ['transactions', 'invoices', 'bills', 'accounts'],
    connect: 'oauth',
  },
  xero: {
    name: 'xero',
    label: 'Xero',
    blurb: 'Read the general ledger, receivables and payables, and bank balances.',
    capabilities: ['transactions', 'invoices', 'bills', 'accounts', 'balances'],
    connect: 'oauth',
  },
  netsuite: {
    name: 'netsuite',
    label: 'NetSuite',
    blurb: 'Read the ledger and subsidiary balances for a multi-entity consolidation.',
    // Token-based rather than an OAuth redirect: NetSuite's integration record is
    // provisioned by an administrator inside the account, so the operator arrives
    // holding a key pair rather than being able to click through a consent screen.
    connect: 'fields',
    capabilities: ['transactions', 'invoices', 'bills', 'accounts', 'balances'],
    fields: [
      { key: 'accountId', label: 'Account ID', secret: false, required: true, help: 'The NetSuite account identifier, e.g. 1234567_SB1.' },
      { key: 'consumerKey', label: 'Consumer key', secret: true, required: true },
      { key: 'consumerSecret', label: 'Consumer secret', secret: true, required: true },
      { key: 'tokenId', label: 'Token ID', secret: true, required: true },
      { key: 'tokenSecret', label: 'Token secret', secret: true, required: true },
    ],
  },
  plaid: {
    name: 'plaid',
    label: 'Bank feed (Plaid)',
    // Deliberately no `invoices`/`bills`: a bank feed sees money move and never sees what
    // was agreed. Declaring capabilities it does not have is how a receivables view comes
    // to render permanently empty with nothing to explain it.
    blurb: 'Connect bank and card accounts for the real cash position behind every runway figure.',
    capabilities: ['transactions', 'balances'],
    connect: 'oauth',
  },
  'stripe-revenue': {
    name: 'stripe-revenue',
    label: 'Stripe (revenue)',
    // Distinct from the payout-port `stripe` entry, and the distinction is the point:
    // one is where money LEAVES to, this is where revenue is READ from. The catalog
    // merges them into one card with two surfaces, which is what the merge rule is for.
    blurb: 'Read charges, subscriptions and refunds so MRR and revenue are computed from what customers actually paid.',
    capabilities: ['transactions', 'invoices'],
    connect: 'oauth',
  },
};

export function accountingProvider(name: AccountingProviderName): AccountingProvider {
  return PROVIDERS[name];
}

export interface AccountingProviderDescriptor {
  name: AccountingProviderName;
  label: string;
  blurb: string;
  connect: 'oauth' | 'fields';
  capabilities: LedgerCapability[];
  fields: Array<{ key: string; label: string; secret: boolean; required: boolean; help?: string }>;
  /** True when this deployment could actually complete a connection today. */
  configured: boolean;
  /**
   * True when an adapter exists that can actually READ from this provider.
   *
   * ── WHY THIS IS DERIVED AND NOT DECLARED ────────────────────────────────────────
   * The `fetch*` members of {@link AccountingProvider} are OPTIONAL — the port shipped
   * its registry before its adapters, exactly as the payout port did — and every one of
   * the five is currently absent. `integrationCatalog.ts` nevertheless published all five
   * to the public `/integrations` page as `direction: 'import'`, so the page claimed the
   * platform reads a company's actuals out of QuickBooks, Xero, NetSuite, Plaid and
   * Stripe when no code could read one number from any of them.
   *
   * That is precisely the overclaim the catalog module was written to prevent, and it had
   * the answer one function away: `connectorDirection()` derives "two-way" from whether a
   * non-GET action EXISTS rather than from a declaration, because a claim about writing to
   * somebody's Salesforce has to come from whether a write exists. The same rule, applied
   * to reading somebody's ledger. An adapter landing turns the claim on by itself; nobody
   * has to remember to edit a page.
   */
  live: boolean;
}

/** True when this provider implements at least one real read. See `descriptor.live`. */
export function accountingProviderIsLive(provider: AccountingProvider): boolean {
  return !!(provider.fetchTransactions ?? provider.fetchDocuments ?? provider.fetchBalances);
}

/** What the public catalog and the connect UI read. Never returns a secret. */
export function describeAccountingProviders(env: Record<string, unknown>): AccountingProviderDescriptor[] {
  return ACCOUNTING_PROVIDER_NAMES.map((name) => {
    const provider = PROVIDERS[name];
    return {
      name,
      label: provider.label,
      blurb: provider.blurb,
      connect: provider.connect,
      capabilities: [...provider.capabilities],
      fields: [...(provider.fields ?? [])],
      configured: provider.connect === 'fields' || (provider.oauth != null && isProviderOAuthConfigured(env, provider.oauth)),
      live: accountingProviderIsLive(provider),
    };
  });
}

/**
 * Which providers can answer a given question.
 *
 * The reason a caller needs this rather than trying and failing: "show me who owes us"
 * has to be able to say "the bank feed you connected cannot answer that, connect
 * QuickBooks or Xero" instead of rendering an empty table.
 */
export function providersWithCapability(capability: LedgerCapability): AccountingProviderName[] {
  return ACCOUNTING_PROVIDER_NAMES.filter((name) => PROVIDERS[name].capabilities.includes(capability));
}

/**
 * Fold normalized transactions into the monthly aggregates `financeRollup` publishes.
 *
 * Lives here, next to the sign convention it depends on, rather than in each adapter —
 * a per-adapter fold is how one vendor's refunds come to be counted as revenue.
 * `pending` rows are excluded: money that may still vanish must never move a runway.
 */
export function foldTransactionsToMonths(transactions: readonly LedgerTransaction[]): Array<{
  month: string;
  currency: string;
  inflow: number;
  outflow: number;
  net: number;
}> {
  const buckets = new Map<string, { month: string; currency: string; inflow: number; outflow: number }>();
  for (const transaction of transactions) {
    if (transaction.status !== 'posted') continue;
    if (!Number.isFinite(transaction.amount)) continue;
    const month = transaction.occurredAtISO.slice(0, 7);
    const key = `${month}:${transaction.currency}`;
    const bucket = buckets.get(key) ?? { month, currency: transaction.currency, inflow: 0, outflow: 0 };
    if (transaction.amount >= 0) bucket.inflow += transaction.amount;
    else bucket.outflow += -transaction.amount;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map((bucket) => ({ ...bucket, net: bucket.inflow - bucket.outflow }))
    .sort((a, b) => (a.month === b.month ? a.currency.localeCompare(b.currency) : a.month.localeCompare(b.month)));
}
