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

/**
 * The stored preference. `view` is `undefined` when nothing (or garbage) is
 * stored, so the hook falls back to the surface's own `defaultView` — a stored
 * `'table'` must win over a `'card'` default, or the List toggle never sticks.
 */
function readStored(surfaceKey: string): { view: CollectionView | undefined; pageSize: PageSize } {
  const stored = readLocalJson<StoredPrefs>(prefsKey(surfaceKey));
  const rawView = stored?.view;
  // Legacy `list` → `table`: the old library stored 'list' for List/Table mode.
  const view: CollectionView | undefined =
    rawView === 'card' ? 'card' : rawView === 'table' || rawView === 'list' ? 'table' : undefined;
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

/** Server render AND the hydrating client render: not hydrated yet. */
const UNHYDRATED = -1;
function getServerSnapshot(): number {
  return UNHYDRATED;
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
  // (a write anywhere) so cross-surface/cross-tab updates propagate. The server
  // snapshot is UNHYDRATED, so the server render and the hydrating client render
  // both use the defaults (no hydration mismatch); React then re-renders with the
  // client snapshot and the stored preference applies. A plain client mount
  // (navigation) reads the stored value on its first render.
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const stored = snapshot === UNHYDRATED
    ? { view: undefined, pageSize: DEFAULT_PAGE_SIZE }
    : readStored(surfaceKey);
  const view: CollectionView = stored.view ?? defaultView;

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
