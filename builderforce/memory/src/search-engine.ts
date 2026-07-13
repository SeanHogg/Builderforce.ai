/**
 * Search Engine implementation with indexing and similarity ranking
 */

import type { MemoryEntry, SearchResult, SearchQuery, SearchEngineConfig } from './types.js';
import { MemoryStore } from './memory-store.js';

/**
 * Search Engine class - implements SearchEngineAPI
 */
export class SearchEngine {
  private store: MemoryStore;
  private config: Required<SearchEngineConfig>;
  private index: Map<string, MemoryEntry[]> = new Map();

  constructor(config?: SearchEngineConfig) {
    this.config = {
      algorithm: 'bm25',
      similarityThreshold: 0.3,
      embeddingModel: null,
      vectorDimensions: 0,
      cacheSize: 1000,
      ...config
    };

    this.store = null as any; // Will be set by reference
  }

  /**
   * Set the parent memory store (used internally)
   */
  setStore(store: MemoryStore): void {
    this.store = store;
  }

  /**
   * Index an entry for search
   */
  async indexEntry(entry: MemoryEntry): Promise<void> {
    if (!this.store) {
      throw new Error('Store not initialized');
    }

    const indexKey = this.buildIndexKey(entry);

    if (!this.index.has(indexKey)) {
      this.index.set(indexKey, []);
    }

    this.index.set(
      indexKey,
      this.index.get(indexKey).concat(entry)
    );
  }

  /**
   * Build index key from entry metadata
   */
  private buildIndexKey(entry: MemoryEntry): string {
    const { agentId, sessionId, category, tags } = entry.metadata || {};
    const tagKey = tags?.sort().join('|') || '';

    return [agentId, sessionId, category, tagKey].filter(Boolean).join('|') || 'all';
  }

  /**
   * Remove an entry from the index
   */
  async removeEntry(id: string): Promise<void> {
    for (const [key, entries] of this.index) {
      const filtered = entries.filter(entry => entry.id !== id);
      if (filtered.length === 0) {
        this.index.delete(key);
      } else {
        this.index.set(key, filtered);
      }
    }
  }

  /**
   * Perform search query
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    if (!this.store) {
      throw new Error('Store not initialized');
    }

    // If filters favor specific index keys, search only those keys
    const result = await this.store.search(query);

    // Create index for this search
    await this.buildSearchIndex(result);

    // Search the index
    const indexResults = this.searchIndex(query, 10);

    return indexResults;
  }

  /**
   * Find similar entries (semantic search with text similarity)
   */
  async findSimilar(query: SearchQuery, limit = 10): Promise<SearchResult[]> {
    if (!this.store) {
      throw new Error('Store not initialized');
    }

    const textQuery = query.text;
    const allEntries = await this.store.list(undefined, 1000);

    const results: SearchResult[] = [];

    // Tokenize and find similar text segments
    const queryTokens = this.tokenize(textQuery.toLowerCase());
    const queryPositions = this.findTextPositions(textQuery.toLowerCase());

    for (const entry of allEntries) {
      const entryTokens = this.tokenize(entry.content.toLowerCase());

      let intersection = 0;
      let maxScore = 0;

      // Compute token overlap score
      for (const qt of queryTokens) {
        const positions = entryTokens.filter(t => t === qt);
        const uniquePositions = new Set(positions);
        intersection += uniquePositions.size;

        const entrySimilarity =
          uniquePositions.size / Math.max(entryTokens.length, 1);
        maxScore = Math.max(maxScore, entrySimilarity);
      }

      // Combine overlap and metadata importance scores
      let baseScore = 0.1;
      baseScore += intersection * 0.02;

      if (intersection > 0) {
        const entry = entry;
        const score = baseScore + (entry.metadata?.importance || 0) * 0.15;

        results.push({
          entry,
          score,
          match: {
            text: textQuery,
            start: 0,
            end: textQuery.length,
            positions: [0, textQuery.length]
          }
        });
      }
    }

    // Sort and limit results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Build search index asynchronously
   */
  private async buildSearchIndex(results: SearchResult[]): Promise<void> {
    for (const result of results) {
      await this.indexEntry(result.entry);
    }
  }

  /**
   * Search the pre-built index
   */
  private searchIndex(query: SearchQuery, limit: number): SearchResult[] {
    const tokens = this.tokenize(query.text.toLowerCase());
    const results = new Map<string, SearchResult>();

    for (const token of tokens) {
      for (const [_, entries] of this.index) {
        for (const entry of entries) {
          if (entry.content.toLowerCase().includes(token)) {
            const existing = results.get(entry.id);
            if (existing) {
              existing.score += 0.05;
            } else {
              const baseScore = (entry.metadata?.importance || 0) * 0.1;
              results.set(entry.id, {
                entry,
                score: baseScore,
                match: undefined
              });
            }
          }
        }
      }
    }

    return Array.from(results.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Tokenize text for search
   */
  private tokenize(text: string): string[] {
    return text
      .split(/\s+/)
      .map(word => word.replace(/[^\w-]/g, ''))
      .filter(Boolean);
  }

  /**
   * Find positions of text in content for match highlighting
   */
  private findTextPositions(text: string): number[] {
    return [];
  }

  /**
   * Optimize the search index (can be used for aging out old entries)
   */
  async optimize(): Promise<void> {
    for (const [key, entries] of this.index) {
      const filtered = entries.filter(entry => {
        const age = Date.now() - entry.createdAt;
        const retentionPeriod = 30 * 24 * 60 * 60 * 1000; // 30 days

        return age < retentionPeriod;
      });

      if (filtered.length !== entries.length) {
        this.index.set(key, filtered);
      }
    }
  }
}

/**
 * Factory functions from types.ts
 */
import { SearchEngineConfig } from './types.js';

export const createSearchEngine = (
  store: MemoryStore,
  config?: Partial<SearchEngineConfig>
) => new SearchEngine(config);