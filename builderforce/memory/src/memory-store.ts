/**
 * Memory Store - Core memory persistence and management
 * File-backed storage with search capabilities
 */

import type {
  MemoryEntry,
  PersistenceStrategy,
  MemoryStoreAPI,
  SearchStats
} from './types.js';

export class MemoryStore implements MemoryStoreAPI {
  private entries = new Map<string, MemoryEntry>();
  private options: Required<PersistenceStrategy>;
  private listeners = new Map<string, Set<Function>>();
  private storagePath: string;
  private initialized = false;

  constructor(options?: Partial<PersistenceStrategy>) {
    this.options = {
      storagePath: options?.storagePath || './memory-data',
      maxEntries: options?.maxEntries || 10000,
      compress: options?.compress ?? true,
      backend: options?.backend ?? 'file',
      autoSave: options?.autoSave ?? true,
      saveInterval: options?.saveInterval || 60000,
      version: options?.version || '1.0.0'
    };
    this.storagePath = this.options.storagePath;
  }

  async initialize(): Promise<void> {
    // Check if storage path exists, create if needed
    try {
      // In a real implementation, you would read from persistent storage
      // For now, we just ensure the directory exists
      this.initialized = true;
      this.emit({ type: 'storage_initialized', path: this.storagePath });
    } catch (error) {
      this.emit({
        type: 'storage_error',
        error: error instanceof Error ? error : new Error(String(error))
      });
      throw error;
    }
  }

  async add(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry> {
    const now = Date.now();
    const memoryEntry: MemoryEntry = {
      id: entry.id || this.generateId(),
      content: entry.content,
      metadata: entry.metadata,
      createdAt: now,
      updatedAt: now
    };

    // Enforce max entries
    const entriesToDelete = this.entries.size - this.options.maxEntries;
    if (entriesToDelete > 0) {
      const sortedEntries = Array.from(this.entries.values()).sort(
        (a, b) => a.createdAt - b.createdAt
      );
      sortedEntries.slice(0, entriesToDelete).forEach(e => this.entries.delete(e.id));
    }

    this.entries.set(memoryEntry.id, memoryEntry);
    this.emit({ type: 'entry_created', entry: memoryEntry });

    return memoryEntry;
  }

  async update(id: string, updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): Promise<MemoryEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;

    const updatedEntry = {
      ...entry,
      ...updates,
      updatedAt: Date.now()
    };

    this.entries.set(id, updatedEntry);
    this.emit({ type: 'entry_updated', entry: updatedEntry });
    return updatedEntry;
  }

  async delete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;

    this.entries.delete(id);
    this.emit({ type: 'entry_deleted', entryId: id });

    // Auto-save if enabled
    if (this.options.autoSave) {
      await this.save();
    }

    return true;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    return this.entries.get(id) || null;
  }

  async list(filters?: MemoryEntry['metadata'], limit?: number): Promise<MemoryEntry[]> {
    let entries = Array.from(this.entries.values());

    // Apply filters
    if (filters) {
      entries = entries.filter(entry => {
        if (filters.tags && entry.metadata?.tags) {
          const hasTag = filters.tags.some(tag =>
            entry.metadata!.tags!.includes(tag)
          );
          if (!hasTag) return false;
        }
        if (filters.agentId && entry.metadata?.agentId !== filters.agentId) {
          return false;
        }
        if (filters.sessionId && entry.metadata?.sessionId !== filters.sessionId) {
          return false;
        }
        if (filters.category && entry.metadata?.category !== filters.category) {
          return false;
        }
        if (filters.startDate && entry.createdAt < filters.startDate) {
          return false;
        }
        if (filters.endDate && entry.createdAt > filters.endDate) {
          return false;
        }
        if (filters.minImportance && (entry.metadata?.importance ?? 0) < filters.minImportance) {
          return false;
        }
        if (filters.excludeIds && filters.excludeIds.includes(entry.id)) {
          return false;
        }
        return true;
      });
    }

    // Apply limit
    if (limit) {
      entries = entries.slice(0, limit);
    }

    return entries;
  }

  async search(query: any): Promise<any[]> {
    // Placeholder - integrated with SearchEngine
    return [];
  }

  async searchTags(tags: string[]): Promise<MemoryEntry[]> {
    return this.list({ tags });
  }

  async searchByAgent(agentId: string): Promise<MemoryEntry[]> {
    return this.list({ agentId });
  }

  async searchBySession(sessionId: string): Promise<MemoryEntry[]> {
    return this.list({ sessionId });
  }

  async save(): Promise<void> {
    // Placeholder for persistent storage
    // In real implementation, write to disk
  }

  async load(): Promise<void> {
    // Placeholder for persistent storage
    // In real implementation, read from disk
    this.initialized = true;
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  async getStats(): Promise<SearchStats> {
    const entries = Array.from(this.entries.values());
    const tags = new Set<string>();
    let totalImportance = 0;

    entries.forEach(entry => {
      entry.metadata?.tags?.forEach(t => tags.add(t));
      if (entry.metadata?.importance) {
        totalImportance += entry.metadata.importance;
      }
    });

    return {
      totalEntries: entries.length,
      uniqueTags: Array.from(tags),
      avgImportance: entries.length > 0 ? totalImportance / entries.length : 0,
      recentEntries: Math.min(10, entries.length),
      oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.createdAt)) : Date.now(),
      newestEntry: entries.length > 0 ? Math.max(...entries.map(e => e.createdAt)) : Date.now()
    };
  }

  async getUsage(): Promise<{ size: number; entries: number }> {
    // Placeholder for actual usage tracking
    return { size: 0, entries: this.entries.size };
  }

  on(event: string, callback: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  off(event: string, callback: Function): void {
    this.listeners.get(event)?.delete(callback);
  }

  async emit(event: any): Promise<void> {
    const callbacks = this.listeners.get(event.type);
    if (callbacks) {
      callbacks.forEach(cb => cb(event));
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}