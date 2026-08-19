import { describe, it, expect } from 'vitest';
import {
  diagnoseStall, escalateIfIneffective, isManagerActionable, stageSignoffFor,
  MAX_REMEDY_ATTEMPTS, STALL_AFTER_MS, STALL_CAUSE_LABEL, isStallResolved,
  type StallInput,
} from './stallTriage';

const DAY = 86_400_000;

const diagnose = (over: Partial<StallInput> = {}) => diagnoseStall(base(over));

/** A ticket that has been idle for three days with nothing running it. */
const base = (over: Partial<StallInput> = {}): StallInput => ({
  status: 'todo',
  isTerminal: false,
  idleMs: 3 * DAY,
  everRan: false,
  autoRunReason: 'will_run',
  hasLiveRun: false,
  readiness: null,
  pr: null,
  mergeWithheld: false,
  ...over,
});

describe('diagnoseStall — what is NOT stalled', () => {
  it('never flags a terminal ticket', () => {
    expect(diagnoseStall(base({ isTerminal: true, idleMs: 90 * DAY })).stalled).toBe(false);
  });

  it('never flags a ticket with a run in flight, however long it has been idle', () => {
    const d = diagnoseStall(base({ hasLiveRun: true, idleMs: 30 * DAY }));
    expect(d.stalled).toBe(false);
    expect(d.cause).toBe('live');
  });

  it('treats an active back-off as waiting, not stuck — it retries itself', () => {
    const d = diagnoseStall(base({ autoRunReason: 'cooldown_active', idleMs: 30 * DAY }));
    expect(d.stalled).toBe(false);
    expect(d.cause).toBe('cooling_down');
  });

  it('does not flag a ticket that changed status recently', () => {
    expect(diagnoseStall(base({ idleMs: STALL_AFTER_MS - 1 })).stalled).toBe(false);
  });

  it('leaves a ticket the dispatcher is about to start alone', () => {
    const d = diagnoseStall(base({ autoRunReason: 'will_run', idleMs: 60_000 }));
    expect(d.stalled).toBe(false);
    expect(d.remedy).toBe('none');
  });

  it('does not flag a system chore that is not agent-executable by design', () => {
    expect(diagnoseStall(base({ autoRunReason: 'not_executable', idleMs: 30 * DAY })).stalled).toBe(false);
  });
});

describe('diagnoseStall — dispatch-side stalls', () => {
  it('staffs a ticket no agent can run', () => {
    const d = diagnoseStall(base({ autoRunReason: 'no_agent' }));
    expect(d).toMatchObject({ stalled: true, cause: 'unassigned', remedy: 'assign' });
  });

  // Its own cause AND its own remedy. `assign` writes a ticket owner, and on a managed
  // board the owner is the Coordinator — it cannot move the ticket, so the manager would
  // "fix" it every pass forever without anything changing.
  it('coordinates a managed stage with no role-capable participant — never assigns an owner', () => {
    const d = diagnose({ autoRunReason: 'managed_no_role' });
    expect(d.cause).toBe('managed_no_role');
    expect(d.remedy).toBe('coordinate');
    expect(d.detail).toContain('lifecycle-managed');
  });

  it('keeps it DISTINCT from unassigned, so the census cohort splits by what actually fixes it', () => {
    expect(diagnose({ autoRunReason: 'no_agent' }).cause).toBe('unassigned');
    expect(diagnose({ autoRunReason: 'managed_no_role' }).cause).toBe('managed_no_role');
  });

  it('escalates a capability gap — the manager cannot conjure a capable agent', () => {
    const d = diagnoseStall(base({ autoRunReason: 'capability_mismatch' }));
    expect(d).toMatchObject({ stalled: true, cause: 'capability_gap', remedy: 'escalate_human' });
  });

  it('grants a fresh attempt when the failure breaker halted the ticket', () => {
    const d = diagnoseStall(base({ autoRunReason: 'run_cap_exhausted', everRan: true }));
    expect(d).toMatchObject({ stalled: true, cause: 'failure_breaker', remedy: 'reset_breaker' });
  });

  it('escalates rather than overriding a human gate a human deliberately configured', () => {
    const d = diagnoseStall(base({ autoRunReason: 'human_gate' }));
    expect(d).toMatchObject({ stalled: true, cause: 'human_gate', remedy: 'escalate_human' });
  });

  it('starts an inert-from-birth ticket — the 466-ticket population', () => {
    // Runnable on paper, never executed, idle since creation.
    const d = diagnoseStall(base({ autoRunReason: 'will_run', everRan: false, idleMs: 19 * DAY }));
    expect(d).toMatchObject({ stalled: true, cause: 'never_started', remedy: 'dispatch' });
    expect(d.detail).toContain('19 days');
  });
});

describe('diagnoseStall — review-side stalls', () => {
  it('returns a ticket that reached review with no deliverable', () => {
    const d = diagnoseStall(base({ status: 'in_review', readiness: 'return_to_implementation', everRan: true }));
    expect(d).toMatchObject({ cause: 'missing_deliverable', remedy: 'return_to_implementation' });
  });

  it('returns a ticket whose build is red', () => {
    const d = diagnoseStall(base({ status: 'in_review', readiness: 'return_build_failed', everRan: true }));
    expect(d).toMatchObject({ cause: 'build_failed', remedy: 'return_to_implementation' });
  });

  it('drives the outstanding sign-offs', () => {
    const d = diagnoseStall(base({ status: 'in_review', readiness: 'drive_signoff', everRan: true }));
    expect(d).toMatchObject({ cause: 'awaiting_signoff', remedy: 'drive_signoff' });
  });

  it('escalates a build verdict that never arrives — waiting forever is not waiting', () => {
    const d = diagnoseStall(base({ status: 'in_review', readiness: 'wait_for_build', everRan: true }));
    expect(d).toMatchObject({ cause: 'build_failed', remedy: 'escalate_human' });
  });
});

describe('diagnoseStall — pull-request stalls', () => {
  it('reconciles a PR our row calls open but the provider says is closed', () => {
    // The drift measured live: PRs #21-23 closed on GitHub, open in our table.
    const d = diagnoseStall(base({
      status: 'in_review', everRan: true,
      pr: { open: true, providerClosed: true, conflicted: false },
    }));
    expect(d).toMatchObject({ cause: 'pr_unreconciled', remedy: 'reconcile_pr' });
  });

  it('prefers the provider truth over every other reading of the PR', () => {
    // Conflicted AND drifted: bookkeeping wins, because there is nothing to merge.
    const d = diagnoseStall(base({
      status: 'in_review', everRan: true, autoRunReason: 'no_agent',
      pr: { open: true, providerClosed: true, conflicted: true },
    }));
    expect(d.cause).toBe('pr_unreconciled');
  });

  it('hands a conflicting branch to an agent to resolve', () => {
    const d = diagnoseStall(base({
      status: 'in_review', readiness: 'complete', everRan: true,
      pr: { open: true, providerClosed: false, conflicted: true },
    }));
    expect(d).toMatchObject({ cause: 'pr_conflict', remedy: 'none' });
  });

  it('escalates a ready PR the manager is not permitted to merge', () => {
    const d = diagnoseStall(base({
      status: 'in_review', readiness: 'complete', everRan: true, mergeWithheld: true,
      pr: { open: true, providerClosed: false, conflicted: false },
    }));
    expect(d).toMatchObject({ cause: 'merge_withheld', remedy: 'escalate_human' });
  });
});

describe('escalateIfIneffective — the livelock ceiling', () => {
  const stuck = diagnoseStall(base({ autoRunReason: 'no_agent' }));

  it('keeps applying a remedy below the ceiling', () => {
    for (let attempts = 0; attempts < MAX_REMEDY_ATTEMPTS; attempts++) {
      const v = escalateIfIneffective(stuck, attempts);
      expect(v.remedy).toBe('assign');
      expect(v.escalated).toBe(false);
    }
  });

  it('converts to an escalation at the ceiling — this is what the merge loop lacked', () => {
    const v = escalateIfIneffective(stuck, MAX_REMEDY_ATTEMPTS);
    expect(v.remedy).toBe('escalate_human');
    expect(v.escalated).toBe(true);
    // The cause is unchanged: the diagnosis was never what was wrong.
    expect(v.cause).toBe('unassigned');
    expect(v.detail).toContain(`${MAX_REMEDY_ATTEMPTS} times`);
  });

  it('never escalates a ticket that is not stalled', () => {
    const moving = diagnoseStall(base({ idleMs: 0 }));
    expect(escalateIfIneffective(moving, 99).escalated).toBe(false);
  });

  it('marks an already-human remedy escalated without rewriting its detail', () => {
    const gated = diagnoseStall(base({ autoRunReason: 'human_gate' }));
    const v = escalateIfIneffective(gated, 0);
    expect(v.escalated).toBe(true);
    expect(v.detail).toBe(gated.detail);
  });
});

describe('taxonomy completeness', () => {
  it('labels every cause the classifier can emit', () => {
    const causes: Array<StallInput> = [
      base({ isTerminal: true }), base({ hasLiveRun: true }),
      base({ autoRunReason: 'cooldown_active' }), base({ autoRunReason: 'no_agent' }),
      base({ autoRunReason: 'capability_mismatch' }), base({ autoRunReason: 'human_gate' }),
      base({ autoRunReason: 'run_cap_exhausted' }), base({ autoRunReason: 'no_lane' }),
      base({ status: 'blocked', autoRunReason: 'pending_approval' }),
      base({ status: 'in_review', readiness: 'drive_signoff' }),
    ];
    for (const input of causes) {
      expect(STALL_CAUSE_LABEL[diagnoseStall(input).cause]).toBeTruthy();
    }
  });

  it('classifies escalate_human as NOT manager-actionable', () => {
    expect(isManagerActionable('escalate_human')).toBe(false);
    expect(isManagerActionable('none')).toBe(false);
    expect(isManagerActionable('assign')).toBe(true);
    expect(isManagerActionable('reconcile_pr')).toBe(true);
  });
});

describe('diagnoseStall — a sign-off no agent can give', () => {
  const inReview = (over: Partial<StallInput> = {}) =>
    diagnoseStall(base({ status: 'in_review', readiness: 'drive_signoff', everRan: true, ...over }));

  it('escalates immediately when no outstanding role is agent-owed', () => {
    // "Asking the owing roles to review" is not a remedy when there is nobody to ask.
    // Left as drive_signoff it was re-diagnosed every pass, applied never, and so never
    // counted an attempt — the register row that sat 24 days at attempts=0.
    const d = inReview({ signoffDispatchable: false });
    expect(d).toMatchObject({ cause: 'awaiting_signoff', remedy: 'escalate_human', escalated: true });
    expect(d.detail).toMatch(/unstaffed or held by a person/);
  });

  it('still drives the sign-off when an agent owes one', () => {
    expect(inReview({ signoffDispatchable: true })).toMatchObject({
      cause: 'awaiting_signoff', remedy: 'drive_signoff', escalated: false,
    });
  });

  it('treats an unevaluated gate as unknown, never as "nobody can sign"', () => {
    // Null must not escalate: an escalation is a claim about staffing, and we have not
    // looked. Both the omitted and the explicit-null spellings behave the same.
    expect(inReview().remedy).toBe('drive_signoff');
    expect(inReview({ signoffDispatchable: null }).remedy).toBe('drive_signoff');
  });
});

describe('diagnoseStall — a stage whose roles owe work, on ANY lane', () => {
  /**
   * The hole this closes: the lane gate asks each role once per stage and delegates
   * re-asking to the manager, but the manager could only drive sign-offs for `in_review`
   * tickets. A stage whose one ask was refused — or whose reviewer finished without
   * recording a verdict — fell through to "Unclassified → re-coordinate", and
   * coordinating re-runs the same gate that will not ask again.
   */
  it('asks the stage\'s owed roles instead of re-coordinating', () => {
    const d = diagnoseStall(base({
      status: 'requirements', everRan: true, autoRunReason: 'same_lane_reentry',
      stageSignoff: { roleNames: ['Business Analyst', 'Architect'], dispatchable: true },
    }));
    expect(d).toMatchObject({ stalled: true, cause: 'awaiting_signoff', remedy: 'drive_signoff' });
    expect(d.detail).toContain('Architect, Business Analyst');
  });

  /**
   * THIS SENTENCE IS A GROUPING KEY, not just prose: it is stored as the watch row's
   * `detail` and every rollup groups stall causes by it. The manifest query returns slots
   * in no particular order, so the same two roles rendered "(Product Owner, Architect)" on
   * one ticket and "(Architect, Product Owner)" on the next — one cause wearing two
   * spellings, which reads downstream as two distinct problems. Measured on project 11
   * (2026-07-31): 5 `awaiting_signoff` rows produced 3 wordings differing only in order.
   */
  it('renders the same role SET identically however the slots arrive', () => {
    const detail = (roleNames: string[]) => diagnoseStall(base({
      status: 'requirements', everRan: true, autoRunReason: 'same_lane_reentry',
      stageSignoff: { roleNames, dispatchable: true },
    })).detail;
    expect(detail(['Product Owner', 'Architect'])).toBe(detail(['Architect', 'Product Owner']));
  });

  it('escalates when the stage\'s roles are unstaffed or human-owed', () => {
    const d = diagnoseStall(base({
      status: 'requirements', everRan: true, autoRunReason: 'same_lane_reentry',
      stageSignoff: { roleNames: ['Product Owner'], dispatchable: false },
    }));
    expect(d).toMatchObject({ cause: 'awaiting_signoff', remedy: 'escalate_human', escalated: true });
  });

  /**
   * The ordering the measured failure turns on. `evaluateTaskAutoRun` does not model the
   * lane requirement gate, so it answers `will_run` for a ticket the gate then declines —
   * and re-dispatching that ticket only re-runs the gate that has already asked this
   * stage. Asking the owed role has to win, or the remedy applies nothing forever.
   */
  it('outranks the will_run fall-through for a ticket that has already run', () => {
    const d = diagnoseStall(base({
      status: 'requirements', everRan: true, autoRunReason: 'will_run',
      stageSignoff: { roleNames: ['Architect'], dispatchable: true },
    }));
    expect(d.remedy).toBe('drive_signoff');
  });

  /** Precedence: every stronger diagnosis still wins. */
  it('never displaces a stronger diagnosis', () => {
    const owed = { roleNames: ['Architect'], dispatchable: true };
    expect(diagnoseStall(base({
      autoRunReason: 'run_cap_exhausted', everRan: true, stageSignoff: owed,
    })).remedy).toBe('reset_breaker');
    expect(diagnoseStall(base({
      autoRunReason: 'no_agent', everRan: true, stageSignoff: owed,
    })).remedy).toBe('assign');
    expect(diagnoseStall(base({
      autoRunReason: 'same_lane_reentry', everRan: true, stageSignoff: owed,
      pr: { open: true, providerClosed: false, conflicted: true },
    })).remedy).toBe('none');
    expect(diagnoseStall(base({
      autoRunReason: 'same_lane_reentry', everRan: false, stageSignoff: owed,
    })).remedy).toBe('dispatch');
  });

  it('still reports the unclassified fall-through when no stage role is owed', () => {
    const d = diagnoseStall(base({
      everRan: true, autoRunReason: 'same_lane_reentry',
      stageSignoff: { roleNames: [], dispatchable: false },
    }));
    expect(d).toMatchObject({ cause: 'unknown', remedy: 'coordinate' });
  });
});

describe('stageSignoffFor — the wiring between the stage gate and the diagnosis', () => {
  const gate = (...roleNames: string[]) => ({ outstanding: roleNames.map((roleName) => ({ roleName })) });
  const owned = (n: number) => ({ dispatchable: Array.from({ length: n }, (_, i) => i) });

  it('names the stage\'s owed roles once each, and whether an agent can be asked', () => {
    expect(stageSignoffFor('requirements', gate('Architect', 'Architect', 'BA'), owned(1), 'in_review'))
      .toEqual({ roleNames: ['Architect', 'BA'], dispatchable: true });
    expect(stageSignoffFor('requirements', gate('Product Owner'), owned(0), 'in_review'))
      .toEqual({ roleNames: ['Product Owner'], dispatchable: false });
  });

  /** In review, `readiness` already carries the whole-ticket gate and owns the
   *  diagnosis — answering twice would let the weaker branch win. */
  it('stays null for an in-review ticket', () => {
    expect(stageSignoffFor('in_review', gate('QA'), owned(1), 'in_review')).toBeNull();
  });

  it('stays null when no gate was resolved — unknown must never read as "owed"', () => {
    expect(stageSignoffFor('requirements', null, owned(1), 'in_review')).toBeNull();
    expect(stageSignoffFor('requirements', gate('QA'), null, 'in_review')).toBeNull();
  });

  it('produces an EMPTY role list when the stage owes nothing, so the branch stays shut', () => {
    const owedNothing = stageSignoffFor('requirements', gate(), owned(0), 'in_review');
    expect(owedNothing).toEqual({ roleNames: [], dispatchable: false });
    expect(diagnoseStall(base({
      everRan: true, autoRunReason: 'same_lane_reentry', stageSignoff: owedNothing,
    })).remedy).toBe('coordinate');
  });
});

/**
 * THE PROJECT SETTING REACHES THE DIAGNOSIS (0380).
 *
 * `requireSignoffToComplete` used to govern only completion and merge. Stall triage
 * resolved the stage-scoped gate unconditionally, so a project that had switched sign-off
 * OFF still had its tickets diagnosed `awaiting_signoff` with the `drive_signoff` remedy,
 * every five-minute pass, forever — 265 of 679 stalled tickets on the reference board,
 * the oldest idle 48 days, while the per-pass dispatch budget went on re-asking for
 * verdicts the project did not require.
 *
 * `runStallTriage` now feeds the gate through `resolveRequiredSignoffGate`, which returns
 * SIGNOFF_NOT_REQUIRED — nothing outstanding — when the project has not opted in. This
 * pins the consequence of that at the diagnosis layer: the ticket's REAL blocker is what
 * gets named and remedied.
 */
describe('a project that does not require sign-off is never diagnosed awaiting_signoff', () => {
  /** Exactly what triageStage composes from SIGNOFF_NOT_REQUIRED. */
  const noneOwed = stageSignoffFor('requirements', { outstanding: [] }, { dispatchable: [] }, 'in_review');

  /** The same ticket the opted-IN case below diagnoses as awaiting_signoff. */
  const stalledTicket = { status: 'ready', everRan: true, autoRunReason: 'same_lane_reentry' as const };

  it('never reaches the sign-off branch — nothing is outstanding to hold it', () => {
    const d = diagnoseStall(base({ ...stalledTicket, stageSignoff: noneOwed, signoffDispatchable: false }));
    expect(d.cause).not.toBe('awaiting_signoff');
    expect(d.remedy).not.toBe('drive_signoff');
  });

  it('lets a runnable ticket be DISPATCHED rather than held for a verdict', () => {
    const d = diagnoseStall(base({
      status: 'ready', everRan: false, autoRunReason: 'will_run',
      stageSignoff: noneOwed, signoffDispatchable: false,
    }));
    expect(d).toMatchObject({ cause: 'never_started', remedy: 'dispatch' });
  });

  it('still reports a REAL blocker underneath, rather than being silenced', () => {
    // Switching sign-off off must not make a role-less managed stage look healthy: the
    // two are different faults and only one of them was ever about sign-off.
    const d = diagnoseStall(base({
      status: 'ready', autoRunReason: 'managed_no_role',
      stageSignoff: noneOwed, signoffDispatchable: false,
    }));
    expect(d).toMatchObject({ cause: 'managed_no_role', remedy: 'coordinate' });
  });

  it('and an opted-IN project keeps the sign-off diagnosis exactly as before', () => {
    const d = diagnoseStall(base({
      ...stalledTicket,
      stageSignoff: { roleNames: ['Product Owner'], dispatchable: true },
    }));
    expect(d).toMatchObject({ cause: 'awaiting_signoff', remedy: 'drive_signoff' });
  });
});

describe('poolRateLimited — the manager holds instead of spending a run it knows will 429', () => {
  /**
   * THE LOOP THIS BREAKS (measured project 11, 2026-07-31): three consecutive provider
   * 429s trip a ticket's breaker → triage resets it → the fresh run 429s → the breaker
   * re-arms. The `failure_breaker` cohort GREW while triage was working perfectly.
   */
  const breakerTicket = (over: Partial<StallInput> = {}) =>
    diagnose({ autoRunReason: 'run_cap_exhausted', ...over });

  it('resets the breaker as usual while the pool has headroom', () => {
    const d = breakerTicket({ poolRateLimited: false });
    expect(d.stalled).toBe(true);
    expect(d.remedy).toBe('reset_breaker');
  });

  it('withholds the reset while every provider is rate-limited', () => {
    const d = breakerTicket({ poolRateLimited: true });
    expect(d.remedy).toBe('none');
    expect(d.cause).toBe('cooling_down');
    expect(d.detail).toMatch(/rate-limited/i);
  });

  it('holds every remedy that would SPEND a run', () => {
    // `dispatch` (a ticket that never started) and `drive_signoff` (asks an agent to
    // review) both start a run, so each is withheld while the pool cannot serve one.
    expect(diagnose({ autoRunReason: 'will_run', everRan: false, poolRateLimited: true }).remedy).toBe('none');
    expect(diagnose({
      status: 'in_review', readiness: 'drive_signoff', signoffDispatchable: true,
    }).remedy).toBe('drive_signoff');
    expect(diagnose({
      status: 'in_review', readiness: 'drive_signoff', signoffDispatchable: true, poolRateLimited: true,
    }).remedy).toBe('none');
  });

  it('does NOT hold the cheap, durable work — a throttled provider must not stop the manager managing', () => {
    // Staffing writes an owner; reconciling corrects a stale PR row. Neither costs a run,
    // and both are exactly what should still happen while capacity is out.
    expect(diagnose({ autoRunReason: 'no_agent', poolRateLimited: true }).remedy).toBe('assign');
    expect(diagnose({
      pr: { open: true, providerClosed: true, conflicted: false }, poolRateLimited: true,
    }).remedy).toBe('reconcile_pr');
    expect(diagnose({ autoRunReason: 'human_gate', poolRateLimited: true }).remedy).toBe('escalate_human');
  });

  it('holds as cooling_down so the register row KEEPS its attempt count', () => {
    // `isStallResolved('cooling_down')` is false — the row stays open. Resolving it here
    // would reset `attempts` to zero and make the escalation ceiling unreachable again.
    expect(isStallResolved(breakerTicket({ poolRateLimited: true }).cause)).toBe(false);
  });

  it('leaves a ticket that is not stalled at all untouched', () => {
    const d = diagnose({ isTerminal: true, poolRateLimited: true });
    expect(d.cause).toBe('moving');
  });
});
