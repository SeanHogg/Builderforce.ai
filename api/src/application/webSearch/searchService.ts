import { makeSnippet, rankLexical, tokenize } from '../../domain/webSearch/textIndex';
import { normalizeWebUrl } from '../../domain/webSearch/urlPolicy';
import type { SemanticIndex, WebSearchStore } from './ports';

export interface SearchRequest { query: string; limit?: number; offset?: number; domains?: string[]; language?: string; freshness?: string; since?: string }

function sinceDate(request: Pick<SearchRequest, 'freshness' | 'since'>): Date | undefined {
  if (request.since) { const date = new Date(request.since); if (!Number.isNaN(date.getTime())) return date; }
  const match = /^(\d+)([dhwmy])$/.exec(request.freshness ?? ''); if (!match) return undefined;
  const units: Record<string, number> = { d: 1, h: 1 / 24, w: 7, m: 30, y: 365 };
  return new Date(Date.now() - Number(match[1]) * units[match[2]!]! * 86_400_000);
}

export class InternetSearchService {
  constructor(private readonly store: WebSearchStore, private readonly semantic?: SemanticIndex) {}
  async search(tenantId: number, request: SearchRequest) {
    const query = request.query?.trim().replace(/\s+/g, ' ');
    if (!query) throw new Error('query is required');
    if (query.length > 500) throw new Error('query must be 500 characters or fewer');
    const limit = Math.max(1, Math.min(25, Math.floor(request.limit ?? 10)));
    const offset = Math.max(0, Math.min(1000, Math.floor(request.offset ?? 0)));
    const terms = [...new Set(tokenize(query))].slice(0, 24);
    const lexical = await this.store.searchCandidates(tenantId, terms, { limit, offset, domains: request.domains?.map((domain) => domain.toLowerCase()), language: request.language?.toLowerCase(), since: sinceDate(request) });
    const ranked = rankLexical(query, lexical.candidates, lexical.stats.documentCount, lexical.stats.averageLength);
    const semantic = this.semantic ? await this.semantic.search(tenantId, query, Math.min(50, limit * 3)) : [];
    const semanticMap = new Map(semantic.map((match) => [match.documentId, match.score]));
    const merged = ranked.map((result, index) => {
      const semanticScore = semanticMap.get(result.id) ?? 0;
      const hybridScore = result.score + semanticScore * 0.8 + 1 / (60 + index + 1);
      return { ...result, score: hybridScore, scoring: { ...result.scoring, semantic: semanticScore, hybrid: hybridScore } };
    }).sort((a, b) => b.score - a.score).slice(offset, offset + limit);
    return {
      query, limit, offset, coverage: lexical.stats.documentCount ? 'owned_index' : 'empty_index', retrieval: this.semantic ? 'hybrid' : 'lexical',
      results: merged.map((result) => ({ title: result.title, url: result.canonicalUrl, domain: result.domain, snippet: makeSnippet(result.text, query), published_at: result.publishedAt?.toISOString() ?? null, crawled_at: result.crawledAt.toISOString(), language: result.language, score: result.score, scoring: result.scoring, source: { https: result.canonicalUrl.startsWith('https://'), type: 'crawled_web', firstParty: false } })),
    };
  }
  async open(tenantId: number, rawUrl: string) {
    const url = normalizeWebUrl(rawUrl); const document = await this.store.openDocument(tenantId, url);
    if (!document) return null;
    return { title: document.title, url: document.canonicalUrl, domain: document.domain, content: document.text, headings: document.headings, language: document.language, published_at: document.publishedAt?.toISOString() ?? null, crawled_at: document.crawledAt.toISOString(), source: { type: 'crawled_web', citationUrl: document.canonicalUrl } };
  }
  queueResearch(tenantId: number, query: string, urls: string[]) { return this.store.queueResearch(tenantId, query, urls); }
  failResearch(tenantId: number, requestId: string, error: string) { return this.store.failResearch(tenantId, requestId, error); }
  getResearch(tenantId: number, requestId: string) { return this.store.getResearch(tenantId, requestId); }
}
