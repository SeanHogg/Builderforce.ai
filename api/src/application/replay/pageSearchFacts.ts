/**
 * Search Console facts for a key page (PRD 33 §5.2 "Search Console via the analytics
 * port when connected, never fabricated").
 *
 * Reads the workspace's `search_console` property through THE analytics port
 * (`resolveAnalyticsProperty` + `readAnalyticsBreakdown` by `page`, cached there).
 * Not connected → `{ connected: false }`; connected but the page is not in the
 * report → `{ connected: true, found: false }`. A page's numbers are never zero-filled:
 * a rule reading an absent page simply does not fire.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { PageSearchFacts } from '../../domain/replay/prescriptions/pageFacts';
import {
  analyticsWindowFrom,
  readAnalyticsBreakdown,
  resolveAnalyticsProperty,
} from '../analytics/analyticsService';
import type { AnalyticsBreakdownRow } from '../analytics/analyticsProviders';
import { reportCaughtError } from '../observability/caughtErrorReporter';

const SOURCE = 'application/replay/pageSearchFacts.ts';
const WINDOW_DAYS = 28;
const PAGES_READ = 1_000;

/** `https://Shop.example/pricing/` and `https://shop.example/pricing` are one page. */
export function normalisePageUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.protocol}//${url.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

/** Pure: the page's row among the property's page rows, with the property CTR alongside. */
export function searchFactsFromRows(rows: readonly AnalyticsBreakdownRow[], pageUrl: string): PageSearchFacts {
  const target = normalisePageUrl(pageUrl);
  let impressions = 0;
  let clicks = 0;
  for (const row of rows) {
    impressions += row.measures.impressions ?? 0;
    clicks += row.measures.clicks ?? 0;
  }
  const siteCtr = impressions > 0 ? clicks / impressions : null;
  const match = target ? rows.find((row) => normalisePageUrl(row.key) === target) : undefined;
  const pageImpressions = match?.measures.impressions;
  if (!match || pageImpressions === undefined) return { connected: true, found: false };
  const pageClicks = match.measures.clicks ?? 0;
  return {
    connected: true,
    found: true,
    impressions: pageImpressions,
    clicks: pageClicks,
    ctr: pageImpressions > 0 ? pageClicks / pageImpressions : 0,
    siteCtr,
  };
}

/** Several pages' search facts with ONE property resolution and ONE (cached) page report. Never throws. */
export async function pagesSearchFacts(env: Env, db: Db, tenantId: number, urls: readonly string[]): Promise<Map<string, PageSearchFacts>> {
  const notConnected = () => new Map(urls.map((url): [string, PageSearchFacts] => [url, { connected: false }]));
  try {
    const resolved = await resolveAnalyticsProperty(db, env, tenantId, { source: 'search_console' });
    if (!resolved.ok) return notConnected();
    const rows = await readAnalyticsBreakdown(
      db, env, tenantId, resolved.account, 'page',
      { ...analyticsWindowFrom({ days: WINDOW_DAYS }), limit: PAGES_READ },
      'agent',
    );
    return new Map(urls.map((url) => [url, searchFactsFromRows(rows, url)]));
  } catch (error) {
    // A revoked grant or a platform outage is "not connected right now", not a zero.
    reportCaughtError(error, { source: SOURCE, operation: 'pageSearchFacts' });
    return notConnected();
  }
}

/** The page's search facts, or an honest "not connected". Never throws. */
export async function pageSearchFacts(env: Env, db: Db, tenantId: number, url: string): Promise<PageSearchFacts> {
  return (await pagesSearchFacts(env, db, tenantId, [url])).get(url) ?? { connected: false };
}
