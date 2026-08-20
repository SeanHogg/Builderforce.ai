/**
 * What the sync WRITES, and where.
 *
 * Three things are worth failing a build over:
 *
 *   1. The normalised row is idempotent on the provider's stable id, so a re-sync
 *      converges instead of growing a second copy of a month's burn.
 *   2. A synced row is structurally distinguishable from a typed one — the whole
 *      point of the item — and cannot reach a platform credit balance.
 *   3. A removal is replayed. A removal that is dropped leaves a ghost expense in
 *      the burn, permanently, and it looks exactly like every other synced row.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import {
  EXTERNAL_ACCOUNT_KIND,
  EXTERNAL_CREDIT,
  EXTERNAL_DEBIT,
  LEDGER_BACKFILL_MONTHS,
  LEDGER_RESTATEMENT_DAYS,
  denominationFor,
  ledgerReference,
  ledgerWindow,
  removeLedgerTransactions,
  writeLedgerBalances,
  writeLedgerTransactions,
} from './ledgerSync';
import type { LedgerBalance, LedgerTransaction } from './accountingProviders';

/** Minimal Drizzle chain stub. Records every value and conflict target it is given
 *  so the assertions can be about the ROW rather than about a mock's call count. */
function stubDb() {
  const inserts: Array<{ values: Record<string, unknown>; set: Record<string, unknown> }> = [];
  const updates: unknown[] = [];
  const deletes: unknown[] = [];
  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
          inserts.push({ values, set });
          return Promise.resolve();
        },
      }),
    }),
    update: () => ({ set: (v: unknown) => ({ where: () => { updates.push(v); return Promise.resolve(); } }) }),
    delete: () => ({
      where: (condition: unknown) => ({
        returning: () => { deletes.push(condition); return Promise.resolve([{ id: 1 }, { id: 2 }]); },
      }),
    }),
  } as unknown as Db;
  return { db, inserts, updates, deletes };
}

const transaction = (over: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  id: 'Purchase:184',
  occurredAtISO: '2026-07-14T00:00:00.000Z',
  amount: -250,
  currency: 'USD',
  description: 'Office rent',
  counterparty: 'Northside Property',
  category: 'Rent',
  accountId: 'acc-1',
  status: 'posted',
  recurring: false,
  ...over,
});

const NOW = new Date('2026-08-19T12:00:00.000Z');

describe('the shape of a synced row', () => {
  it('marks provenance structurally, where no other writer can produce it', async () => {
    const { db, inserts } = stubDb();
    await writeLedgerTransactions(db, 7, 3, 'quickbooks', 'full', [transaction()], NOW);
    const row = inserts[0]!.values;
    // The platform's own writers use 'tenant' | 'user' | 'partner' | 'seller' |
    // 'agent'. A bank debit therefore cannot reach anybody's credit balance, and
    // "which of these did a person type?" is one predicate rather than an audit.
    expect(row.accountKind).toBe(EXTERNAL_ACCOUNT_KIND);
    expect(row.tenantId).toBe(7);
  });

  it('stores money in CENTS with the sign the port promised', async () => {
    const { db, inserts } = stubDb();
    await writeLedgerTransactions(db, 1, 1, 'xero', 'full', [
      transaction({ amount: -250 }),
      transaction({ id: 'b', amount: 900 }),
    ], NOW);
    expect(inserts.map((i) => [i.values.amount, i.values.entryKind]))
      .toEqual([['-25000', EXTERNAL_DEBIT], ['90000', EXTERNAL_CREDIT]]);
  });

  it('leaves balance_after NULL rather than inventing a running total', async () => {
    const { db, inserts } = stubDb();
    await writeLedgerTransactions(db, 1, 1, 'plaid', 'full', [transaction()], NOW);
    // The feed never saw the opening balance, so any running total here would be a
    // sum from an unknown starting point — a number that looks precise and is not.
    expect(inserts[0]!.values.balanceAfter).toBeNull();
  });

  it('carries the provider status so the rollup can exclude pending money', async () => {
    const { db, inserts } = stubDb();
    await writeLedgerTransactions(db, 1, 1, 'plaid', 'full', [transaction({ status: 'pending' })], NOW);
    const metadata = inserts[0]!.values.metadata as Record<string, unknown>;
    // The row IS written — when the hold posts, the upsert corrects it in place —
    // but a runway must never move on money that can still vanish.
    expect(metadata.txStatus).toBe('pending');
  });

  it('stamps the coverage the rollup reads to decide whether typed rows are superseded', async () => {
    const { db, inserts } = stubDb();
    await writeLedgerTransactions(db, 1, 1, 'quickbooks', 'full', [transaction()], NOW);
    await writeLedgerTransactions(db, 1, 2, 'stripe-revenue', 'revenue', [transaction({ id: 's' })], NOW);
    const coverage = inserts.map((i) => (i.values.metadata as Record<string, unknown>).ledgerCoverage);
    // A full ledger supersedes typed expenses for its months; a revenue feed does
    // NOT, or connecting Stripe would make a company's rent disappear from burn.
    expect(coverage).toEqual(['full', 'revenue']);
  });

  it('keeps a euro book out of a dollar total instead of inventing an FX rate', async () => {
    const { db, inserts } = stubDb();
    await writeLedgerTransactions(db, 1, 1, 'xero', 'full', [transaction({ currency: 'EUR' })], NOW);
    expect(inserts[0]!.values.denomination).toBe('eur_cents');
    // `financeRollup` filters `usd_cents`, so the row is stored faithfully and
    // simply not summed — a rate baked into a stored row is wrong the next day.
    expect(denominationFor('USD')).toBe('usd_cents');
  });

  it('drops a row with no id or a non-finite amount rather than poisoning a total', async () => {
    const { db, inserts } = stubDb();
    await writeLedgerTransactions(db, 1, 1, 'xero', 'full', [
      transaction({ id: '' }),
      transaction({ id: 'b', amount: Number.NaN }),
    ], NOW);
    expect(inserts).toHaveLength(0);
  });
});

describe('idempotency', () => {
  it('keys on the provider id, so a re-sync converges instead of duplicating', () => {
    expect(ledgerReference('quickbooks', 'Purchase:184')).toBe('quickbooks:Purchase:184');
    // `uq_ledger_entries_reference` is (tenant, denomination, reference), so the
    // same transaction read twice lands on the same row.
    expect(ledgerReference('plaid', 'x')).not.toBe(ledgerReference('xero', 'x'));
  });

  it('truncates a very long provider id to the column width rather than failing the write', () => {
    expect(ledgerReference('netsuite', 'x'.repeat(400))).toHaveLength(160);
  });

  it('UPDATES a restated transaction instead of leaving the first reading in place', async () => {
    const { db, inserts } = stubDb();
    await writeLedgerTransactions(db, 1, 1, 'quickbooks', 'full', [transaction({ amount: -250 })], NOW);
    // A recategorised expense, a pending charge that posted, a corrected amount —
    // `doNothing` would freeze the most incomplete reading forever, which is the
    // exact failure the restatement window exists to avoid.
    expect(inserts[0]!.set.amount).toBe('-25000');
    expect(inserts[0]!.set.memo).toBe('Office rent');
  });

  it('stamps the connection as synced — the only thing separating live from typed on screen', async () => {
    const { db, updates } = stubDb();
    await writeLedgerTransactions(db, 1, 1, 'xero', 'full', [transaction()], NOW);
    expect(updates[0]).toMatchObject({ lastSyncedAt: NOW });
  });

  it('does not stamp a sync that wrote nothing', async () => {
    const { db, updates } = stubDb();
    await writeLedgerTransactions(db, 1, 1, 'xero', 'full', [], NOW);
    expect(updates).toHaveLength(0);
  });
});

describe('removals', () => {
  it('deletes by the provider reference — a ghost expense is permanent burn', async () => {
    const { db, deletes } = stubDb();
    const removed = await removeLedgerTransactions(db, 1, 'plaid', ['gone-1', 'gone-2']);
    expect(deletes).toHaveLength(1);
    expect(removed).toBe(2);
  });

  it('does not issue a delete at all for an empty removal list', async () => {
    const { db, deletes } = stubDb();
    expect(await removeLedgerTransactions(db, 1, 'plaid', [])).toBe(0);
    expect(await removeLedgerTransactions(db, 1, 'plaid', [''])).toBe(0);
    expect(deletes).toHaveLength(0);
  });
});

describe('balances', () => {
  const balance = (over: Partial<LedgerBalance> = {}): LedgerBalance => ({
    accountId: 'acc-1',
    accountName: 'Business Current',
    accountKind: 'bank',
    balance: 51_204.18,
    currency: 'USD',
    asOfISO: '2026-08-19T00:00:00.000Z',
    ...over,
  });

  it('upserts one row per account so a re-sync corrects rather than doubles the cash', async () => {
    const { db, inserts } = stubDb();
    const written = await writeLedgerBalances(db, 1, 3, 'plaid', [balance()], NOW);
    expect(written).toBe(1);
    expect(inserts[0]!.values).toMatchObject({ tenantId: 1, connectionId: 3, externalId: 'acc-1', balance: '51204.18' });
    expect(inserts[0]!.set).toMatchObject({ balance: '51204.18' });
  });

  it('stores the adapter\'s already-negated credit balance verbatim', async () => {
    const { db, inserts } = stubDb();
    // The negation belongs to the adapter — it is the vendor's convention being
    // absorbed — so a second one here would turn a debt back into an asset.
    await writeLedgerBalances(db, 1, 3, 'plaid', [balance({ accountKind: 'credit', balance: -10_000 })], NOW);
    expect(inserts[0]!.values.balance).toBe('-10000');
  });

  it('skips an account the provider could not name', async () => {
    const { db, inserts } = stubDb();
    expect(await writeLedgerBalances(db, 1, 3, 'xero', [balance({ accountId: '' })], NOW)).toBe(0);
    expect(inserts).toHaveLength(0);
  });
});

describe('the window each sweep asks for', () => {
  it('backfills the whole charted history on a first sync', () => {
    const window = ledgerWindow(NOW, false);
    // The rollup recomputes 18 months, so a newly connected book fills the series
    // the seat charts rather than starting a runway from today.
    const months = (Date.parse(window.toISO) - Date.parse(window.fromISO)) / (30 * 86_400_000);
    expect(months).toBeGreaterThan(LEDGER_BACKFILL_MONTHS - 2);
    expect(window.toISO).toBe(NOW.toISOString());
  });

  it('re-reads only the restatement window afterwards', () => {
    const window = ledgerWindow(NOW, true);
    const days = (Date.parse(window.toISO) - Date.parse(window.fromISO)) / 86_400_000;
    expect(Math.round(days)).toBe(LEDGER_RESTATEMENT_DAYS);
  });
});

describe('the sweep is discoverable from the connections, not from a tenant list', () => {
  it('exports a sweep the cron registry can call with (env, db)', async () => {
    const module = await import('./ledgerSync');
    expect(typeof module.runLedgerSyncSweep).toBe('function');
    // A workspace with no connected book is not work, and iterating every tenant to
    // discover that would be the expensive half of the sweep on a Neon-Free budget.
    const db = {
      selectDistinct: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    } as unknown as Db;
    const result = await module.runLedgerSyncSweep({} as never, db, NOW);
    expect(result).toEqual({ tenants: 0, connections: 0, written: 0, removed: 0, failed: 0 });
  });
});

vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
