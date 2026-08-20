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
 * vendor HTTP client — all five `fetch` halves live in `accountingAdapters.ts` and are
 * spread onto the entries below, so this file stays the one place the CONTRACT is
 * stated and no vendor's quirk can leak into it. What matters for correctness is that
 * the contract is one shape, decided here, rather than three adapters each inventing one.
 *
 * ── WHAT IS STILL OPEN ──────────────────────────────────────────────────────────
 * The adapters are written against the vendors' documented REST APIs and checked
 * against recorded payloads. No sandbox credential for QuickBooks, Xero, NetSuite,
 * Plaid or Stripe exists in this environment, so no sign convention here has been
 * confirmed against a real book. That is the one remaining unknown, and it is a
 * VERIFICATION gap rather than a missing feature.
 */

import { isProviderOAuthConfigured, type OAuthProviderConfig } from '../shared/providerOAuthConnect';
import { ACCOUNTING_ADAPTERS, type AccountingAdapter } from './accountingAdapters';

export type { AccountingAdapter, AccountingCredential } from './accountingAdapters';
export { AccountingProviderError } from './accountingAdapters';

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
  /** Absent when the window is fully read. Present means "call again with this". */
  cursor?: string;
  /**
   * The cursor to PERSIST for the next sync, which is not the same thing as
   * {@link cursor}.
   *
   * A windowed provider (QuickBooks, Xero, NetSuite, Stripe) has no state to keep:
   * the next sweep asks for a date range and gets the same answer. A CURSOR-based
   * one (Plaid) does — its final cursor is where tomorrow starts, and a caller that
   * only stored a cursor while there was more data would re-read the account's
   * entire history every single night.
   */
  checkpoint?: string;
  /**
   * Provider ids whose rows must be DELETED.
   *
   * Plaid removes a transaction when the bank reverses or de-duplicates one, and a
   * caller that reads the additions and ignores the removals leaves a GHOST in the
   * ledger: an expense the bank says never happened, permanently in the burn,
   * permanently lowering the runway, and indistinguishable from every other synced
   * row. So a removal is a first-class part of a page rather than a second call
   * somebody has to remember to make.
   */
  removedIds?: string[];
}

/** The interface everything above this file speaks. */
export interface AccountingProvider extends AccountingAdapter {
  name: AccountingProviderName;
  label: string;
  blurb: string;
  capabilities: readonly LedgerCapability[];
  /** OAuth grant, or fields the operator types (a NetSuite token pair). */
  connect: 'oauth' | 'fields';
  oauth?: OAuthProviderConfig;
  fields?: readonly { key: string; label: string; secret: boolean; required: boolean; help?: string }[];
  /**
   * Whether this provider sees EVERYTHING that leaves the company's accounts.
   *
   * ── WHY THIS IS DECLARED AND WHY IT IS NOT A CAPABILITY ────────────────────────
   * `capabilities` answers "can you tell me about transactions?". This answers a
   * different question — "if you say nothing left in July, did nothing leave?" —
   * and only a bank feed or a full accounting ledger can. Stripe declares
   * `transactions` and sees only what came through Stripe.
   *
   * It exists because of one specific way the burn figure could go wrong. A founder
   * who has been typing expenses connects QuickBooks; QuickBooks reports the same
   * money; the rollup adds both and the burn DOUBLES. So a month covered by a
   * provider that sees everything supersedes the typed rows for that month, and a
   * month covered only by Stripe does not — because suppressing hand-typed rent on
   * the strength of a revenue feed would make the burn collapse instead.
   */
  coversAllSpend: boolean;
}

const PROVIDERS: Record<AccountingProviderName, AccountingProvider> = {
  quickbooks: {
    ...ACCOUNTING_ADAPTERS.quickbooks,
    name: 'quickbooks',
    label: 'QuickBooks Online',
    blurb: 'Read expenses, invoices, bills and the chart of accounts so burn, MRR and runway compute from the books rather than from typing.',
    // `balances` joined the list when the adapter landed, and it belongs there:
    // QuickBooks' `Account` entity carries `CurrentBalance`, so the chart of
    // accounts and the balance on each node arrive from the same read. Declaring
    // `accounts` without it would have left the cash half of a runway unanswerable
    // by the provider that had the number.
    capabilities: ['transactions', 'invoices', 'bills', 'accounts', 'balances'],
    connect: 'oauth',
    // The accounting scope, and NOTHING else. Intuit issues payment scopes from the
    // same consent screen; a ledger port that asked for one would be holding the
    // right to move a customer's money in order to read a number.
    oauth: {
      authUrl: 'https://appcenter.intuit.com/connect/oauth2',
      tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      scopes: ['com.intuit.quickbooks.accounting'],
      clientIdKey: 'QUICKBOOKS_CLIENT_ID',
      clientSecretKey: 'QUICKBOOKS_CLIENT_SECRET',
    },
    coversAllSpend: true,
  },
  xero: {
    ...ACCOUNTING_ADAPTERS.xero,
    name: 'xero',
    label: 'Xero',
    blurb: 'Read the general ledger, receivables and payables, and bank balances.',
    capabilities: ['transactions', 'invoices', 'bills', 'accounts', 'balances'],
    connect: 'oauth',
    oauth: {
      authUrl: 'https://login.xero.com/identity/connect/authorize',
      tokenUrl: 'https://identity.xero.com/connect/token',
      // Every scope is a `.read`. `offline_access` is the one that is not optional:
      // without it Xero issues no refresh token and the connection dies in 30
      // minutes, which presents as "the sync worked once and then stopped".
      scopes: [
        'offline_access',
        'accounting.transactions.read',
        'accounting.reports.read',
        'accounting.settings.read',
        'accounting.contacts.read',
      ],
      clientIdKey: 'XERO_CLIENT_ID',
      clientSecretKey: 'XERO_CLIENT_SECRET',
    },
    coversAllSpend: true,
  },
  netsuite: {
    ...ACCOUNTING_ADAPTERS.netsuite,
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
    coversAllSpend: true,
  },
  plaid: {
    ...ACCOUNTING_ADAPTERS.plaid,
    name: 'plaid',
    label: 'Bank feed (Plaid)',
    // Deliberately no `invoices`/`bills`: a bank feed sees money move and never sees what
    // was agreed. Declaring capabilities it does not have is how a receivables view comes
    // to render permanently empty with nothing to explain it.
    blurb: 'Connect bank and card accounts for the real cash position behind every runway figure.',
    capabilities: ['transactions', 'balances'],
    connect: 'oauth',
    // Plaid's grant does NOT arrive as an authorization code. Link hands back a
    // `public_token` which is traded for an `access_token` at the endpoint named
    // below — a different request body from the OAuth exchange, which is why
    // `ledgerConnections.ts` has one documented branch for it and stores the result
    // in the same vault as the other four. The config is declared anyway because
    // `configured` derives from it: a deployment with no PLAID_CLIENT_ID must not
    // advertise a bank feed it cannot open.
    oauth: {
      authUrl: 'https://link.plaid.com/oauth',
      tokenUrl: 'https://production.plaid.com/item/public_token/exchange',
      scopes: ['transactions'],
      clientIdKey: 'PLAID_CLIENT_ID',
      clientSecretKey: 'PLAID_SECRET',
    },
    coversAllSpend: true,
  },
  'stripe-revenue': {
    ...ACCOUNTING_ADAPTERS['stripe-revenue'],
    name: 'stripe-revenue',
    label: 'Stripe (revenue)',
    // Distinct from the payout-port `stripe` entry, and the distinction is the point:
    // one is where money LEAVES to, this is where revenue is READ from. The catalog
    // merges them into one card with two surfaces, which is what the merge rule is for.
    blurb: 'Read charges, subscriptions and refunds so MRR and revenue are computed from what customers actually paid.',
    capabilities: ['transactions', 'invoices'],
    connect: 'oauth',
    // `read_only`, and that is the difference between this entry and the payout
    // port's `stripe`, which asks for `read_write` because it has to transfer.
    // Reading revenue never needs the right to move money, and holding it anyway
    // is how a credential with one job becomes a credential with two.
    oauth: {
      authUrl: 'https://connect.stripe.com/oauth/authorize',
      tokenUrl: 'https://connect.stripe.com/oauth/token',
      scopes: ['read_only'],
      clientIdKey: 'STRIPE_CONNECT_CLIENT_ID',
      clientSecretKey: 'STRIPE_SECRET_KEY',
      extraAuthParams: { stripe_landing: 'login' },
    },
    // Stripe sees what came through Stripe and nothing else. A company's rent,
    // payroll and cloud bill are invisible to it, so a month it "covers" must NOT
    // supersede the typed rows — see `coversAllSpend` for what that would do.
    coversAllSpend: false,
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
  /** See {@link AccountingProvider.coversAllSpend}. Surfaced so the connect UI can
   *  say WHY connecting Stripe alone will not make a burn figure live. */
  coversAllSpend: boolean;
  /**
   * True when an adapter exists that can actually READ from this provider.
   *
   * ── WHY THIS IS DERIVED AND NOT DECLARED ────────────────────────────────────────
   * The `fetch*` members of {@link AccountingProvider} are OPTIONAL, and for a period
   * every one of the five was absent while `integrationCatalog.ts` published all five
   * to the public `/integrations` page as `direction: 'import'` — so the page claimed
   * the platform read a company's actuals out of QuickBooks, Xero, NetSuite, Plaid and
   * Stripe when no code could read one number from any of them.
   *
   * That is precisely the overclaim the catalog module was written to prevent, and it had
   * the answer one function away: `connectorDirection()` derives "two-way" from whether a
   * non-GET action EXISTS rather than from a declaration, because a claim about writing to
   * somebody's Salesforce has to come from whether a write exists. The same rule, applied
   * to reading somebody's ledger. The adapters have since landed, and the claim turned
   * itself on: nobody had to remember to edit a page, and nobody could have turned it on
   * early either.
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
      coversAllSpend: provider.coversAllSpend,
      live: accountingProviderIsLive(provider),
    };
  });
}

/**
 * The read a capability is a promise about.
 *
 * The two lists are declared separately — `capabilities` in the registry, the
 * `fetch*` members on the adapter — and this is what binds them. A provider that
 * declares `balances` and implements no `fetchBalances` is not a smaller feature, it
 * is a tab that renders permanently empty with nothing to explain it, so the port's
 * own test walks every provider through this map and fails on the mismatch.
 */
export const CAPABILITY_READS: Record<LedgerCapability, keyof AccountingAdapter> = {
  transactions: 'fetchTransactions',
  invoices: 'fetchDocuments',
  bills: 'fetchDocuments',
  // A chart of accounts and a balance both arrive from the balances read: the
  // account is the row, the balance is the column on it.
  accounts: 'fetchBalances',
  balances: 'fetchBalances',
};

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
