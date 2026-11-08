import { describe, expect, it } from 'vitest';
import { personalityOneLiner, type OneLinerPhrases } from './personalityOneLiner';
import type { PsychometricCatalog, PsychometricProfile } from './psychometric';

const phrases: OneLinerPhrases = {
  mbti: (v) => `MBTI ${v}`,
  enneagram: (n) => `Type ${n}`,
  trait: (band, name) => `${band === 'high' ? 'High' : 'Low'} ${name}`,
};

const catalog = {
  frameworks: [{ id: 'f', name: 'F', summary: '', dimensions: [{ id: 'curiosity', name: 'Curiosity', low: '', high: '', description: '' }] }],
} as unknown as PsychometricCatalog;

describe('personalityOneLiner', () => {
  it('is empty for no profile and for a profile with no signal', () => {
    expect(personalityOneLiner(undefined, catalog, phrases)).toBe('');
    expect(personalityOneLiner({ vector: {} } as PsychometricProfile, catalog, phrases)).toBe('');
  });

  it('joins type, enneagram and the single strongest trait', () => {
    const profile = { mbti: 'ENFP', enneagramType: 7, vector: { curiosity: 90, other: 20 } } as PsychometricProfile;
    expect(personalityOneLiner(profile, catalog, phrases)).toBe('MBTI ENFP · Type 7 · High Curiosity');
  });

  it('falls back to the dimension id when the catalog has not loaded', () => {
    const profile = { vector: { curiosity: 10 } } as PsychometricProfile;
    expect(personalityOneLiner(profile, null, phrases)).toBe('Low curiosity');
  });
});
