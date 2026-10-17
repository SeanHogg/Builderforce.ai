/**
 * The workspace's plan + month-to-date meters + 30-day spend & savings
 * (`GET /api/consumption`), read through ONE shared cache per page.
 *
 * React-free on purpose: the editor's headless diagnostics probe reads the same
 * snapshot as the Status tab, and it must come from this cache rather than a second
 * fetch that could report something different. Every mounted reader (the Status tab,
 * a plan chip, a diagnostics copy) shares one request: the server caches the snapshot
 * for 60s, so this mirrors that TTL and coalesces concurrent callers.
 */
import type { ChatDiagnosticsPlanSnapshot } from '@seanhogg/builderforce-brain-embedded';

/** The host's authenticated JSON GET, as a port (web `apiRequest`, webview `authedFetch`, Rovr `api.request`). */
export type JsonRequest = <T>(path: string) => Promise<T>;

export type ConsumptionSnapshot = ChatDiagnosticsPlanSnapshot;

const TTL_MS = 60_000;
let cache: { ts: number; data: ConsumptionSnapshot | null } | null = null;
let inFlight: Promise<ConsumptionSnapshot | null> | null = null;
const listeners = new Set<(s: ConsumptionSnapshot | null) => void>();

export function fetchConsumptionSnapshot(request: JsonRequest, forceRefresh = false): Promise<ConsumptionSnapshot | null> {
  if (!forceRefresh && cache && Date.now() - cache.ts < TTL_MS) return Promise.resolve(cache.data);
  if (!forceRefresh && inFlight) return inFlight;
  inFlight = request<ConsumptionSnapshot>('/api/consumption')
    .then((data) => {
      cache = { ts: Date.now(), data };
      for (const l of listeners) l(data);
      return data;
    })
    // A failed read must not pin "no plan" for a minute — leave the cache so the next
    // reader retries.
    .catch(() => null)
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Drop the cached snapshot — after an upgrade click, the person may return on another tier. */
export function invalidateConsumptionSnapshot(): void {
  cache = null;
}

/** The warm snapshot, if any — what a subscriber renders before its first fetch resolves. */
export function cachedConsumptionSnapshot(): ConsumptionSnapshot | null {
  return cache?.data ?? null;
}

/** Hear every fresh snapshot (so two readers never show two different plans). */
export function subscribeConsumptionSnapshot(listener: (s: ConsumptionSnapshot | null) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
