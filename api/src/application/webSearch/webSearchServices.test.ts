import { describe, expect, it } from 'vitest';
import { WebCrawlerService } from './crawlerService';
import { InternetSearchService } from './searchService';
import type { CrawledResponse, CrawlSource, FrontierItem, IndexedDocument, SearchCandidate, SearchFilters, WebSearchStore } from './ports';

class MemoryStore implements WebSearchStore {
  item: FrontierItem | null = null; robots: string | null = null; blocked: string | null = null; failed: string | null = null;
  stored: IndexedDocument | null = null; links: string[] = []; candidateRows: SearchCandidate[] = [];
  async addSource(): Promise<CrawlSource> { throw new Error('not used'); }
  async claim() { const value = this.item; this.item = null; return value; }
  async markFailed(_item: FrontierItem, error: string) { this.failed = error; }
  async markBlocked(_item: FrontierItem, reason: string) { this.blocked = reason; }
  async storeDocument(_item: FrontierItem, document: IndexedDocument) { this.stored = document; return { id: 'doc-1', changed: true, duplicate: false }; }
  async enqueueLinks(_item: FrontierItem, links: string[]) { this.links = links; return links.length; }
  async getRobots() { return this.robots === null ? null : { body: this.robots, expiresAt: new Date(Date.now() + 1000) }; }
  async putRobots(_origin: string, body: string) { this.robots = body; }
  async searchCandidates(_tenantId: number, _terms: string[], _filters: SearchFilters) { return { candidates: this.candidateRows, stats: { documentCount: this.candidateRows.length, averageLength: 20 } }; }
  async openDocument(_tenantId: number, url: string) { return this.candidateRows.find((row) => row.canonicalUrl === url) ?? null; }
  async queueResearch(_tenantId: number, _query: string, urls: string[]) { return { id: 'request-1', status: urls.length ? 'crawling' : 'discovering', queuedUrls: urls.length }; }
  async failResearch() {}
  async getResearch(_tenantId: number, requestId: string) { return { id: requestId, query: 'battery', status: 'crawling', resultCount: 0, lastError: null }; }
}

const item = (): FrontierItem => ({
  id: 1, tenantId: 7, url: 'https://example.com/start', normalizedUrl: 'https://example.com/start', domain: 'example.com', depth: 0, attempts: 1,
  source: { id: 'source', tenantId: 7, seedUrl: 'https://example.com/start', allowedDomains: ['example.com'], blockedDomains: [], maxDepth: 2, crawlDelayMs: 1000, perDomainConcurrency: 1, enabled: true },
});
const response = (url: string, body: string, contentType = 'text/html', status = 200): CrawledResponse => ({ url, body, status, contentType, headers: new Headers() });

describe('WebCrawlerService', () => {
  it('obeys robots.txt before fetching and indexing a page', async () => {
    const store = new MemoryStore(); store.item = item(); store.robots = 'User-agent: *\nDisallow: /start';
    let requests = 0; const crawler = new WebCrawlerService(store, { fetch: async () => { requests++; return response('', ''); } });
    expect(await crawler.runOne(7)).toMatchObject({ status: 'blocked' });
    expect(requests).toBe(0); expect(store.blocked).toBe('robots.txt'); expect(store.stored).toBeNull();
  });
  it('extracts, indexes, hashes and schedules discovered links', async () => {
    const store = new MemoryStore(); store.item = item(); store.robots = '';
    const crawler = new WebCrawlerService(store, { fetch: async (url) => response(url, '<html lang="en"><title>Research</title><main><h1>Battery</h1><p>A sufficiently long useful solid state battery research document for indexing.</p><a href="/next">Next</a></main></html>') });
    const result = await crawler.runOne(7);
    expect(result).toMatchObject({ status: 'indexed', documentId: 'doc-1', discovered: 1 });
    expect(store.stored?.contentHash).toMatch(/^[a-f0-9]{64}$/); expect(store.stored?.language).toBe('en');
    expect(store.links).toEqual(['https://example.com/next']);
  });
});

describe('InternetSearchService', () => {
  it('returns citation-ready ranked results and opens only tenant-indexed content', async () => {
    const store = new MemoryStore(); const crawled = new Date('2026-08-10T00:00:00Z');
    store.candidateRows = [{ id: 'doc', canonicalUrl: 'https://example.com/research', title: 'Solid state battery research', text: 'Current solid state battery research and findings.', headings: ['Findings'], domain: 'example.com', language: 'en', publishedAt: crawled, crawledAt: crawled, wordCount: 20, terms: [{ term: 'battery', titleFrequency: 1, headingFrequency: 0, bodyFrequency: 1, documentFrequency: 1 }] }];
    const service = new InternetSearchService(store);
    const search = await service.search(7, { query: 'battery', limit: 10, freshness: '30d' });
    expect(search.coverage).toBe('owned_index'); expect(search.results[0]).toMatchObject({ url: 'https://example.com/research', domain: 'example.com', language: 'en' });
    expect(search.results[0]?.scoring).toHaveProperty('bm25');
    expect(await service.open(7, 'https://example.com/research#fragment')).toMatchObject({ content: expect.stringContaining('findings'), source: { citationUrl: 'https://example.com/research' } });
    expect(await service.open(7, 'https://other.example/missing')).toBeNull();
  });
});
