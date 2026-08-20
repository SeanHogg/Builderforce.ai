import { describe, it, expect } from 'vitest';
import { MAX_WHY_STEPS, normaliseWhyChain, rootStatement } from './PostmortemWhyService';

/**
 * The ladder invariants. Every one of these is a shape the RENDERER and the
 * partial-unique index both assume: contiguous ordinals from 1, at most one root,
 * and the root at the bottom. A chain that violates any of them is a picture that
 * cannot be drawn and a "the cause" with two answers.
 */
describe('normaliseWhyChain', () => {
  it('numbers the kept steps contiguously from 1', () => {
    const chain = normaliseWhyChain([
      { statement: 'Checkout returned 500' },
      { statement: '  ' },
      { statement: 'The payment client timed out' },
      { statement: '' },
      { statement: 'Its pool was exhausted' },
    ]);
    expect(chain.map((s) => s.stepNo)).toEqual([1, 2, 3]);
    expect(chain.map((s) => s.statement)).toEqual([
      'Checkout returned 500',
      'The payment client timed out',
      'Its pool was exhausted',
    ]);
  });

  it('caps the ladder at MAX_WHY_STEPS', () => {
    const chain = normaliseWhyChain(
      Array.from({ length: MAX_WHY_STEPS + 4 }, (_, i) => ({ statement: `why ${i}` })),
    );
    expect(chain).toHaveLength(MAX_WHY_STEPS);
    expect(chain[chain.length - 1]!.stepNo).toBe(MAX_WHY_STEPS);
  });

  it('moves a root flag from a middle step down to the terminal step', () => {
    // The user marked step 2 as the root, then kept asking. "As deep as we got" and
    // "this is the cause" are different claims, and only the bottom step can make
    // the second one — a step with an answer below it has been answered.
    const chain = normaliseWhyChain([
      { statement: 'A' },
      { statement: 'B', isRoot: true },
      { statement: 'C' },
    ]);
    expect(chain.map((s) => s.isRoot)).toEqual([false, false, true]);
    expect(rootStatement(chain)).toBe('C');
  });

  it('never marks more than one root even when every step is flagged', () => {
    const chain = normaliseWhyChain([
      { statement: 'A', isRoot: true },
      { statement: 'B', isRoot: true },
      { statement: 'C', isRoot: true },
    ]);
    expect(chain.filter((s) => s.isRoot)).toHaveLength(1);
    expect(chain[2]!.isRoot).toBe(true);
  });

  it('leaves an unflagged chain rootless — a chain in progress is not a verdict', () => {
    const chain = normaliseWhyChain([{ statement: 'A' }, { statement: 'B' }]);
    expect(chain.some((s) => s.isRoot)).toBe(false);
    expect(rootStatement(chain)).toBeNull();
  });

  it('drops a chain that is entirely blank rather than storing empty rungs', () => {
    expect(normaliseWhyChain([{ statement: '' }, { statement: '   ' }])).toEqual([]);
  });

  it('truncates a pasted document instead of storing it as a why', () => {
    const chain = normaliseWhyChain([{ statement: 'x'.repeat(5000) }]);
    expect(chain[0]!.statement.length).toBe(1000);
  });
});
