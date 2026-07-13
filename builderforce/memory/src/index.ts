/**
 * BuilderForce Memory Package
 * Core memory management utilities for AI agents with file-backed search and retrieval
 */

export * from './memory-store.js';
export * from './search-engine.js';
export * from './types.js';

import { MemoryStore } from './memory-store.js';
import { SearchEngine } from './search-engine.js';
import type { MemoryEntry, SearchQuery, SearchResult, PersistenceStrategy } from './types.js';

/**
 * Default configuration for memory storage
 */
export const DEFAULT_CONFIG = {
  storagePath: './memory-data',
  maxEntries: 10000,
  compress: true,
  version: '1.0.0'
} as const;

/**
 * Create a new memory store instance
 */
export function createMemoryStore(
  options?: Partial<PersistenceStrategy>
): MemoryStore {
  return new MemoryStore(options);
}

/**
 * Create a search engine for memory retrieval
 */
export function createSearchEngine(store: MemoryStore): SearchEngine {
  return new SearchEngine(store);
}

/**
 * Initialize a complete memory system with store and search engine
 */
export async function initMemorySystem(
  config?: Partial<PersistenceStrategy>
): Promise<{ store: MemoryStore; engine: SearchEngine }> {
  const store = createMemoryStore(config);
  const engine = createSearchEngine(store);

  await store.initialize();

  return { store, engine };
}

/**
 * Memory package entry point
 */
export default {
  MemoryStore,
  SearchEngine,
  createMemoryStore,
  createSearchEngine,
  initMemorySystem,
  DEFAULT_CONFIG
};