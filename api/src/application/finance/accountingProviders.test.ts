/**
 * The ledger port's contract.
 *
 * The assertions that matter are about the SIGN CONVENTION and the CAPABILITY
 * DECLARATION: an adapter that leaks its vendor's sign puts a negative burn on a
 * founder's board and the rollup divides by it, and a provider that claims a capability
 * it lacks renders a permanently empty receivables tab with nothing to explain it.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNTING_PROVIDER_NAMES,
  CAPABILITY_READS,
  accountingProvider,
  accountingProviderIsLive,
  describeAccountingProviders,
  foldTransactionsToMonths,
  isAccountingProviderName,
  providersWithCapability,
  type LedgerTransaction,
} from './accountingProviders';

const transaction = (over: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id: 't1', occurredAtISO: '2026-07-14T00:00:00.000Z', amount: 100, currency: 'USD',
  description: 'x', counterparty: null, category: null, accountId: null, status: 'posted', recurring: false,
  ...over,
});

describe('the registry', () => {
  it('recognises its own names and nothing else', () => {
    expect(isAccountingProviderName('xero')).toBe(true);
    expect(isAccountingProviderName('stripe')).toBe(false);
    expect(isAccountingProviderName(42)).toBe(false);
  });

  it('describes every provider without ever returning a secret value', () => {
    const described = describeAccountingProviders({});
    expect(described).toHaveLength(ACCOUNTING_PROVIDER_NAMES.length);
    for (const provider of described) {
      for (const field of provider.fields) {
        // The DECLARATION of a secret field is fine; a value would not be.
        expect(Object.keys(field)).not.toContain('value');
      }
    }
  });

  it('does not claim a bank feed can answer a receivables question', () => {
    // The whole point of declaring capabilities: a bank feed sees money move and never
    // sees what was agreed, so "who owes us" must be answered by naming a provider that
    // can rather than by rendering an empty table.
    expect(accountingProvider('plaid').capabilities).not.toContain('invoices');
    expect(providersWithCapability('invoices')).toEqual(['quickbooks', 'xero', 'netsuite', 'stripe-revenue']);
    expect(providersWithCapability('balances')).toContain('plaid');
  });

  it('implements the read behind every capability it declares', () => {
    // The two lists are declared separately — `capabilities` on the registry entry,
    // the `fetch*` members on the adapter — so this is what binds them. A provider
    // claiming `balances` with no `fetchBalances` is not a smaller feature; it is a
    // tab that renders permanently empty with nothing to explain it.
    for (const name of ACCOUNTING_PROVIDER_NAMES) {
      const provider = accountingProvider(name);
      for (const capability of provider.capabilities) {
        expect(provider[CAPABILITY_READS[capability]], `${name} declares ${capability}`).toBeTypeOf('function');
      }
    }
  });

  it('reports every provider LIVE, because every adapter now exists', () => {
    // `live` is DERIVED from whether a read exists rather than declared, so this
    // assertion is the honest one: it would have failed while the registry shipped
    // ahead of its adapters, and it fails again the moment one is removed.
    for (const name of ACCOUNTING_PROVIDER_NAMES) {
      expect(accountingProviderIsLive(accountingProvider(name)), name).toBe(true);
    }
    expect(describeAccountingProviders({}).every((provider) => provider.live)).toBe(true);
  });

  it('says which providers see EVERYTHING that leaves, and Stripe is not one', () => {
    // The flag that stops a founder's burn DOUBLING when they connect QuickBooks
    // beside six months of typed expenses — and stops it COLLAPSING when they
    // connect a revenue feed that never saw their rent.
    const covering = ACCOUNTING_PROVIDER_NAMES.filter((name) => accountingProvider(name).coversAllSpend);
    expect(covering).toEqual(['quickbooks', 'xero', 'netsuite', 'plaid']);
    expect(accountingProvider('stripe-revenue').coversAllSpend).toBe(false);
  });

  it('asks Stripe for read_only, unlike the payout port asking the same vendor', () => {
    // Reading revenue never needs the right to move money. Holding it anyway is how
    // a credential with one job becomes a credential with two.
    expect(accountingProvider('stripe-revenue').oauth?.scopes).toEqual(['read_only']);
    // Xero without `offline_access` issues no refresh token and the connection dies
    // in 30 minutes — which presents as "it synced once and then stopped".
    expect(accountingProvider('xero').oauth?.scopes).toContain('offline_access');
    // Intuit issues payment scopes from the same consent screen. This port takes
    // the accounting scope and nothing else.
    expect(accountingProvider('quickbooks').oauth?.scopes).toEqual(['com.intuit.quickbooks.accounting']);
  });

  it('advertises an OAuth provider only where this deployment holds both halves', () => {
    const withKeys = describeAccountingProviders({
      QUICKBOOKS_CLIENT_ID: 'id', QUICKBOOKS_CLIENT_SECRET: 'secret',
      XERO_CLIENT_ID: 'id',
    });
    const byName = new Map(withKeys.map((provider) => [provider.name, provider]));
    expect(byName.get('quickbooks')?.configured).toBe(true);
    // Half a client is not a configured provider: it sends somebody to a consent
    // screen that cannot complete.
    expect(byName.get('xero')?.configured).toBe(false);
    // A `fields` provider needs nothing from the deployment — the operator supplies
    // the whole credential — so it is connectable on every install.
    expect(byName.get('netsuite')?.configured).toBe(true);
  });

  it('connects NetSuite by typed fields rather than a redirect', () => {
    // Its integration record is provisioned by an admin inside the account, so the
    // operator arrives holding a key pair with no consent screen to click through.
    const netsuite = describeAccountingProviders({}).find((provider) => provider.name === 'netsuite');
    expect(netsuite?.connect).toBe('fields');
    expect(netsuite?.fields.filter((field) => field.secret).length).toBe(4);
    expect(netsuite?.configured).toBe(true);
  });
});

describe('foldTransactionsToMonths', () => {
  it('splits the one signed amount into inflow and outflow', () => {
    const folded = foldTransactionsToMonths([
      transaction({ amount: 1_000 }),
      transaction({ id: 't2', amount: -400 }),
    ]);
    expect(folded).toEqual([{ month: '2026-07', currency: 'USD', inflow: 1_000, outflow: 400, net: 600 }]);
  });

  it('never counts pending money — it may still vanish, and a runway must not move on it', () => {
    const folded = foldTransactionsToMonths([
      transaction({ amount: -500, status: 'pending' }),
      transaction({ id: 't2', amount: -100 }),
    ]);
    expect(folded).toEqual([{ month: '2026-07', currency: 'USD', inflow: 0, outflow: 100, net: -100 }]);
  });

  it('keeps currencies apart rather than adding a euro to a dollar', () => {
    const folded = foldTransactionsToMonths([
      transaction({ amount: 100 }),
      transaction({ id: 't2', amount: 90, currency: 'EUR' }),
    ]);
    expect(folded).toHaveLength(2);
    expect(folded.map((bucket) => bucket.currency)).toEqual(['EUR', 'USD']);
  });

  it('buckets by month and sorts chronologically', () => {
    const folded = foldTransactionsToMonths([
      transaction({ occurredAtISO: '2026-09-02T00:00:00.000Z' }),
      transaction({ id: 't2', occurredAtISO: '2026-08-31T00:00:00.000Z' }),
    ]);
    expect(folded.map((bucket) => bucket.month)).toEqual(['2026-08', '2026-09']);
  });

  it('drops a non-finite amount instead of poisoning the total with NaN', () => {
    expect(foldTransactionsToMonths([transaction({ amount: Number.NaN })])).toEqual([]);
  });
});
