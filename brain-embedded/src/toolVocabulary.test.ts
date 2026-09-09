import { describe, it, expect } from 'vitest';
import { expandWithSynonyms, synonymsFor } from './toolVocabulary';

describe('synonymsFor', () => {
  it('relates the product word to the catalog word', () => {
    expect(synonymsFor('ticket')).toContain('task');
    expect(synonymsFor('issue')).toContain('task');
  });

  it('is symmetric — classes are a relation, not a direction', () => {
    expect(synonymsFor('task')).toContain('ticket');
    expect(synonymsFor('ticket')).toContain('task');
  });

  it('returns nothing for a word with no class, so the common case is free', () => {
    expect(synonymsFor('chart')).toEqual([]);
    expect(synonymsFor('')).toEqual([]);
  });

  it('keeps OKR objectives and delivery epics APART', () => {
    // These are separate entities with separate tables and separate tools on this
    // platform. Merging them would answer an OKR question with epic tooling.
    expect(synonymsFor('objective')).not.toContain('epic');
    expect(synonymsFor('epic')).not.toContain('objective');
    expect(synonymsFor('okr')).toContain('objective');
  });
});

describe('expandWithSynonyms', () => {
  it('adds the interchangeable terms', () => {
    expect(expandWithSynonyms(new Set(['ticket']))).toContain('task');
  });

  it('never re-emits a stem the caller already has — the sets stay disjoint', () => {
    const stems = new Set(['task', 'ticket']);
    const expanded = expandWithSynonyms(stems);
    for (const s of stems) expect(expanded.has(s)).toBe(false);
  });

  it('is empty when nothing in the query has a class', () => {
    expect(expandWithSynonyms(new Set(['chart', 'colour'])).size).toBe(0);
  });
});
