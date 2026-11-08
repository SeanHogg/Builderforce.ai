/**
 * The account ledger: an idempotent insert keyed on `reference`, a cached SUM, and a cache
 * invalidation only when a row was really written. The database is doubled.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  getOrSetCached: async (_env: unknown, _key: string, load: () => Promise<unknown>) => load(),
  invalidateCached: vi.fn(async () => undefined),
}));

import { accountLedger } from './accountLedger';
import { boardAccount } from './ledgerAccount';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';

const env = {} as Env;
const ledger = accountLedger('points', 'test-points');
const account = boardAccount('board-1');
const movement = { tenantId: 7, amount: 3, reference: 'ref-1', memo: 'm', metadata: { a: 1 } };

describe('accountLedger.credit / debit', () => {
  beforeEach(() => vi.mocked(invalidateCached).mockClear());

  it('credits a grant row for the account and invalidates the balance key', async () => {
    const db = fakeDb([[{ id: 1 }]]);
    expect(await ledger.credit(db as unknown as Db, env, account, movement)).toBe(true);
    expect(db.calls[0]!.payload).toMatchObject({
      tenantId: 7, accountKind: 'board', accountRef: 'board-1', denomination: 'points',
      entryKind: 'grant', amount: '3', reference: 'ref-1',
    });
    expect(invalidateCached).toHaveBeenCalledWith(env, 'test-points:balance:7:board:board-1');
  });

  it('is idempotent: a conflicting reference inserts nothing, returns false and invalidates nothing', async () => {
    const db = fakeDb([[]]);
    expect(await ledger.credit(db as unknown as Db, env, account, movement)).toBe(false);
    expect(invalidateCached).not.toHaveBeenCalled();
  });

  it('debits as a negative spend row', async () => {
    const db = fakeDb([[{ id: 2 }]]);
    expect(await ledger.debit(db as unknown as Db, env, account, movement)).toBe(true);
    expect(db.calls[0]!.payload).toMatchObject({ entryKind: 'spend', amount: '-3' });
  });

  it('rounds a fractional amount UP and refuses a zero or negative one without touching the database', async () => {
    const db = fakeDb([[{ id: 3 }]]);
    await ledger.credit(db as unknown as Db, env, account, { ...movement, amount: 2.1 });
    expect(db.calls[0]!.payload).toMatchObject({ amount: '3' });
    const none = fakeDb();
    expect(await ledger.credit(none as unknown as Db, env, account, { ...movement, amount: 0 })).toBe(false);
    expect(await ledger.debit(none as unknown as Db, env, account, { ...movement, amount: -1 })).toBe(false);
    expect(none.calls).toHaveLength(0);
  });

  it('honours a custom cache key function', async () => {
    const custom = accountLedger('points', 'x', (tenantId) => `legacy:${tenantId}`);
    const db = fakeDb([[{ id: 1 }]]);
    await custom.credit(db as unknown as Db, env, account, movement);
    expect(invalidateCached).toHaveBeenCalledWith(env, 'legacy:7');
  });
});

describe('accountLedger.balance / statement', () => {
  it('reads the rounded SUM, treating no rows as zero', async () => {
    expect(await ledger.balance(fakeDb([[{ total: '12.4000' }]]) as unknown as Db, env, 7, account)).toBe(12);
    expect(await ledger.balance(fakeDb([[]]) as unknown as Db, env, 7, account)).toBe(0);
  });

  it('maps statement rows newest-first with numeric ids and ISO timestamps, clamping the limit', async () => {
    const db = fakeDb([[
      { id: '5', amount: '3.000000', entryKind: 'grant', memo: 'a', occurredAt: new Date('2026-11-02T00:00:00Z') },
      { id: 4, amount: '-1', entryKind: 'spend', memo: null, occurredAt: '2026-11-01T00:00:00Z' },
    ]]);
    const rows = await ledger.statement(db as unknown as Db, 7, account, 9999);
    expect(rows).toEqual([
      { id: 5, amount: 3, kind: 'grant', memo: 'a', occurredAt: '2026-11-02T00:00:00.000Z' },
      { id: 4, amount: -1, kind: 'spend', memo: null, occurredAt: '2026-11-01T00:00:00.000Z' },
    ]);
    expect(db.calls[0]!.chain).toEqual(expect.arrayContaining(['orderBy', 'limit']));
  });
});
