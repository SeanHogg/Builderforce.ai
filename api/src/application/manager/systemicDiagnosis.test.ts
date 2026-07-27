import { describe, it, expect } from 'vitest';
import {
  selectSystemicCohorts, heuristicFinding, buildFindingDirective, raiseSystemicFindings,
  SYSTEMIC_COHORT_MIN, MAX_FINDINGS_PER_PASS, SYSTEMIC_DIAGNOSIS_PROMPT,
  proposesWeakeningSafetyLimit, type SystemicFinding,
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

/**
 * The IO path had NO coverage — only its three pure helpers did. So the bounds that stop
 * an automated ticket-filer from spamming a board (refresh-not-refile, the per-pass
 * ceiling, resolve-on-shrink) were asserted nowhere, on the one subsystem where an
 * unbounded writer creates BOARD ROWS rather than log lines.
 */
describe('raiseSystemicFindings — the bounds that stop an automated ticket-filer', () => {
  type Op = { kind: 'select' | 'update' | 'insert'; values?: Record<string, unknown> };

  /** Records what the pass wrote; `open` seeds the existing open findings. */
  function stubDb(open: Array<{ id: string; cause: string }>) {
    const ops: Op[] = [];
    const chain = (result: unknown): Record<string, unknown> => {
      const self: Record<string, unknown> = {};
      for (const m of ['from', 'where', 'set', 'values', 'onConflictDoUpdate', 'returning', 'limit']) {
        self[m] = (arg?: unknown) => {
          if (m === 'values' && arg && typeof arg === 'object') {
            ops[ops.length - 1]!.values = arg as Record<string, unknown>;
          }
          return self;
        };
      }
      self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      self.catch = () => self;
      return self;
    };
    const db = {
      select: () => { ops.push({ kind: 'select' }); return chain(open); },
      update: () => { ops.push({ kind: 'update' }); return chain([]); },
      insert: () => { ops.push({ kind: 'insert' }); return chain([]); },
    } as unknown as Parameters<typeof raiseSystemicFindings>[1];
    return { db, ops };
  }

  const env = {} as Parameters<typeof raiseSystemicFindings>[0];
  const runtime = {} as Parameters<typeof raiseSystemicFindings>[2];

  const run = async (
    cohorts: CensusCohort[],
    open: Array<{ id: string; cause: string }> = [],
  ) => {
    const { db, ops } = stubDb(open);
    const created: string[] = [];
    const out = await raiseSystemicFindings(env, db, runtime, {
      tenantId: 1, projectId: 11, census: census(cohorts),
      createTicket: async (_directive, title) => { created.push(title); return 900 + created.length; },
    });
    return { out, ops, created };
  };

  it('files ONE ticket per newly-observed cohort', async () => {
    const { out, created } = await run([cohort({ cause: 'unassigned', count: 300 })]);
    expect(created).toHaveLength(1);
    expect(created[0]).toContain('300 tickets stalled on "unassigned"');
    expect(out.ticketsCreated).toBe(1);
  });

  // The idempotent steady state. Without it the manager files the same platform ticket
  // every five minutes, forever — strictly worse than not filing at all.
  it('REFRESHES an already-open finding instead of filing a second ticket', async () => {
    const { out, created, ops } = await run(
      [cohort({ cause: 'unassigned', count: 320 })],
      [{ id: 'f1', cause: 'unassigned' }],
    );
    expect(created).toEqual([]);
    expect(out.ticketsCreated).toBe(0);
    expect(ops.some((o) => o.kind === 'update')).toBe(true);
    expect(ops.some((o) => o.kind === 'insert')).toBe(false);
  });

  it('never exceeds the per-pass ceiling, taking the LARGEST cohorts first', async () => {
    const { created } = await run([
      cohort({ cause: 'unassigned', count: 300 }),
      cohort({ cause: 'awaiting_signoff', count: 180 }),
      cohort({ cause: 'failure_breaker', count: 120 }),
    ]);
    expect(created).toHaveLength(MAX_FINDINGS_PER_PASS);
    expect(created[0]).toContain('unassigned');
    expect(created[1]).toContain('awaiting_signoff');
  });

  it('RESOLVES a finding whose cohort fell below the threshold, so a recurrence files fresh prose', async () => {
    const { out } = await run(
      [cohort({ cause: 'unassigned', count: 300 })],
      [{ id: 'f1', cause: 'unassigned' }, { id: 'f2', cause: 'failure_breaker' }],
    );
    expect(out.resolved).toBe(1);
  });
});

describe('the systemic diagnosis prompt', () => {
  // MEASURED: the model's remediation for the failure-breaker cohort was "increase the
  // retry limit to 10 or 15, then re-dispatch" — i.e. remove the guard that stops a retry
  // storm — and that text is filed as a ticket an agent may pick up and act on.
  it('forbids proposing that a safety limit be relaxed', () => {
    expect(SYSTEMIC_DIAGNOSIS_PROMPT).toContain('NEVER propose raising, relaxing or disabling a safety limit');
  });

  it('explains WHY, so the constraint survives a prompt edit', () => {
    expect(SYSTEMIC_DIAGNOSIS_PROMPT).toContain('evidence of the underlying failure');
  });
});

/**
 * A PROMPT IS A REQUEST, NOT AN INVARIANT — and the prompt shipped a pass too late.
 *
 * Measured on project 11 the day after the prompt guard shipped: the failure-breaker
 * finding was STILL advising "increase the retry limit from its current value to a higher
 * threshold, such as 10 or 15, and then manually re-dispatch the stalled tickets". The
 * refresh branch only ever updates the count, so a finding diagnosed before the guard kept
 * its prose for as long as its cohort survived — indefinitely, for a cohort of 116.
 */
describe('proposesWeakeningSafetyLimit', () => {
  it('catches the exact remediation production filed', () => {
    expect(proposesWeakeningSafetyLimit(
      'Adjust the "failure_breaker" configuration to increase the maximum number of consecutive '
      + 'failures allowed before dispatching is halted. Specifically, increase the retry limit from '
      + 'its current value to a higher threshold, such as 10 or 15, and then manually re-dispatch.',
    )).toBe(true);
  });

  it.each([
    'Disable the failure breaker for these tickets and re-run them.',
    'Relax the retry cap so the cohort can drain.',
    'Remove the approval gate blocking these stages.',
    'Raise the rate limit on the dispatcher.',
  ])('catches %s', (text) => {
    expect(proposesWeakeningSafetyLimit(text)).toBe(true);
  });

  // A guard that fires on every remediation is a guard nobody can ship a diagnosis past.
  // Both halves are required precisely so these stay clean.
  it.each([
    'Investigate why the runs fail before the breaker trips; fix the underlying build error.',
    'Increase test coverage on the affected module.',
    'The breaker is firing because the repo has no default branch configured — set one.',
    'Staff the review lane with a role-capable agent so the sign-off can be recorded.',
  ])('does NOT catch %s', (text) => {
    expect(proposesWeakeningSafetyLimit(text)).toBe(false);
  });

  // The deterministic fallback is what a rejected diagnosis becomes, so it must itself
  // never trip the check — otherwise a rejection loops.
  it('never fires on the heuristic finding it falls back to', () => {
    for (const cause of ['failure_breaker', 'managed_no_role', 'awaiting_signoff', 'human_gate']) {
      const f = heuristicFinding(cohort({ cause: cause as CensusCohort['cause'] }), 11);
      expect(proposesWeakeningSafetyLimit(f.remediation), cause).toBe(false);
    }
  });
});
