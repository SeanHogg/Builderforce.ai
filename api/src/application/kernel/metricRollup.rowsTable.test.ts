/**
 * `rowsTable` renders rows read off ANOTHER database as a `jsonb_to_recordset`
 * relation a fact's `tail` can select from — see {@link ./metricRollup.rowsTable}
 * for why: a statement cannot span two databases, so a metric over site rows
 * aggregates them on the apps database first and hands the result here as ONE
 * bound JSON parameter, however many rows.
 */
import { describe, expect, it } from 'vitest';
import { rowsTable, type RowsColumn } from './metricRollup';

/**
 * Walk a built `SQL`'s `queryChunks`, collecting the raw text (`StringChunk`s,
 * including the ones NESTED inside a `sql.raw(...)` sub-`SQL`) separately from
 * the bound parameters (anything else) — good enough to assert the shape
 * without a database, the same way `rollupRegistry.test.ts` inspects a built
 * statement (`JSON.stringify` + `toContain`), but keeping text and params apart
 * so a parameter's own contents can never be mistaken for SQL.
 */
function inspect(built: unknown): { text: string; params: unknown[] } {
  let text = '';
  const params: unknown[] = [];
  const walk = (node: unknown): void => {
    if (node && typeof node === 'object' && 'value' in (node as { value?: unknown })
      && Array.isArray((node as { value: unknown }).value)) {
      text += (node as { value: string[] }).value.join('');
      return;
    }
    if (node && typeof node === 'object' && 'queryChunks' in (node as { queryChunks?: unknown })) {
      for (const chunk of (node as { queryChunks: unknown[] }).queryChunks) walk(chunk);
      return;
    }
    params.push(node);
  };
  walk(built);
  return { text, params };
}

const COLUMNS: readonly RowsColumn[] = [
  { name: 'tenant_id', type: 'int' },
  { name: 'bucket_at', type: 'timestamp' },
  { name: 'n', type: 'bigint' },
];

describe('rowsTable', () => {
  it('renders a jsonb_to_recordset relation with the alias and column defs', () => {
    const built = rowsTable('v', COLUMNS, [{ tenant_id: 1, bucket_at: '2026-01-01', n: 3 }]);
    const { text } = inspect(built);
    expect(text).toContain('jsonb_to_recordset(');
    expect(text).toContain('::jsonb) AS v(tenant_id int, bucket_at timestamp, n bigint)');
  });

  it('binds the rows as ONE JSON parameter, not a value per cell', () => {
    const rows = [
      { tenant_id: 1, bucket_at: '2026-01-01', n: 3 },
      { tenant_id: 2, bucket_at: '2026-01-02', n: 5 },
    ];
    const built = rowsTable('v', COLUMNS, rows);
    const { params } = inspect(built);
    // Exactly one bound parameter, however many rows — a `VALUES` list would
    // have needed one parameter per cell (and Postgres caps a statement at
    // 65,535 of them, which a 90-day per-site scan can exceed).
    expect(params).toHaveLength(1);
    expect(JSON.parse(params[0] as string)).toEqual([
      { tenant_id: 1, bucket_at: '2026-01-01', n: 3 },
      { tenant_id: 2, bucket_at: '2026-01-02', n: 5 },
    ]);
  });

  it('projects exactly the declared columns, filling an absent one with null rather than dropping it', () => {
    // A row missing a column (or carrying an EXTRA one the spec never declared)
    // must not desync the recordset from its own column list.
    const built = rowsTable('v', COLUMNS, [{ tenant_id: 1, extra: 'ignored' }]);
    const { params } = inspect(built);
    expect(JSON.parse(params[0] as string)).toEqual([
      { tenant_id: 1, bucket_at: null, n: null },
    ]);
  });

  it('still binds a well-formed empty relation for zero rows, per the no-zero-fill rule', () => {
    // An empty array is an empty relation, not a skipped statement: the fact it
    // feeds still runs and simply writes nothing, which is the honest reading of
    // "no rows on this database right now" rather than a fabricated skip.
    const built = rowsTable('v', COLUMNS, []);
    const { text, params } = inspect(built);
    expect(JSON.parse(params[0] as string)).toEqual([]);
    expect(text).toContain('AS v(tenant_id int, bucket_at timestamp, n bigint)');
  });

  it('is a distinct relation per alias, so a fact selecting from two can UNION them', () => {
    const a = rowsTable('a', COLUMNS, [{ tenant_id: 1 }]);
    const b = rowsTable('b', COLUMNS, [{ tenant_id: 2 }]);
    expect(inspect(a).text).toContain('AS a(');
    expect(inspect(b).text).toContain('AS b(');
  });
});
