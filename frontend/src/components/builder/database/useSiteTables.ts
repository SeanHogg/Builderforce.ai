// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useEffect, useState } from 'react';
import { siteDataApi, type SiteCollection, type SiteRecord } from '@/lib/growthApi';

const PAGE = 50;

type CollectionPatch = Parameters<typeof siteDataApi.updateCollection>[2];

export interface SiteTables {
  /** Null until the first load answers. */
  collections: SiteCollection[] | null;
  selected: SiteCollection | null;
  select: (collectionId: number) => void;
  /** Rows of the selected table, newest first; null while the first page loads. */
  records: SiteRecord[] | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  create: (name: string) => Promise<void>;
  patch: (collectionId: number, patch: CollectionPatch) => Promise<void>;
  removeCollection: (collectionId: number) => Promise<void>;
  removeRecord: (recordId: number) => Promise<void>;
  /** The last load that failed, for the section to show. */
  loadError: unknown;
}

/**
 * A project's tables (site collections) and the rows of the one selected. Every
 * mutation throws to its caller, which owns the message; reads keep their
 * failure in `loadError`.
 */
export function useSiteTables(projectId: number): SiteTables {
  const [collections, setCollections] = useState<SiteCollection[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [records, setRecords] = useState<SiteRecord[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  const reloadCollections = useCallback(async () => {
    try {
      const { collections: next } = await siteDataApi.listCollections(projectId);
      setCollections(next);
      setLoadError(null);
      setSelectedId((current) => (current !== null && next.some((c) => c.id === current) ? current : next[0]?.id ?? null));
    } catch (cause) {
      setLoadError(cause);
    }
  }, [projectId]);

  useEffect(() => { void reloadCollections(); }, [reloadCollections]);

  useEffect(() => {
    if (selectedId === null) { setRecords(null); return undefined; }
    let cancelled = false;
    setRecords(null);
    siteDataApi.listRecords(projectId, selectedId, PAGE)
      .then(({ records: page }) => {
        if (cancelled) return;
        setRecords(page);
        setHasMore(page.length === PAGE);
      })
      .catch((cause: unknown) => { if (!cancelled) { setRecords([]); setLoadError(cause); } });
    return () => { cancelled = true; };
  }, [projectId, selectedId]);

  const loadMore = useCallback(async () => {
    if (selectedId === null || !records?.length) return;
    const { records: page } = await siteDataApi.listRecords(projectId, selectedId, PAGE, records[records.length - 1]!.id);
    setRecords([...records, ...page]);
    setHasMore(page.length === PAGE);
  }, [projectId, records, selectedId]);

  const create = useCallback(async (name: string) => {
    const created = await siteDataApi.createCollection(projectId, name);
    await reloadCollections();
    setSelectedId(created.id);
  }, [projectId, reloadCollections]);

  const patch = useCallback(async (collectionId: number, change: CollectionPatch) => {
    await siteDataApi.updateCollection(projectId, collectionId, change);
    await reloadCollections();
  }, [projectId, reloadCollections]);

  const removeCollection = useCallback(async (collectionId: number) => {
    await siteDataApi.deleteCollection(projectId, collectionId);
    await reloadCollections();
  }, [projectId, reloadCollections]);

  const removeRecord = useCallback(async (recordId: number) => {
    if (selectedId === null) return;
    await siteDataApi.deleteRecord(projectId, selectedId, recordId);
    setRecords((current) => current?.filter((r) => r.id !== recordId) ?? null);
    setCollections((current) => current?.map((c) => (c.id === selectedId ? { ...c, recordCount: Math.max(0, c.recordCount - 1) } : c)) ?? null);
  }, [projectId, selectedId]);

  return {
    collections,
    selected: collections?.find((c) => c.id === selectedId) ?? null,
    select: setSelectedId,
    records,
    hasMore,
    loadMore,
    create,
    patch,
    removeCollection,
    removeRecord,
    loadError,
  };
}
