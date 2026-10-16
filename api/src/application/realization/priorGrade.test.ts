/**
 * "Read again with what we learned" (PRD 33 §5.3.3): PRIOR_GRADE_RULES steer the
 * recommender from the last proof's grade and evidence.
 */
import { describe, expect, it } from 'vitest';
import type { ChallengeSpec } from '../challenge/parseBrief';
import { priorGradeContext, priorGradeFromRow, priorGradeRule, PRIOR_GRADE_RULES, type PriorGrade } from './priorGrade';
import { recommendRealizations } from './targets';

const spec = {
  title: 'Acme Concierge',
  sponsor: null,
  goal: 'Answer customer questions about orders.',
  capabilities: ['analytics', 'email'],
  integrations: [],
  deliverables: [],
  constraints: [],
  successCriteria: [],
} as ChallengeSpec;

function grade(over: Partial<PriorGrade> = {}): PriorGrade {
  return {
    realizationId: 'real-1',
    targetKey: 'smoke-test',
    verdict: 'missed',
    held: null,
    sampleReached: true,
    value: 12,
    target: 25,
    sampleN: 640,
    firstPattern: 'Visitors left when the price appeared',
    ...over,
  };
}

const top = (g: PriorGrade | null) => recommendRealizations(spec, g).find((r) => r.recommended)!;

describe('PRIOR_GRADE_RULES', () => {
  it('is data, one rule per lesson', () => {
    expect(PRIOR_GRADE_RULES.map((r) => r.id)).toEqual(['met', 'sample_not_reached', 'missed_with_sample']);
  });

  it('sample never reached → the same form again, and fix the traffic', () => {
    const steered = top(grade({ verdict: 'missed', sampleReached: false }));
    expect(steered.key).toBe('smoke-test');
    expect(steered.reasons[0]).toMatch(/fix the traffic/);
    expect(top(grade({ verdict: null, held: 'sample_not_reached', sampleReached: false })).key).toBe('smoke-test');
  });

  it('missed with a full sample → a lower-effort form testing the first cited pattern', () => {
    // smoke-test is effort 2; demo-video (effort 1) is the closest cheaper form.
    const steered = top(grade());
    expect(steered.key).toBe('demo-video');
    expect(steered.reasons[0]).toContain('Visitors left when the price appeared');
  });

  it('met → the next proof up in fidelity', () => {
    const steered = top(grade({ verdict: 'met', value: 31 }));
    expect(steered.key).toBe('wizard-of-oz');
    expect(steered.reasons[0]).toMatch(/next proof up/);
  });

  it('an abandoned or ungraded proof steers nothing', () => {
    expect(priorGradeRule(grade({ verdict: 'abandoned', sampleReached: null }))).toBeNull();
    expect(top(grade({ verdict: 'abandoned', sampleReached: null })).key).toBe(top(null).key);
  });

  it('still returns every target with exactly one recommended', () => {
    const ranked = recommendRealizations(spec, grade());
    expect(ranked).toHaveLength(8);
    expect(ranked.filter((r) => r.recommended)).toHaveLength(1);
    expect(ranked[0]!.recommended).toBe(true);
  });
});

describe('priorGradeFromRow', () => {
  it('reads a measured grade, its sample and its first cited pattern', () => {
    const g = priorGradeFromRow({
      id: 'real-1',
      targetKey: 'smoke-test',
      verdict: 'missed',
      verdictMetric: { measured: true, metricValue: 12, target: 25, sample: 640, sampleMin: 500, evidence: { patterns: [{ text: 'Left at price', examples: [] }] } },
    });
    expect(g).toMatchObject({ verdict: 'missed', sampleReached: true, value: 12, target: 25, firstPattern: 'Left at price' });
  });

  it('reads a held call as sample not reached', () => {
    const g = priorGradeFromRow({ id: 'real-1', targetKey: 'smoke-test', verdict: null, verdictMetric: { held: 'sample_not_reached' } });
    expect(g).toMatchObject({ held: 'sample_not_reached', sampleReached: false });
    expect(priorGradeRule(g)?.id).toBe('sample_not_reached');
  });

  it('gives the Read step the lesson in words', () => {
    expect(priorGradeContext(grade())).toContain('Measured 12 against a target of 25 on 640 visits');
  });
});
