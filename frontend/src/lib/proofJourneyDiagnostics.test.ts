import { describe, expect, it } from 'vitest';
import { buildProofJourneyDiagnosticsReport } from './proofJourneyDiagnostics';
import type { ProofJourney } from './builderforceApi';

const CONTEXT = { uiVersion: 'ui-1', apiVersion: 'api-1', capturedAt: '2026-08-02T12:01:00.000Z', sourceUrl: 'https://builderforce.ai/create/session-1' };

function journey(overrides: Partial<ProofJourney> = {}): ProofJourney {
  return {
    sessionId: 'session-1',
    events: [],
    attempts: [],
    verdict: {
      firstReadAt: null, readCount: 0, latestRecommendations: [], attemptCount: 0,
      reachedGradedProof: false, stalledAt: null,
    },
    ...overrides,
  };
}

describe('Proof journey diagnostics', () => {
  it('leads with the verdict before any raw event', () => {
    const report = buildProofJourneyDiagnosticsReport(journey({
      verdict: {
        firstReadAt: '2026-08-01T00:00:00.000Z', readCount: 1, latestRecommendations: [], attemptCount: 0,
        reachedGradedProof: false, stalledAt: 'not_chosen',
      },
    }), CONTEXT);

    expect(report).toContain('# Proof journey diagnostics — session session-1');
    const verdictIndex = report.indexOf('-- Verdict --');
    const eventsIndex = report.indexOf('-- Raw events');
    expect(verdictIndex).toBeGreaterThan(-1);
    expect(eventsIndex).toBeGreaterThan(verdictIndex);
    expect(report).toContain('reachedGradedProof: no');
    expect(report).toContain('Stalled: a proof form has not been chosen yet');
  });

  // The regression this report exists to catch: a founder chose a proof form
  // other than the one the recommender actually ranked first, and that
  // divergence must be visible without cross-referencing two payloads.
  it('flags a chosen target that diverged from the top recommendation', () => {
    const report = buildProofJourneyDiagnosticsReport(journey({
      verdict: {
        firstReadAt: '2026-08-01T00:00:00.000Z', readCount: 1,
        latestRecommendations: [{ key: 'smoke-test', score: 0.9, recommended: true }, { key: 'poc', score: 0.4, recommended: false }],
        attemptCount: 1, reachedGradedProof: false, stalledAt: 'building',
      },
      attempts: [{
        realizationId: 'real-1', targetKey: 'poc', chosenAt: '2026-08-01T00:05:00.000Z',
        topRecommendation: { key: 'smoke-test', score: 0.9, recommended: true },
        chosenWasTopRecommended: false,
        build: { startedAt: '2026-08-01T00:06:00.000Z', succeededAt: null, failedAt: null, reachable: null },
        grade: { startedAt: null, result: null, resultAt: null },
      }],
    }), CONTEXT);

    expect(report).toContain('★ smoke-test — score 0.9');
    expect(report).toContain('real-1 · target=poc — DIVERGED from top recommendation "smoke-test" (score 0.9)');
    expect(report).toContain('Stalled: the chosen proof is still building');
  });

  it('does not report a graded attempt as stalled, met or missed', () => {
    const graded = journey({
      verdict: {
        firstReadAt: '2026-08-01T00:00:00.000Z', readCount: 1, latestRecommendations: [], attemptCount: 1,
        reachedGradedProof: true, stalledAt: null,
      },
      attempts: [{
        realizationId: 'real-1', targetKey: 'poc', chosenAt: '2026-08-01T00:05:00.000Z',
        topRecommendation: null, chosenWasTopRecommended: null,
        build: { startedAt: '2026-08-01T00:06:00.000Z', succeededAt: '2026-08-01T00:07:00.000Z', failedAt: null, reachable: true },
        grade: { startedAt: '2026-08-01T00:07:00.000Z', result: 'missed', resultAt: '2026-08-01T01:00:00.000Z' },
      }],
    });
    const report = buildProofJourneyDiagnosticsReport(graded, CONTEXT);
    expect(report).toContain('reachedGradedProof: yes');
    expect(report).toContain('Not stalled — the most recent attempt was graded.');
    expect(report).toContain('gradeResult: missed');
  });

  it('bounds a long raw-event list with a head+tail window and announces the elision', () => {
    const events = Array.from({ length: 60 }, (_, i) => ({
      correlationId: `build:real-${i}`,
      action: 'proof.build' as const,
      phase: 'started' as const,
      metricKey: null, metricValue: null, unit: null, artifactId: null, durationMs: null,
      metadata: {},
      occurredAt: `2026-08-01T00:${String(i).padStart(2, '0')}:00.000Z`,
    }));
    const report = buildProofJourneyDiagnosticsReport(journey({ events }), CONTEXT);
    expect(report).toContain('-- Raw events (60) --');
    expect(report).toMatch(/… \d+ earlier events elided …/);
  });
});
