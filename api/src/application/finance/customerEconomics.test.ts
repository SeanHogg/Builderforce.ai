import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { loadCustomerEconomics } from './customerEconomics';

/** A db whose every query resolves to no rows — nothing declared. */
function emptyDb(): Db {
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve([]);
      return () => self;
    },
  });
  return self as unknown as Db;
}

/** A db that answers every query with one row carrying the given declared target. */
function constDb(value: number): Db {
  const row = { target: value };
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve([row]);
      return () => self;
    },
  });
  return self as unknown as Db;
}

describe('loadCustomerEconomics', () => {
  it('returns no rows — never a zero tranche — when nothing is declared', async () => {
    expect(await loadCustomerEconomics(emptyDb(), 1)).toEqual([]);
  });

  it('returns one declared blended row when the founder has declared economics', async () => {
    const rows = await loadCustomerEconomics(constDb(80), 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'declared',
      arpa: 80,
      marginPct: 80,
      churnPct: 80,
      cac: 80,
      declared: true,
    });
  });
});
