import { describe, expect, it } from 'vitest';
import { shapeProofJourney, type ProofJourneyEvent } from './proofJourney';

let seq = 0;
/** A minimal proof-lifecycle event. `seq` fakes strictly increasing timestamps
 *  so ordering-sensitive logic (which read preceded which choice) is exercised
 *  without a clock. */
function event(partial: Partial<ProofJourneyEvent> & Pick<ProofJourneyEvent, 'action' | 'phase' | 'correlationId'>): ProofJourneyEvent {
  seq += 1;
  return {
    metricKey: null,
    metricValue: null,
    unit: null,
    artifactId: null,
    durationMs: null,
    metadata: {},
    occurredAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
    ...partial,
  };
}

describe('shapeProofJourney', () => {
  it('is empty before any idea has been read', () => {
    seq = 0;
    const journey = shapeProofJourney('session-1', []);
    expect(journey.attempts).toEqual([]);
    expect(journey.verdict).toMatchObject({ readCount: 0, attemptCount: 0, reachedGradedProof: false, stalledAt: null });
  });

  it('reports a read with nothing chosen as not_chosen', () => {
    seq = 0;
    const read = event({
      action: 'idea.read', phase: 'succeeded', correlationId: 'read:r1',
      metadata: { recommendations: [{ key: 'smoke-test', score: 0.9, recommended: true }] },
    });
    const journey = shapeProofJourney('session-1', [read]);
    expect(journey.verdict).toMatchObject({ readCount: 1, attemptCount: 0, stalledAt: 'not_chosen' });
    expect(journey.verdict.latestRecommendations).toEqual([{ key: 'smoke-test', score: 0.9, recommended: true }]);
  });

  it('flags when the chosen target was NOT the recommender\'s top pick', () => {
    seq = 0;
    const events = [
      event({
        action: 'idea.read', phase: 'succeeded', correlationId: 'read:r1',
        metadata: { recommendations: [{ key: 'smoke-test', score: 0.9, recommended: true }, { key: 'poc', score: 0.4, recommended: false }] },
      }),
      event({ action: 'proof.choose', phase: 'started', correlationId: 'choose:real-1' }),
      event({ action: 'proof.choose', phase: 'succeeded', correlationId: 'choose:real-1', metadata: { targetKey: 'poc' } }),
    ];
    const journey = shapeProofJourney('session-1', events);
    expect(journey.attempts).toHaveLength(1);
    expect(journey.attempts[0]).toMatchObject({
      realizationId: 'real-1', targetKey: 'poc',
      topRecommendation: { key: 'smoke-test', score: 0.9, recommended: true },
      chosenWasTopRecommended: false,
    });
    expect(journey.verdict.stalledAt).toBe('not_chosen');
  });

  it('walks a full loop through to a graded MET verdict', () => {
    seq = 0;
    const events = [
      event({
        action: 'idea.read', phase: 'succeeded', correlationId: 'read:r1',
        metadata: { recommendations: [{ key: 'smoke-test', score: 0.9, recommended: true }] },
      }),
      event({ action: 'proof.choose', phase: 'succeeded', correlationId: 'choose:real-1', metadata: { targetKey: 'smoke-test' } }),
      event({ action: 'proof.build', phase: 'started', correlationId: 'build:real-1' }),
      event({ action: 'proof.build', phase: 'succeeded', correlationId: 'build:real-1', metadata: { reachable: true } }),
      event({ action: 'proof.grade', phase: 'started', correlationId: 'grade:real-1' }),
      event({ action: 'proof.grade', phase: 'validated', correlationId: 'grade:real-1', metricValue: 1 }),
    ];
    const journey = shapeProofJourney('session-1', events);
    expect(journey.attempts[0]).toMatchObject({
      chosenWasTopRecommended: true,
      build: { reachable: true },
      grade: { result: 'met' },
    });
    expect(journey.verdict).toMatchObject({ reachedGradedProof: true, stalledAt: null });
  });

  it('a MISSED kill condition still counts as graded, not stalled', () => {
    seq = 0;
    const events = [
      event({ action: 'idea.read', phase: 'succeeded', correlationId: 'read:r1', metadata: { recommendations: [] } }),
      event({ action: 'proof.choose', phase: 'succeeded', correlationId: 'choose:real-1', metadata: { targetKey: 'poc' } }),
      event({ action: 'proof.build', phase: 'succeeded', correlationId: 'build:real-1', metadata: { reachable: true } }),
      event({ action: 'proof.grade', phase: 'validated', correlationId: 'grade:real-1', metricValue: 0 }),
    ];
    const journey = shapeProofJourney('session-1', events);
    expect(journey.attempts[0]!.grade.result).toBe('missed');
    expect(journey.verdict).toMatchObject({ reachedGradedProof: true, stalledAt: null });
  });

  it('an abandoned proof is stalled at abandoned and never counts as graded', () => {
    seq = 0;
    const events = [
      event({ action: 'idea.read', phase: 'succeeded', correlationId: 'read:r1', metadata: { recommendations: [] } }),
      event({ action: 'proof.choose', phase: 'succeeded', correlationId: 'choose:real-1', metadata: { targetKey: 'poc' } }),
      event({ action: 'proof.build', phase: 'succeeded', correlationId: 'build:real-1', metadata: { reachable: true } }),
      event({ action: 'proof.grade', phase: 'started', correlationId: 'grade:real-1' }),
      event({ action: 'proof.grade', phase: 'failed', correlationId: 'grade:real-1', metadata: { verdict: 'abandoned' } }),
    ];
    const journey = shapeProofJourney('session-1', events);
    expect(journey.attempts[0]!.grade.result).toBe('abandoned');
    expect(journey.verdict).toMatchObject({ reachedGradedProof: false, stalledAt: 'abandoned' });
  });

  it('a build that never went reachable stalls at not_reachable, not awaiting_grade', () => {
    seq = 0;
    const events = [
      event({ action: 'idea.read', phase: 'succeeded', correlationId: 'read:r1', metadata: { recommendations: [] } }),
      event({ action: 'proof.choose', phase: 'succeeded', correlationId: 'choose:real-1', metadata: { targetKey: 'poc' } }),
      event({ action: 'proof.build', phase: 'succeeded', correlationId: 'build:real-1', metadata: { reachable: false } }),
    ];
    const journey = shapeProofJourney('session-1', events);
    expect(journey.verdict.stalledAt).toBe('not_reachable');
  });
});
