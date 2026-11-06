import { describe, expect, it } from 'vitest';
import { countReconciledMemories } from '@seanhogg/builderforce-brain-embedded';
import { formatPackBlock, isPackItem, learnedItems, packItems } from './packItems';

const items = [
  { id: 7, text: 'the lease ends on termination notice', score: 0.9 },
  { id: -1, text: '`policy.md` (file) — termination requires thirty days notice', score: 0.7 },
];

describe('knowledge-pack items on an Evermind recall', () => {
  it('tells pack cards (negative ids) from learned memories', () => {
    expect(items.map((i) => isPackItem(i))).toEqual([false, true]);
    expect(learnedItems(items)).toEqual([items[0]]);
    expect(packItems(items)).toEqual([items[1]]);
  });

  it('renders the cards under their own header, not the learned-memory one', () => {
    const block = formatPackBlock(packItems(items));
    expect(block).toContain('[Knowledge packs');
    expect(block).not.toContain('self-learning model');
    expect(block).toContain('policy.md');
    expect(formatPackBlock([])).toBe('');
  });

  it('does not let a pack card count as a reconciled learning', () => {
    const answer = 'termination requires thirty days notice per policy';
    expect(countReconciledMemories(items, answer)).toBeGreaterThan(countReconciledMemories(learnedItems(items), answer));
  });
});
