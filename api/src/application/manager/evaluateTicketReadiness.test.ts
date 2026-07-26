import { describe, it, expect } from 'vitest';
import { decideTicketReadiness, expectsCodeDeliverable, type ReadinessInput } from './evaluateTicketReadiness';
import type { SignoffGateResult } from '../kanban/signoffGate';

/**
 * These branches are the AI Manager's judgement. Before this existed the manager asked
 * one question ("branch and no PR?") and force-completed anything that matched, so the
 * tests below are written around the failures that were actually measured in production:
 * implementable tickets rotting in review with no deliverable, and unreviewed work being
 * squash-merged because nobody checked for a sign-off.
 */

const signedOff: SignoffGateResult = {
  satisfied: true, reason: 'all_signed_off', requiredCount: 2, satisfiedCount: 2,
  outstanding: [], detail: 'All 2 required roles signed off.',
};
const notSignedOff: SignoffGateResult = {
  satisfied: false, reason: 'outstanding_signoffs', requiredCount: 2, satisfiedCount: 1,
  outstanding: [{ roleKey: 'qa-tester', roleName: 'QA Tester', stageKey: 'in_review', state: 'assigned', responsibility: 'reviewer', assigneeName: 'QA Bot', assigneeRef: 'a1', assigneeKind: 'agent' }],
  detail: 'Waiting on 1 of 2 required sign-offs: QA Tester.',
};

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    taskType: 'task',
    actionType: 'backend_api',
    hasBranch: true,
    hasPr: true,
    buildStatus: 'success',
    hasLiveRun: false,
    signoff: signedOff,
    requireSignoff: true,
    requireGreenBuild: false,
    ...over,
  };
}

describe('expectsCodeDeliverable', () => {
  it.each(['backend_api', 'frontend_ui', 'sql', 'bugfix', 'refactor', 'data_migration', 'tests', 'docs', 'devops_ci'])(
    'expects a deliverable for %s work',
    (actionType) => expect(expectsCodeDeliverable('task', actionType)).toBe(true),
  );

  it('does NOT expect a deliverable for unclassified work', () => {
    // `other`/null is the honest unknown — demanding a branch would bounce legitimate
    // non-code tickets (a decision, an approval) back to implementation forever.
    expect(expectsCodeDeliverable('task', 'other')).toBe(false);
    expect(expectsCodeDeliverable('task', null)).toBe(false);
  });

  it('does NOT expect an Epic to produce code itself — it delegates to children', () => {
    expect(expectsCodeDeliverable('epic', 'backend_api')).toBe(false);
  });
});

describe('decideTicketReadiness', () => {
  it('completes when deliverable, build and sign-offs all check out', () => {
    const r = decideTicketReadiness(input());
    expect(r.action).toBe('complete');
  });

  it('never touches a ticket with a live run', () => {
    const r = decideTicketReadiness(input({ hasLiveRun: true, signoff: notSignedOff, hasBranch: false }));
    expect(r.action).toBe('wait_for_run');
  });

  it('RETURNS code work that reached review with no deliverable', () => {
    // The measured failure: `backend_api` tickets parked in review having produced
    // nothing. Review is not a resting place for unstarted work.
    const r = decideTicketReadiness(input({ hasBranch: false, hasPr: false }));
    expect(r.action).toBe('return_to_implementation');
    expect(r.detail).toContain('no branch or PR');
  });

  it('does NOT return a non-code ticket for having no branch', () => {
    const r = decideTicketReadiness(input({ actionType: 'other', hasBranch: false, hasPr: false }));
    expect(r.action).toBe('complete');
  });

  it('RETURNS a ticket whose PR build is failing, ahead of asking for sign-off', () => {
    // Approving broken code is worse than not approving it, so a red build outranks the
    // sign-off question — otherwise a reviewer gets asked to bless a failing branch.
    const r = decideTicketReadiness(input({ buildStatus: 'failure', signoff: notSignedOff }));
    expect(r.action).toBe('return_build_failed');
  });

  it('drives sign-off when required roles are outstanding', () => {
    const r = decideTicketReadiness(input({ signoff: notSignedOff }));
    expect(r.action).toBe('drive_signoff');
    expect(r.detail).toContain('QA Tester');
  });

  it('does NOT complete an unreviewed ticket just because it has a green build', () => {
    // The exact hole this whole change closes: a branch + green CI used to be enough to
    // force-complete and squash-merge with nobody having reviewed it.
    const r = decideTicketReadiness(input({ signoff: notSignedOff, buildStatus: 'success' }));
    expect(r.action).not.toBe('complete');
  });

  it('does NOT complete a ticket whose manifest has no required roles', () => {
    // Fail-closed empty manifest: "nobody reviewed" must not read as "everybody approved".
    const empty: SignoffGateResult = {
      satisfied: false, reason: 'no_required_participants', requiredCount: 0, satisfiedCount: 0,
      outstanding: [], detail: 'No required roles are on this ticket, so no agent has signed off.',
    };
    expect(decideTicketReadiness(input({ signoff: empty })).action).toBe('drive_signoff');
  });

  it('skips the sign-off question entirely when the project opted out', () => {
    const r = decideTicketReadiness(input({ signoff: notSignedOff, requireSignoff: false }));
    expect(r.action).toBe('complete');
  });

  it('waits for a green build under on_green rather than merging on pending', () => {
    const r = decideTicketReadiness(input({ requireGreenBuild: true, buildStatus: 'pending' }));
    expect(r.action).toBe('wait_for_build');
  });

  it('waits when on_green and the build never reported at all', () => {
    const r = decideTicketReadiness(input({ requireGreenBuild: true, buildStatus: null }));
    expect(r.action).toBe('wait_for_build');
  });

  it('completes on a pending build when the project does NOT require green', () => {
    // Preserves the existing `immediate` policy semantics — this change must not silently
    // start gating every project on CI.
    const r = decideTicketReadiness(input({ requireGreenBuild: false, buildStatus: 'pending' }));
    expect(r.action).toBe('complete');
  });

  it('ignores build status on a ticket with no PR', () => {
    const r = decideTicketReadiness(input({ actionType: 'other', hasBranch: false, hasPr: false, buildStatus: 'failure' }));
    expect(r.action).toBe('complete');
  });

  it('orders the checks deliverable → build → signoff → green', () => {
    // All four failing at once must surface the MOST upstream problem, so the manager
    // fixes the cause rather than the symptom.
    const r = decideTicketReadiness(input({
      hasBranch: false, hasPr: false, buildStatus: 'failure',
      signoff: notSignedOff, requireGreenBuild: true,
    }));
    expect(r.action).toBe('return_to_implementation');
  });
});
