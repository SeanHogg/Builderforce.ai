'use client';

import { useEffect, useState } from 'react';
import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';

/**
 * Dedup-and-cache for widget data sources.
 *
 * A dashboard can show MANY widgets backed by the same collector (e.g. the ten
 * AI-Impact cards all read /api/insights/ai-impact). Letting each card fire its
 * own request is the N+1 anti-pattern the perf rules reject. {@link useSharedSource}
 * collapses every concurrent reader of the same `key` onto ONE in-flight promise
 * and serves the result from a short-TTL module cache, so the dashboard makes one
 * request per (source, window) regardless of how many widgets consume it.
 *
 * Client mirror of the server's read-through cache contract (getOrSetCached):
 * single-flight + brief TTL, invalidated by expiry rather than writes (these are
 * read-only collector reads).
 */

const TTL_MS = 30_000;
const CACHE_PREFIX = 'widget-source:';

export interface SharedAsync<T> {
  data: T | null;
  error: string | null;
}

export function useSharedSource<T>(key: string, loader: () => Promise<T>): SharedAsync<T> {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({
    key: '',
    data: null,
    error: null,
  });

  useEffect(() => {
    let alive = true;
    getOrSetClientCached(`${CACHE_PREFIX}${key}`, () => loader(), { ttlMs: TTL_MS })
      .then((d) => { if (alive) setState({ key, data: d, error: null }); })
      .catch((e: unknown) => {
        // Drop the failed entry so a remount retries instead of caching the error.
        invalidateClientCache(`${CACHE_PREFIX}${key}`);
        if (alive) setState({ key, data: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => { alive = false; };
    // loader is recreated each render; the key is the stable cache identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const fresh = state.key === key;
  return { data: fresh ? state.data : null, error: fresh ? state.error : null };
}
