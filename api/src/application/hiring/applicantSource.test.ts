import { describe, expect, it } from 'vitest';
import {
  BUILTIN_BOARD_SOURCES, foldSourceCounts, normalizeSourceToken, resolveApplicantSource, sourceFoldSql, withBoardSources,
} from './applicantSource';

describe('resolveApplicantSource', () => {
  it('folds the declared spellings onto the board key, whatever the case, spacing or URL form', () => {
    for (const raw of ['LinkedIn', '  linkedin  ', 'LinkedIn Jobs', 'linkedin.com', 'https://www.linkedin.com/jobs/view/1', 'www.linkedin.com', 'linkedin-jobs']) {
      expect(resolveApplicantSource(raw, BUILTIN_BOARD_SOURCES), raw).toBe('linkedin-jobs');
    }
    expect(resolveApplicantSource('Indeed.com', BUILTIN_BOARD_SOURCES)).toBe('indeed-jobs');
    expect(resolveApplicantSource('https://boards.greenhouse.io/acme', BUILTIN_BOARD_SOURCES)).toBe('greenhouse-job-board');
    expect(resolveApplicantSource('Workable', BUILTIN_BOARD_SOURCES)).toBe('workable');
  });

  it('leaves a source that names no board exactly as it came', () => {
    expect(resolveApplicantSource('Referral', BUILTIN_BOARD_SOURCES)).toBe('Referral');
    expect(resolveApplicantSource('careers-site', BUILTIN_BOARD_SOURCES)).toBe('careers-site');
  });

  it('matches neither board for an alias two boards claim, but a key always wins', () => {
    const boards = [{ key: 'a-board', aliases: ['shared', 'a'] }, { key: 'b-board', aliases: ['shared', 'a-board'] }];
    expect(resolveApplicantSource('shared', boards)).toBe('shared');
    expect(resolveApplicantSource('a', boards)).toBe('a-board');
    expect(resolveApplicantSource('a-board', boards)).toBe('a-board');
  });

  it('is the identity with no boards', () => {
    expect(resolveApplicantSource('LinkedIn', [])).toBe('LinkedIn');
  });
});

describe('normalizeSourceToken', () => {
  it('reduces a URL to its host without www', () => {
    expect(normalizeSourceToken('HTTPS://WWW.Indeed.com/viewjob?jk=1')).toBe('indeed.com');
  });
});

describe('withBoardSources', () => {
  it('adds a tenant board with its aliases but never overrides a built-in key', () => {
    const boards = withBoardSources([{ key: 'acme-careers', aliases: ['acme'] }, { key: 'linkedin-jobs', aliases: ['hijack'] }]);
    expect(resolveApplicantSource('ACME', boards)).toBe('acme-careers');
    expect(resolveApplicantSource('hijack', boards)).toBe('hijack');
    expect(resolveApplicantSource('LinkedIn', boards)).toBe('linkedin-jobs');
  });
});

describe('sourceFoldSql', () => {
  it('is generated from the same alias map and escapes its literals', () => {
    const text = (sourceFoldSql('a.source', [{ key: "it's-board", aliases: ['its'] }]) as unknown as { queryChunks: Array<{ value: string[] }> })
      .queryChunks.map((chunk) => chunk.value.join('')).join('');
    expect(text).toContain("WHEN 'its' THEN 'it''s-board'");
    expect(text).toContain('ELSE a.source END');
  });
});

describe('foldSourceCounts', () => {
  it('sums every spelling of one board and keeps the rest', () => {
    expect(foldSourceCounts(
      [{ source: 'LinkedIn', count: 4 }, { source: 'linkedin-jobs', count: 3 }, { source: 'referral', count: 9 }],
      BUILTIN_BOARD_SOURCES,
    )).toEqual([{ source: 'referral', count: 9 }, { source: 'linkedin-jobs', count: 7 }]);
  });
});
