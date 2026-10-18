import { describe, expect, it } from 'vitest';
import { extractCandidate, median, pipelineMetrics, type BaselineFact } from './learningPipeline';

const BASELINE: BaselineFact[] = [
  { key: 'deploy-window', content: 'Deploys happen on Tuesday mornings.' },
  { key: 'auth-store', content: 'Sessions live in auth_user_sessions, not a second table.' },
];

describe('extractCandidate', () => {
  it('returns null for empty text and for a statement already in the baseline', () => {
    expect(extractCandidate('   ', BASELINE)).toBeNull();
    expect(extractCandidate('Deploys happen on Tuesday mornings.', BASELINE)).toBeNull();
  });

  it('extracts an explicit key and flags a contradiction against that key', () => {
    const candidate = extractCandidate('deploy-window: Deploys happen on Thursday evenings after the freeze.', BASELINE);
    expect(candidate).toMatchObject({
      factKey: 'deploy-window',
      contradicts: true,
      baselineContent: 'Deploys happen on Tuesday mornings.',
    });
  });

  it('extracts a new sentence that does not contradict any baseline key', () => {
    const candidate = extractCandidate('The review queue is the only door that writes an approved learning back.', []);
    expect(candidate).toMatchObject({ contradicts: false, baselineContent: null });
    expect(candidate?.factKey.startsWith('learn-')).toBe(true);
  });

  it('refuses a key line whose statement is too short to be a learning', () => {
    expect(extractCandidate('deploy-window: Thursday.', BASELINE)).toBeNull();
  });
});

describe('pipelineMetrics', () => {
  it('is zero, not a target, when nothing has run', () => {
    expect(pipelineMetrics([])).toEqual({
      runs: 0,
      produced: 0,
      candidates: 0,
      extractionRate: 0,
      reviewHours: null,
      contradictionRate: 0,
      transferUplift: null,
    });
  });

  it('computes extraction, contradiction, median review hours and mean uplift from the ledger', () => {
    const metrics = pipelineMetrics([
      { kind: 'run', produced: true },
      { kind: 'run', produced: true },
      { kind: 'run', produced: false },
      { kind: 'run', produced: false },
      {
        kind: 'candidate',
        contradicts: true,
        createdAt: '2026-07-01T00:00:00.000Z',
        reviewedAt: '2026-07-01T02:00:00.000Z',
        benchBefore: 40,
        benchAfter: 50,
        transferred: true,
      },
      {
        kind: 'candidate',
        contradicts: false,
        createdAt: '2026-07-01T00:00:00.000Z',
        reviewedAt: '2026-07-01T10:00:00.000Z',
        benchBefore: null,
        benchAfter: null,
        transferred: false,
      },
    ]);
    expect(metrics.extractionRate).toBe(50);
    expect(metrics.contradictionRate).toBe(50);
    expect(metrics.reviewHours).toBe(6);
    expect(metrics.transferUplift).toBe(25);
    expect(median([2, 10])).toBe(6);
  });
});
