import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { normalizeSearchQuery, searchWeb } from '../runtime/cloudWeb';
import { resolveWebSearchBacking } from '../runtime/webSearchCredential';
import { buildInternetSearch } from './factory';
import type { SearchRequest } from './searchService';

/**
 * The tenant-scoped "capture" search: check the tenant's OWNED crawled index first, and
 * fall back to a vendor only to discover pages worth crawling — the primitive that makes
 * research build a reusable corpus instead of a vendor bill that's forgotten the moment
 * the answer is read. Called by every tenant-scoped search surface: the Brain's
 * `web.search` MCP tool, the cloud agent's `web_search` tool (durable + container), and
 * the workflow `web-search` node. The one surface that does NOT go through this is the
 * logged-out guest canvas — there is no tenant, so there is no index to own.
 *
 * Returns `WebSearchResult`-COMPATIBLE shapes either way, so every caller — the rich
 * Brain MCP tool included — can rely on `ok`/`results[].{title,url,snippet}`/`attribution`/
 * `research_request`, while a HIT also carries the owned index's fuller per-result
 * metadata (domain, score, published/crawled timestamps) that only the Brain surface
 * reads today. Deliberately NOT narrowed to the exact `WebSearchResult` interface, so
 * that richer hit shape is never lost to satisfy a stricter caller — see the individual
 * call sites (`cloudAgentEngine.ts`, `cloudExecutor.ts`) for how they consume it.
 */
export async function searchOwnedThenDiscover(args: { db: Db; env: Env; tenantId: number; request: SearchRequest; executionCtx?: ExecutionContext }) {
  const services = buildInternetSearch(args.db);
  const local = await services.search.search(args.tenantId, args.request);
  // `coverage: 'owned_index' as const` overrides `local`'s own (widened to `string`,
  // and technically `'owned_index' | 'empty_index'`) field — nonzero results already
  // proves this branch can only ever be the former, so this is a type narrowing, not a
  // behavior change.
  if (local.results.length) return { ok: true as const, ...local, coverage: 'owned_index' as const, attribution: 'Builderforce owned web index', research_request: null };

  const query = normalizeSearchQuery(args.request.query);
  const discovering = await services.search.queueResearch(args.tenantId, query, []);
  const backing = await resolveWebSearchBacking(args.env, args.db, args.tenantId);
  const discovery = await searchWeb(args.env, { ...backing, meter: { db: args.db, tenantId: args.tenantId } }, query);
  if (!discovery.ok) {
    await services.search.failResearch(args.tenantId, discovering.id, discovery.error ?? 'Web discovery failed.');
    return { ...discovery, research_request: { id: discovering.id, status: 'failed' as const, queued_urls: 0 } };
  }
  const urls = (discovery.results ?? []).map((result) => result.url).filter((url): url is string => typeof url === 'string' && url.length > 0);
  const queued = await services.search.queueResearch(args.tenantId, query, urls);
  if (!queued.queuedUrls) {
    await services.search.failResearch(args.tenantId, queued.id, 'Discovery returned no crawlable public URLs.');
    return { ...discovery, research_request: { id: queued.id, status: 'failed' as const, queued_urls: 0 } };
  }
  const crawl = services.crawler.runBatch(args.tenantId, Math.min(8, queued.queuedUrls));
  if (args.executionCtx) args.executionCtx.waitUntil(crawl); else await crawl;
  return { ...discovery, research_request: { id: queued.id, status: 'crawling' as const, queued_urls: queued.queuedUrls } };
}
