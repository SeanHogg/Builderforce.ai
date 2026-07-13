/**
 * Search Engine - Memory search and retrieval
 * Provides querying and ranking capabilities
 */

import type { MemoryEntry, SearchQuery, SearchResult, SearchEngineAPI } from './types.js';
import { MemoryStore } from './memory-store.js';

export class SearchEngine implements SearchEngineAPI {
  private store: MemoryStore;
  private index = new Map<string, MemoryEntry[]>();
  private config: any;

  constructor(store: MemoryStore, config?: any) {
    this.store = store;
    this.config = config || {};
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const startTime = Date.now();
    let entries = Array.from(this.store.entries.values());

    // Filter by text match
    if (query.text) {
      entries = entries.filter(entry => {
        const text = entry.content.toLowerCase();
        const queryText = query.text.toLowerCase();
        return text.includes(queryText);
      });
    }

    // Apply query filters
    if (query.filters) {
      // Note: This is simplified - actual implementation would be more sophisticated
      entries = entries.filter(entry => {
        if (query.filters.tags) {
          // Tag filtering will be handled by MemoryStore
          return query.filters.tags.every(tag => entry.metadata?.tags?.includes(tag));
        }
        return true;
      });
    }

    // Rank results based on query ranking method
    const results: SearchResult[] = entries.map(entry => ({
      entry,
      score: this.calculateScore(query, entry)
    }));

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    // Apply limit
    if (query.limit) {
      return results.slice(0, query.limit);
    }

    return results;
  }

  async findSimilar(query: SearchQuery, limit?: number): Promise<SearchResult[]> {
    // Placeholder for similarity search
    // In a real implementation, would use embeddings or other similarity algorithms
    return this.search(query).then(results => {
      if (limit) {
        return results.slice(0, limit);
      }
      return results;
    });
  }

  async indexEntry(entry: MemoryEntry): Promise<void> {
    // Placeholder for indexing
    if (!this.index.has('all')) {
      this.index.set('all', []);
    }
    this.index.get('all')!.push(entry);
  }

  async removeEntry(id: string): Promise<void> {
    const allEntries = this.index.get('all') || [];
    this.index.set('all', allEntries.filter(entry => entry.id !== id));
  }

  async optimize(): Promise<void> {
    // Placeholder for optimization
    // Could rebuild index, clean up, etc.
  }

  private calculateScore(query: SearchQuery, entry: MemoryEntry): number {
    let score = 0;

    // Text relevance score (simple count of matches)
    if (query.text) {
      const entryText = entry.content.toLowerCase();
      const queryText = query.text.toLowerCase();
      const matches = (entryText.match(new RegExp(queryText.split(' ').join('.*'), 'gi')) || []).length;
      score += matches * 10;
    }

    // Recency boost for recent entries
    const age = Date.now() - entry.createdAt;
    if (age < 86400000) { // Less than 24 hours
      score += 2;
    } else if (age < 604800000) { // Less than a week
      score += 1;
    }

    // Importance boost
    if (entry.metadata?.importance) {
      score += entry.metadata.importance;
    }

    // Tag matches
    if (query.filters?.tags && entry.metadata?.tags) {
      score += query.filters.tags.filter(tag => entry.metadata!.tags!.includes(tag)).length * 5;
    }

    // Hybrid ranking method
    if (query.ranking?.method === 'hybrid') {
      // Combine multiple scores
      score = (score * 0.6) + (1 - age / 31536000000) * 0.4;
    }

    return Math.max(0, score);
  }
}