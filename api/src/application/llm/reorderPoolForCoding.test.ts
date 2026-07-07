import { describe, it, expect } from 'vitest';
import { reorderPoolForCoding, CODING_MODEL_POOL } from './LlmProxyService';

describe('reorderPoolForCoding — agentic tool-loop routing', () => {
  const codingModel = CODING_MODEL_POOL[0];

  it('floats a CODING_MODEL_POOL driver ahead of a cheap generalist', () => {
    const pool = ['some/cheap-generalist', codingModel];
    const out = reorderPoolForCoding(pool);
    expect(out[0]).toBe(codingModel);
    expect(out).toContain('some/cheap-generalist');
  });

  it('is a pure permutation — same set, no additions or drops', () => {
    const pool = ['a/one', codingModel, 'b/two', 'c/three'];
    const out = reorderPoolForCoding(pool);
    expect([...out].sort()).toEqual([...pool].sort());
  });

  it('preserves relative order within the coding and non-coding buckets', () => {
    const c0 = CODING_MODEL_POOL[0];
    const c1 = CODING_MODEL_POOL[1] ?? CODING_MODEL_POOL[0];
    const pool = ['x/first', c1, 'y/second', c0];
    const out = reorderPoolForCoding(pool);
    // coding models lead in their original relative order (c1 appeared before c0)
    expect(out.indexOf(c1)).toBeLessThan(out.indexOf(c0));
    // non-coding tail keeps its relative order
    expect(out.indexOf('x/first')).toBeLessThan(out.indexOf('y/second'));
    // and all coding models precede all non-coding ones
    expect(out.indexOf(c0)).toBeLessThan(out.indexOf('x/first'));
  });

  it('leaves a pool with no coding models untouched', () => {
    const pool = ['p/a', 'q/b', 'r/c'];
    expect(reorderPoolForCoding(pool)).toEqual(pool);
  });
});
