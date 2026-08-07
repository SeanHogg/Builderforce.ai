/**
 * Guest RESEARCH — server-side web search, page reads and geocoding for a logged-out
 * visitor working on the public Creation Canvas.
 *
 * Why this exists at all: anonymous visitors ask the canvas to research things. They
 * type "compare the top 10 EV makers and chart it" into the first box they see, and
 * until now the answer came out of the model's weights, because a guest turn was given
 * ONLY client-side canvas tools — the tenant MCP catalog (which owns `web.search`,
 * `web.fetch` and `geo.geocode`) requires a tenant, and a guest has none. The result
 * was a confident chart with invented numbers, which is the single worst thing this
 * product can do in front of a first-time visitor.
 *
 * So the three research primitives are re-exposed here as a small PUBLIC surface with
 * its own guard rails, rather than by loosening the tenant catalog:
 *
 *  • **Identity** — a signed guest token (`guestToken.ts`), the same credential the
 *    guest LLM gateway takes. No token, no research.
 *  • **Allowance** — its own UTC-day counters (visitor + IP), separate from the chat
 *    message cap because one message legitimately fans out into several calls.
 *  • **Backing** — {@link platformWebSearchBacking}: the operator key if the deployment
 *    funds one, else the keyless encyclopedic vendor. A guest can never reach a
 *    TENANT's BYO key, because no tenant is in scope on this path.
 *  • **Egress** — the same SSRF guard and byte caps every other surface fetches
 *    through. This is an outbound proxy exposed to the public internet; nothing here
 *    may take a shortcut around `fetchWebDocumentCached` / `classifyWebEgress`.
 *
 * Results are cached by the shared read-through helpers, so a hundred visitors
 * researching the same subject cost one real query.
 */

import type { Env } from '../../env';
import type { WebSearchResult } from '@builderforce/agent-tools';
import { GUEST_RESEARCH_LIMITS } from '../../domain/tenant/PlanLimits';
import { bumpDailyCounter, dailyCounterKey, readDailyCounter } from './guestDailyCounter';
import { platformWebSearchBacking } from '../runtime/webSearchCredential';
import { searchWeb } from '../runtime/cloudWeb';
import { fetchWebDocumentCached, type WebFetchResult } from '../web/webFetch';
import { geocodeBatch, type GeocodeBatchOptions, type GeocodeBatchResult } from '../web/geocode';

/** Verdict of the per-call allowance check. */
export interface GuestResearchCap {
  allowed: boolean;
  /** Calls left today on the VISITOR axis (the number worth showing a human). */
  remaining: number;
  limit: number;
  reason?: 'visitor' | 'ip';
}

const visitorKey = (visitorId: string): string => dailyCounterKey('guestresearch:v', visitorId);
const ipKey = (ip: string): string => dailyCounterKey('guestresearch:ip', ip);

/**
 * Charge one research call, or refuse it.
 *
 * Check-and-consume in ONE step, unlike the chat cap's split check/consume: a research
 * call is a single request with no streaming continuation to reconcile, so there is no
 * turn to be idempotent about — and charging before the outbound fetch means an
 * abandoned request still counts, which is the posture an abuse ceiling needs.
 */
export async function consumeGuestResearchCall(
  env: Env,
  visitorId: string,
  ip: string | null,
): Promise<GuestResearchCap> {
  const limit = GUEST_RESEARCH_LIMITS.callsDailyLimit;
  const used = await readDailyCounter(env, visitorKey(visitorId));
  if (used >= limit) return { allowed: false, remaining: 0, limit, reason: 'visitor' };

  if (ip) {
    const ipUsed = await readDailyCounter(env, ipKey(ip));
    if (ipUsed >= GUEST_RESEARCH_LIMITS.ipCallsDailyLimit) {
      return { allowed: false, remaining: Math.max(limit - used, 0), limit, reason: 'ip' };
    }
  }

  const next = await bumpDailyCounter(env, visitorKey(visitorId));
  if (ip) await bumpDailyCounter(env, ipKey(ip));
  // With no KV bound the counters are inert (they return 0); report the allowance as
  // untouched rather than pretending to have charged it.
  return { allowed: true, remaining: Math.max(limit - (next || used + 1), 0), limit };
}

/** Search the public web on the platform's backing — never a tenant's key. */
export async function guestWebSearch(env: Env, query: string): Promise<WebSearchResult> {
  // No `meter`: there is no tenant ledger to bill an anonymous visitor against. The
  // daily call cap above is this surface's meter.
  return searchWeb(env, platformWebSearchBacking(env), query);
}

/** Read one public URL, behind the same SSRF guard + cache as every other surface. */
export async function guestWebFetch(env: Env, url: string): Promise<WebFetchResult> {
  return fetchWebDocumentCached(env, url);
}

/** Resolve place names to coordinates — already keyless, already cached, already paced. */
export async function guestGeocode(
  env: Env,
  queries: readonly string[],
  opts: GeocodeBatchOptions = {},
): Promise<GeocodeBatchResult> {
  return geocodeBatch(env, queries, opts);
}
