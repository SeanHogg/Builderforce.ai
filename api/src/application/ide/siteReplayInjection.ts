/**
 * THE INSIGHTS LOADER ON A BUILDERFORCE-HOSTED APP (PRD 33 S7, §3.1 step 2).
 *
 * A hosted app needs no snippet: when its project has an ENABLED hosted
 * `replay_sites` row (the switch in canvas Measure ▸ Visitors or Insights set-up),
 * every HTML document the site serves carries the loader tag, with the release
 * identity written onto it from `site_releases.version_token` — so a recording is
 * tied to the exact build the visitor saw without the app doing anything.
 *
 *   <script async src="https://cdn.builderforce.ai/replay/v1/loader.js"
 *           data-site="hosted:<siteId>" data-release="<versionToken>"></script>
 *
 * Runs in the SITES Worker (`sitesWorker.ts → siteStaticServe.ts`), whose import
 * graph `check:sites-worker-graph` keeps small: this module reads ONE cached query
 * through the core handle and imports nothing from the service graph. The lookup is
 * keyed under the tenant's sites version (`tenantSitesKey`), so the site-admin writes
 * that call `bumpReplaySitesVersion` switch the tag on or off on the next request; the
 * 5-minute TTL is only a safety net.
 *
 * Idempotent: a document that already carries the marker, or any Insights loader
 * tag the creator pasted by hand, is left as it is — one page, one recorder.
 */
import { eq } from 'drizzle-orm';
import { REPLAY_CDN_ORIGIN, REPLAY_LOADER_PATH, replayLoaderUrl } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { replaySites } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { tenantSitesKey } from '../replay/replayCacheKeys';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { injectBeforeBodyClose } from './siteAttribution';
import { escapeHtml } from '@builderforce/creation-canvas-contract';

/** The marker that makes the injection idempotent. */
export const REPLAY_LOADER_MARKER = 'bf-replay-loader';

const HOSTED_SITE_TTL_SECONDS = 5 * 60;

/** The CDN origin: the Worker's `REPLAY_CDN_ORIGIN` var when bound, else the contract default (D5). */
function cdnOrigin(env: Env): string {
  const configured = (env as Env & { REPLAY_CDN_ORIGIN?: string }).REPLAY_CDN_ORIGIN;
  return typeof configured === 'string' && configured.trim() ? configured.trim() : REPLAY_CDN_ORIGIN;
}

/** The loader tag for a hosted site and the release being served. */
export function hostedReplayLoaderTag(input: { siteId: string; versionToken: string; cdnOrigin?: string; variant?: string | null }): string {
  const src = replayLoaderUrl(input.cdnOrigin ?? REPLAY_CDN_ORIGIN);
  // `data-variant`: the A/B arm this document was served from (`siteAbSplit.ts`).
  const variant = input.variant ? ` data-variant="${escapeHtml(input.variant)}"` : '';
  return `<script async src="${escapeHtml(src)}" data-site="hosted:${escapeHtml(input.siteId)}" data-release="${escapeHtml(input.versionToken)}"${variant} data-bf-marker="${REPLAY_LOADER_MARKER}"></script>`;
}

/** Add the loader to a document unless it already has one (ours or a pasted one). */
export function injectReplayLoader(html: string, tag: string): string {
  if (html.includes(REPLAY_LOADER_PATH)) return html;
  return injectBeforeBodyClose(html, REPLAY_LOADER_MARKER, tag);
}

/**
 * The enabled hosted Insights site of this project, or null. Cached; one indexed
 * read on a miss (`uq_replay_sites_project`).
 */
export async function enabledHostedReplaySiteId(env: Env, tenantId: number, projectId: number): Promise<string | null> {
  const key = `${await tenantSitesKey(env, tenantId)}:hosted:p${projectId}`;
  const found = await getOrSetCached(env, key, async (): Promise<{ siteId: string | null }> => {
    const [row] = await buildDatabase(env)
      .select({ id: replaySites.id, kind: replaySites.kind, status: replaySites.status })
      .from(replaySites)
      .where(scopedToTenant(replaySites, tenantId, eq(replaySites.projectId, projectId)))
      .limit(1);
    return { siteId: row && row.kind === 'hosted' && row.status === 'active' ? row.id : null };
  }, { kvTtlSeconds: HOSTED_SITE_TTL_SECONDS, l1TtlMs: 60_000 });
  return found.siteId;
}

/**
 * Compose next to `withSiteBadge`: an HTML document of a project whose hosted
 * Insights site is enabled leaves with the loader tag. Anything else — an asset, a
 * project that has not switched recording on, a lookup that fails — passes through
 * untouched (a recording is never worth breaking a page for).
 */
export async function withReplayLoader(
  env: Env,
  tenantId: number,
  projectId: number,
  versionToken: string,
  response: Response,
  /** The A/B arm label when a prescription test split this request (`siteAbSplit.ts`). */
  variant?: string | null,
): Promise<Response> {
  const type = response.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('text/html') || !response.body) return response;

  let siteId: string | null;
  try {
    siteId = await enabledHostedReplaySiteId(env, tenantId, projectId);
  } catch (error) {
    // Fail open to "no recording": the visitor still gets the page.
    reportCaughtError(error, { source: 'application/ide/siteReplayInjection.ts', operation: 'withReplayLoader' });
    return response;
  }
  if (!siteId) return response;

  const tag = hostedReplayLoaderTag({ siteId, versionToken, cdnOrigin: cdnOrigin(env), variant });
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(injectReplayLoader(await response.text(), tag), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
