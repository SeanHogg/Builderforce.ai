import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  classifyBulkAutoRunReason, censusDiagnose, summarizeCensus, type CensusTicketFacts,
} from './stallCensus';
import { STALL_AFTER_MS } from './stallTriage';

const STALE = STALL_AFTER_MS + 60_000;

/** A project that HAS opted into required sign-off — the pre-0380 assumption. */
const SIGNOFF_ON = { requireSignoff: true };
/** A project that has not. The default since 0380, and every project as of that migration. */
const SIGNOFF_OFF = { requireSignoff: false };

const facts = (over: Partial<CensusTicketFacts> = {}): CensusTicketFacts => ({
  taskId: 1,
  status: 'backlog',
  source: null,
  assignedAgentRef: null,
  idleMs: STALE,
  everRan: false,
  hasLiveRun: false,
  consecutiveFailures: 0,
  lane: { gate: 'auto', isTerminal: false, staffed: false },
  managedProducerResolvable: null,
  managedLaneAuthorityTier: null,
  stageOwedRoles: [],
  ...over,
});

describe('classifyBulkAutoRunReason', () => {
  it('mirrors the evaluator\'s pre-lane guards in order', () => {
    expect(classifyBulkAutoRunReason(facts({ source: 'manager' }))).toBe('not_executable');
    expect(classifyBulkAutoRunReason(facts({ status: 'done' }))).toBe('terminal_lane');
    expect(classifyBulkAutoRunReason(facts({ lane: null }))).toBe('no_lane');
    expect(classifyBulkAutoRunReason(facts({ lane: { gate: 'auto', isTerminal: true, staffed: true } })))
      .toBe('terminal_lane');
  });

  it('reports no_agent when neither the lane nor an owner can run it', () => {
    expect(classifyBulkAutoRunReason(facts())).toBe('no_agent');
  });

  it('accepts a staffed lane, or an owner agent off a review lane', () => {
    expect(classifyBulkAutoRunReason(facts({ lane: { gate: 'auto', isTerminal: false, staffed: true } })))
      .toBe('will_run');
    expect(classifyBulkAutoRunReason(facts({ assignedAgentRef: 'agent-1' }))).toBe('will_run');
  });

  it('SUPPRESSES the owner fallback on a review lane, exactly as the evaluator does', () => {
    // The guardrail that stops an author re-running on its own output and signing it
    // off. Without it the census would report every in_review ticket as staffed.
    expect(classifyBulkAutoRunReason(facts({ status: 'in_review', assignedAgentRef: 'agent-1' })))
      .toBe('no_agent');
  });

  it('ranks the human gate above staffing, and staffing above the breaker', () => {
    const humanGated = facts({ lane: { gate: 'human', isTerminal: false, staffed: false }, consecutiveFailures: 9 });
    expect(classifyBulkAutoRunReason(humanGated)).toBe('human_gate');

    const unstaffedAndFailing = facts({ consecutiveFailures: 9 });
    expect(classifyBulkAutoRunReason(unstaffedAndFailing)).toBe('no_agent');
  });

  // The census must model the same gate the DISPATCHER enforces, or it re-describes a
  // configuration defect as a staffing problem. Measured: a managed board's tickets read
  // `will_run` while every dispatch was being refused.
  it('reports managed_no_role on a managed stage with no resolvable role — even when the lane IS staffed', () => {
    const staffed = { gate: 'auto', isTerminal: false, staffed: true };
    expect(classifyBulkAutoRunReason(facts({ lane: staffed, managedProducerResolvable: false })))
      .toBe('managed_no_role');
  });

  it('lets a managed stage WITH a resolvable role fall through the normal ladder', () => {
    const staffed = { gate: 'auto', isTerminal: false, staffed: true };
    expect(classifyBulkAutoRunReason(facts({ lane: staffed, managedProducerResolvable: true })))
      .toBe('will_run');
    expect(classifyBulkAutoRunReason(facts({ lane: staffed, managedProducerResolvable: true, hasLiveRun: true })))
      .toBe('already_running');
  });

  it('ranks the human gate above it, exactly as the evaluator does', () => {
    const humanGated = { gate: 'human', isTerminal: false, staffed: true };
    expect(classifyBulkAutoRunReason(facts({ lane: humanGated, managedProducerResolvable: false })))
      .toBe('human_gate');
  });

  it('reports the breaker and live runs on a staffed lane', () => {
    const staffed = { gate: 'auto', isTerminal: false, staffed: true };
    expect(classifyBulkAutoRunReason(facts({ lane: staffed, hasLiveRun: true }))).toBe('already_running');
    expect(classifyBulkAutoRunReason(facts({ lane: staffed, consecutiveFailures: 3 }))).toBe('run_cap_exhausted');
    expect(classifyBulkAutoRunReason(facts({ lane: staffed, consecutiveFailures: 2 }))).toBe('will_run');
  });
});

describe('censusDiagnose', () => {
  it('does not call a recently-moved ticket stalled', () => {
    expect(censusDiagnose(facts({ idleMs: 1000 }), SIGNOFF_ON).stalled).toBe(false);
  });

  it('maps an unstaffed stale ticket onto the SAME cause the deep stage uses', () => {
    const d = censusDiagnose(facts(), SIGNOFF_ON);
    expect(d.stalled).toBe(true);
    expect(d.cause).toBe('unassigned');
  });

  it('never treats a live ticket as stuck', () => {
    const d = censusDiagnose(facts({ lane: { gate: 'auto', isTerminal: false, staffed: true }, hasLiveRun: true }), SIGNOFF_ON);
    expect(d.stalled).toBe(false);
  });

  it('surfaces an owed stage sign-off on an otherwise-runnable ticket', () => {
    const d = censusDiagnose(facts({
      status: 'ready',
      lane: { gate: 'auto', isTerminal: false, staffed: true },
      stageOwedRoles: ['code-reviewer'],
      everRan: true,
    }), SIGNOFF_ON);
    expect(d.stalled).toBe(true);
    expect(d.cause).toBe('awaiting_signoff');
  });

  it('needs a NAMED owing role — an anonymous open slot is not a sign-off diagnosis', () => {
    // `diagnoseStall` only reaches its awaiting_signoff branch when it can say WHO owes
    // the work, so the census must carry role keys rather than a boolean. Without them
    // the whole measured 149-ticket cohort mis-classifies as a dispatch problem.
    const d = censusDiagnose(facts({
      status: 'ready',
      lane: { gate: 'auto', isTerminal: false, staffed: true },
      stageOwedRoles: [],
      everRan: true,
    }), SIGNOFF_ON);
    expect(d.cause).not.toBe('awaiting_signoff');
  });

  /**
   * THE SECOND DIAGNOSIS PATH (0380 follow-up, measured).
   *
   * `requireSignoffToComplete` became a project setting and stall TRIAGE was taught to
   * consult it — the census was not. Measured on project 11 at api 2026.7.175, hours
   * after the gate was switched off for every project: the census still reported an
   * `awaiting_signoff` cohort of 135, and `systemicDiagnosis` promoted 76 of them to an
   * open platform finding reading "a defect in the sign-off recording mechanism is
   * preventing stage gates from opening" — for a gate that was holding nothing at all.
   *
   * An open manifest slot on a project that does not require sign-off is not a stall
   * cause; whatever else is wrong with the ticket is, and naming the slot hides it.
   */
  it('does NOT name an owed slot as the cause when the project requires no sign-off', () => {
    const owed = {
      status: 'ready',
      lane: { gate: 'auto', isTerminal: false, staffed: true },
      stageOwedRoles: ['code-reviewer'],
      everRan: true,
    };
    // Identical ticket, opposite project settings — only the policy differs.
    expect(censusDiagnose(facts(owed), SIGNOFF_ON).cause).toBe('awaiting_signoff');
    expect(censusDiagnose(facts(owed), SIGNOFF_OFF).cause).not.toBe('awaiting_signoff');
  });

  it('still reports the ticket as stalled — the cause changes, the stall does not', () => {
    // The opt-out must not silence a stuck ticket, only stop mis-attributing it. A
    // released ticket that nothing dispatches is `never_started`, which is actionable.
    const d = censusDiagnose(facts({
      status: 'ready',
      lane: { gate: 'auto', isTerminal: false, staffed: true },
      stageOwedRoles: ['code-reviewer'],
      everRan: false,
    }), SIGNOFF_OFF);
    expect(d.stalled).toBe(true);
    expect(d.cause).toBe('never_started');
  });

  it('keeps a REAL blocker visible underneath the released slot', () => {
    // managed_no_role outranks the sign-off branch either way; switching sign-off off
    // must not change a diagnosis that never depended on it.
    const d = censusDiagnose(facts({
      status: 'ready',
      lane: { gate: 'auto', isTerminal: false, staffed: true },
      managedProducerResolvable: false,
      stageOwedRoles: ['code-reviewer'],
      everRan: true,
    }), SIGNOFF_OFF);
    expect(d.cause).toBe('managed_no_role');
  });
});

describe('summarizeCensus', () => {
  const rows = [
    { taskId: 1, idleMs: 5, stalled: true, cause: 'unassigned' as const },
    { taskId: 2, idleMs: 90, stalled: true, cause: 'unassigned' as const },
    { taskId: 3, idleMs: 40, stalled: true, cause: 'unassigned' as const },
    { taskId: 4, idleMs: 10, stalled: true, cause: 'failure_breaker' as const },
    { taskId: 5, idleMs: 1, stalled: false, cause: 'moving' as const },
  ];

  it('counts only stalled tickets and ranks cohorts by size', () => {
    const c = summarizeCensus(7, rows, 2);
    expect(c.managed).toBe(5);
    expect(c.stalled).toBe(4);
    expect(c.moving).toBe(1);
    expect(c.cohorts[0]).toMatchObject({ cause: 'unassigned', count: 3 });
    expect(c.cohorts[1]).toMatchObject({ cause: 'failure_breaker', count: 1 });
  });

  it('samples the LONGEST-idle members so an operator sees the worst cases', () => {
    const c = summarizeCensus(7, rows, 0);
    expect(c.cohorts[0]?.sampleTaskIds).toEqual([2, 3, 1]);
    expect(c.cohorts[0]?.maxIdleMs).toBe(90);
  });

  it('reports how much of the census the deep stage has confirmed', () => {
    // The honesty field: breadth is not certainty, and a reader must be able to see
    // that 4 stalls are known while only 2 have been diagnosed in depth.
    expect(summarizeCensus(7, rows, 2).deepDiagnosed).toBe(2);
  });

  it('is empty-safe', () => {
    const c = summarizeCensus(7, [], 0);
    expect(c).toMatchObject({ managed: 0, stalled: 0, moving: 0, cohorts: [] });
  });
});

/**
 * A FAILED READ IS NOT A VERDICT — the 306-ticket cohort.
 *
 * `loadCensusFacts` used to substitute `{ roleKeys: [], approvers: [], tier: 'none' }`
 * whenever the bulk lane-authority map had no entry for a ticket's lane, and
 * `pickManagedProducer` reads that as null, which this ladder reports as
 * `managed_no_role`. The map's loader was itself wrapped in `.catch(() => new Map())`, so
 * ONE failed read relabelled every managed ticket on the board at once.
 *
 * Measured on project 11 across five captures: `managed_no_role` sat at 294 → 306 of
 * ~670 stalled tickets while the board-staffing sweep — the SAME `loadBoardLaneAuthorities`
 * call, in the same pass, without a swallow — reported `unfilledRoleKeys: []` and no
 * unauthorised lanes. Two code paths, identical inputs, opposite answers, because one of
 * them turned a failure into the most alarming available verdict.
 *
 * The ladder's contract is what these pin: FALSE means "asked and the answer is no",
 * `null` means "could not ask". Only the first may produce `managed_no_role`.
 */
describe('classifyBulkAutoRunReason — unknown must not read as managed_no_role', () => {
  const managedLane = { gate: 'auto', isTerminal: false, staffed: true };

  it('reports managed_no_role only when the producer was genuinely resolved to none', () => {
    expect(classifyBulkAutoRunReason(facts({
      lane: managedLane, managedProducerResolvable: false,
    }))).toBe('managed_no_role');
  });

  it('falls through when the producer question could not be answered at all', () => {
    const verdict = classifyBulkAutoRunReason(facts({
      lane: managedLane, managedProducerResolvable: null,
    }));
    expect(verdict).not.toBe('managed_no_role');
  });

  /**
   * TWO READINGS OF "NO PRODUCER", AND THEY ARE OPPOSITE REPAIRS.
   *
   * `managed_no_role` is a NAMED role that failed to bind — the manager's staffing ladder
   * is keyed on that name and can fill it. `lane_unconfigured` is a lane that names no role
   * at all, so the ladder has nothing to work with and the repair is to configure the lane.
   * Measured on project 11 (2026-07-31): 306 tickets reported `managed_no_role`, of which
   * 299 sat in `backlog` and 10 in `blocked` — lanes nobody had ever set up. Reporting them
   * as a failed binding sent every reader after a staffing problem that did not exist and
   * hid the handful of tickets that genuinely had one.
   */
  it('separates a lane that authorises NOTHING from a role that failed to bind', () => {
    const unresolved = { lane: managedLane, managedProducerResolvable: false } as const;
    expect(classifyBulkAutoRunReason(facts({ ...unresolved, managedLaneAuthorityTier: 'none' })))
      .toBe('lane_unconfigured');
    expect(classifyBulkAutoRunReason(facts({ ...unresolved, managedLaneAuthorityTier: 'requirements' })))
      .toBe('managed_no_role');
    expect(classifyBulkAutoRunReason(facts({ ...unresolved, managedLaneAuthorityTier: 'lane_agents' })))
      .toBe('managed_no_role');
  });

  /** An unanswered tier must not read as `none` — the same substitution this whole block
   *  exists to prevent, one field over. */
  it('falls back to managed_no_role when the tier itself is unknown', () => {
    expect(classifyBulkAutoRunReason(facts({
      lane: managedLane, managedProducerResolvable: false, managedLaneAuthorityTier: null,
    }))).toBe('managed_no_role');
  });

  it('never reports managed_no_role when a producer DID resolve', () => {
    expect(classifyBulkAutoRunReason(facts({
      lane: managedLane, managedProducerResolvable: true,
    }))).not.toBe('managed_no_role');
  });
});

/**
 * The source guard for the same defect, because the fabrication is a control-flow
 * decision no unit test of the pure ladder can see: `loadCensusFacts` builds the facts,
 * and substituting an empty authority there is invisible to `classifyBulkAutoRunReason`,
 * which only ever sees the boolean that substitution produced.
 */
describe('loadCensusFacts does not fabricate an authority it could not load', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./stallCensus.ts', import.meta.url).href),
    'utf8',
  );

  it('leaves the producer verdict UNKNOWN when the lane has no loaded inputs', () => {
    // The fabricated fallback must not return in any form.
    expect(source).not.toMatch(/:\s*\{ roleKeys: \[\] as string\[\], approvers: \[\], tier: 'none' as const \}/);
    // The verdict is computed only INSIDE the `if (inputs)` branch, so an absent entry
    // leaves the initialised `null` in place.
    expect(source).toMatch(/if \(inputs\) \{[\s\S]*?managedProducerResolvable = pickManagedProducer/);
  });

  it('does not swallow a failed lane-authority load', () => {
    expect(source, 'a silent catch here relabels every managed ticket on the board')
      .not.toMatch(/loadBoardLaneAuthorities\([\s\S]{0,300}?\}\)\.catch\(\(\) => new Map\(\)\)/);
    expect(source).toMatch(/loadBoardLaneAuthorities[\s\S]{0,400}?reportCaughtError/);
  });
});
