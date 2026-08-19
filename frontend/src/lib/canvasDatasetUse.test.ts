import { describe, expect, it } from 'vitest';
import {
  evaluateDatasetUse,
  normalizeUsePolicy,
  type ColumnClassification,
  type DatasetUsePolicy,
} from './canvasDataGovernance';

const col = (column: string, pii: ColumnClassification['pii']): ColumnClassification =>
  ({ column, pii, classification: pii === 'none' ? 'internal' : 'confidential', confidence: 'high' } as ColumnClassification);

const NONE = [col('latency_ms', 'none'), col('region', 'none')];
const PERSONAL = [col('email', 'email'), col('full_name', 'name')];
const SPECIAL = [col('diagnosis', 'health')];

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe('data with no personal columns is not gated at all', () => {
  it('permits every use, policy or no policy', () => {
    for (const use of ['train', 'export', 'publish', 'share'] as const) {
      expect(evaluateDatasetUse(use, NONE, null).allowed).toBe(true);
    }
  });

  it('does not invent a lawful-basis requirement for server metrics', () => {
    // The rule that keeps the product usable: gating non-personal data teaches
    // people to tick boxes, which is worse than having no boxes.
    expect(evaluateDatasetUse('train', NONE, {}).allowed).toBe(true);
  });
});

describe('retention outranks everything', () => {
  const expired: DatasetUsePolicy = { retentionDays: 30, collectedAt: daysAgo(90), lawfulBasis: 'consent', permittedUses: ['train', 'export'] };

  it('refuses even a fully permitted use once the window has run', () => {
    const decision = evaluateDatasetUse('export', PERSONAL, expired);
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('retention-expired');
    expect(decision.reason).toContain('60 day(s) ago');
  });

  it('refuses non-personal data too, because a declared window is a promise', () => {
    expect(evaluateDatasetUse('export', NONE, expired).allowed).toBe(false);
  });

  it('permits inside the window', () => {
    expect(evaluateDatasetUse('export', PERSONAL, { ...expired, collectedAt: daysAgo(10) }).allowed).toBe(true);
  });

  it('ignores a window with no collection date rather than guessing one', () => {
    expect(evaluateDatasetUse('export', NONE, { retentionDays: 1 }).allowed).toBe(true);
  });
});

describe('the reversible uses', () => {
  it('permit personal data when nothing forbids them', () => {
    // Export produces a copy somebody can delete; silence is not a refusal here.
    expect(evaluateDatasetUse('export', PERSONAL, null).allowed).toBe(true);
    expect(evaluateDatasetUse('share', PERSONAL, {}).allowed).toBe(true);
  });

  it('are refused when the declared purpose does not cover them', () => {
    const decision = evaluateDatasetUse('publish', PERSONAL, { purpose: 'Support triage', permittedUses: ['export'] });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('use-not-permitted');
    expect(decision.reason).toContain('Support triage');
  });
});

describe('training is the one use that cannot be undone', () => {
  it('is refused on personal data with no lawful basis', () => {
    const decision = evaluateDatasetUse('train', PERSONAL, { permittedUses: ['train'] });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('no-lawful-basis');
  });

  it('is refused on personal data that never said training was covered', () => {
    // The asymmetry: export defaults open, training defaults shut.
    const decision = evaluateDatasetUse('train', PERSONAL, { lawfulBasis: 'legitimate_interests' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('use-not-permitted');
  });

  it('is permitted when basis and permission are both present', () => {
    expect(evaluateDatasetUse('train', PERSONAL, { lawfulBasis: 'consent', permittedUses: ['train'] }).allowed).toBe(true);
    expect(evaluateDatasetUse('train', PERSONAL, { lawfulBasis: 'legitimate_interests', permittedUses: ['train'] }).allowed).toBe(true);
  });

  it('refuses special-category data on anything short of explicit consent', () => {
    const decision = evaluateDatasetUse('train', SPECIAL, { lawfulBasis: 'legitimate_interests', permittedUses: ['train'] });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('special-category-needs-consent');
    expect(decision.categories).toEqual(['health']);
  });

  it('permits special-category data on consent', () => {
    expect(evaluateDatasetUse('train', SPECIAL, { lawfulBasis: 'consent', permittedUses: ['train'] }).allowed).toBe(true);
  });

  it('still allows EXPORTING the special-category set — only training is weight-bound', () => {
    expect(evaluateDatasetUse('export', SPECIAL, { lawfulBasis: 'legitimate_interests' }).allowed).toBe(true);
  });
});

describe('reading a policy off an object', () => {
  it('drops malformed values rather than trusting them', () => {
    expect(normalizeUsePolicy({ lawfulBasis: 'vibes', retentionDays: -5, permittedUses: ['train', 'nonsense'] }))
      .toEqual({ permittedUses: ['train'] });
  });

  it('returns null for an empty or non-object policy', () => {
    expect(normalizeUsePolicy({})).toBeNull();
    expect(normalizeUsePolicy(null)).toBeNull();
    expect(normalizeUsePolicy([])).toBeNull();
    expect(normalizeUsePolicy('consent')).toBeNull();
  });

  it('keeps a well-formed policy intact', () => {
    expect(normalizeUsePolicy({
      purpose: '  Recruiting  ', lawfulBasis: 'consent', retentionDays: 30.7, collectedAt: '2026-01-01', permittedUses: ['train'],
    })).toEqual({ purpose: 'Recruiting', lawfulBasis: 'consent', retentionDays: 30, collectedAt: '2026-01-01', permittedUses: ['train'] });
  });
});
