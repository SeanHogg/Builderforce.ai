import { fetchPhoneOverview, type PhoneOverview } from '@/lib/phoneApi';
import { createSharedResource } from '@/lib/useSharedResource';

/**
 * The shared phone snapshot — one fetch behind every phone surface.
 *
 * Modelled on {@link usePoints}, for the identical reason: the balance card, the
 * number list, the composer and the rate card all mount together, and each one
 * needs the SAME three facts (is the add-on live, what is the balance, which
 * numbers exist). Without a shared read-through they would fire four identical
 * requests and could disagree about the balance for a TTL — and "disagree about
 * the balance" on a metered product is a support ticket.
 *
 * 30s TTL, matching the server's own cache on the balance. Every write
 * invalidates explicitly: the moment after somebody spends or tops up is the one
 * moment a stale balance is unacceptable.
 *
 * Returns null until there is a tenant session and a successful fetch, so every
 * phone component can self-hide rather than take a `canShow` prop.
 */

const PHONE_TTL_MS = 30_000;
const PHONE_CACHE_KEY = 'phone:overview';

const phone = createSharedResource<PhoneOverview>({
  cacheKey: PHONE_CACHE_KEY,
  ttlMs: PHONE_TTL_MS,
  fetcher: () => fetchPhoneOverview(),
});

export const fetchSharedPhoneOverview = phone.fetchShared;
export const invalidatePhone = phone.invalidate;

export interface UsePhoneResult {
  overview: PhoneOverview | null;
  /** Re-read after a write. Every phone surface refreshes together because they
   *  all subscribe to the same snapshot. */
  refresh: () => Promise<void>;
}

export function usePhone(): UsePhoneResult {
  const { data, refresh } = phone.use();
  return { overview: data, refresh };
}
