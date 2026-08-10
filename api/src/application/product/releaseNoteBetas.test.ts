import { describe, expect, it } from 'vitest';
import { isJoinableBeta, type ReleaseNote } from './releaseNotes';
import { bannerBeta, hashBetaTerms, DEFAULT_BETA_TERMS_REF, type BetaProgram } from './releaseNoteBetas';

const note = (over: Partial<ReleaseNote> = {}): ReleaseNote => ({
  id: 'n1',
  version: '2026.8.1',
  title: 'New look',
  body: null,
  category: 'improvement',
  stage: 'public_beta',
  betaOptIn: true,
  betaTerms: null,
  stageEndsAt: null,
  publishedAt: '2026-08-01T00:00:00.000Z',
  emailedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const program = (over: Partial<BetaProgram> = {}): BetaProgram => ({
  ...note(over),
  myStatus: null,
  agreedAt: null,
  ...over,
});

describe('isJoinableBeta', () => {
  it('accepts a published, opt-in beta', () => {
    expect(isJoinableBeta(note())).toBe(true);
    expect(isJoinableBeta(note({ stage: 'private_beta' }))).toBe(true);
  });

  it('refuses a draft, a non-beta stage, or an invitation-only beta', () => {
    expect(isJoinableBeta(note({ publishedAt: null }))).toBe(false);
    expect(isJoinableBeta(note({ stage: 'live' }))).toBe(false);
    expect(isJoinableBeta(note({ stage: 'sunset' }))).toBe(false);
    expect(isJoinableBeta(note({ betaOptIn: false }))).toBe(false);
  });
});

describe('bannerBeta', () => {
  it('offers a public beta the user has never answered', () => {
    expect(bannerBeta([program({ id: 'b1' })])?.id).toBe('b1');
  });

  it('stays silent once they have answered — in either direction', () => {
    for (const myStatus of ['joined', 'left', 'dismissed'] as const) {
      expect(bannerBeta([program({ myStatus })])).toBeNull();
    }
  });

  it('never interrupts anyone about an invitation-only beta', () => {
    expect(bannerBeta([program({ stage: 'private_beta' })])).toBeNull();
  });

  it('offers the newest unanswered one, not a second banner', () => {
    const banner = bannerBeta([
      program({ id: 'newest' }),
      program({ id: 'older' }),
    ]);
    expect(banner?.id).toBe('newest');
  });
});

describe('hashBetaTerms', () => {
  it('is stable for the same text and different for different text', async () => {
    const a = await hashBetaTerms('You accept that betas change.');
    expect(a).toEqual(await hashBetaTerms('You accept that betas change.'));
    expect(a).not.toEqual(await hashBetaTerms('You accept that betas change!'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records "agreed to the platform default" distinctly from any real text', async () => {
    const fallback = await hashBetaTerms(null);
    expect(fallback).toEqual(await hashBetaTerms('   '));
    expect(fallback).toEqual(await hashBetaTerms(DEFAULT_BETA_TERMS_REF));
    // …and is not the hash of nothing at all, which is the point of the sentinel.
    expect(fallback).not.toEqual(await hashBetaTerms('x'));
  });
});
