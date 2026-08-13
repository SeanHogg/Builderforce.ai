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
  accountingProvider,
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
    expect(folded[0].outflow).toBe(100);
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
