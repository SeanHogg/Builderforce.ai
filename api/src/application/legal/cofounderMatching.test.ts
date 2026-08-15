import { describe, expect, it } from 'vitest';
import { mutualScore, scoreMatch, type ScorableProfile } from './cofounderMatching';

/**
 * The scorer is pure, so it is tested as a table — which is the reason it was
 * built pure. Every assertion below is a claim the product makes to somebody
 * about the most consequential professional decision they will take, and each one
 * should be readable as a sentence.
 */
const profile = (over: Partial<ScorableProfile> = {}): ScorableProfile => ({
  strength: 'technical',
  seeking: 'commercial',
  brings: ['backend', 'infra'],
  needs: ['sales', 'fundraising'],
  commitment: 'full-time',
  equityExpectation: 50,
  location: 'London',
  remoteOk: false,
  sectors: ['fintech'],
  stage: 'idea',
  ...over,
});

describe('complementarity dominates', () => {
  it('rewards a counterpart who covers what you are looking for', () => {
    const complementary = scoreMatch(profile(), profile({ strength: 'commercial', seeking: 'technical', brings: ['sales', 'fundraising'], needs: ['backend'] }));
    const duplicate = scoreMatch(profile(), profile({ brings: ['backend'], needs: ['infra'] }));
    expect(complementary.score).toBeGreaterThan(duplicate.score);
  });

  it('reports two people covering the same half as a reason AGAINST, not an absence', () => {
    // The single most important thing this comparison can tell either of them, so
    // it must be a negative reason rather than a missing positive one — a zero
    // reads as "no data", which is the opposite of what is true here.
    const { reasons } = scoreMatch(profile(), profile({ strength: 'technical' }));
    const complementarity = reasons.find((r) => r.dimension === 'complementarity');
    expect(complementarity?.points).toBeLessThan(0);
    expect(complementarity?.detail).toContain('nobody is covering the other half');
  });
});

describe('commitment', () => {
  it('penalises opposite ends of the ladder', () => {
    const matched = scoreMatch(profile(), profile({ strength: 'commercial', seeking: 'technical', commitment: 'full-time' }));
    const mismatched = scoreMatch(profile(), profile({ strength: 'commercial', seeking: 'technical', commitment: 'advisory' }));
    expect(mismatched.score).toBeLessThan(matched.score);
    expect(mismatched.reasons.find((r) => r.dimension === 'commitment')?.points).toBeLessThan(0);
  });

  it('names it as the most common reason a founding team breaks up', () => {
    const { reasons } = scoreMatch(profile(), profile({ commitment: 'nights-weekends' }));
    expect(reasons.find((r) => r.dimension === 'commitment')?.detail).toContain('breaks up');
  });
});

describe('equity', () => {
  it('treats expectations summing over 100 as an impossibility, not a preference', () => {
    const { reasons } = scoreMatch(profile({ equityExpectation: 60 }), profile({ equityExpectation: 60 }));
    const equity = reasons.find((r) => r.dimension === 'equity');
    expect(equity?.points).toBeLessThan(0);
    expect(equity?.detail).toContain('cannot be split');
  });

  it('says what is left for everyone else when the split works', () => {
    const { reasons } = scoreMatch(profile({ equityExpectation: 45 }), profile({ equityExpectation: 40 }));
    expect(reasons.find((r) => r.dimension === 'equity')?.detail).toContain('15% for the option pool');
  });

  it('says nothing at all when either side has not stated a number', () => {
    // Silence, not a neutral score: inventing a verdict about somebody's equity
    // expectation from an empty field is worse than leaving the row out.
    const { reasons } = scoreMatch(profile({ equityExpectation: null }), profile());
    expect(reasons.some((r) => r.dimension === 'equity')).toBe(false);
  });
});

describe('skills', () => {
  it('counts what they bring against what you said you need', () => {
    const { reasons } = scoreMatch(
      profile({ needs: ['sales', 'fundraising', 'design'] }),
      profile({ brings: ['sales', 'fundraising'] }),
    );
    expect(reasons.find((r) => r.dimension === 'skills')?.detail).toContain('2 of the 3');
  });

  it('matches case-insensitively, so "Sales" and "sales" are one skill', () => {
    const { reasons } = scoreMatch(profile({ needs: ['Sales'] }), profile({ brings: ['sales'] }));
    expect(reasons.find((r) => r.dimension === 'skills')?.points).toBeGreaterThan(0);
  });
});

describe('the score', () => {
  it('stays inside 0–100 however badly a pair matches', () => {
    const awful = scoreMatch(
      profile({ equityExpectation: 90, commitment: 'full-time' }),
      profile({ strength: 'technical', equityExpectation: 90, commitment: 'advisory', brings: [], sectors: [] }),
    );
    expect(awful.score).toBeGreaterThanOrEqual(0);
    expect(awful.score).toBeLessThanOrEqual(100);
  });

  it('leads with the reason that decided it, positive or negative', () => {
    const { reasons } = scoreMatch(profile(), profile({ strength: 'technical' }));
    const first = reasons[0]!;
    expect(Math.abs(first.points)).toBeGreaterThanOrEqual(Math.abs(reasons[reasons.length - 1]!.points));
  });
});

describe('mutuality', () => {
  it('reports the lower of the two directions — a pairing is only as good as the side that wants it less', () => {
    const keen = profile({ strength: 'technical', seeking: 'commercial', needs: ['sales'] });
    const indifferent = profile({ strength: 'commercial', seeking: 'commercial', brings: ['sales'], needs: [] });
    const { score, forA, forB } = mutualScore(keen, indifferent);
    expect(score).toBe(Math.min(forA.score, forB.score));
    expect(forA.score).not.toBe(forB.score);
  });
});
