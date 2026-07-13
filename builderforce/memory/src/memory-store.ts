/**
 * Memory Store implementation with file-backed persistence
 */

import type {
  MemoryEntry,
  MemoryStoreAPI,
  MemoryEvent,
  MemoryConfig,
  SearchQuery,
  SearchResult,
  SearchStats
} from './types.js';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';

/**
 * In-memory store for memory entries
 */
class MemoryEntryStore extends Map<string, MemoryEntry> {
  private version = '1.0.0';

  constructor(config: MemoryConfig) {
    super();
    this.version = config.version || this.version;
  }

  /**
   * Check if store respects maxEntries limit
   */
  enforceLimits(): void {
    const maxEntries = Number(this.at(0)?.metadata?.importance) || 10000;
    while (this.size > maxEntries) {
      const oldestId = this.getOldestId();
      if (oldestId && this.has(oldestId)) {
        this.delete(oldestId);
      }
    }
  }

  getOldestId(): string | null {
    let oldest: MemoryEntry | null = null;
    let oldestId = null;

    for (const [id, entry] of this) {
      if (!oldest || entry.createdAt < oldest?.createdAt) {
        oldest = entry;
        oldestId = id;
      }
    }

    return oldestId;
  }

  getIdByImportance(importance: number): string | null {
    let highest: MemoryEntry | null = null;
    let highestId = null;

    for (const [id, entry] of this) {
      if (!highest ||
        (entry.metadata?.importance || 0) > (highest.metadata?.importance || 0)
      ) {
        highest = entry;
        highestId = id;
      }
    }

    return highestId;
  }

  getOldest(): MemoryEntry | null {
    let oldest: MemoryEntry | null = null;
    for (const entry of this.values()) {
      if (!oldest || entry.createdAt < oldest.createdAt) {
        oldest = entry;
      }
    }
    return oldest;
  }

  import(entries: MemoryEntry[]): void {
    entries.forEach(entry => this.set(entry.id, entry));
  }

  export(): MemoryEntry[] {
    return Array.from(this.values()).sort((a, b) => a.createdAt - b.createdAt);
  }
}

/**
 * Events emitter for memory operations
 */
class MemoryEventEmitter extends EventEmitter {
  // Pre-define events
  constructor() {
    super();
    this.setMaxListeners(50);
  }
}

/**
 * Memory Store class - implements MemoryStoreAPI
 */
export class MemoryStore implements MemoryStoreAPI {
  private store: MemoryEntryStore;
  private events: MemoryEventEmitter;
  private config: Required<MemoryConfig>;
  private filePath: string;
  private isInitialized: boolean = false;
  private saveTimer?: NodeJS.Timeout;

  constructor(config?: MemoryConfig) {
    this.config = {
      storagePath: './memory-data',
      maxEntries: 10000,
      compress: true,
      backend: 'filesystem',
      autoSave: true,
      saveInterval: 30000,
      defaultImportance: 1,
      retentionPeriod: null,
      ...config
    };

    this.store = new MemoryEntryStore(this.config);
    this.events = new MemoryEventEmitter();
    this.filePath = `${this.config.storagePath}/memory-store.json`;

    // Setup auto-save if enabled
    if (this.config.autoSave) {
      this.setupAutoSave();
    }
  }

  /**
   * Register an event listener
   */
  on(event: MemoryEvent['type'], callback: (event: MemoryEvent) => void): () => void {
    this.events.on(event, callback);
    return () => this.events.off(event, callback);
  }

  /**
   * Remove an event listener
   */
  off(event: MemoryEvent['type'], callback: (event: MemoryEvent) => void): void {
    this.events.off(event, callback);
  }

  /**
   * Emit an event
   */
  async emit(event: MemoryEvent): Promise<void> {
    this.events.emit(event.type, event);
  }

  /**
   * Initialize the memory store
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Ensure storage directory exists
    await fs.mkdir(this.config.storagePath, { recursive: true });

    this.isInitialized = true;
    await this.load();

    await this.emit({
      type: 'storage_initialized',
      path: this.filePath
    });
  }

  /**
   * Load memory entries from persistent storage
   */
  async load(): Promise<void> {
    try {
      await fs.mkdir(this.config.storagePath, { recursive: true });

      const data = await fs.readFile(this.filePath, 'utf-8');
      const entries: MemoryEntry[] = JSON.parse(data);
      this.store.import(entries);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Save memory entries to persistent storage
   */
  async save(): Promise<void> {
    try {
      await fs.mkdir(this.config.storagePath, { recursive: true });

      const entries = this.store.export();
      await fs.writeFile(
        this.filePath,
        JSON.stringify(entries, null, 2),
        'utf-8'
      );
    } catch (error) {
      throw new Error(`Failed to save memory store: ${error}`);
    }
  }

  /**
   * Setup auto-save interval
   */
  private setupAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }

    this.saveTimer = setInterval(() => {
      this.save().catch((error) => {
        console.error('Auto-save error:', error);
      });
    }, this.config.saveInterval);
  }

  /**
   * Clear the memory store
   */
  async clear(): Promise<void> {
    this.store.clear();
    await this.save();
  }

  /**
   * Add a new memory entry
   */
  async add(
    entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<MemoryEntry> {
    const now = Date.now();
    const id = entry.id || `mem_${now}_${Math.random().toString(36).substr(2, 9)}`;

    const memoryEntry: MemoryEntry = {
      id,
      ...entry,
      createdAt: entry.createdAt || now,
      updatedAt: now
    };

    // Set default importance if not specified
    if (memoryEntry.metadata?.importance === undefined) {
      memoryEntry.metadata.importance = this.config.defaultImportance;
    }

    this.store.set(id, memoryEntry);
    await this.enforceLimits();
    await this.save();

    await this.emit({
      type: 'entry_created',
      entry: memoryEntry
    });

    return memoryEntry;
  }

  /**
   * Update an existing memory entry
   */
  async update(
    id: string,
    updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>
  ): Promise<MemoryEntry | null> {
    const entry = this.store.get(id);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    const updated: MemoryEntry = {
      ...entry,
      ...updates,
      updatedAt: now
    };

    this.store.set(id, updated);
    await this.save();

    await this.emit({
      type: 'entry_updated',
      entry: updated
    });

    return updated;
  }

  /**
   * Delete a memory entry
   */
  async delete(id: string): Promise<boolean> {
    const entry = this.store.get(id);
    if (!entry) {
      return false;
    }

    this.store.delete(id);
    await this.save();

    await this.emit({
      type: 'entry_deleted',
      entryId: id
    });

    return true;
  }

  /**
   * Get a single memory entry
   */
  async get(id: string): Promise<MemoryEntry | null> {
    return this.store.get(id) || null;
  }

  /**
   * List memory entries with optional filters
   */
  async list(
    filters?: MemoryEntry['metadata'],
    limit?: number
  ): Promise<MemoryEntry[]> {
    let entries = Array.from(this.store.values());

    if (filters) {
      if (filters.tags?.length) {
        entries = entries.filter(entry =>
          entry.metadata?.tags?.some(tag => filters.tags!.includes(tag))
        );
      }
      if (filters.category) {
        entries = entries.filter(entry =>
          entry.metadata?.category === filters.category
        );
      }
      if (filters.agentId) {
        entries = entries.filter(entry =>
          entry.metadata?.agentId === filters.agentId
        );
      }
      if (filters.sessionId) {
        entries = entries.filter(entry =>
          entry.metadata?.sessionId === filters.sessionId
        );
      }
      if (filters.minImportance !== undefined) {
        entries = entries.filter(entry =>
          (entry.metadata?.importance || 0) >= filters.minImportance
        );
      }
    }

    if (limit) {
      entries = entries.slice(0, limit);
    }

    return entries;
  }

  /**
   * Search for memory entries
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    const {
      text,
      limit = 10,
      filters = {},
      ranking = { method: 'relevance' }
    } = query;

    let results = this.performSimpleSearch(text, 0.1);

    // Apply filters
    if (filters.tags?.length) {
      results = results.filter(r => {
        const entry = r.entry;
        return entry.metadata?.tags?.some(tag => filters.tags!.includes(tag));
      });
    }
    if (filters.category) {
      results = results.filter(r => {
        const entry = r.entry;
        return entry.metadata?.category === filters.category;
      });
    }
    if (filters.minImportance !== undefined) {
      results = results.filter(r => {
        const entry = r.entry;
        return (entry.metadata?.importance || 0) >= filters.minImportance;
      });
    }

    // Apply ranking
    results = this.applyRanking(results, ranking);

    return results.slice(0, limit);
  }

  /**
   * Simple text matching search
   */
  private performSimpleSearch(text: string, baseScore: number): SearchResult[] {
    const lowerText = text.toLowerCase();
    const results = [];

    for (const entry of this.store.values()) {
      if (entry.content.toLowerCase().includes(lowerText)) {
        const score = baseScore + (entry.metadata?.importance || 0) * 0.1;

        results.push({
          entry,
          score,
          match: {
            text: text,
            start: 0,
            end: text.length,
            positions: [0, text.length]
          }
        });
      }
    }

    return results;
  }

  /**
   * Apply ranking strategy to results
   */
  private applyRanking(
    results: SearchResult[],
    ranking:
      | { method: 'relevance' | 'recency' | 'importance' | 'hybrid'; boost?: Record<string, number> }
      | undefined
  ): SearchResult[] {
    if (!ranking) {
      return results;
    }

    const { method, boost } = ranking;
    const now = Date.now();

    results.forEach(result => {
      const { entry } = result;
      const { metadata } = entry;

      // Base score consideration
      let score = result.score;

      // Apply boosts
      if (boost) {
        score += (metadata?.importance || 0) * (boost.importance || 0);
      }

      // Ranking method
      switch (method) {
        case 'importance':
          score += (metadata?.importance || 0) * 0.5;
          break;
        case 'recency':
          const age = now - entry.createdAt;
          const recencyScore = Math.max(0, 1 - age / 86400000); // 1 day window
          score += recencyScore * 0.3;
          break;
        case 'hybrid':
          score = result.score +
            (metadata?.importance || 0) * 0.35 +
            Math.max(0, 1 - (now - entry.createdAt) / 86400000) * 0.35;
          break;
        // relevance (default) uses the base score
      }

      result.score = score;
    });

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Search entries by tags
   */
  async searchTags(tags: string[]): Promise<MemoryEntry[]> {
    return this.list({
      tags
    });
  }

  /**
   * Search entries by agent ID
   */
  async searchByAgent(agentId: string): Promise<MemoryEntry[]> {
    return this.list({
      agentId
    });
  }

  /**
   * Search entries by session ID
   */
  async searchBySession(sessionId: string): Promise<MemoryEntry[]> {
    return this.list({
      sessionId
    });
  }

  /**
   * Get search statistics
   */
  async getStats(): Promise<SearchStats> {
    const entries = Array.from(this.store.values());
    const uniqueTags = new Set<string>();

    entries.forEach(entry => {
      entry.metadata?.tags?.forEach(tag => uniqueTags.add(tag));
    });

    const avgImportance =
      entries.length > 0
        ? entries.reduce((sum, entry) => sum + (entry.metadata?.importance || 0), 0) /
          entries.length
        : 0;

    const now = Date.now();
    const recentEntries = entries.filter(
      entry => now - entry.createdAt < 86400000
    ).length;

    const oldestEntry = this.store.getOldest();
    const newestEntry = entries.reduce((latest, entry) =>
      entry.createdAt > latest?.createdAt ? entry : latest
    , null);

    return {
      totalEntries: entries.length,
      uniqueTags: Array.from(uniqueTags),
      avgImportance,
      recentEntries,
      oldestEntry: oldestEntry?.createdAt || 0,
      newestEntry: newestEntry?.createdAt || 0
    };
  }

  /**
   * Get storage usage information
   */
  async getUsage(): Promise<{ size: number; entries: number }> {
    const entries = Array.from(this.store.values());
    const data = JSON.stringify(entries, null, 2);
    const size = Buffer.byteLength(data, 'utf-8');

    return {
      size,
      entries: entries.length
    };
  }

  /**
   * Enforce storage limits (max entries)
   */
  private async enforceLimits(): Promise<void> {
    this.store.enforceLimits();
    await this.save();
  }
}

/**
 * Factory functions from types.ts
 */
import { MemoryConfig } from './types.js';

export const createMemoryStore = (config?: Partial<MemoryConfig>) => new MemoryStore(config);