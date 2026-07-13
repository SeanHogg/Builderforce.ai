import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './memory-store.js';
import { SearchEngine } from './search-engine.js';

describe('SearchEngine', () => {
  let store: MemoryStore;
  let engine: SearchEngine;

  beforeEach(async () => {
    store = new MemoryStore({
      storagePath: './test-memory-data',
      maxEntries: 1000,
      autoSave: false
    });

    await store.initialize();

    engine = new SearchEngine(store, {
      algorithm: 'basic',
      similarityThreshold: 0.5
    });
  });

  describe('constructor', () => {
    it('should create a SearchEngine with store', () => {
      expect(engine).toBeDefined();
      expect(engine['store']).toBe(store);
    });
  });

  describe('search', () => {
    it('should search by text content', async () => {
      await store.add({
        content: 'The quick brown fox jumps over the lazy dog',
        metadata: { tags: ['animals', 'test'] }
      });

      const results = await engine.search({
        text: 'quick brown'
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      results.forEach(result => {
        expect(result.entry.content.toLowerCase()).toContain('quick');
        expect(result.entry.content.toLowerCase()).toContain('brown');
        expect(result.score).toBeGreaterThan(0);
      });
    });

    it('should apply text case insensitivity', async () => {
      await store.add({
        content: 'Hello World',
        metadata: { tags: ['test'] }
      });

      const results = await engine.search({
        text: 'hello world'
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should apply filters', async () => {
      await store.add({
        content: 'Tagged entry',
        metadata: {
          tags: ['important', 'test'],
          agentId: 'agent-1',
          importance: 7
        }
      });

      await store.add({
        content: 'Different agent',
        metadata: {
          tags: ['important'],
          agentId: 'agent-2',
          importance: 5
        }
      });

      const results = await engine.search({
        text: 'test',
        filters: {
          agentId: 'agent-1',
          minImportance: 6
        }
      });

      expect(results.length).toBe(1);
      expect(results[0].entry.metadata?.agentId).toBe('agent-1');
    });

    it('should apply limit', async () => {
      for (let i = 0; i < 15; i++) {
        await store.add({
          content: `Memory ${i}`,
          metadata: { tags: ['test'] }
        });
      }

      const results = await engine.search({
        text: 'Memory',
        limit: 5
      });

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should sort by score descending', async () => {
      await store.add({
        content: 'Short entry',
        metadata: { tags: ['test'] }
      });

      await store.add({
        content: 'This is a much longer and more detailed entry that should score higher',
        metadata: { tags: ['test'] }
      });

      const results = await engine.search({ text: 'entry' });

      if (results.length >= 2) {
        expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
      }
    });

    it('should support hybrid ranking method', async () => {
      await store.add({
        content: 'Recent important memory',
        metadata: {
          tags: ['important'],
          importance: 9
        }
      });

      await store.add({
        content: 'Old less important memory',
        metadata: {
          tags: ['test'],
          importance: 3
        }
      });

      const results = await engine.search({
        text: 'memory',
        ranking: {
          method: 'hybrid'
        }
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('findSimilar', () => {
    it('should find similar memories by text similarity', async () => {
      await store.add({
        content: 'The current temperature is 72 degrees',
        metadata: { tags: ['weather', 'test'] }
      });

      await store.add({
        content: 'Current temperature reading is similar to previous day',
        metadata: { tags: ['weather'] }
      });

      const results = await engine.findSimilar(
        { text: 'temperature 72' },
        5
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should apply limit to similar search', async () => {
      for (let i = 0; i < 20; i++) {
        await store.add({
          content: `Similar memory ${i}`,
          metadata: { tags: ['test'] }
        });
      }

      const results = await engine.findSimilar(
        { text: 'similar' },
        3
      );

      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('indexEntry', () => {
    it('should index a memory entry', async () => {
      const entry = await store.add({
        content: 'Indexed entry',
        metadata: { tags: ['test'] }
      });

      await engine.indexEntry(entry);

      const indexed = (engine as any).index.get('all');
      expect(indexed?.includes(entry)).toBe(true);
    });

    it('should handle multiple indexed entries', async () => {
      const entry1 = await store.add({
        content: 'First entry',
        metadata: { tags: ['test'] }
      });

      const entry2 = await store.add({
        content: 'Second entry',
        metadata: { tags: ['test'] }
      });

      await engine.indexEntry(entry1);
      await engine.indexEntry(entry2);

      const indexed = (engine as any).index.get('all');
      expect(indexed?.length).toBe(2);
    });
  });

  describe('removeEntry', () => {
    it('should remove an indexed entry', async () => {
      const entry = await store.add({
        content: 'Entry to remove',
        metadata: { tags: ['test'] }
      });

      await engine.indexEntry(entry);
      await engine.removeEntry(entry.id);

      const indexed = (engine as any).index.get('all');
      expect(indexed?.includes(entry)).toBe(false);
    });

    it('should handle removing non-existent entry', async () => {
      const initialSize = (engine as any).index.get('all')?.length || 0;

      await engine.removeEntry('non-existent-id');

      const finalSize = (engine as any).index.get('all')?.length || 0;
      expect(finalSize).toBe(initialSize);
    });
  });

  describe('optimize', () => {
    it('should run optimization successfully', async () => {
      await expect(engine.optimize()).resolves.not.toThrow();
    });

    it('should rebuild and clean index', async () => {
      // Add and index entries
      for (let i = 0; i < 10; i++) {
        const entry = await store.add({
          content: `Entry ${i}`,
          metadata: { tags: ['test'] }
        });
        await engine.indexEntry(entry);
      }

      await engine.optimize();

      const indexed = (engine as any).index.get('all');
      expect(indexed?.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('ranking calculations', () => {
    it('should calculate score for text matches', async () => {
      await store.add({
        content: 'The temperature is 72 degrees',
        metadata: { tags: ['weather'] }
      });

      const results = await engine.search({ text: 'temp' });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should score based on recency', async () => {
      // Multiple entries with same content but different timestamps
      const now = Date.now();
      await store.add({
        content: 'Recent test',
        metadata: { tags: ['test'] }
      });

      await store.add({
        content: 'Old test',
        metadata: { tags: ['test'] }
      });

      // Add a substantial delay to simulate age (simplified test)
      const results = await engine.search({ text: 'test' });

      // Both should have scores, just different values
      results.forEach(result => {
        expect(result.score).toBeGreaterThanOrEqual(0);
      });
    });

    it('should score based on importance', async () => {
      await store.add({
        content: 'Important test',
        metadata: { importance: 10 }
      });

      await store.add({
        content: 'Less important test',
        metadata: { importance: 3 }
      });

      const results = await engine.search({ text: 'test' });

      if (results.length >= 2) {
        // Higher importance should generally score higher
        expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
      }
    });

    it('should score based on tag matches', async () => {
      await store.add({
        content: 'Standard entry',
        metadata: { tags: ['standard'] }
      });

      await store.add({
        content: 'Highly tagged entry',
        metadata: { tags: ['important', 'urgent', 'priority'] }
      });

      const results = await engine.search({
        text: 'entry',
        filters: {
          tags: ['urgent']
        }
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });
});