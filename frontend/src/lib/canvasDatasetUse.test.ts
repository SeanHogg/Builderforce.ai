import { describe, expect, it } from 'vitest';
import {
  evaluateDatasetUse,
  normalizeUsePolicy,
  type ColumnClassification,
  type DatasetUsePolicy,
} from './canvasDataGovernance';

/**
 * ONE gate, after two.
 *
 * These cases are the union of what both predecessors guaranteed: the classification-aware
 * asymmetry this file already covered (export defaults open, training defaults shut,
 * special categories need consent) plus the four `checkDataUse` covered from the canvas
 * side (a permissive default, a declared purpose that binds, a retention window that
 * outranks everything, and a lawful basis asked only of the uses that take rows somewhere).
 * They are together because there is now one function to ask, and keeping them apart is how
 * two gates came to disagree in the first place.
 */

const col = (column: string, pii: ColumnClassification['pii']): ColumnClassification =>
  ({ column, pii, classification: pii === 'none' ? 'internal' : 'confidential', confidence: 'high' } as ColumnClassification);

const NONE = [col('latency_ms', 'none'), col('region', 'none')];
const PERSONAL = [col('email', 'email'), col('full_name', 'name')];
const SPECIAL = [col('diagnosis', 'health')];

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe('data with no personal columns and no policy is not gated at all', () => {
  it('permits every use', () => {
    for (const use of ['analysis', 'training', 'evaluation', 'export', 'sharing', 'publish'] as const) {
      expect(evaluateDatasetUse(use, NONE, null).allowed).toBe(true);
    }
  });

  it('does not invent a lawful-basis requirement for server metrics', () => {
    // The rule that keeps the product usable: gating non-personal data teaches
    // people to tick boxes, which is worse than having no boxes.
    expect(evaluateDatasetUse('training', NONE, null).allowed).toBe(true);
    expect(evaluateDatasetUse('export', NONE, {}).allowed).toBe(true);
  });

  it('permits analysis of rows already in front of the person, policy or no policy', () => {
    // Asking for consent to LOOK at the rows is how a consent prompt becomes furniture.
    expect(evaluateDatasetUse('analysis', PERSONAL, { purposes: ['analysis'] }).allowed).toBe(true);
    expect(evaluateDatasetUse('analysis', PERSONAL, null).allowed).toBe(true);
  });
});

describe('retention outranks everything', () => {
  const expired: DatasetUsePolicy = { retentionDays: 30, collectedAt: daysAgo(90), lawfulBasis: 'consent', purposes: ['training', 'export'] };

  it('refuses even a fully permitted use once the window has run', () => {
    const decision = evaluateDatasetUse('export', PERSONAL, expired);
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('retention-expired');
    expect(decision.reason).toContain('60 day(s) ago');
  });

  it('refuses non-personal data too, because a declared window is a promise', () => {
    expect(evaluateDatasetUse('export', NONE, expired).allowed).toBe(false);
  });

  it('refuses even a mere analysis, because expired rows have no lawful use left', () => {
    expect(evaluateDatasetUse('analysis', NONE, expired).code).toBe('retention-expired');
  });

  it('permits inside the window', () => {
    expect(evaluateDatasetUse('export', PERSONAL, { ...expired, collectedAt: daysAgo(10) }).allowed).toBe(true);
  });

  it('ignores a window with no collection date rather than guessing one', () => {
    expect(evaluateDatasetUse('analysis', NONE, { retentionDays: 1 }).allowed).toBe(true);
  });
});

describe('a declared purpose binds, personal data or not', () => {
  it('refuses a use the dataset excludes', () => {
    const decision = evaluateDatasetUse('training', NONE, { purposes: ['analysis'], lawfulBasis: 'consent' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('purpose-not-permitted');
    expect(decision.reason).toContain('training');
  });

  it('names the declared purposes so the reader knows what to change', () => {
    const decision = evaluateDatasetUse('publish', PERSONAL, { purpose: 'Support triage', purposes: ['export'], lawfulBasis: 'consent' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('export');
  });
});

describe('a lawful basis is asked only of the uses that take the rows somewhere', () => {
  const policy: DatasetUsePolicy = { purposes: ['analysis', 'training', 'sharing', 'export'] };

  it('is not asked for analysis', () => {
    expect(evaluateDatasetUse('analysis', NONE, policy).allowed).toBe(true);
  });

  it('is asked for training and sharing once a policy exists', () => {
    expect(evaluateDatasetUse('training', NONE, policy).code).toBe('no-lawful-basis');
    expect(evaluateDatasetUse('sharing', NONE, policy).code).toBe('no-lawful-basis');
  });

  it('is never asked for a plain export — a download lands where the rows already are', () => {
    // Neither predecessor gate asked, and asking would refuse the single most common
    // thing anybody does with a dataset. The declared purposes and the retention window
    // still bind an export; the basis does not.
    expect(evaluateDatasetUse('export', NONE, policy).allowed).toBe(true);
    expect(evaluateDatasetUse('export', PERSONAL, policy).allowed).toBe(true);
  });
});

describe('the reversible uses', () => {
  it('permit personal data when no policy forbids them', () => {
    // Export produces a copy somebody can delete; silence is not a refusal here.
    expect(evaluateDatasetUse('export', PERSONAL, null).allowed).toBe(true);
    expect(evaluateDatasetUse('sharing', PERSONAL, { lawfulBasis: 'consent' }).allowed).toBe(true);
  });
});

describe('training is the one use that cannot be undone', () => {
  it('is refused on personal data with no lawful basis', () => {
    const decision = evaluateDatasetUse('training', PERSONAL, { purposes: ['training'] });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('no-lawful-basis');
  });

  it('is refused on personal data that never said training was covered', () => {
    // The asymmetry: export defaults open, training defaults shut.
    const decision = evaluateDatasetUse('training', PERSONAL, { lawfulBasis: 'legitimate-interests' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('purpose-not-permitted');
  });

  it('is permitted when basis and permission are both present', () => {
    expect(evaluateDatasetUse('training', PERSONAL, { lawfulBasis: 'consent', purposes: ['training'] }).allowed).toBe(true);
    expect(evaluateDatasetUse('training', PERSONAL, { lawfulBasis: 'legitimate-interests', purposes: ['training'] }).allowed).toBe(true);
  });

  it('refuses special-category data on anything short of explicit consent', () => {
    const decision = evaluateDatasetUse('training', SPECIAL, { lawfulBasis: 'legitimate-interests', purposes: ['training'] });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('special-category-needs-consent');
    expect(decision.categories).toEqual(['health']);
  });

  it('permits special-category data on consent', () => {
    expect(evaluateDatasetUse('training', SPECIAL, { lawfulBasis: 'consent', purposes: ['training'] }).allowed).toBe(true);
  });

  it('still allows EXPORTING the special-category set — only training is weight-bound', () => {
    expect(evaluateDatasetUse('export', SPECIAL, { lawfulBasis: 'legitimate-interests' }).allowed).toBe(true);
  });
});

describe('reading a policy off an object', () => {
  it('drops malformed values rather than trusting them', () => {
    // An unreadable basis silently accepted would turn a refusal into a permission.
    expect(normalizeUsePolicy({ lawfulBasis: 'vibes', retentionDays: -5, purposes: ['training', 'nonsense'] }))
      .toEqual({ purposes: ['training'] });
  });

  it('returns null for an empty or non-object policy', () => {
    expect(normalizeUsePolicy({})).toBeNull();
    expect(normalizeUsePolicy(null)).toBeNull();
    expect(normalizeUsePolicy([])).toBeNull();
    expect(normalizeUsePolicy('consent')).toBeNull();
  });

  it('keeps a well-formed policy intact', () => {
    expect(normalizeUsePolicy({
      purpose: '  Recruiting  ', lawfulBasis: 'consent', retentionDays: 30.7, collectedAt: '2026-01-01', purposes: ['training'],
    })).toEqual({ purposes: ['training'], purpose: 'Recruiting', lawfulBasis: 'consent', retentionDays: 30, collectedAt: '2026-01-01' });
  });
});
