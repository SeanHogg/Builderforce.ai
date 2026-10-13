/**
 * The Insights client's URL and request helpers, shared by `replayApi.ts` and
 * `replayAnalysisApi.ts` so the two halves of the ONE client build every URL
 * the same way (paths from `REPLAY_PATHS`, `?site=` always, the filter's own
 * `f.*` params). Not a client itself: components import `replayApi`.
 */

import { filterToQuery, type ReplayFilter } from '@builderforce/interaction-contract';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';

export type QueryValue = string | number | null | undefined;

/** Fill `:name` segments of a `REPLAY_PATHS` template. */
export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/:([A-Za-z]+)/g, (_, name: string) => encodeURIComponent(String(params[name] ?? '')));
}

/** `path?site=…&k=v…` plus the filter's own params. */
export function withQuery(path: string, siteId: string, query: Record<string, QueryValue> = {}, filter?: ReplayFilter | null): string {
  const params = filter ? filterToQuery(filter) : new URLSearchParams();
  params.set('site', siteId);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}

/**
 * Concurrent identical reads share one request (several tabs of one panel level
 * read the same recording at mount). Single-flight only — `ttlMs: 0` means a
 * settled answer is never reused, so live follow always sees new chunks.
 */
export function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
  return getOrSetClientCached(`replay:${key}`, () => load(), { ttlMs: 0 });
}

export function listOf<T>(body: T[] | { items: T[] } | null | undefined): T[] {
  if (Array.isArray(body)) return body;
  return body?.items ?? [];
}
