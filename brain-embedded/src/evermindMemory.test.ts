import { describe, it, expect } from 'vitest';
import {
  formatEvermindMemoryBlock,
  countReconciledMemories,
  EVERMIND_LEARN_MIN_CHARS,
  type EvermindRecallItem,
} from './evermindMemory';

const item = (id: number, text: string, score = 0.5): EvermindRecallItem => ({ id, text, score });

describe('formatEvermindMemoryBlock', () => {
  it('is empty for no items', () => {
    expect(formatEvermindMemoryBlock([])).toBe('');
  });

  it('numbers the memories and includes the write-through framing', () => {
    const block = formatEvermindMemoryBlock([item(1, 'Deploy pushes to main'), item(2, 'Use the shared cache helper')]);
    expect(block).toContain('[Evermind Memory');
    expect(block).toContain('1. Deploy pushes to main');
    expect(block).toContain('2. Use the shared cache helper');
    expect(block.toLowerCase()).toContain('write-through');
  });

  it('collapses whitespace and drops empty snippets', () => {
    const block = formatEvermindMemoryBlock([item(1, '  multi\n  line   text '), item(2, '   ')]);
    expect(block).toContain('1. multi line text');
    expect(block).not.toContain('2.');
  });
});

describe('countReconciledMemories', () => {
  it('counts a memory the answer restates (high token overlap)', () => {
    const items = [item(1, 'the deploy pushes changes to the main branch automatically')];
    const answer = 'Yes — deploy pushes changes to the main branch automatically on every merge.';
    expect(countReconciledMemories(items, answer)).toBe(1);
  });

  it('does not count an unrelated memory', () => {
    const items = [item(1, 'the invoice billing cycle runs monthly on the first')];
    const answer = 'The deploy pipeline restarts the worker after each push.';
    expect(countReconciledMemories(items, answer)).toBe(0);
  });

  it('is zero for an empty answer', () => {
    expect(countReconciledMemories([item(1, 'anything meaningful here')], '')).toBe(0);
  });
});

describe('EVERMIND_LEARN_MIN_CHARS', () => {
  it('mirrors the server teach floor (40)', () => {
    expect(EVERMIND_LEARN_MIN_CHARS).toBe(40);
  });
});
