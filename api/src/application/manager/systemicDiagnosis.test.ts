import { describe, it, expect } from 'vitest';
import {
  selectSystemicCohorts, heuristicFinding, buildFindingDirective,
  SYSTEMIC_COHORT_MIN, type SystemicFinding,
} from './systemicDiagnosis';
import type { StallCensus, CensusCohort } from './stallCensus';

const cohort = (over: Partial<CensusCohort>): CensusCohort => ({
  cause: 'unassigned', count: 50, sampleTaskIds: [1, 2, 3], maxIdleMs: 5 * 86_400_000, ...over,
});

const census = (cohorts: CensusCohort[]): StallCensus => ({
  projectId: 11, managed: 767, stalled: 755, moving: 12,
  cohorts, deepDiagnosed: 44, computedAt: new Date(0).toISOString(),
});

describe('selectSystemicCohorts', () => {
  it('keeps only cohorts at or above the materiality threshold', () => {
    const c = census([
      cohort({ cause: 'unassigned', count: SYSTEMIC_COHORT_MIN }),
      cohort({ cause: 'failure_breaker', count: SYSTEMIC_COHORT_MIN - 1 }),
    ]);
    expect(selectSystemicCohorts(c).map((x) => x.cause)).toEqual(['unassigned']);
  });

  it('ranks by cohort size so the biggest defect is diagnosed first', () => {
    const c = census([
      cohort({ cause: 'failure_breaker', count: 116 }),
      cohort({ cause: 'unassigned', count: 313 }),
      cohort({ cause: 'awaiting_signoff', count: 149 }),
    ]);
    expect(selectSystemicCohorts(c).map((x) => x.count)).toEqual([313, 149, 116]);
  });

  it('never raises a finding for a DELIBERATE state', () => {
    // A large `blocked` or `merge_withheld` cohort is a human decision (a dependency, a
    // withheld merge authority). Filing a defect ticket against a policy someone set on
    // purpose is noise, and would be filed forever since the "defect" is intended.
    const c = census([
      cohort({ cause: 'blocked', count: 400 }),
      cohort({ cause: 'merge_withheld', count: 400 }),
      cohort({ cause: 'moving', count: 400 }),
      cohort({ cause: 'live', count: 400 }),
    ]);
    expect(selectSystemicCohorts(c)).toEqual([]);
  });
});

describe('heuristicFinding', () => {
  it('produces an actionable finding from measured facts alone', () => {
    const f = heuristicFinding(cohort({ count: 313, cause: 'unassigned' }), 11);
    expect(f.source).toBe('heuristic');
    expect(f.ticketCount).toBe(313);
    expect(f.summary).toContain('313');
    expect(f.summary).toContain('unassigned');
    // The load-bearing claim: this is ONE defect, not 313 ticket problems.
    expect(f.summary).toMatch(/not independent ticket problems/i);
    expect(f.remediation).toContain('1, 2, 3');
  });

  it('describes what the cause MEANS, not just its enum name', () => {
    const f = heuristicFinding(cohort({ cause: 'awaiting_signoff', count: 149 }), 11);
    expect(f.summary).toMatch(/sign-off/i);
  });
});

describe('buildFindingDirective', () => {
  const f: SystemicFinding = {
    cause: 'unassigned', ticketCount: 313, summary: 'No lane on any board has staffing.',
    remediation: 'Staff each lane with a role-capable agent.', source: 'ai', sampleTaskIds: [7, 8],
  };

  it('states the cohort, the root cause, the remediation and the evidence', () => {
    const d = buildFindingDirective(f, 11);
    expect(d).toContain('313 tickets stalled on "unassigned"');
    expect(d).toContain('No lane on any board has staffing.');
    expect(d).toContain('Staff each lane with a role-capable agent.');
    expect(d).toContain('Sample stalled tickets: 7, 8');
  });

  it('records whether a model or the fallback produced it', () => {
    expect(buildFindingDirective(f, 11)).toContain('Diagnosis source: model');
    expect(buildFindingDirective({ ...f, source: 'heuristic' }, 11))
      .toContain('Diagnosis source: deterministic fallback');
  });

  it('tells the reader how to verify the fix', () => {
    expect(buildFindingDirective(f, 11)).toMatch(/census.*collapse/is);
  });
});
