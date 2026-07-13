import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './memory-store.js';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({
      storagePath: './test-memory-data',
      maxEntries: 1000,
      autoSave: false
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await store.initialize();
      expect(store.initialized).toBe(true);
    });
  });

  describe('add', () => {
    it('should add a memory entry successfully', async () => {
      await store.initialize();

      const entry = await store.add({
        content: 'Test memory content',
        metadata: {
          tags: ['test', 'sample'],
          agentId: 'agent-1',
          importance: 5
        }
      });

      expect(entry).toBeDefined();
      expect(entry.id).toBeDefined();
      expect(entry.content).toBe('Test memory content');
      expect(entry.metadata?.tags).toContain('test');
    });

    it('should auto-generate ID if not provided', async () => {
      await store.initialize();

      const entry = await store.add({
        content: 'No ID provided',
        metadata: { tags: ['test'] }
      });

      expect(entry.id).toBeDefined();
    });

    it('should enforce max entries when limit is exceeded', async () => {
      await store.initialize();
      store.options.maxEntries = 3;

      // Add more than max entries
      for (let i = 0; i < 5; i++) {
        await store.add({
          content: `Memory ${i}`,
          metadata: { tags: ['test'] }
        });
      }

      // Should only keep newest 3
      const allEntries = store.getAllEntries();
      expect(allEntries.length).toBe(3);
      expect(allEntries[0].content).toBe('Memory 2'); // Newest
      expect(allEntries[2].content).toBe('Memory 0'); // Oldest removed
    });
  });

  describe('update', () => {
    it('should update an existing entry', async () => {
      await store.initialize();

      const created = await store.add({
        content: 'Original content',
        metadata: { tags: ['test'] }
      });

      const updated = await store.update(created.id, {
        content: 'Updated content',
        metadata: { ...created.metadata, importance: 8 }
      });

      expect(updated?.content).toBe('Updated content');
      expect(updated?.metadata?.importance).toBe(8);
      expect(updated?.metadata?.tags).toContain('test');
    });

    it('should return null when updating non-existent entry', async () => {
      await store.initialize();
      const result = await store.update('non-existent-id', { content: 'Updated' });
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an existing entry', async () => {
      await store.initialize();

      const entry = await store.add({
        content: 'To be deleted',
        metadata: { tags: ['test'] }
      });

      const deleted = await store.delete(entry.id);
      expect(deleted).toBe(true);

      const retrieved = await store.get(entry.id);
      expect(retrieved).toBeNull();
    });

    it('should return false when deleting non-existent entry', async () => {
      await store.initialize();
      const result = await store.delete('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('get', () => {
    it('should retrieve a specific entry', async () => {
      await store.initialize();

      const entry = await store.add({
        content: 'Specific entry',
        metadata: { tags: ['test'] }
      });

      const retrieved = await store.get(entry.id);
      expect(retrieved).toEqual(entry);
    });

    it('should return null for non-existent entry', async () => {
      await store.initialize();
      const result = await store.get('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should list all entries without filters', async () => {
      await store.initialize();

      await store.add({
        content: 'Memory 1',
        metadata: { tags: ['test'] }
      });

      await store.add({
        content: 'Memory 2',
        metadata: { tags: ['test', 'sample'] }
      });

      await store.add({
        content: 'Memory 3',
        metadata: { tags: ['test'] }
      });

      const entries = await store.list(undefined, 5);
      expect(entries.length).toBe(3);
    });

    it('should apply filters correctly', async () => {
      await store.initialize();

      await store.add({
        content: 'Test entry',
        metadata: {
          tags: ['test'],
          agentId: 'agent-1',
          importance: 5
        }
      });

      await store.add({
        content: 'Different agent',
        metadata: {
          tags: ['test'],
          agentId: 'agent-2',
          importance: 5
        }
      });

      const filtered = await store.list({ agentId: 'agent-1' });
      expect(filtered.length).toBe(1);
      expect(filtered[0].metadata?.agentId).toBe('agent-1');
    });

    it('should apply limit', async () => {
      await store.initialize();

      for (let i = 0; i < 10; i++) {
        await store.add({
          content: `Memory ${i}`,
          metadata: { tags: ['test'] }
        });
      }

      const limited = await store.list(undefined, 3);
      expect(limited.length).toBe(3);
    });
  });

  describe('searchTags', () => {
    it('should search entries by tags', async () => {
      await store.initialize();

      await store.add({
        content: 'Has tag',
        metadata: { tags: ['alpha', 'beta'] }
      });

      await store.add({
        content: 'No tags',
        metadata: {}
      });

      await store.add({
        content: 'Has tag',
        metadata: { tags: ['gamma'] }
      });

      const results = await store.searchTags(['alpha', 'gamma']);
      expect(results.length).toBe(2);
    });
  });

  describe('searchByAgent', () => {
    it('should search entries by agent ID', async () => {
      await store.initialize();

      await store.add({
        content: 'Agent entry',
        metadata: { agentId: 'agent-1', tags: ['test'] }
      });

      await store.add({
        content: 'Different agent',
        metadata: { agentId: 'agent-2', tags: ['test'] }
      });

      const results = await store.searchByAgent('agent-1');
      expect(results.length).toBe(1);
      expect(results[0].metadata?.agentId).toBe('agent-1');
    });
  });

  describe('searchBySession', () => {
    it('should search entries by session ID', async () => {
      await store.initialize();

      await store.add({
        content: 'Session entry',
        metadata: { sessionId: 'session-1', tags: ['test'] }
      });

      await store.add({
        content: 'Different session',
        metadata: { sessionId: 'session-2', tags: ['test'] }
      });

      const results = await store.searchBySession('session-1');
      expect(results.length).toBe(1);
      expect(results[0].metadata?.sessionId).toBe('session-1');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      await store.initialize();

      await store.add({
        content: 'Memory 1',
        metadata: { tags: ['tag1', 'tag2'], importance: 5 }
      });

      await store.add({
        content: 'Memory 2',
        metadata: { tags: ['tag1'], importance: 3 }
      });

      const stats = await store.getStats();

      expect(stats.totalEntries).toBe(2);
      expect(stats.uniqueTags).toEqual(expect.arrayContaining(['tag1', 'tag2']));
      expect(stats.avgImportance).toBe(4);
    });
  });

  describe('getUsage', () => {
    it('should return usage information', async () => {
      await store.initialize();

      await store.add({
        content: 'Memory',
        metadata: { tags: ['test'] }
      });

      const usage = await store.getUsage();
      expect(usage.entries).toBe(1);
      expect(usage.size).toBe(0); // Placeholder implementation
    });
  });

  describe('events', () => {
    it('should emit entries created', async () => {
      await store.initialize();

      const callback = vi.fn();
      const unsubscribe = store.on('entry_created', callback);

      await store.add({
        content: 'Test',
        metadata: { tags: ['test'] }
      });

      expect(callback).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it('should emit entries updated', async () => {
      await store.initialize();

      const entry = await store.add({
        content: 'Test',
        metadata: { tags: ['test'] }
      });

      const callback = vi.fn();
      const unsubscribe = store.on('entry_updated', callback);

      await store.update(entry.id, { content: 'Updated' });

      expect(callback).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it('should emit entries deleted', async () => {
      await store.initialize();

      const entry = await store.add({
        content: 'Test',
        metadata: { tags: ['test'] }
      });

      const callback = vi.fn();
      const unsubscribe = store.on('entry_deleted', callback);

      await store.delete(entry.id);

      expect(callback).toHaveBeenCalledTimes(1);
      unsubscribe();
    });
  });
});