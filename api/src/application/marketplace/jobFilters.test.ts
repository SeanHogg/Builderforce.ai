/**
 * THE PARITY TABLE.
 *
 * `jobFilters` deliberately holds TWO evaluators of one spec — a SQL lowering for the
 * browse route and an in-memory predicate for the alert sweep — because the two callers
 * need different machines (see the module header). The whole risk that arrangement
 * creates is that they come to disagree, and a seeker whose alert says "no new work"
 * about a posting sitting on the board they are looking at has an alert they will never
 * trust again.
 *
 * A unit test cannot run Postgres, so it cannot execute both machines. What it CAN pin
 * is the thing that actually drifts: the normalisation both share, and the predicate's
 * behaviour on every edge the SQL encodes — blank-is-not-a-filter, exact-and-
 * case-insensitive skills, substring keywords that also see the raw skills text. Each
 * case below names the SQL clause it mirrors, so changing one without the other is a
 * visible omission rather than an invisible one.
 */
import { describe, expect, it } from 'vitest';
import {
  describeJobFilters,
  jobFilterConditions,
  jobFilterIsEmpty,
  jobFilterMatches,
  normalizeJobFilters,
} from './jobFilters';

const posting = (over: Partial<Record<string, unknown>> = {}) => ({
  title: 'Senior Rust engineer',
  description: 'Build a payments ledger.',
  discipline: 'developer',
  skills: '["Rust","Postgres"]',
  ...over,
});

describe('normalizeJobFilters', () => {
  it('drops blanks — an empty keyword is "did not filter", not "match nothing"', () => {
    expect(normalizeJobFilters({ q: '   ', discipline: '', skill: undefined })).toEqual({});
    expect(jobFilterIsEmpty(normalizeJobFilters({}))).toBe(true);
  });

  it('trims, and lowercases the discipline so the SQL clause can stay an equality', () => {
    expect(normalizeJobFilters({ q: '  rust ', discipline: ' Developer ', skill: ' Postgres ' }))
      .toEqual({ q: 'rust', discipline: 'developer', skill: 'Postgres' });
  });

  it('reads an alert blob and a query string identically, and `enabled` is not a filter', () => {
    const fromQueryString = normalizeJobFilters({ q: 'rust', discipline: 'developer' });
    const fromAlertFilters = normalizeJobFilters({ q: 'rust', discipline: 'developer', enabled: false });
    expect(fromAlertFilters).toEqual(fromQueryString);
    expect(jobFilterIsEmpty(fromAlertFilters)).toBe(false);
  });
});

describe('jobFilterConditions', () => {
  it('emits one clause per declared criterion, and none for an empty spec', () => {
    expect(jobFilterConditions(normalizeJobFilters({}))).toHaveLength(0);
    expect(jobFilterConditions(normalizeJobFilters({ discipline: 'developer' }))).toHaveLength(1);
    expect(jobFilterConditions(normalizeJobFilters({ q: 'rust', discipline: 'developer', skill: 'Rust' })))
      .toHaveLength(3);
  });
});

describe('jobFilterMatches — mirroring each SQL clause', () => {
  it('an empty spec matches everything (no criteria clauses were emitted)', () => {
    expect(jobFilterMatches(normalizeJobFilters({}), posting())).toBe(true);
  });

  it('discipline is an exact match on the closed vocabulary — mirrors `eq(discipline)`', () => {
    expect(jobFilterMatches(normalizeJobFilters({ discipline: 'Developer' }), posting())).toBe(true);
    expect(jobFilterMatches(normalizeJobFilters({ discipline: 'designer' }), posting())).toBe(false);
  });

  it('skill is exact and case-insensitive — mirrors `lower(skill) = ?` over the JSON array', () => {
    expect(jobFilterMatches(normalizeJobFilters({ skill: 'rust' }), posting())).toBe(true);
    expect(jobFilterMatches(normalizeJobFilters({ skill: 'RUST' }), posting())).toBe(true);
    // Exact, NOT a substring: "rus" must not match the tag "Rust", or a skill filter
    // would quietly behave like a keyword one and the two criteria would collapse.
    expect(jobFilterMatches(normalizeJobFilters({ skill: 'rus' }), posting())).toBe(false);
  });

  it('reads skills whether stored as a JSON string or already parsed', () => {
    const spec = normalizeJobFilters({ skill: 'postgres' });
    expect(jobFilterMatches(spec, posting({ skills: ['Rust', 'Postgres'] }))).toBe(true);
    expect(jobFilterMatches(spec, posting({ skills: null }))).toBe(false);
  });

  it('a keyword is a substring of title OR description — mirrors the `ilike` OR', () => {
    expect(jobFilterMatches(normalizeJobFilters({ q: 'senior' }), posting())).toBe(true);
    expect(jobFilterMatches(normalizeJobFilters({ q: 'ledger' }), posting())).toBe(true);
    expect(jobFilterMatches(normalizeJobFilters({ q: 'kubernetes' }), posting())).toBe(false);
  });

  it('a keyword also sees the raw skills text — the third `ilike` arm, deliberately', () => {
    // A seeker searching "postgres" expects a posting TAGGED Postgres to match even
    // though the word appears in neither the title nor the prose. The browse surface
    // has always behaved this way; the predicate has to as well.
    expect(jobFilterMatches(normalizeJobFilters({ q: 'postgres' }), posting({
      title: 'Backend engineer', description: 'Ledgers.',
    }))).toBe(true);
  });

  it('criteria are ANDed — every clause must hold', () => {
    const spec = normalizeJobFilters({ q: 'rust', discipline: 'developer', skill: 'Postgres' });
    expect(jobFilterMatches(spec, posting())).toBe(true);
    expect(jobFilterMatches(spec, posting({ discipline: 'designer' }))).toBe(false);
    expect(jobFilterMatches(spec, posting({ skills: '["Rust"]' }))).toBe(false);
  });

  it('tolerates a posting with nothing on it rather than throwing', () => {
    expect(jobFilterMatches(normalizeJobFilters({ q: 'rust' }), {})).toBe(false);
    expect(jobFilterMatches(normalizeJobFilters({}), {})).toBe(true);
  });
});

describe('describeJobFilters', () => {
  it('renders the criteria for a notification body, and empty for no criteria', () => {
    expect(describeJobFilters(normalizeJobFilters({ q: 'rust', discipline: 'developer' })))
      .toBe('rust · developer');
    expect(describeJobFilters(normalizeJobFilters({}))).toBe('');
  });
});
