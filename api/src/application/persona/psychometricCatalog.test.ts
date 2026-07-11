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
    const dimValues = new Set<string>(Object.values(DIM));
    for (const fw of PSYCHOMETRIC_CATALOG) {
      for (const dim of fw.dimensions) {
        expect(dimValues.has(dim.id)).toBe(true);
      }
    }
  });

  it('every dimension item targets a known dimension', () => {
    for (const q of PSYCHOMETRIC_QUESTIONS) {
      // MBTI / Enneagram items are categorical (not vector dimensions), so they
      // carry descriptive non-DIM tokens; only trait items must be known DIM ids.
      if (q.kind && q.kind !== 'dimension') continue;
      expect(VALID_DIMENSION_IDS.has(q.dimension)).toBe(true);
    }
  });

  it('every Schwartz value dimension has a scoring item', () => {
    const valueIds = new Set(
      Object.entries(DIM)
        .filter(([k]) => k.startsWith('val'))
        .map(([, v]) => v),
    );
    const covered = new Set(PSYCHOMETRIC_QUESTIONS.filter((q) => (q.kind ?? 'dimension') === 'dimension').map((q) => q.dimension));
    for (const id of valueIds) expect(covered.has(id)).toBe(true);
  });

  it('tags a basic spine plus the full advanced battery', () => {
    const basic = PSYCHOMETRIC_QUESTIONS.filter((q) => q.tier === 'basic');
    expect(basic.length).toBeGreaterThanOrEqual(10);
    expect(basic.length).toBeLessThanOrEqual(12);
    // Basic items are all trait items (no categorical typing in the quick test).
    expect(basic.every((q) => (q.kind ?? 'dimension') === 'dimension')).toBe(true);
  });
});

describe('scoreQuestionnaire', () => {
  it('maps Likert 5 (agree) to ~100 and 1 (disagree) to ~0 on a normal item', () => {
    const high = scoreQuestionnaire({ c1: 5 });
    expect(high.vector[DIM.conscientiousness]).toBe(100);
    const low = scoreQuestionnaire({ c1: 1 });
    expect(low.vector[DIM.conscientiousness]).toBe(0);
  });

  it('reverses reverse-keyed items', () => {
    // c2 is reverse-keyed on conscientiousness; agreeing => low score
    const v = scoreQuestionnaire({ c2: 5 });
    expect(v.vector[DIM.conscientiousness]).toBe(0);
  });

  it('averages multiple items on the same dimension', () => {
    // c1 (normal) = 100 at 5; c2 (reverse) = 100 at 1 -> average 100
    const v = scoreQuestionnaire({ c1: 5, c2: 1 });
    expect(v.vector[DIM.conscientiousness]).toBe(100);
  });

  it('ignores unknown question ids', () => {
    expect(scoreQuestionnaire({ nope: 5 })).toEqual({ vector: {} });
  });

  it('derives a 4-letter MBTI type only when all dichotomies are answered', () => {
    // Agree with E, S, T, J anchor items -> ESTJ.
    const full = scoreQuestionnaire({ mbti_ei: 5, mbti_sn: 5, mbti_tf: 5, mbti_jp: 5 });
    expect(full.mbti).toBe('ESTJ');
    // Disagree flips each axis to the partner pole -> INFP.
    const flipped = scoreQuestionnaire({ mbti_ei: 1, mbti_sn: 1, mbti_tf: 1, mbti_jp: 1 });
    expect(flipped.mbti).toBe('INFP');
    // A partial set yields no type.
    expect(scoreQuestionnaire({ mbti_ei: 5 }).mbti).toBeUndefined();
    // MBTI items never leak into the trait vector.
    expect(full.vector).toEqual({});
  });

  it('derives the highest-agreement Enneagram type (ties -> lowest)', () => {
    const v = scoreQuestionnaire({ enn3: 5, enn7: 4, enn1: 2 });
    expect(v.enneagramType).toBe(3);
    // Tie between types 1 and 5 resolves to the lower number.
    const tie = scoreQuestionnaire({ enn5: 5, enn1: 5 });
    expect(tie.enneagramType).toBe(1);
    expect(v.vector).toEqual({});
  });

  it('scores Schwartz value items onto their dimension', () => {
    const v = scoreQuestionnaire({ vpo1: 5, vun1: 1 });
    expect(v.vector[DIM.valPower]).toBe(100);
    expect(v.vector[DIM.valUniversalism]).toBe(0);
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
