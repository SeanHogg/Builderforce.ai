import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../database/connection';
import { webSearchDocuments, webSearchFrontier, webSearchRobots, webSearchSources, webSearchTerms } from '../database/schema';
import { termFrequencies } from '../../domain/webSearch/textIndex';
import { isUrlAllowed, normalizeWebUrl } from '../../domain/webSearch/urlPolicy';
import type { CrawlSource, FrontierItem, IndexedDocument, SearchCandidate, SearchFilters, WebSearchStore } from '../../application/webSearch/ports';

function sourceRow(row: typeof webSearchSources.$inferSelect): CrawlSource {
  return { id: row.id, tenantId: row.tenantId, seedUrl: row.seedUrl, allowedDomains: row.allowedDomains, blockedDomains: row.blockedDomains, maxDepth: row.maxDepth, crawlDelayMs: row.crawlDelayMs, enabled: row.enabled };
}

export class PostgresWebSearchStore implements WebSearchStore {
  constructor(private readonly db: Db) {}

  async addSource(tenantId: number, input: Omit<CrawlSource, 'id' | 'tenantId' | 'enabled'>): Promise<CrawlSource> {
    const [row] = await this.db.insert(webSearchSources).values({ tenantId, seedUrl: input.seedUrl, allowedDomains: input.allowedDomains, blockedDomains: input.blockedDomains, maxDepth: input.maxDepth, crawlDelayMs: input.crawlDelayMs })
      .onConflictDoUpdate({ target: [webSearchSources.tenantId, webSearchSources.seedUrl], set: { allowedDomains: input.allowedDomains, blockedDomains: input.blockedDomains, maxDepth: input.maxDepth, crawlDelayMs: input.crawlDelayMs, enabled: true, updatedAt: new Date() } }).returning();
    if (!row) throw new Error('Could not create crawl source.');
    const normalized = normalizeWebUrl(input.seedUrl);
    await this.db.insert(webSearchFrontier).values({ tenantId, sourceId: row.id, url: input.seedUrl, normalizedUrl: normalized, domain: new URL(normalized).hostname, depth: 0, priority: 100 })
      .onConflictDoNothing({ target: [webSearchFrontier.tenantId, webSearchFrontier.normalizedUrl] });
    return sourceRow(row);
  }

  async claim(tenantId: number): Promise<FrontierItem | null> {
    const result = await this.db.execute(sql`
      WITH candidate AS (
        SELECT f.id FROM web_search_frontier f JOIN web_search_sources s ON s.id = f.source_id
        WHERE f.tenant_id = ${tenantId} AND s.enabled = TRUE
          AND (f.status = 'queued' OR (f.status = 'leased' AND f.lease_expires_at < NOW()))
          AND f.next_fetch_at <= NOW() AND f.attempts < 4
        ORDER BY f.priority DESC, f.next_fetch_at ASC, f.id ASC LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      UPDATE web_search_frontier f SET status = 'leased', attempts = attempts + 1,
        lease_expires_at = NOW() + INTERVAL '2 minutes', updated_at = NOW()
      FROM candidate WHERE f.id = candidate.id RETURNING f.*
    `);
    const raw = result.rows[0] as Record<string, unknown> | undefined; if (!raw) return null;
    const [source] = await this.db.select().from(webSearchSources).where(eq(webSearchSources.id, String(raw.source_id))).limit(1);
    if (!source) return null;
    return { id: Number(raw.id), tenantId, source: sourceRow(source), url: String(raw.url), normalizedUrl: String(raw.normalized_url), domain: String(raw.domain), depth: Number(raw.depth), attempts: Number(raw.attempts) };
  }

  async markFailed(item: FrontierItem, error: string, terminal: boolean): Promise<void> {
    const retryMinutes = Math.min(1440, 2 ** item.attempts);
    await this.db.update(webSearchFrontier).set({ status: terminal ? 'failed' : 'queued', lastError: error.slice(0, 2000), leaseExpiresAt: null, nextFetchAt: new Date(Date.now() + retryMinutes * 60_000), updatedAt: new Date() }).where(and(eq(webSearchFrontier.id, item.id), eq(webSearchFrontier.tenantId, item.tenantId)));
  }
  async markBlocked(item: FrontierItem, reason: string): Promise<void> {
    await this.db.update(webSearchFrontier).set({ status: 'blocked', lastError: reason.slice(0, 2000), leaseExpiresAt: null, updatedAt: new Date() }).where(and(eq(webSearchFrontier.id, item.id), eq(webSearchFrontier.tenantId, item.tenantId)));
  }

  async storeDocument(item: FrontierItem, doc: IndexedDocument): Promise<{ id: string; changed: boolean; duplicate: boolean }> {
    const [existing] = await this.db.select({ id: webSearchDocuments.id, contentHash: webSearchDocuments.contentHash }).from(webSearchDocuments)
      .where(and(eq(webSearchDocuments.tenantId, item.tenantId), eq(webSearchDocuments.canonicalUrl, doc.canonicalUrl))).limit(1);
    const [same] = await this.db.select({ id: webSearchDocuments.id }).from(webSearchDocuments)
      .where(and(eq(webSearchDocuments.tenantId, item.tenantId), eq(webSearchDocuments.contentHash, doc.contentHash))).limit(1);
    const duplicateOf = same && same.id !== existing?.id ? same.id : null;
    const [stored] = await this.db.insert(webSearchDocuments).values({ tenantId: item.tenantId, canonicalUrl: doc.canonicalUrl, originalUrl: doc.originalUrl, title: doc.title, text: doc.text, headings: doc.headings, domain: new URL(doc.canonicalUrl).hostname, language: doc.language, publicationTimestamp: doc.publicationTimestamp, contentHash: doc.contentHash, httpStatus: doc.httpStatus, contentType: doc.contentType, outboundLinks: doc.outboundLinks, metadata: doc.metadata, author: doc.author, wordCount: doc.wordCount, duplicateOf, crawlTimestamp: new Date(), nextCrawlAt: new Date(Date.now() + 86_400_000) })
      .onConflictDoUpdate({ target: [webSearchDocuments.tenantId, webSearchDocuments.canonicalUrl], set: { originalUrl: doc.originalUrl, title: doc.title, text: doc.text, headings: doc.headings, language: doc.language, publicationTimestamp: doc.publicationTimestamp, contentHash: doc.contentHash, httpStatus: doc.httpStatus, contentType: doc.contentType, outboundLinks: doc.outboundLinks, metadata: doc.metadata, author: doc.author, wordCount: doc.wordCount, duplicateOf, crawlTimestamp: new Date(), updatedAt: new Date(), nextCrawlAt: new Date(Date.now() + 86_400_000) } }).returning({ id: webSearchDocuments.id });
    if (!stored) throw new Error('Document upsert returned no row.');
    const changed = existing?.contentHash !== doc.contentHash;
    if (changed && !duplicateOf) {
      await this.db.delete(webSearchTerms).where(and(eq(webSearchTerms.tenantId, item.tenantId), eq(webSearchTerms.documentId, stored.id)));
      const title = termFrequencies(doc.title ?? ''); const heading = termFrequencies(doc.headings.join(' ')); const body = termFrequencies(doc.text);
      const terms = new Set([...title.keys(), ...heading.keys(), ...body.keys()]);
      const values = [...terms].map((term) => ({ tenantId: item.tenantId, documentId: stored.id, term, titleFrequency: title.get(term) ?? 0, headingFrequency: heading.get(term) ?? 0, bodyFrequency: body.get(term) ?? 0 }));
      for (let offset = 0; offset < values.length; offset += 500) await this.db.insert(webSearchTerms).values(values.slice(offset, offset + 500));
    }
    await this.db.update(webSearchFrontier).set({ status: 'fetched', lastError: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(webSearchFrontier.id, item.id));
    await this.db.update(webSearchFrontier).set({ nextFetchAt: new Date(Date.now() + item.source.crawlDelayMs) }).where(and(eq(webSearchFrontier.tenantId, item.tenantId), eq(webSearchFrontier.domain, item.domain), eq(webSearchFrontier.status, 'queued')));
    return { id: stored.id, changed, duplicate: duplicateOf !== null };
  }

  async enqueueLinks(item: FrontierItem, links: string[]): Promise<number> {
    if (item.depth >= item.source.maxDepth) return 0;
    const rows = [...new Set(links)].flatMap((url) => { try { const normalized = normalizeWebUrl(url); if (!isUrlAllowed(normalized, item.source)) return []; return [{ tenantId: item.tenantId, sourceId: item.source.id, url, normalizedUrl: normalized, domain: new URL(normalized).hostname, depth: item.depth + 1 }]; } catch { return []; } }).slice(0, 500);
    if (!rows.length) return 0;
    await this.db.insert(webSearchFrontier).values(rows).onConflictDoNothing({ target: [webSearchFrontier.tenantId, webSearchFrontier.normalizedUrl] });
    return rows.length;
  }
  async getRobots(origin: string): Promise<{ body: string; expiresAt: Date } | null> { const [row] = await this.db.select().from(webSearchRobots).where(and(eq(webSearchRobots.domain, origin), sql`${webSearchRobots.expiresAt} > NOW()`)).limit(1); return row ? { body: row.body, expiresAt: row.expiresAt } : null; }
  async putRobots(origin: string, body: string, status: number, expiresAt: Date): Promise<void> { await this.db.insert(webSearchRobots).values({ domain: origin, body, fetchStatus: status, expiresAt }).onConflictDoUpdate({ target: webSearchRobots.domain, set: { body, fetchStatus: status, fetchedAt: new Date(), expiresAt } }); }

  async searchCandidates(tenantId: number, terms: string[], filters: SearchFilters): Promise<{ candidates: SearchCandidate[]; stats: { documentCount: number; averageLength: number } }> {
    if (!terms.length) return { candidates: [], stats: { documentCount: 0, averageLength: 1 } };
    const conditions = [eq(webSearchDocuments.tenantId, tenantId), inArray(webSearchTerms.term, terms), sql`${webSearchDocuments.duplicateOf} IS NULL`];
    if (filters.language) conditions.push(eq(webSearchDocuments.language, filters.language));
    if (filters.domains?.length) conditions.push(inArray(webSearchDocuments.domain, filters.domains));
    if (filters.since) conditions.push(sql`COALESCE(${webSearchDocuments.publicationTimestamp}, ${webSearchDocuments.crawlTimestamp}) >= ${filters.since}`);
    const rows = await this.db.select({ document: webSearchDocuments, term: webSearchTerms.term, titleFrequency: webSearchTerms.titleFrequency, headingFrequency: webSearchTerms.headingFrequency, bodyFrequency: webSearchTerms.bodyFrequency })
      .from(webSearchTerms).innerJoin(webSearchDocuments, eq(webSearchDocuments.id, webSearchTerms.documentId)).where(and(...conditions)).orderBy(desc(webSearchDocuments.crawlTimestamp)).limit(Math.min(500, (filters.limit + filters.offset) * Math.max(terms.length, 1) * 5));
    const dfs = await this.db.select({ term: webSearchTerms.term, value: count(webSearchTerms.documentId) }).from(webSearchTerms).where(and(eq(webSearchTerms.tenantId, tenantId), inArray(webSearchTerms.term, terms))).groupBy(webSearchTerms.term);
    const df = new Map(dfs.map((row) => [row.term, Number(row.value)]));
    const [stats] = await this.db.select({ documentCount: count(webSearchDocuments.id), averageLength: sql<number>`COALESCE(AVG(${webSearchDocuments.wordCount}), 1)` }).from(webSearchDocuments).where(and(eq(webSearchDocuments.tenantId, tenantId), sql`${webSearchDocuments.duplicateOf} IS NULL`));
    const grouped = new Map<string, SearchCandidate>();
    for (const row of rows) {
      let candidate = grouped.get(row.document.id);
      if (!candidate) { candidate = { id: row.document.id, canonicalUrl: row.document.canonicalUrl, title: row.document.title, text: row.document.text, headings: row.document.headings, domain: row.document.domain, language: row.document.language, publishedAt: row.document.publicationTimestamp, crawledAt: row.document.crawlTimestamp, wordCount: row.document.wordCount, terms: [] }; grouped.set(candidate.id, candidate); }
      candidate.terms.push({ term: row.term, titleFrequency: row.titleFrequency, headingFrequency: row.headingFrequency, bodyFrequency: row.bodyFrequency, documentFrequency: df.get(row.term) ?? 1 });
    }
    return { candidates: [...grouped.values()], stats: { documentCount: Number(stats?.documentCount ?? 0), averageLength: Number(stats?.averageLength ?? 1) } };
  }
  async openDocument(tenantId: number, url: string): Promise<SearchCandidate | null> {
    const normalized = normalizeWebUrl(url); const [row] = await this.db.select().from(webSearchDocuments).where(and(eq(webSearchDocuments.tenantId, tenantId), eq(webSearchDocuments.canonicalUrl, normalized))).limit(1);
    return row ? { id: row.id, canonicalUrl: row.canonicalUrl, title: row.title, text: row.text, headings: row.headings, domain: row.domain, language: row.language, publishedAt: row.publicationTimestamp, crawledAt: row.crawlTimestamp, wordCount: row.wordCount, terms: [] } : null;
  }
}

