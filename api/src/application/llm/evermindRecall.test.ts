import { describe, it, expect } from 'vitest';
import { rankEvermindRecall, hashRecallPrompt, type RecallScorable } from './evermindRecall';

const mk = (id: number, over: Partial<RecallScorable>): RecallScorable => ({
  id, kind: 'text', version: 1, at: id, weight: 1, ...over,
});

describe('rankEvermindRecall', () => {
  const recent: RecallScorable[] = [
    mk(1, { prompt: 'Add pagination to the users API endpoint', text: 'implemented cursor pagination for /users' }),
    mk(2, { prompt: 'Fix the dark mode contrast on the settings page', text: 'adjusted theme tokens for settings' }),
    mk(3, { kind: 'delta', prompt: undefined, text: undefined }), // delta: no text → never matches
  ];

  it('ranks the memory whose text overlaps the task first', () => {
    const out = rankEvermindRecall('paginate the users endpoint', recent);
    expect(out[0]?.id).toBe(1);
    expect(out[0]!.score).toBeGreaterThan(0);
  });

  it('never matches a delta contribution (no inspectable text)', () => {
    const out = rankEvermindRecall('weight delta', recent);
    expect(out.every((m) => m.id !== 3)).toBe(true);
  });

  it('returns nothing for a wholly unrelated task', () => {
    const out = rankEvermindRecall('quarterly financial forecast spreadsheet', recent);
    expect(out).toEqual([]);
  });

  it('scores are 0..1 and sorted descending', () => {
    const out = rankEvermindRecall('settings page dark mode contrast users pagination', recent);
    for (const m of out) {
      expect(m.score).toBeGreaterThan(0);
      expect(m.score).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < out.length; i++) expect(out[i - 1]!.score).toBeGreaterThanOrEqual(out[i]!.score);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => mk(i + 10, { prompt: `optimize query performance case ${i}`, text: 'query tuning' }));
    const out = rankEvermindRecall('optimize query performance', many, { limit: 5 });
    expect(out.length).toBe(5);
  });

  it('an empty query matches nothing', () => {
    expect(rankEvermindRecall('   ', recent)).toEqual([]);
  });

  it('hashRecallPrompt is stable and bounded', () => {
    expect(hashRecallPrompt('abc')).toBe(hashRecallPrompt('abc'));
    expect(hashRecallPrompt('abc')).not.toBe(hashRecallPrompt('abd'));
    expect(hashRecallPrompt('a very long prompt '.repeat(50)).length).toBeLessThan(12);
  });
});
