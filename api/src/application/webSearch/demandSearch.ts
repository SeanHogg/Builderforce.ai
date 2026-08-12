import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { normalizeSearchQuery, searchWeb } from '../runtime/cloudWeb';
import { resolveWebSearchBacking } from '../runtime/webSearchCredential';
import { buildInternetSearch } from './factory';
import type { SearchRequest } from './searchService';

export async function searchOwnedThenDiscover(args: { db: Db; env: Env; tenantId: number; request: SearchRequest; executionCtx?: ExecutionContext }) {
  const services = buildInternetSearch(args.db);
  const local = await services.search.search(args.tenantId, args.request);
  if (local.results.length) return { ok: true as const, ...local, attribution: 'Builderforce owned web index', research_request: null };

  const query = normalizeSearchQuery(args.request.query);
  const discovering = await services.search.queueResearch(args.tenantId, query, []);
  const backing = await resolveWebSearchBacking(args.env, args.db, args.tenantId);
  const discovery = await searchWeb(args.env, { ...backing, meter: { db: args.db, tenantId: args.tenantId } }, query);
  if (!discovery.ok) {
    await services.search.failResearch(args.tenantId, discovering.id, discovery.error ?? 'Web discovery failed.');
    return { ...discovery, research_request: { id: discovering.id, status: 'failed', queued_urls: 0 } };
  }
  const urls = (discovery.results ?? []).map((result) => result.url).filter((url): url is string => typeof url === 'string' && url.length > 0);
  const queued = await services.search.queueResearch(args.tenantId, query, urls);
  if (!queued.queuedUrls) {
    await services.search.failResearch(args.tenantId, queued.id, 'Discovery returned no crawlable public URLs.');
    return { ...discovery, research_request: { id: queued.id, status: 'failed', queued_urls: 0 } };
  }
  const crawl = services.crawler.runBatch(args.tenantId, Math.min(8, queued.queuedUrls));
  if (args.executionCtx) args.executionCtx.waitUntil(crawl); else await crawl;
  return { ...discovery, research_request: { id: queued.id, status: 'crawling', queued_urls: queued.queuedUrls } };
}
