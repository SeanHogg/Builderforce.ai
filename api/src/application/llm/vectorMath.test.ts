import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from './vectorMath';

describe('cosineSimilarity', () => {
  it('returns 1 for identical (parallel) vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0, 0], [2, 0, 0])).toBeCloseTo(1); // scaled
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for anti-parallel vectors', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1);
  });

  it('returns 0 for an empty input (no NaN)', () => {
    expect(cosineSimilarity([], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [])).toBe(0);
  });

  it('returns 0 for a zero-magnitude vector (no divide-by-zero)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('compares over the shorter vector (min length)', () => {
    // overlapping prefix [1,0] vs [1,0] → parallel → 1; the trailing 99 is ignored
    expect(cosineSimilarity([1, 0, 99], [1, 0])).toBeCloseTo(1);
  });

  it('treats a missing slot as 0 (sparse-safe)', () => {
    const sparse = [1, 0, 0];
    // eslint-disable-next-line no-sparse-arrays
    expect(cosineSimilarity(sparse, [1, , 0] as unknown as number[])).toBeCloseTo(1);
  });
});
