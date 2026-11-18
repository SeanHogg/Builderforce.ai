import { useCallback, useState } from 'react';
import type { CollectionDescriptor } from './descriptor';

/**
 * useCollectionSort — the sort state every Collection shares (PRD 47 §3.1).
 * One hook serves both sort flavours:
 *
 *  - SERVER sources send the `sort`/`dir` to the endpoint; `sortKey` on the
 *    column must match the server allowlist.
 *  - LOCAL sources sort client-side through the column's `compare` comparator.
 *
 * A header click cycles asc → desc (PRD 47 §3.2). Initial state comes from the
 * descriptor's `defaultSort`; `key` is the server sort key (or column key for
 * local sources).
 */
export interface CollectionSort {
  key: string;
  dir: 'asc' | 'desc';
  /** Cycle asc → desc on the same key; a new key starts at asc. */
  toggle: (key: string) => void;
  setSort: (key: string, dir: 'asc' | 'desc') => void;
}

export function useCollectionSort<Row>(
  descriptor: CollectionDescriptor<Row>,
  onChange?: () => void,
): CollectionSort {
  const [key, setKey] = useState(descriptor.defaultSort.key);
  const [dir, setDir] = useState<'asc' | 'desc'>(descriptor.defaultSort.dir);

  const setSort = useCallback((nextKey: string, nextDir: 'asc' | 'desc') => {
    setKey(nextKey);
    setDir(nextDir);
    onChange?.();
  }, [onChange]);

  const toggle = useCallback((nextKey: string) => {
    setKey((prevKey) => {
      const same = prevKey === nextKey;
      const nextDir: 'asc' | 'desc' = same && dir === 'asc' ? 'desc' : 'asc';
      setDir(nextDir);
      onChange?.();
      return nextKey;
    });
  }, [dir, onChange]);

  return { key, dir, toggle, setSort };
}

/**
 * The comparator for a LOCAL source: resolves the active column's `compare`.
 * Returns `null` when no comparator is available (the surface then keeps its
 * input order).
 */
export function resolveLocalCompare<Row>(
  descriptor: CollectionDescriptor<Row>,
  key: string,
): ((a: Row, b: Row) => number) | null {
  const col = descriptor.columns.find((c) => (c.sortKey ?? c.key) === key || c.key === key);
  return col?.compare ?? null;
}
