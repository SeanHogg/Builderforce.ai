/**
 * Joins, and the two facts that decide whether one is trustworthy: how many
 * rows found no partner, and whether the join multiplied the row count.
 */
import { describe, expect, it } from 'vitest';
import { joinTabular, normalizeJoinSpec, suggestJoinKeys } from './canvasTabularJoin';
import type { TabularSource } from './canvasTabularData';

const CUSTOMERS: TabularSource = {
  columns: ['customer_id', 'name', 'region'],
  rows: [
    { customer_id: 'c1', name: 'Acme', region: 'EU' },
    { customer_id: 'c2', name: 'Globex', region: 'US' },
    { customer_id: 'c3', name: 'Initech', region: 'US' },
  ],
};

const TICKETS: TabularSource = {
  columns: ['id', 'customer_id', 'name', 'severity'],
  rows: [
    { id: 't1', customer_id: 'c1', name: 'Login broken', severity: 'high' },
    { id: 't2', customer_id: 'c1', name: 'Slow export', severity: 'low' },
    { id: 't3', customer_id: 'c9', name: 'Orphan', severity: 'low' },
  ],
};

describe('joinTabular', () => {
  it('joins on a shared key and reports what did not match', () => {
    const result = joinTabular(CUSTOMERS, TICKETS, { on: [{ left: 'customer_id', right: 'customer_id' }] });
    expect(result.rowCount).toBe(2);
    expect(result.matchedLeft).toBe(1);
    expect(result.unmatchedLeft).toBe(2);
    expect(result.unmatchedRight).toBe(1);
  });

  it('renames colliding right-hand columns instead of dropping them', () => {
    const result = joinTabular(CUSTOMERS, TICKETS, { on: [{ left: 'customer_id', right: 'customer_id' }] });
    expect(result.collisions).toEqual(['name']);
    expect(result.columns).toContain('name');
    expect(result.columns).toContain('right.name');
    expect(result.rows[0]!.name).toBe('Acme');
    expect(result.rows[0]!['right.name']).toBe('Login broken');
  });

  it('carries the join key exactly once', () => {
    const result = joinTabular(CUSTOMERS, TICKETS, { on: [{ left: 'customer_id', right: 'customer_id' }] });
    expect(result.columns.filter((column) => column.endsWith('customer_id'))).toEqual(['customer_id']);
  });

  it('reports fan-out, because a SUM over the result would otherwise be wrong', () => {
    const result = joinTabular(CUSTOMERS, TICKETS, { on: [{ left: 'customer_id', right: 'customer_id' }] });
    expect(result.fanOut).toBe(true);
  });

  it('keeps every left row on a left join', () => {
    const result = joinTabular(CUSTOMERS, TICKETS, { type: 'left', on: [{ left: 'customer_id', right: 'customer_id' }] });
    expect(result.rowCount).toBe(4);
    expect(result.rows.filter((row) => row['right.name'] === '')).toHaveLength(2);
  });

  it('keeps the unmatched right rows on a full join, with their key readable', () => {
    const result = joinTabular(CUSTOMERS, TICKETS, { type: 'full', on: [{ left: 'customer_id', right: 'customer_id' }] });
    const orphan = result.rows.find((row) => row['right.name'] === 'Orphan');
    expect(orphan?.customer_id).toBe('c9');
    expect(orphan?.name).toBe('');
  });

  it('fails loudly on a key column that does not exist rather than returning zero rows', () => {
    const result = joinTabular(CUSTOMERS, TICKETS, { on: [{ left: 'nope', right: 'customer_id' }] });
    expect(result.unknownColumns).toEqual(['nope']);
    expect(result.rows).toEqual([]);
  });

  it('is case- and whitespace-insensitive on the key, as operational exports require', () => {
    const left: TabularSource = { columns: ['k'], rows: [{ k: ' ABC ' }] };
    const right: TabularSource = { columns: ['k', 'v'], rows: [{ k: 'abc', v: 1 }] };
    expect(joinTabular(left, right, { on: [{ left: 'k', right: 'k' }] }).rowCount).toBe(1);
  });
});

describe('suggestJoinKeys', () => {
  it('finds the shared key by name and by overlapping values', () => {
    expect(suggestJoinKeys(CUSTOMERS, TICKETS)).toEqual([{ left: 'customer_id', right: 'customer_id' }]);
  });

  it('does not offer a same-named column whose values never overlap', () => {
    const left: TabularSource = { columns: ['code'], rows: [{ code: 'aa' }, { code: 'bb' }] };
    const right: TabularSource = { columns: ['code'], rows: [{ code: 'zz' }, { code: 'yy' }] };
    expect(suggestJoinKeys(left, right)).toEqual([]);
  });

  it('recognises an <entity>_id ↔ id pairing', () => {
    const orders: TabularSource = { columns: ['order_id', 'customer_id'], rows: [{ order_id: 'o1', customer_id: 'c1' }] };
    const customers: TabularSource = { columns: ['id'], rows: [{ id: 'c1' }] };
    expect(suggestJoinKeys(orders, customers)).toContainEqual({ left: 'customer_id', right: 'id' });
  });
});

describe('normalizeJoinSpec', () => {
  it('rejects a spec with no usable keys', () => {
    expect(normalizeJoinSpec({ on: [{ left: '', right: 'x' }] })).toBeNull();
    expect(normalizeJoinSpec(null)).toBeNull();
  });

  it('keeps only the fields the engine understands', () => {
    expect(normalizeJoinSpec({ on: [{ left: 'a', right: 'b' }], type: 'nonsense', rightAlias: 'r' }))
      .toEqual({ on: [{ left: 'a', right: 'b' }], rightAlias: 'r' });
  });
});
