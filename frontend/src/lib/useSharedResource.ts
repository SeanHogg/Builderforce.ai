import { useCallback, useEffect, useState } from 'react';
import { useOptionalAuth } from '@/lib/AuthContext';
import { getOrSetClientCached, invalidateClientCache, readClientCached } from '@/infrastructure/http/readThrough';

/**
 * A tenant-scoped snapshot fetched ONCE behind every surface that shows it.
 *
 * The phone and points cards each mount several components that need the same
 * facts at the same time; without a shared read-through each would fire its own
 * identical request and they could disagree for a TTL. This is that read-through
 * plus a subscriber set, so a refresh after a write updates every mounted surface
 * together.
 *
 * `use()` returns null until there is a tenant session and a successful fetch, so
 * consumers self-hide rather than take a `canShow` prop.
 */
export interface SharedResourceOptions<T> {
  cacheKey: string;
  ttlMs: number;
  fetcher: () => Promise<T | null>;
}

export interface SharedResourceHandle<T> {
  fetchShared: () => Promise<T | null>;
  invalidate: () => void;
  use: () => { data: T | null; refresh: () => Promise<void> };
}

export function createSharedResource<T>({ cacheKey, ttlMs, fetcher }: SharedResourceOptions<T>): SharedResourceHandle<T> {
  const subscribers = new Set<(value: T | null) => void>();

  const fetchShared = (): Promise<T | null> =>
    getOrSetClientCached(cacheKey, fetcher, { ttlMs })
      .then((data) => {
        subscribers.forEach((fn) => fn(data));
        return data;
      })
      // A failed read must not pin "unavailable" for a whole TTL — leave the cache
      // alone so the next mount retries.
      .catch(() => null);

  const invalidate = () => invalidateClientCache(cacheKey);

  function use() {
    const hasTenant = useOptionalAuth()?.hasTenant ?? false;
    const [data, setData] = useState<T | null>(readClientCached<T>(cacheKey, ttlMs) ?? null);

    useEffect(() => {
      if (!hasTenant) return;
      let active = true;
      const notify = (value: T | null) => { if (active) setData(value); };
      subscribers.add(notify);
      void fetchShared().then(notify);
      return () => { active = false; subscribers.delete(notify); };
    }, [hasTenant]);

    const refresh = useCallback(async () => {
      invalidate();
      await fetchShared();
    }, []);

    return { data: hasTenant ? data : null, refresh };
  }

  return { fetchShared, invalidate, use };
}
