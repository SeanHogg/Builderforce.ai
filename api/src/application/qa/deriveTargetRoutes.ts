/**
 * deriveTargetRoutes — what to explore when a project has NO interaction heat yet.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * The Agentic Tester ranks what to exercise from captured journey events. A
 * just-deployed site has none, and the fallback was a single hardcoded zone:
 *
 *     zones = [{ route: '/', selector: null, kind: 'pageview', … }]
 *
 * So the first (and for an unvisited app, every) exploration tested exactly the
 * home page and reported "all good" about a site whose other pages had never
 * been loaded. The scheduled path was worse — it recorded `no_heat` and queued
 * nothing at all.
 *
 * ── WHY A FETCH AND A REGEX, NOT A CRAWLER ──────────────────────────────────
 * `routesFromHtml` already exists in the shared canvas contract and is already
 * how the Creation Canvas derives a route map; it was simply never called on the
 * server. Reusing it (rather than writing a second route extractor) is the whole
 * point — one definition of "which hrefs are testable" covers both surfaces, so
 * the canvas and the tester can never disagree about what a route is.
 *
 * The depth is deliberately ONE page. This runs in a Worker on a request path;
 * a real recursive crawl belongs to the browser container, which is where the
 * exploration itself happens. One fetch of the root turns "test the home page"
 * into "test everything the home page links to", which is the difference that
 * matters — and the harness then drives each of those routes for real.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 * The target URL is tenant-owned data (a `qa_targets` row the tenant created),
 * not a request parameter, so this is not an open redirect/SSRF surface: the
 * same tenant could point a target anywhere it liked before this existed. The
 * fetch is bounded (timeout + response cap) and every failure degrades to the
 * root-only plan rather than failing the exploration.
 */

import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';
import { routesFromHtml } from './qaTypes';
import type { QaHeatZone } from './qaTypes';

/** Give up on a slow target rather than holding the request open. */
const FETCH_TIMEOUT_MS = 5_000;
/** Read at most this much HTML — the nav/link markup is near the top anyway. */
const MAX_HTML_BYTES = 512 * 1024;
/** Never plan more than this many derived routes, whatever the page links to. */
const MAX_DERIVED_ROUTES = 40;

/** The root-only plan — the honest answer when nothing could be derived. */
export function rootZone(): QaHeatZone[] {
  return [{ route: '/', selector: null, kind: 'pageview', label: null, heat: 0, score: 0 }];
}

/** Fetch the target's root HTML, bounded in both time and size. */
async function fetchRootHtml(baseUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl, {
      signal: controller.signal,
      headers: { accept: 'text/html', 'user-agent': 'Builderforce-QA-RouteDiscovery/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type && !/text\/html|application\/xhtml/i.test(type)) return null;
    const buffer = await res.arrayBuffer();
    return new TextDecoder().decode(buffer.slice(0, MAX_HTML_BYTES));
  } catch {
    // A target that is down, slow, or not serving HTML is not an error — it just
    // means we plan the root only.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Zones to explore for a target with no heat: one per route linked from its root
 * page, root first. Always returns at least {@link rootZone}.
 *
 * `heat`/`score` are 0 by construction — these are DISCOVERED routes, not
 * observed ones, so they must never outrank a route real users actually used.
 * When heat exists, the caller uses the heat ranking and never calls this.
 */
export async function deriveTargetZones(
  env: Env | undefined,
  baseUrl: string | null | undefined,
  limit: number,
): Promise<QaHeatZone[]> {
  if (!baseUrl) return rootZone();

  const load = async (): Promise<string[]> => {
    const html = await fetchRootHtml(baseUrl);
    if (!html) return [];
    return routesFromHtml(html, baseUrl);
  };

  // Route discovery is an outbound fetch on a request path — exactly the shape
  // the read-through cache exists for. A site's link graph does not change
  // between two explorations minutes apart.
  const routes = env
    ? await getOrSetCached(env, `qa-routes:${baseUrl}`, load, { kvTtlSeconds: 900 })
    : await load();

  const ordered = ['/', ...routes.filter((r) => r !== '/')].slice(
    0,
    Math.max(1, Math.min(limit, MAX_DERIVED_ROUTES)),
  );
  return ordered.map((route) => ({
    route,
    selector: null,
    kind: 'pageview',
    label: null,
    heat: 0,
    score: 0,
  }));
}
