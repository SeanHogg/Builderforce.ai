'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { readLocalJson, writeLocalJson } from '@/lib/storage';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type PageSize } from './collectionTypes';

/**
 * collectionPreferences — per-surface persisted view mode + page size for a
 * Collection (PRD 47 §3.1). The ONE place a Collection's chrome preferences are
 * kept, via `lib/storage.ts` (`readLocalJson`/`writeLocalJson`) — never raw
 * `localStorage` — and read through `useSyncExternalStore` so a write in one
 * tab re-renders the surfaces subscribed in another.
 *
 * The legacy value `'list'` maps to `'table'` (the old creation library stored
 * `'list'` for what the Collection now calls List/Table mode).
 */
export type CollectionView = 'card' | 'table';

export interface CollectionPreferences {
  view: CollectionView;
  pageSize: PageSize;
  setView: (view: CollectionView) => void;
  setPageSize: (size: PageSize) => void;
}

interface StoredPrefs {
  view?: string;
  pageSize?: number;
}

const prefsKey = (surfaceKey: string) => `collection.prefs.${surfaceKey}`;

function readStored(surfaceKey: string): { view: CollectionView; pageSize: PageSize } {
  const stored = readLocalJson<StoredPrefs>(prefsKey(surfaceKey));
  const rawView = stored?.view;
  // Legacy `list` → `table`: the old library stored 'list' for List/Table mode.
  const view: CollectionView = rawView === 'card' ? 'card' : rawView === 'table' || rawView === 'list' ? 'table' : 'table';
  const rawSize = stored?.pageSize;
  const pageSize: PageSize = rawSize && (PAGE_SIZES as readonly number[]).includes(rawSize) ? (rawSize as PageSize) : DEFAULT_PAGE_SIZE;
  return { view, pageSize };
}

// Minimal external store: a change counter bumped on every write. Subscribers
// re-read through readLocalJson so cross-tab storage events converge too.
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return version;
}

function write(surfaceKey: string, next: StoredPrefs): void {
  const prev = readLocalJson<StoredPrefs>(prefsKey(surfaceKey)) ?? {};
  writeLocalJson(prefsKey(surfaceKey), { ...prev, ...next });
  version += 1;
  for (const listener of listeners) listener();
}

export function useCollectionPreferences(
  surfaceKey: string,
  defaultView: CollectionView = 'table',
): CollectionPreferences {
  // useSyncExternalStore re-reads the stored value whenever `version` changes
  // (a write anywhere) so cross-surface/cross-tab updates propagate.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const stored = readStored(surfaceKey);
  const view: CollectionView = stored.view === 'card' ? 'card' : defaultView;

  const setView = useCallback(
    (next: CollectionView) => write(surfaceKey, { view: next }),
    [surfaceKey],
  );
  const setPageSize = useCallback(
    (next: PageSize) => write(surfaceKey, { pageSize: next }),
    [surfaceKey],
  );

  return { view, pageSize: stored.pageSize, setView, setPageSize };
}
