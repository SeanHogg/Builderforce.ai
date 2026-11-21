import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CollectionDescriptor } from './descriptor';
import { useLocalSource } from './sources';

type Row = { id: number };
const descriptor = {
  entity: null,
  surfaceKey: 'test.sources',
  rowId: (r: Row) => String(r.id),
  label: (r: Row) => String(r.id),
  defaultSort: { key: 'id', dir: 'asc' },
  emptyKey: 'empty',
  card: () => null,
  columns: [{ key: 'id', header: 'Id', compare: (a: Row, b: Row) => a.id - b.id, cell: (r: Row) => r.id }],
} as unknown as CollectionDescriptor<Row>;
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
const sort = { key: 'id', dir: 'asc' as const };

describe('useLocalSource', () => {
  it('regression: clamps a page past the end when the rows shrink', () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: Row[] }) => useLocalSource(data, descriptor, sort, { page: 3, pageSize: 50 }),
      { initialProps: { data: rows(120) } },
    );
    expect(result.current.rows.map((r) => r.id)).toEqual(Array.from({ length: 20 }, (_, i) => 101 + i));
    rerender({ data: rows(30) });
    expect(result.current.rows).toHaveLength(30);
    expect(result.current.total).toBe(30);
  });

  it('an empty set yields an empty page, never a negative slice', () => {
    const { result } = renderHook(() => useLocalSource([], descriptor, sort, { page: 4, pageSize: 50 }));
    expect(result.current.rows).toEqual([]);
  });
});
