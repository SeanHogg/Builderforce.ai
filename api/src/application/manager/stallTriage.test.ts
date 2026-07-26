import { describe, it, expect } from 'vitest';
import {
  diagnoseStall, escalateIfIneffective, isManagerActionable,
  MAX_REMEDY_ATTEMPTS, STALL_AFTER_MS, STALL_CAUSE_LABEL,
  type StallInput,
} from './stallTriage';

const DAY = 86_400_000;

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
    expect(d).toMatchObject({ cause: 'pr_conflict', remedy: 'resolve_conflict' });
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
