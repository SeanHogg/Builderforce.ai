/**
 * The RANKING, pinned.
 *
 * The weights in `scoreMatch` are the product decision in this feature: they decide whose
 * name a client sees first, and a change to them that nobody notices is the failure worth
 * a test. The queries around them need a database and are exercised through the routes;
 * the scorer is pure, so it is testable exactly where the judgement lives.
 */
import { describe, expect, it } from 'vitest';
import { __scoreMatch, __skillTokens } from './talentRecommendations';

const base = {
  postingSkills: new Set<string>(),
  candidateSkills: new Set<string>(),
  postingDiscipline: null as string | null,
  candidateDiscipline: null as string | null,
  specialtyAgrees: false,
  engagementType: null as string | null,
  rateMinCents: null as number | null,
  rateMaxCents: null as number | null,
  hourlyRateCents: null as number | null,
  rating: null as number | null,
  ratingCount: 0,
  availability: null as string | null,
};

describe('skillTokens — the SAME lexicon the résumé match uses', () => {
  it('reads a stored JSON skill list and prose alike, keeping only recognised skills', () => {
    const tokens = __skillTokens('["Rust","Postgres"]', 'Backend engineer who likes ledgers');
    expect(tokens.has('rust')).toBe(true);
    // CANONICALISED by the shared lexicon, not merely lowercased: `Postgres` and
    // `PostgreSQL` are one token, which is why borrowing the lexicon matters more than
    // borrowing a tokeniser would.
    expect(tokens.has('postgresql')).toBe(true);
    // A noun is not a skill. The lexicon decides, not the tokeniser.
    expect(tokens.has('ledgers')).toBe(false);
  });

  it('ignores a null column rather than throwing on it', () => {
    expect(__skillTokens(null, undefined).size).toBe(0);
  });
});

describe('scoreMatch — skills dominate, and an unmeasurable posting says so', () => {
  it('a posting naming no recognisable skill scores NEUTRAL, not zero', () => {
    // The same refusal `compareResumeToJob` makes: with nothing to measure, do not invent
    // a confident number. A zero would read as "this person is terrible".
    const scored = __scoreMatch({ ...base });
    expect(scored.score).toBe(28);
    expect(scored.reasons).toEqual([]);
  });

  it('full skill overlap is worth 55, and half is worth about half of that', () => {
    const full = __scoreMatch({
      ...base,
      postingSkills: new Set(['rust', 'postgresql']),
      candidateSkills: new Set(['rust', 'postgresql']),
    });
    expect(full.score).toBe(55);
    const half = __scoreMatch({
      ...base,
      postingSkills: new Set(['rust', 'postgresql']),
      candidateSkills: new Set(['rust']),
    });
    expect(half.score).toBe(28);
    expect(half.matched).toEqual(['Rust']);
    expect(half.missing).toEqual(['PostgreSQL']);
  });

  it('shows the GAPS as well as the hits — a list of only hits reads like an advert', () => {
    const scored = __scoreMatch({
      ...base,
      postingSkills: new Set(['rust', 'kubernetes']),
      candidateSkills: new Set(['rust']),
    });
    expect(scored.missing.length).toBeGreaterThan(0);
  });

  it('a matching discipline adds 12, and an agreeing specialty 8 more', () => {
    const discipline = __scoreMatch({ ...base, postingDiscipline: 'dba', candidateDiscipline: 'dba' });
    expect(discipline.score).toBe(28 + 12);
    const withLeaf = __scoreMatch({ ...base, postingDiscipline: 'dba', candidateDiscipline: 'dba', specialtyAgrees: true });
    expect(withLeaf.score).toBe(28 + 12 + 8);
    // The specialty never scores without its parent — it is not a free-floating tag.
    const orphan = __scoreMatch({ ...base, postingDiscipline: 'dba', candidateDiscipline: 'qa', specialtyAgrees: true });
    expect(orphan.score).toBe(28);
  });
});

describe('scoreMatch — rate is compared only where the units are comparable', () => {
  const hourly = { ...base, engagementType: 'hourly', rateMinCents: 8000, rateMaxCents: 12000 };

  it('inside the band scores fullest', () => {
    expect(__scoreMatch({ ...hourly, hourlyRateCents: 10000 }).score).toBe(28 + 10);
  });

  it('BELOW the band still scores — a band is a ceiling a client will pay, not a floor', () => {
    expect(__scoreMatch({ ...hourly, hourlyRateCents: 5000 }).score).toBe(28 + 7);
  });

  it('above the band scores nothing for rate', () => {
    expect(__scoreMatch({ ...hourly, hourlyRateCents: 20000 }).score).toBe(28);
  });

  it('is NOT compared on fixed-price work: a total and an hourly rate are different quantities', () => {
    const fixed = __scoreMatch({
      ...base, engagementType: 'fixed_bid', rateMinCents: 8000, rateMaxCents: 12000, hourlyRateCents: 10000,
    });
    expect(fixed.score).toBe(28);
    expect(fixed.reasons.some((r) => r.code === 'rate')).toBe(false);
  });
});

describe('scoreMatch — reputation needs evidence, and availability is respected', () => {
  it('one glowing review is worth a fraction of a track record', () => {
    const one = __scoreMatch({ ...base, rating: 5, ratingCount: 1 });
    const many = __scoreMatch({ ...base, rating: 5, ratingCount: 20 });
    expect(one.score).toBeLessThan(many.score);
    expect(many.score).toBeLessThanOrEqual(28 + 10);
  });

  it('a mediocre average earns nothing rather than a negative', () => {
    expect(__scoreMatch({ ...base, rating: 3, ratingCount: 10 }).score).toBe(28);
  });

  it('an unrated profile is not punished into invisibility', () => {
    expect(__scoreMatch({ ...base, rating: null, ratingCount: 0 }).score).toBe(28);
  });

  it('open beats limited, and both are stated as a reason', () => {
    expect(__scoreMatch({ ...base, availability: 'open' }).score).toBe(28 + 5);
    expect(__scoreMatch({ ...base, availability: 'limited' }).score).toBe(28 + 2);
  });
});

describe('scoreMatch — the reasons are the audit trail', () => {
  it('every term that scored appears, ordered by how much it contributed', () => {
    const scored = __scoreMatch({
      ...base,
      postingSkills: new Set(['rust', 'postgresql']),
      candidateSkills: new Set(['rust', 'postgresql']),
      postingDiscipline: 'developer',
      candidateDiscipline: 'developer',
      availability: 'open',
    });
    expect(scored.reasons.map((r) => r.code)).toEqual(['skills', 'discipline', 'available']);
    // The points shown must add up to the score shown, or the explanation is a decoration.
    expect(scored.reasons.reduce((total, r) => total + r.points, 0)).toBe(scored.score);
  });

  it('clamps to 100 — a score is a rank, not an unbounded sum', () => {
    const scored = __scoreMatch({
      ...base,
      postingSkills: new Set(['rust']),
      candidateSkills: new Set(['rust']),
      postingDiscipline: 'developer',
      candidateDiscipline: 'developer',
      specialtyAgrees: true,
      engagementType: 'hourly',
      rateMinCents: 8000,
      rateMaxCents: 12000,
      hourlyRateCents: 10000,
      rating: 5,
      ratingCount: 100,
      availability: 'open',
    });
    expect(scored.score).toBeLessThanOrEqual(100);
  });
});
