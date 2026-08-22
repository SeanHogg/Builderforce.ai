import { extractHtmlDocument } from '../../domain/webSearch/htmlExtraction';
import { evaluateRobots } from '../../domain/webSearch/robots';
import { isUrlAllowed, normalizeWebUrl } from '../../domain/webSearch/urlPolicy';
import { tokenize } from '../../domain/webSearch/textIndex';
import type { CrawlerHttpPort, WebSearchStore } from './ports';
import { sha256Hex } from '../../infrastructure/crypto/digest';

export interface AddCrawlSourceInput { seedUrl: string; allowedDomains?: string[]; blockedDomains?: string[]; maxDepth?: number; crawlDelayMs?: number; perDomainConcurrency?: number }



export class WebCrawlerService {
  constructor(private readonly store: WebSearchStore, private readonly http: CrawlerHttpPort) {}

  async addSource(tenantId: number, input: AddCrawlSourceInput) {
    const seedUrl = normalizeWebUrl(input.seedUrl);
    const seedDomain = new URL(seedUrl).hostname;
    const allowedDomains = input.allowedDomains?.length ? input.allowedDomains : [seedDomain];
    if (!isUrlAllowed(seedUrl, { allowedDomains, blockedDomains: input.blockedDomains })) throw new Error('The seed URL is excluded by the supplied domain policy.');
    return this.store.addSource(tenantId, {
      seedUrl, allowedDomains, blockedDomains: input.blockedDomains ?? [],
      maxDepth: Math.max(0, Math.min(10, Math.floor(input.maxDepth ?? 2))),
      crawlDelayMs: Math.max(100, Math.min(86_400_000, Math.floor(input.crawlDelayMs ?? 1000))),
      perDomainConcurrency: Math.max(1, Math.min(16, Math.floor(input.perDomainConcurrency ?? 1))),
    });
  }

  private async robotsFor(url: string): Promise<{ allowed: boolean; delay: number | null }> {
    const parsed = new URL(url); const origin = parsed.origin;
    let cached = await this.store.getRobots(origin);
    if (!cached) {
      const response = await this.http.fetch(`${origin}/robots.txt`, { accept: 'text/plain', maxBytes: 512 * 1024 });
      const denyAll = response.status === 401 || response.status === 403;
      const temporary = response.status >= 500;
      if (temporary) throw new Error(`robots.txt temporarily unavailable (${response.status}).`);
      const body = denyAll ? 'User-agent: *\nDisallow: /' : response.status >= 200 && response.status < 300 ? response.body : '';
      const maxAge = /max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '')?.[1];
      const ttl = Math.max(300, Math.min(86_400, Number(maxAge ?? 21_600)));
      await this.store.putRobots(origin, body, response.status, new Date(Date.now() + ttl * 1000));
      cached = { body, expiresAt: new Date(Date.now() + ttl * 1000) };
    }
    const decision = evaluateRobots(cached.body, url);
    return { allowed: decision.allowed, delay: decision.crawlDelayMs };
  }

  async runOne(tenantId: number): Promise<{ status: string; url?: string; documentId?: string; changed?: boolean; discovered?: number }> {
    const item = await this.store.claim(tenantId);
    if (!item) return { status: 'idle' };
    try {
      if (!isUrlAllowed(item.normalizedUrl, item.source)) { await this.store.markBlocked(item, 'domain policy'); return { status: 'blocked', url: item.url }; }
      const robots = await this.robotsFor(item.normalizedUrl);
      if (!robots.allowed) { await this.store.markBlocked(item, 'robots.txt'); return { status: 'blocked', url: item.url }; }
      const response = await this.http.fetch(item.normalizedUrl);
      if (response.status < 200 || response.status >= 300) {
        await this.store.markFailed(item, `HTTP ${response.status}`, item.attempts >= 4 || (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429));
        return { status: 'failed', url: item.url };
      }
      if (!response.contentType.includes('text/html') && !response.contentType.includes('application/xhtml+xml')) {
        await this.store.markBlocked(item, `unsupported content type: ${response.contentType || 'unknown'}`);
        return { status: 'blocked', url: item.url };
      }
      const extracted = extractHtmlDocument(response.body, response.url);
      if (extracted.text.length < 40) { await this.store.markFailed(item, 'No indexable page content.', true); return { status: 'failed', url: item.url }; }
      const contentHash = await sha256Hex(`${extracted.title ?? ''}\n${extracted.text}`);
      const stored = await this.store.storeDocument(item, { ...extracted, originalUrl: item.url, contentHash, httpStatus: response.status, contentType: response.contentType, wordCount: tokenize(extracted.text).length });
      const discovered = await this.store.enqueueLinks(item, extracted.outboundLinks);
      return { status: stored.duplicate ? 'duplicate' : 'indexed', url: item.url, documentId: stored.id, changed: stored.changed, discovered };
    } catch (error) {
      await this.store.markFailed(item, error instanceof Error ? error.message : 'crawl failed', item.attempts >= 4);
      return { status: 'failed', url: item.url };
    }
  }

  async runBatch(tenantId: number, limit = 5) {
    const results = [];
    for (let i = 0; i < Math.max(1, Math.min(25, limit)); i++) {
      const result = await this.runOne(tenantId); results.push(result); if (result.status === 'idle') break;
    }
    return { processed: results.filter((result) => result.status !== 'idle').length, results };
  }
}
