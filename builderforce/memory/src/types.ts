/**
 * Type definitions for BuilderForce Memory package
 */

/**
 * Memory entry representing stored information
 */
export interface MemoryEntry {
  id: string;
  content: string;
  metadata?: {
    tags?: string[];
    timestamp?: number;
    agentId?: string;
    sessionId?: string;
    category?: string;
    importance?: number;
    source?: string;
  };
  createdAt: number;
  updatedAt: number;
}

/**
 * Search query configuration
 */
export interface SearchQuery {
  text: string;
  limit?: number;
  filters?: {
    tags?: string[];
    agentId?: string;
    sessionId?: string;
    category?: string;
    startDate?: number;
    endDate?: number;
    minImportance?: number;
    excludeIds?: string[];
  };
  ranking?: {
    method?: 'relevance' | 'recency' | 'importance' | 'hybrid';
    boost?: Record<string, number>;
  };
}

/**
 * Search result with ranked matches
 */
export interface SearchResult {
  entry: MemoryEntry;
  score: number;
  match?: {
    text: string;
    start: number;
    end: number;
    positions: number[];
  };
}

/**
 * Persistence strategy configuration
 */
export interface PersistenceStrategy {
  storagePath?: string;
  maxEntries?: number;
  compress?: boolean;
  backend?: 'file' | 'filesystem' | 'json';
  autoSave?: boolean;
  saveInterval?: number;
  version?: string;
}

/**
 * Search statistics
 */
export interface SearchStats {
  totalEntries: number;
  uniqueTags: string[];
  avgImportance: number;
  recentEntries: number;
  oldestEntry: number;
  newestEntry: number;
}

/**
 * Memory configuration
 */
export interface MemoryConfig extends PersistenceStrategy {
  defaultImportance?: number;
  maxMemorySize?: number;
  retentionPeriod?: number; // in milliseconds
}

/**
 * Event types for memory operations
 */
export type MemoryEvent =
  | { type: 'entry_created'; entry: MemoryEntry }
  | { type: 'entry_updated'; entry: MemoryEntry }
  | { type: 'entry_deleted'; entryId: string }
  | { type: 'search_executed'; query: SearchQuery; resultsCount: number }
  | { type: 'storage_initialized'; path: string }
  | { type: 'storage_error'; error: Error };

/**
 * Memory event listener callback
 */
export type EventCallback = (event: MemoryEvent) => void;

/**
 * API surface for memory store
 */
export interface MemoryStoreAPI {
  // Memory operations
  add(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry>;
  update(id: string, updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): Promise<MemoryEntry | null>;
  delete(id: string): Promise<boolean>;
  get(id: string): Promise<MemoryEntry | null>;
  list(filters?: MemoryEntry['metadata'], limit?: number): Promise<MemoryEntry[]>;
  
  // Search operations
  search(query: SearchQuery): Promise<SearchResult[]>;
  searchTags(tags: string[]): Promise<MemoryEntry[]>;
  searchByAgent(agentId: string): Promise<MemoryEntry[]>;
  searchBySession(sessionId: string): Promise<MemoryEntry[]>;
  
  // Storage operations
  initialize(): Promise<void>;
  save(): Promise<void>;
  load(): Promise<void>;
  clear(): Promise<void>;
  
  // Statistics
  getStats(): Promise<SearchStats>;
  getUsage(): Promise<{ size: number; entries: number }>;
  
  // Events
  on(event: MemoryEvent['type'], callback: EventCallback): () => void;
  off(event: MemoryEvent['type'], callback: EventCallback): void;
  emit(event: MemoryEvent): Promise<void>;
}

/**
 * Search engine configuration
 */
export interface SearchEngineConfig {
  algorithm?: string;
  similarityThreshold?: number;
  embeddingModel?: string;
  vectorDimensions?: number;
  cacheSize?: number;
}

/**
 * Search engine API
 */
export interface SearchEngineAPI {
  search(query: SearchQuery): Promise<SearchResult[]>;
  findSimilar(query: SearchQuery, limit?: number): Promise<SearchResult[]>;
  indexEntry(entry: MemoryEntry): Promise<void>;
  removeEntry(id: string): Promise<void>;
  optimize(): Promise<void>;
}