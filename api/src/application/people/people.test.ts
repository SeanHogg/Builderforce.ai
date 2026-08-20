import { describe, expect, it } from 'vitest';
import {
  assessTeamHealth,
  hrmsRefusal,
  levelFromTitle,
  matchBand,
  normaliseCompensation,
  normaliseEmployment,
  normaliseRequisitions,
  normaliseRoster,
  normaliseStatus,
  planHeadcount,
  planRosterReconciliation,
  reviewCycleState,
  reviewOrg,
  syncedPartyRef,
  type CompensationBand,
  type LocalEmployee,
  type Requisition,
  type RosterPerson,
} from './index';

/**
 * The property every test here defends is the one the whole domain was built
 * around: these five tools go to a board meeting. A number that is wrong is worse
 * than a number that is absent, because absence is visible and a fabricated
 * salary on a slide is not.
 *
 * So the assertions cluster on the REFUSALS and the honest-null paths as much as
 * on the arithmetic — an empty roster must not compute a clean org, a missing
 * band must not become a plausible market rate, and an absent employee must not
 * become a termination date.
 */

const NOW = new Date('2026-08-20T00:00:00.000Z');

const person = (over: Partial<RosterPerson> & { externalId: string }): RosterPerson => ({
  name: `Person ${over.externalId}`,
  email: null,
  title: null,
  department: null,
  managerExternalId: null,
  location: null,
  employment: 'full_time',
  status: 'active',
  startedAt: '2020-01-01',
  endedAt: null,
  ...over,
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe('reading a provider roster', () => {
  it('reads four vendors\' spellings into one employee', () => {
    // BambooHR (bare array, flat fields), Personio ({ data: [{ attributes:
    // { field: { value } } }] }), HiBob (nested `work`), SCIM ({ Resources }).
    const bamboo = normaliseRoster([
      { id: 42, firstName: 'Ada', lastName: 'Lovelace', jobTitle: 'Engineer', department: 'R&D', supervisorId: 7, hireDate: '2019-03-04' },
    ]);
    expect(bamboo).toHaveLength(1);
    expect(bamboo[0]).toMatchObject({
      externalId: '42', name: 'Ada Lovelace', title: 'Engineer', department: 'R&D',
      managerExternalId: '7', startedAt: '2019-03-04', status: 'active',
    });

    const personio = normaliseRoster({
      data: [{ attributes: { id: { value: 99 }, first_name: { value: 'Grace' }, last_name: { value: 'Hopper' }, department: { value: 'Navy' }, hire_date: { value: '1944-07-01T00:00:00+02:00' } } }],
    });
    expect(personio[0]).toMatchObject({ externalId: '99', name: 'Grace Hopper', department: 'Navy', startedAt: '1944-07-01' });

    const hibob = normaliseRoster({ employees: [{ id: 'bob-1', fullName: 'Alan Turing', work: { title: 'Cryptanalyst', department: 'Hut 8' } }] });
    expect(hibob[0]).toMatchObject({ externalId: 'bob-1', name: 'Alan Turing', title: 'Cryptanalyst', department: 'Hut 8' });

    const scim = normaliseRoster({ Resources: [{ userName: 'katherine@nasa.gov', name: { givenName: 'Katherine', familyName: 'Johnson' }, active: true }] });
    expect(scim[0]).toMatchObject({ externalId: 'katherine@nasa.gov', name: 'Katherine Johnson', status: 'active' });
  });

  it('drops a row with no provider id rather than inventing one', () => {
    // A synthetic key makes every sync create a duplicate person, which is the
    // one defect here a customer sees in their own org chart.
    expect(normaliseRoster([{ firstName: 'Nobody', lastName: 'Atall' }])).toEqual([]);
  });

  it('lets a past end date outrank a status the provider forgot to flip', () => {
    const rows = normaliseRoster([{ id: '1', status: 'Active', terminationDate: '2024-01-01' }]);
    expect(rows[0]!.status).toBe('terminated');
  });

  it('maps every vendor\'s vocabulary onto the four states and four types', () => {
    expect(normaliseStatus('Terminated', null)).toBe('terminated');
    expect(normaliseStatus('On Parental Leave', null)).toBe('on_leave');
    expect(normaliseStatus('Serving notice', null)).toBe('notice');
    expect(normaliseStatus('false', null)).toBe('terminated');
    expect(normaliseStatus(null, null)).toBe('active');
    expect(normaliseEmployment('Contingent Worker')).toBe('contract');
    expect(normaliseEmployment('Part-Time')).toBe('part_time');
    expect(normaliseEmployment('Summer Intern')).toBe('intern');
    expect(normaliseEmployment(null)).toBe('full_time');
  });
});

describe('reading compensation', () => {
  it('annualises an hourly rate and says so, rather than reporting it as a salary', () => {
    const rows = normaliseCompensation([{ id: 'a', rate: 50, payment_unit: 'Hour', currency: 'USD' }]);
    // 50 × 2080 hours × 100 minor units.
    expect(rows[0]!.annualBaseCents).toBe(50 * 2080 * 100);
  });

  it('reads Gusto\'s nested jobs[].compensations[]', () => {
    const rows = normaliseCompensation({
      employees: [{ id: 'g1', jobs: [{ compensations: [{ rate: '9000', payment_unit: 'Month' }] }] }],
    });
    expect(rows[0]!.annualBaseCents).toBe(9000 * 12 * 100);
  });

  it('reports unreadable pay as null instead of zero', () => {
    // "We could not read 12 people's pay" and "12 people are paid nothing" are
    // different sentences and only the second one is a lie.
    const rows = normaliseCompensation([{ id: 'x', currency: 'GBP' }]);
    expect(rows[0]!.annualBaseCents).toBeNull();
  });
});

describe('reading requisitions', () => {
  it('reads Lever and Ashby postings and keeps their provenance', () => {
    const lever = normaliseRequisitions({ data: [{ id: 'lv1', text: 'Staff Engineer', categories: { department: 'Platform', location: 'Remote' }, state: 'published' }] }, 'lever-postings');
    expect(lever[0]).toMatchObject({ externalId: 'lv1', title: 'Staff Engineer', department: 'Platform', status: 'published', source: 'lever-postings' });
    const ashby = normaliseRequisitions({ results: [{ id: 'ab1', title: 'Designer' }] }, 'ashby-postings');
    expect(ashby[0]!.source).toBe('ashby-postings');
  });
});

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

describe('the refusal', () => {
  it('names what to connect and forbids an estimate, in three distinguishable flavours', () => {
    const none = hrmsRefusal({ reason: 'no_roster_source' });
    expect(none.ok).toBe(false);
    expect(none.connect).toContain('Workday');
    expect(none.connect).toContain('Gusto');
    expect(none.instruction).toMatch(/Do NOT estimate/);

    const failed = hrmsRefusal({ reason: 'provider_error', connectedSources: ['bamboohr'], providerError: '401 Unauthorized' });
    expect(failed.providerError).toBe('401 Unauthorized');
    expect(failed.message).toContain('bamboohr');
    expect(failed.instruction).toMatch(/expired token|missing scope/);

    const empty = hrmsRefusal({ reason: 'empty_roster', connectedSources: ['hibob'] });
    // The three need three different next actions: an admin task, a credential,
    // and a permissions problem that looks exactly like an empty company.
    expect(empty.message).toMatch(/integration user/);
    expect(new Set([none.message, failed.message, empty.message]).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// hr.org_review
// ---------------------------------------------------------------------------

describe('hr.org_review', () => {
  const org: RosterPerson[] = [
    person({ externalId: 'ceo', name: 'Root', title: 'CEO', department: 'Exec' }),
    person({ externalId: 'vp', name: 'VP', managerExternalId: 'ceo', department: 'Eng' }),
    person({ externalId: 'em', name: 'EM', managerExternalId: 'vp', department: 'Eng' }),
    ...Array.from({ length: 12 }, (_, i) => person({ externalId: `ic${i}`, name: `IC ${i}`, managerExternalId: 'em', department: 'Eng' })),
  ];

  it('measures spans and layers over the reporting graph', () => {
    const review = reviewOrg(org);
    expect(review.headcount).toBe(15);
    expect(review.managers).toBe(3);
    expect(review.maxDepth).toBe(3);
    const em = review.spans.find((s) => s.externalId === 'em')!;
    expect(em.directReports).toBe(12);
    expect(em.totalReports).toBe(12);
    expect(review.spans.find((s) => s.externalId === 'ceo')!.totalReports).toBe(14);
  });

  it('flags a wide span and a single-report manager, quoting the people', () => {
    const review = reviewOrg(org);
    const wide = review.findings.find((f) => f.code === 'wide_span')!;
    expect(wide.count).toBe(1);
    expect(wide.evidence[0]).toContain('EM');
    const narrow = review.findings.find((f) => f.code === 'single_report_manager')!;
    // Both the VP and the CEO carry exactly one report.
    expect(narrow.count).toBe(2);
  });

  it('reports an unresolvable manager instead of silently dropping the edge', () => {
    // The most common real defect in an org export, and the one that makes every
    // span quietly wrong when it is swallowed.
    const review = reviewOrg([...org, person({ externalId: 'ghost', name: 'Ghost', managerExternalId: 'nobody' })]);
    const finding = review.findings.find((f) => f.code === 'unresolved_manager')!;
    expect(finding.severity).toBe('high');
    expect(finding.evidence[0]).toContain('nobody');
  });

  it('terminates rather than hangs on a reporting cycle', () => {
    const cycle = [
      person({ externalId: 'a', name: 'A', managerExternalId: 'b' }),
      person({ externalId: 'b', name: 'B', managerExternalId: 'a' }),
    ];
    const review = reviewOrg(cycle);
    expect(review.findings.find((f) => f.code === 'reporting_cycle')!.count).toBe(2);
  });

  it('excludes leavers from the structure and says how many it dropped', () => {
    const review = reviewOrg([...org, person({ externalId: 'gone', status: 'terminated', endedAt: '2025-01-01' })]);
    expect(review.headcount).toBe(15);
    expect(review.assumptions.some((a) => a.includes('1 of 16'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hr.headcount_plan
// ---------------------------------------------------------------------------

describe('hr.headcount_plan', () => {
  const bands: CompensationBand[] = [
    { roleFamily: 'engineer', level: 'senior', location: null, currency: 'USD', baseMinCents: 14_000_000, baseMidCents: 16_000_000, baseMaxCents: 18_000_000, bonusPercent: 10 },
    { roleFamily: 'engineer', level: 'staff', location: null, currency: 'USD', baseMinCents: 18_000_000, baseMidCents: 20_000_000, baseMaxCents: 22_000_000, bonusPercent: 10 },
  ];
  const reqs: Requisition[] = [
    { externalId: 'r1', title: 'Senior Engineer', department: 'Eng', location: null, status: 'open', openedAt: '2026-06-21', source: 'lever-postings' },
    { externalId: 'r2', title: 'Office Manager', department: 'Ops', location: null, status: 'open', openedAt: null, source: 'lever-postings' },
    { externalId: 'r3', title: 'Closed Role', department: 'Eng', location: null, status: 'closed', openedAt: null, source: 'lever-postings' },
  ];
  const people = [
    person({ externalId: 'e1', department: 'Eng' }),
    person({ externalId: 'e2', department: 'Eng' }),
  ];

  it('prices a role from the matching band, loaded, and shows the basis', () => {
    const plan = planHeadcount({ people, requisitions: reqs, bands, now: NOW });
    const row = plan.roles.find((r) => r.externalId === 'r1')!;
    expect(row.basis).toBe('band');
    expect(row.baseCents).toBe(16_000_000);
    // 160,000 × 1.10 bonus × 1.25 employer load.
    expect(row.loadedAnnualCents).toBe(Math.round(16_000_000 * 1.1 * 1.25));
    expect(row.daysOpen).toBe(60);
  });

  it('leaves a role nothing can price UNCOSTED and reports the coverage', () => {
    // The central refusal of this file: a plausible market number for the office
    // manager would be indistinguishable from a real one on the slide.
    const plan = planHeadcount({ people, requisitions: reqs, bands, now: NOW });
    const row = plan.roles.find((r) => r.externalId === 'r2')!;
    expect(row.basis).toBe('uncosted');
    expect(row.loadedAnnualCents).toBeNull();
    expect(plan.uncosted).toHaveLength(1);
    expect(plan.coverage).toBe(0.5);
    expect(plan.plannedAnnualCostCents).toBe(Math.round(16_000_000 * 1.1 * 1.25));
  });

  it('excludes a closed requisition and counts the plan against the roster', () => {
    const plan = planHeadcount({ people, requisitions: reqs, bands, now: NOW });
    expect(plan.openRequisitions).toBe(2);
    expect(plan.currentHeadcount).toBe(2);
    expect(plan.plannedHeadcount).toBe(4);
    expect(plan.byDepartment.find((d) => d.department === 'Eng')!.growth).toBe(0.5);
  });

  it('falls back to the department median only when there is one, and labels it', () => {
    const plan = planHeadcount({
      people: [person({ externalId: 'o1', department: 'Ops' })],
      requisitions: [reqs[1]!],
      bands: [],
      compensation: [{ externalId: 'o1', annualBaseCents: 7_000_000, currency: 'USD', effectiveAt: null }],
      now: NOW,
    });
    const row = plan.roles[0]!;
    expect(row.basis).toBe('department_median');
    expect(row.baseCents).toBe(7_000_000);
    expect(row.loadedAnnualCents).toBe(Math.round(7_000_000 * 1.25));
  });

  it('pro-rates the first year for time-to-fill', () => {
    const plan = planHeadcount({ people, requisitions: [reqs[0]!], bands, daysToFill: 73, now: NOW });
    expect(plan.firstYearCostCents).toBe(Math.round(plan.plannedAnnualCostCents * (365 - 73) / 365));
  });

  it('never converts a currency it has no rate for', () => {
    const euroBands: CompensationBand[] = [{ ...bands[0]!, currency: 'EUR' }];
    const plan = planHeadcount({ people, requisitions: [reqs[0]!], bands: euroBands, currency: 'USD', now: NOW });
    expect(plan.roles[0]!.basis).toBe('uncosted');
  });

  it('matches a band by family when the title names no level it has', () => {
    expect(levelFromTitle('Senior Engineer')).toBe('senior');
    expect(levelFromTitle('Engineer')).toBeNull();
    const matched = matchBand('Engineer', bands, 'USD')!;
    expect(matched.basis).toBe('band_family');
  });
});

// ---------------------------------------------------------------------------
// hr.performance_review
// ---------------------------------------------------------------------------

describe('hr.performance_review', () => {
  const people = [
    person({ externalId: 'm1', name: 'Manager' }),
    person({ externalId: 'p1', name: 'Done', managerExternalId: 'm1', department: 'Eng' }),
    person({ externalId: 'p2', name: 'Rated', managerExternalId: 'm1', department: 'Eng' }),
    person({ externalId: 'p3', name: 'Untouched', managerExternalId: 'm1', department: 'Eng' }),
    person({ externalId: 'p4', name: 'New Joiner', managerExternalId: 'm1', department: 'Eng', startedAt: '2026-08-01' }),
  ];
  const outcomes = [
    { employeeExternalId: 'p1', period: '2026', rating: 3, narrative: null, calibratedBy: 'hr', finalisedAt: '2026-07-01T00:00:00Z' },
    { employeeExternalId: 'p2', period: '2026', rating: 3, narrative: null, calibratedBy: null, finalisedAt: null },
    { employeeExternalId: 'p1', period: '2025', rating: 5, narrative: null, calibratedBy: null, finalisedAt: '2025-07-01T00:00:00Z' },
  ];

  it('counts coverage over the ELIGIBLE population and lists the ineligible with a reason', () => {
    const state = reviewCycleState({ people, outcomes, period: '2026', now: NOW });
    expect(state.headcount).toBe(5);
    expect(state.eligible).toBe(4);
    expect(state.ineligible).toBe(1);
    const newJoiner = state.rows.find((r) => r.externalId === 'p4')!;
    expect(newJoiner.eligible).toBe(false);
    expect(newJoiner.ineligibleReason).toMatch(/minimum tenure/);
    expect(state.finalised).toBe(1);
    expect(state.coverage).toBe(0.25);
  });

  it('separates rated-not-finalised from not-started', () => {
    const state = reviewCycleState({ people, outcomes, period: '2026', now: NOW });
    expect(state.rows.find((r) => r.externalId === 'p2')!.state).toBe('rated');
    expect(state.rows.find((r) => r.externalId === 'p3')!.state).toBe('not_started');
    expect(state.inFlight).toBe(1);
    expect(state.notStarted).toBe(2);
  });

  it('reads only the period asked for', () => {
    const state = reviewCycleState({ people, outcomes, period: '2026', now: NOW });
    expect(state.assumptions.some((a) => a.includes('1 row(s) belong to other periods'))).toBe(true);
    expect(state.rows.find((r) => r.externalId === 'p1')!.rating).toBe(3);
  });

  it('names the managers carrying the outstanding work', () => {
    const state = reviewCycleState({ people, outcomes, period: '2026', now: NOW });
    expect(state.managerLoad[0]).toMatchObject({ managerName: 'Manager', outstanding: 2, finalised: 1 });
  });

  it('reports a flat rating distribution as a shape, not a verdict', () => {
    const flat = Array.from({ length: 6 }, (_, i) => person({ externalId: `f${i}`, managerExternalId: 'm1' }));
    const flatOutcomes = flat.map((p) => ({
      employeeExternalId: p.externalId, period: '2026', rating: 3, narrative: null,
      calibratedBy: 'hr', finalisedAt: '2026-07-01T00:00:00Z',
    }));
    const state = reviewCycleState({ people: [person({ externalId: 'm1' }), ...flat], outcomes: flatOutcomes, period: '2026', now: NOW });
    const finding = state.findings.find((f) => f.code === 'flat_distribution')!;
    expect(finding.headline).toContain('100%');
  });

  it('refuses to be a review writer, in the instruction the model reads', () => {
    const state = reviewCycleState({ people, outcomes, period: '2026', now: NOW });
    expect(state.instruction).toMatch(/Do NOT write, draft or suggest review NARRATIVE/);
  });
});

// ---------------------------------------------------------------------------
// hr.team_health
// ---------------------------------------------------------------------------

describe('hr.team_health', () => {
  const iso = (monthsAgo: number) => new Date(NOW.getTime() - monthsAgo * 30.44 * 86_400_000).toISOString().slice(0, 10);

  it('measures attrition over the average headcount, not today\'s', () => {
    const people = [
      person({ externalId: 'a', department: 'Support', managerExternalId: 'mgr', startedAt: iso(40) }),
      person({ externalId: 'b', department: 'Support', managerExternalId: 'mgr', startedAt: iso(38) }),
      person({ externalId: 'mgr', department: 'Support', startedAt: iso(60) }),
      person({ externalId: 'c', department: 'Support', status: 'terminated', endedAt: iso(3) }),
      person({ externalId: 'd', department: 'Support', status: 'terminated', endedAt: iso(6) }),
    ];
    const report = assessTeamHealth({ people, now: NOW });
    const support = report.teams.find((t) => t.team === 'Support')!;
    expect(support.headcount).toBe(3);
    expect(support.leaversInWindow).toBe(2);
    // 2 leavers over (3 + 2/2) = 4 average headcount.
    expect(support.attritionRate).toBe(0.5);
    expect(report.findings.some((f) => f.code === 'high_attrition')).toBe(true);
  });

  it('ignores a departure older than the window', () => {
    const people = [
      person({ externalId: 'a', department: 'Ops', startedAt: iso(40) }),
      person({ externalId: 'old', department: 'Ops', status: 'terminated', endedAt: iso(30) }),
    ];
    expect(assessTeamHealth({ people, now: NOW }).teams[0]!.leaversInWindow).toBe(0);
  });

  it('reports compression as null without payroll, rather than as healthy', () => {
    // A low risk score that is really a missing signal is the exact failure this
    // whole domain is written against.
    const people = [person({ externalId: 'a', department: 'Eng', startedAt: iso(40) })];
    const report = assessTeamHealth({ people, now: NOW });
    expect(report.hasCompensation).toBe(false);
    expect(report.teams[0]!.compressionRatio).toBeNull();
    expect(report.assumptions.some((a) => a.includes('Connect a payroll provider'))).toBe(true);
  });

  it('flags recent hires paid at or above the tenured people', () => {
    const people = [
      person({ externalId: 'new1', department: 'Eng', startedAt: iso(4) }),
      person({ externalId: 'new2', department: 'Eng', startedAt: iso(8) }),
      person({ externalId: 'old1', department: 'Eng', startedAt: iso(50) }),
      person({ externalId: 'old2', department: 'Eng', startedAt: iso(60) }),
    ];
    const compensation = [
      { externalId: 'new1', annualBaseCents: 15_000_000, currency: 'USD', effectiveAt: null },
      { externalId: 'new2', annualBaseCents: 15_000_000, currency: 'USD', effectiveAt: null },
      { externalId: 'old1', annualBaseCents: 14_000_000, currency: 'USD', effectiveAt: null },
      { externalId: 'old2', annualBaseCents: 14_000_000, currency: 'USD', effectiveAt: null },
    ];
    const report = assessTeamHealth({ people, compensation, now: NOW });
    const eng = report.teams.find((t) => t.team === 'Eng')!;
    expect(eng.compressionRatio).toBeCloseTo(15 / 14, 5);
    expect(eng.signals.some((s) => s.key === 'compression')).toBe(true);
    expect(report.findings.some((f) => f.code === 'pay_compression')).toBe(true);
  });

  it('returns a risk score that is exactly the sum of its named signals', () => {
    const people = [person({ externalId: 'solo', department: 'Legal', startedAt: iso(40) })];
    const team = assessTeamHealth({ people, now: NOW }).teams[0]!;
    const total = team.signals.reduce((acc, s) => acc + s.weight, 0);
    expect(team.risk).toBeCloseTo(Math.min(1, total), 10);
    expect(team.signals.map((s) => s.key)).toContain('single_person_team');
  });
});

// ---------------------------------------------------------------------------
// hr.hrms_sync — the reconciliation decision
// ---------------------------------------------------------------------------

describe('hr.hrms_sync reconciliation', () => {
  const local = (over: Partial<LocalEmployee> & { id: number; partyRef: string }): LocalEmployee => ({
    employeeCode: null, title: null, department: null, managerRef: null, location: null,
    employment: 'full_time', status: 'active', startedAt: null, endedAt: null,
    ...over,
  });

  it('creates, updates and leaves the unchanged alone', () => {
    const plan = planRosterReconciliation({
      connectorKey: 'bamboohr',
      remote: [
        person({ externalId: '1', name: 'Same', title: 'Engineer', startedAt: '2020-01-01' }),
        person({ externalId: '2', name: 'Moved', title: 'Staff Engineer', startedAt: '2020-01-01' }),
        person({ externalId: '3', name: 'New', startedAt: '2026-01-01' }),
      ],
      local: [
        local({ id: 10, partyRef: 'bamboohr:1', employeeCode: '1', title: 'Engineer', startedAt: '2020-01-01' }),
        local({ id: 11, partyRef: 'bamboohr:2', employeeCode: '2', title: 'Engineer', startedAt: '2020-01-01' }),
      ],
      completeRead: true,
    });
    expect(plan.unchanged).toBe(1);
    expect(plan.create.map((c) => c.partyRef)).toEqual(['bamboohr:3']);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]!.changes).toEqual([{ field: 'title', from: 'Engineer', to: 'Staff Engineer' }]);
  });

  it('treats null, undefined and empty string as the same absence', () => {
    // Without this every sync reports a change on every row forever, and the
    // employment audit trail fills with edits nobody made.
    const plan = planRosterReconciliation({
      connectorKey: 'gusto',
      remote: [person({ externalId: '1', department: null, startedAt: null })],
      local: [local({ id: 1, partyRef: 'gusto:1', employeeCode: '1', department: '', startedAt: null })],
    });
    expect(plan.unchanged).toBe(1);
    expect(plan.update).toHaveLength(0);
  });

  it('NEVER proposes a departure from an incomplete read', () => {
    // The most dangerous inference in the exchange: absence from an incremental
    // or truncated page is not evidence that somebody left.
    const args = {
      connectorKey: 'bamboohr',
      remote: [person({ externalId: '1' })],
      local: [local({ id: 1, partyRef: 'bamboohr:1', employeeCode: '1' }), local({ id: 2, partyRef: 'bamboohr:2', employeeCode: '2' })],
    };
    expect(planRosterReconciliation({ ...args, completeRead: false }).departed).toEqual([]);
    const complete = planRosterReconciliation({ ...args, completeRead: true });
    expect(complete.departed).toHaveLength(1);
    expect(complete.departed[0]!.reason).toMatch(/complete read/);
  });

  it('never touches a row another system or a person authored', () => {
    const plan = planRosterReconciliation({
      connectorKey: 'gusto',
      remote: [],
      local: [local({ id: 1, partyRef: 'workday:9' }), local({ id: 2, partyRef: 'manual:jane' })],
      completeRead: true,
    });
    expect(plan.foreign).toBe(2);
    expect(plan.departed).toEqual([]);
    expect(plan.update).toEqual([]);
  });

  it('matches on the provider id alone and reports a duplicate', () => {
    const plan = planRosterReconciliation({
      connectorKey: 'hibob',
      // Same person twice under one id, and a namesake under a different one.
      remote: [person({ externalId: '1', name: 'Jane Doe' }), person({ externalId: '1', name: 'Jane Doe' }), person({ externalId: '2', name: 'Jane Doe' })],
      local: [],
    });
    expect(plan.duplicates).toEqual(['hibob:1']);
    expect(plan.create).toHaveLength(2);
  });

  it('carries the manager across as the same ref shape the person has', () => {
    const plan = planRosterReconciliation({
      connectorKey: 'workday',
      remote: [person({ externalId: 'w2', managerExternalId: 'w1' })],
      local: [],
    });
    expect(plan.create[0]!.fields.managerRef).toBe(syncedPartyRef('workday', 'w1'));
  });

  it('bounds the party ref to the column it is written into', () => {
    expect(syncedPartyRef('a-very-long-connector-key-indeed', 'x'.repeat(200)).length).toBe(64);
  });
});
