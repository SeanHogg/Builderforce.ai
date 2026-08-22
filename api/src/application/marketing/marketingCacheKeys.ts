/**
 * The cache keys the anonymous-funnel surfaces share.
 *
 * Three services read and invalidate the same three entries — the prompt log
 * writes a visitor's standing stale, the broadcast delivery path reads it, and
 * conversion (`MarketingService.markConverted`) changes it. A key defined twice
 * is a key that will eventually be spelled twice, and the failure is silent: a
 * broadcast keeps reaching a visitor who has already paid, or a console keeps
 * showing a lead as promptless. One definition, so an invalidation cannot miss.
 */

/** The superadmin console's leads-with-intent page. Invalidated by every prompt. */
export const GUEST_SESSIONS_CACHE_KEY = 'admin:guest-sessions:v1';

/** Every live platform broadcast — shared by all visitors, one entry. */
export const BROADCAST_LIVE_CACHE_KEY = 'broadcast:live:v1';

/** The console's broadcast list with measured engagement. */
export const BROADCAST_CONSOLE_CACHE_KEY = 'broadcast:console:v1';

/** One visitor's place in the funnel: registered / paid / prompt count. Read on
 *  every broadcast delivery, so it is the hottest key of the four. */
export const visitorStandingCacheKey = (visitorId: string): string => `guest:standing:v1:${visitorId}`;

/** The flow graph over a trailing window. Keyed BY the window, because a graph
 *  for 7 days and one for 30 are different answers to the same question. */
export const visitorFlowCacheKey = (days: number): string => `admin:visitor-flow:v1:${days}`;
