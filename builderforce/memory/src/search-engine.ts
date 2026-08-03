/**
 * Search Engine - Memory search and retrieval
 * Provides querying and ranking capabilities
 */

import type {
  MemoryEntry,
  SearchQuery,
  SearchResult,
  SearchEngineAPI,
  SearchEngineConfig
} from './types.js';
import { MemoryStore } from './memory-store.js';

export class SearchEngine implements SearchEngineAPI {
  private store: MemoryStore;
  private index = new Map<string, MemoryEntry[]>();
  private config: SearchEngineConfig;

  constructor(store: MemoryStore, config?: SearchEngineConfig) {
    this.store = store;
    this.config = config || {};
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    // Get entries with structured filters applied via the store
    let entries: MemoryEntry[];

    if (query.filters) {
      entries = await this.store.list(query.filters);
    } else {
      entries = this.store.getAllEntries();
    }

    // Filter by text match
    if (query.text) {
      const queryLower = query.text.toLowerCase();
      entries = entries.filter(entry => {
        const text = entry.content.toLowerCase();
        return text.includes(queryLower);
      });
    }

    // Rank results
    const results: SearchResult[] = entries.map(entry => ({
      entry,
      score: this.calculateScore(query, entry)
    }));

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Apply limit
    if (query.limit) {
      return results.slice(0, query.limit);
    }

    return results;
  }

  async findSimilar(query: SearchQuery, limit?: number): Promise<SearchResult[]> {
    // Delegate to search; in a production implementation this would use
    // embeddings or other similarity algorithms
    const results = await this.search(query);
    if (limit) {
      return results.slice(0, limit);
    }
    return results;
  }

  async indexEntry(entry: MemoryEntry): Promise<void> {
    if (!this.index.has('all')) {
      this.index.set('all', []);
    }
    this.index.get('all')!.push(entry);
  }

  async removeEntry(id: string): Promise<void> {
    const allEntries = this.index.get('all') || [];
    this.index.set(
      'all',
      allEntries.filter(entry => entry.id !== id)
    );
  }

  async optimize(): Promise<void> {
    // Rebuild the index from the store
    this.index.set('all', this.store.getAllEntries());
  }

  private calculateScore(query: SearchQuery, entry: MemoryEntry): number {
    let score = 0;

    // Text relevance score (simple count of matches)
    if (query.text) {
      const entryText = entry.content.toLowerCase();
      const queryText = query.text.toLowerCase();
      const matches = (
        entryText.match(new RegExp(queryText.split(' ').join('.*'), 'gi')) ||
        []
      ).length;
      score += matches * 10;
    }

    // Recency boost for recent entries
    const age = Date.now() - entry.createdAt;
    if (age < 86400000) {
      // Less than 24 hours
      score += 2;
    } else if (age < 604800000) {
      // Less than a week
      score += 1;
    }

    // Importance boost
    if (entry.metadata?.importance) {
      score += entry.metadata.importance;
    }

    // Tag matches
    if (query.filters?.tags && entry.metadata?.tags) {
      score +=
        query.filters.tags.filter(tag =>
          entry.metadata!.tags!.includes(tag)
        ).length * 5;
    }

    // Hybrid ranking method
    if (query.ranking?.method === 'hybrid') {
      // Combine multiple scores with recency decay
      const recencyFactor = 1 - age / 31536000000;
      score = score * 0.6 + recencyFactor * 0.4;
    }

    return Math.max(0, score);
  }
}
