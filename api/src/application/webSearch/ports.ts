import type { ExtractedWebDocument } from '../../domain/webSearch/htmlExtraction';

export interface CrawlSource {
  id: string; tenantId: number; seedUrl: string; allowedDomains: string[]; blockedDomains: string[];
  maxDepth: number; crawlDelayMs: number; enabled: boolean;
}
export interface FrontierItem { id: number; tenantId: number; source: CrawlSource; url: string; normalizedUrl: string; domain: string; depth: number; attempts: number }
export interface IndexedDocument extends ExtractedWebDocument {
  originalUrl: string; contentHash: string; httpStatus: number; contentType: string; wordCount: number;
}
export interface SearchFilters { domains?: string[]; language?: string; since?: Date; limit: number; offset: number }
export interface SearchCandidate {
  id: string; canonicalUrl: string; title: string | null; text: string; headings: string[]; domain: string; language: string | null;
  publishedAt: Date | null; crawledAt: Date; wordCount: number;
  terms: Array<{ term: string; titleFrequency: number; headingFrequency: number; bodyFrequency: number; documentFrequency: number }>;
}
export interface SearchCorpusStats { documentCount: number; averageLength: number }

export interface WebSearchStore {
  addSource(tenantId: number, source: Omit<CrawlSource, 'id' | 'tenantId' | 'enabled'>): Promise<CrawlSource>;
  claim(tenantId: number): Promise<FrontierItem | null>;
  markFailed(item: FrontierItem, error: string, terminal: boolean): Promise<void>;
  markBlocked(item: FrontierItem, reason: string): Promise<void>;
  storeDocument(item: FrontierItem, document: IndexedDocument): Promise<{ id: string; changed: boolean; duplicate: boolean }>;
  enqueueLinks(item: FrontierItem, links: string[]): Promise<number>;
  getRobots(origin: string): Promise<{ body: string; expiresAt: Date } | null>;
  putRobots(origin: string, body: string, status: number, expiresAt: Date): Promise<void>;
  searchCandidates(tenantId: number, terms: string[], filters: SearchFilters): Promise<{ candidates: SearchCandidate[]; stats: SearchCorpusStats }>;
  openDocument(tenantId: number, url: string): Promise<SearchCandidate | null>;
}

export interface CrawledResponse { url: string; status: number; contentType: string; body: string; headers: Headers }
export interface CrawlerHttpPort { fetch(url: string, options?: { accept?: string; maxBytes?: number }): Promise<CrawledResponse> }

export interface SemanticMatch { documentId: string; score: number }
export interface SemanticIndex { search(tenantId: number, query: string, limit: number): Promise<SemanticMatch[]> }

