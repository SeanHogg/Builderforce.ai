import { describe, it, expect } from 'vitest';
import {
  DIM,
  PSYCHOMETRIC_CATALOG,
  PSYCHOMETRIC_QUESTIONS,
  VALID_DIMENSION_IDS,
  scoreQuestionnaire,
  sanitizeVector,
} from './psychometricCatalog';

describe('psychometric catalog', () => {
  it('every catalog dimension id is a known DIM value', () => {
    const dimValues = new Set(Object.values(DIM));
    for (const fw of PSYCHOMETRIC_CATALOG) {
      for (const dim of fw.dimensions) {
        expect(dimValues.has(dim.id)).toBe(true);
      }
    }
  });

  it('every question targets a known dimension', () => {
    for (const q of PSYCHOMETRIC_QUESTIONS) {
      expect(VALID_DIMENSION_IDS.has(q.dimension)).toBe(true);
    }
  });
});

describe('scoreQuestionnaire', () => {
  it('maps Likert 5 (agree) to ~100 and 1 (disagree) to ~0 on a normal item', () => {
    const high = scoreQuestionnaire({ c1: 5 });
    expect(high[DIM.conscientiousness]).toBe(100);
    const low = scoreQuestionnaire({ c1: 1 });
    expect(low[DIM.conscientiousness]).toBe(0);
  });

  it('reverses reverse-keyed items', () => {
    // c2 is reverse-keyed on conscientiousness; agreeing => low score
    const v = scoreQuestionnaire({ c2: 5 });
    expect(v[DIM.conscientiousness]).toBe(0);
  });

  it('averages multiple items on the same dimension', () => {
    // c1 (normal) = 100 at 5; c2 (reverse) = 100 at 1 -> average 100
    const v = scoreQuestionnaire({ c1: 5, c2: 1 });
    expect(v[DIM.conscientiousness]).toBe(100);
  });

  it('ignores unknown question ids', () => {
    expect(scoreQuestionnaire({ nope: 5 })).toEqual({});
  });
});

describe('sanitizeVector', () => {
  it('keeps known dimensions and clamps to 0..100', () => {
    const v = sanitizeVector({ [DIM.openness]: 150, [DIM.grit]: -10, bogus: 50 });
    expect(v[DIM.openness]).toBe(100);
    expect(v[DIM.grit]).toBe(0);
    expect('bogus' in v).toBe(false);
  });

  it('returns {} for non-object input', () => {
    expect(sanitizeVector(null)).toEqual({});
    expect(sanitizeVector('x')).toEqual({});
  });
});
