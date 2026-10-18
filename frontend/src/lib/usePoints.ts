import { fetchPointsSummary, type PointsSummary } from '@/lib/pointsApi';
import { createSharedResource } from '@/lib/useSharedResource';

/**
 * The shared points snapshot — one fetch behind every points surface.
 *
 * Modelled on {@link useConsumption} and for the same reason: the balance chip,
 * the badge grid, the reward shelf and the activity list mount together, and
 * without a shared read-through each one would fire its own identical request and
 * they could disagree about the balance for a TTL.
 *
 * 60s TTL mirrors the server's own cache on `GET /api/points`. A redemption
 * invalidates explicitly, because the one moment a stale balance is unacceptable
 * is immediately after the user spent it.
 *
 * Returns null until there is a tenant session and a successful fetch — the hook
 * decides its own gating so no consumer has to, which is what lets every points
 * component self-hide rather than take a `canShow` prop.
 */

const POINTS_TTL_MS = 60_000;
const POINTS_CACHE_KEY = 'points:summary';

const points = createSharedResource<PointsSummary>({
  cacheKey: POINTS_CACHE_KEY,
  ttlMs: POINTS_TTL_MS,
  fetcher: () => fetchPointsSummary(),
});

export const fetchSharedPointsSummary = points.fetchShared;
export const invalidatePoints = points.invalidate;

export interface UsePointsResult {
  summary: PointsSummary | null;
  /** Re-read after a write. Every points surface refreshes together because they
   *  all subscribe to the same snapshot. */
  refresh: () => Promise<void>;
}

export function usePoints(): UsePointsResult {
  const { data, refresh } = points.use();
  return { summary: data, refresh };
}
