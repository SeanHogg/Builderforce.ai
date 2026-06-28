/**
 * Sentry pull/backfill — seeds the Quality model from the Sentry issues API so a
 * newly-connected Sentry source isn't empty until the next webhook fires. Issues
 * are reshaped into the webhook-ish `{ issue }` envelope and run through the SAME
 * `sentry` adapter (DRY) — and the adapter fingerprints on the Sentry issue id, so
 * backfilled issues dedupe cleanly with anything the webhook later delivers.
 *
 * Network access goes through an INJECTED fetch so tests never hit the network.
 */

import { getErrorAdapter } from './adapters';
import type { NormalizedErrorEvent } from './errorSpec';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SentryPullConfig {
  apiToken: string;
  /** `organization-slug/project-slug`. */
  scope: string;
  /** Self-hosted base URL; defaults to https://sentry.io. */
  baseUrl?: string | null;
}

/** Extract the rel="next" cursor from a Sentry Link header (null when exhausted). */
function parseNextCursor(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    if (/rel="next"/.test(part) && /results="true"/.test(part)) {
      const m = part.match(/cursor="([^"]+)"/);
      if (m?.[1]) return m[1];
    }
  }
  return null;
}

/** Bounded backfill: the most recent issues (up to MAX_PAGES × 100). */
const MAX_PAGES = 5;

/**
 * Pull recent Sentry issues for the source's scope and normalize them to canonical
 * error events. Throws on a bad scope / auth failure so the caller can surface it.
 */
export async function pullSentryIssues(cfg: SentryPullConfig, fetchFn: FetchLike): Promise<NormalizedErrorEvent[]> {
  if (!cfg.apiToken) throw new Error('Sentry backfill requires an API token');
  const [org, project] = (cfg.scope ?? '').split('/');
  if (!org || !project) throw new Error('Sentry backfill requires scope "organization-slug/project-slug"');

  const base = (cfg.baseUrl ?? '').replace(/\/$/, '') || 'https://sentry.io';
  const headers = { Authorization: `Bearer ${cfg.apiToken}`, Accept: 'application/json' };
  const baseUrl = `${base}/api/0/projects/${org}/${project}/issues/?sort=date&limit=100&query=`;
  const adapter = getErrorAdapter('sentry');

  const events: NormalizedErrorEvent[] = [];
  let pageCursor: string | null = null;
  let pages = 0;
  do {
    const url = pageCursor ? `${baseUrl}&cursor=${encodeURIComponent(pageCursor)}` : baseUrl;
    const res = await fetchFn(url, { headers });
    if (!res.ok) throw new Error(`Sentry issues fetch failed: ${res.status}`);
    const issues = (await res.json()) as unknown[];
    for (const issue of issues) events.push(...adapter.normalize({ issue }));
    pageCursor = parseNextCursor(res.headers.get('Link'));
  } while (pageCursor && ++pages < MAX_PAGES);

  return events;
}
