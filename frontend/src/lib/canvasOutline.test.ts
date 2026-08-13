import { describe, it, expect } from 'vitest';
import { filterOutlineNodes, outlineKindCounts, outlineMatchScore, type OutlineSearchable } from './canvasOutline';

const node = (id: string, kind: string, title: string, status?: string, subtitle?: string): OutlineSearchable =>
  ({ id, data: { kind, title, ...(status ? { status } : {}), ...(subtitle ? { subtitle } : {}) } });

const board: OutlineSearchable[] = [
  node('1', 'task', 'Ship the pricing page', 'in_progress'),
  node('2', 'slides', 'Pricing deck', 'Draft', 'Board review copy'),
  node('3', 'task', 'Fix login redirect', 'blocked'),
  node('4', 'document', 'Runbook', 'Draft'),
  node('5', 'task', 'Pricing experiment', 'todo'),
];

describe('outlineMatchScore', () => {
  it('ranks a title prefix above a title hit above a hit anywhere else', () => {
    expect(outlineMatchScore(node('a', 'task', 'Pricing deck'), 'pricing')).toBe(3);
    expect(outlineMatchScore(node('a', 'task', 'The pricing deck'), 'pricing')).toBe(2);
    expect(outlineMatchScore(node('a', 'task', 'Deck', 'pricing review'), 'pricing')).toBe(1);
    expect(outlineMatchScore(node('a', 'task', 'Deck'), 'pricing')).toBe(-1);
  });

  it('scores everything as equal when the query is empty', () => {
    expect(outlineMatchScore(node('a', 'task', 'Anything'), '   ')).toBe(0);
  });

  it('matches the kind, so "task" finds tasks that do not say so in their title', () => {
    expect(outlineMatchScore(node('a', 'task', 'Fix login redirect'), 'task')).toBe(1);
  });
});

describe('filterOutlineNodes', () => {
  it('keeps board order when there is no query — re-sorting under a screen reader would be worse than no search', () => {
    expect(filterOutlineNodes(board).map((n) => n.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('puts the best match first and keeps board order within a tie', () => {
    // 'Pricing deck' and 'Pricing experiment' both prefix-match; '2' precedes '5'
    // on the board, and 'Ship the pricing page' is only a mid-title hit.
    expect(filterOutlineNodes(board, { query: 'pricing' }).map((n) => n.id)).toEqual(['2', '5', '1']);
  });

  it('restricts to one kind, and treats "all" as no restriction', () => {
    expect(filterOutlineNodes(board, { kind: 'task' }).map((n) => n.id)).toEqual(['1', '3', '5']);
    expect(filterOutlineNodes(board, { kind: 'all' })).toHaveLength(5);
  });

  it('applies the kind filter and the query together', () => {
    expect(filterOutlineNodes(board, { kind: 'task', query: 'pricing' }).map((n) => n.id)).toEqual(['5', '1']);
  });

  it('searches the subtitle, so a note about an object still finds it', () => {
    expect(filterOutlineNodes(board, { query: 'board review' }).map((n) => n.id)).toEqual(['2']);
  });

  it('returns nothing rather than everything when a query matches nothing', () => {
    expect(filterOutlineNodes(board, { query: 'zzzz' })).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [...board];
    filterOutlineNodes(input, { query: 'pricing' });
    expect(input.map((n) => n.id)).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('outlineKindCounts', () => {
  it('counts the kinds present, most-used first', () => {
    expect(outlineKindCounts(board)).toEqual([
      { kind: 'task', count: 3 },
      { kind: 'document', count: 1 },
      { kind: 'slides', count: 1 },
    ]);
  });

  it('breaks a count tie alphabetically so the chips do not reshuffle between renders', () => {
    expect(outlineKindCounts([node('1', 'zebra', 'z'), node('2', 'alpha', 'a')]))
      .toEqual([{ kind: 'alpha', count: 1 }, { kind: 'zebra', count: 1 }]);
  });

  it('is empty for an empty board', () => {
    expect(outlineKindCounts([])).toEqual([]);
  });
});
