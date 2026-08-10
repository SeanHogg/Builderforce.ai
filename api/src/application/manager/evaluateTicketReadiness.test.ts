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
    // 'settled' = a pull request exists and has already landed, so the build checks below
    // still apply and there is nothing left to merge. The OPEN case has its own tests.
    prState: 'settled',
    hasAssignee: true,
    buildStatus: 'success',
    hasLiveRun: false,
    deliverableEvidence: 'implementation',
    signoff: signedOff,
    requireSignoff: true,
    requireGreenBuild: false,
    ...over,
  };
}

describe('expectsCodeDeliverable', () => {
  it.each(['backend_api', 'frontend_ui', 'sql', 'bugfix', 'refactor', 'data_migration', 'tests', 'devops_ci'])(
    'expects a deliverable for %s work',
    (actionType) => expect(expectsCodeDeliverable('task', actionType)).toBe(true),
  );

  it.each(['docs', 'analysis', 'provisioning', 'decision'])(
    'treats explicitly classified %s work as a non-code deliverable',
    (actionType) => expect(expectsCodeDeliverable('task', actionType)).toBe(false),
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
    const r = decideTicketReadiness(input({ hasBranch: false, prState: 'none' }));
    expect(r.action).toBe('return_to_implementation');
    expect(r.detail).toContain('no implementation files');
  });

  it('RETURNS code work whose recorded changes are documentation-only', () => {
    const r = decideTicketReadiness(input({ deliverableEvidence: 'docs_only', prState: 'open' }));
    expect(r.action).toBe('return_to_implementation');
    expect(r.detail).toContain('only documentation');
  });

  it('does not mistake unknown evidence for proof that implementation is absent', () => {
    const r = decideTicketReadiness(input({ deliverableEvidence: 'unknown' }));
    expect(r.action).toBe('complete');
  });

  it('does NOT return a non-code ticket for having no branch', () => {
    const r = decideTicketReadiness(input({ actionType: 'other', hasBranch: false, prState: 'none', deliverableEvidence: 'none' }));
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
    const r = decideTicketReadiness(input({ actionType: 'other', hasBranch: false, prState: 'none', buildStatus: 'failure' }));
    expect(r.action).toBe('complete');
  });

  it('orders the checks deliverable → build → signoff → green', () => {
    // All four failing at once must surface the MOST upstream problem, so the manager
    // fixes the cause rather than the symptom.
    const r = decideTicketReadiness(input({
      hasBranch: false, prState: 'none', buildStatus: 'failure',
      signoff: notSignedOff, requireGreenBuild: true,
    }));
    expect(r.action).toBe('return_to_implementation');
  });
});

/**
 * THE DEFECT THIS SUITE EXISTS FOR (api 2026.7.195, project 11, one pass, 78ms apart):
 *   09:00:04.193  ticket -085 completed, journalled "(no branch to merge)", openedPr:false
 *   09:00:04.271  the merge stage retired that same ticket's PR #103, conflict_exhausted
 * The ticket had a branch AND an open pull request, so both halves of that sentence were
 * false. It is the generator of the human-owed PR pile (49 → 52 → 72 → 75 in two days,
 * 5 of its top 10 rows flagged "ticket already DONE — close this PR").
 */
describe('an OPEN pull request blocks completion', () => {
  it('does NOT complete a ticket whose pull request is still open', () => {
    const r = decideTicketReadiness(input({ prState: 'open' }));
    expect(r.action).toBe('await_merge');
    expect(r.completion).toBeNull();
  });

  it('says the work has not landed, never that there is nothing to merge', () => {
    const r = decideTicketReadiness(input({ prState: 'open' }));
    expect(r.detail).toContain('still open');
    expect(r.detail).not.toContain('nothing to merge');
  });

  it('defers even when every other check passed and sign-off is not required', () => {
    // The exact shape of ticket -085: green build, no sign-off requirement, a branch, and
    // an open PR. Every question but "has it landed?" answers yes.
    const r = decideTicketReadiness(input({ prState: 'open', requireSignoff: false, buildStatus: 'success' }));
    expect(r.action).toBe('await_merge');
  });

  it('still asks for outstanding sign-offs while the PR is open', () => {
    // Deferring the merge must not silence the review: the sign-off is what unblocks it.
    const r = decideTicketReadiness(input({ prState: 'open', signoff: notSignedOff }));
    expect(r.action).toBe('drive_signoff');
  });

  it('still returns an open PR whose build is red', () => {
    const r = decideTicketReadiness(input({ prState: 'open', buildStatus: 'failure' }));
    expect(r.action).toBe('return_build_failed');
  });
});

describe('the completion shape names which closure applied', () => {
  it('opens a PR when there is a branch, no PR and an agent to open it as', () => {
    const r = decideTicketReadiness(input({ hasBranch: true, prState: 'none', hasAssignee: true }));
    expect(r.action).toBe('complete');
    expect(r.completion).toBe('open_pr');
  });

  it('reports branch_unopened when nobody is assigned to open the PR', () => {
    // "No branch to merge" was printed here too, with a pushed branch sitting right there.
    const r = decideTicketReadiness(input({ hasBranch: true, prState: 'none', hasAssignee: false }));
    expect(r.completion).toBe('branch_unopened');
  });

  it('reports pr_settled when the pull request has already landed', () => {
    expect(decideTicketReadiness(input({ hasBranch: true, prState: 'settled' })).completion).toBe('pr_settled');
  });

  it('reports no_deliverable only when there is genuinely nothing to merge', () => {
    const r = decideTicketReadiness(input({ actionType: 'other', hasBranch: false, prState: 'none' }));
    expect(r.completion).toBe('no_deliverable');
  });

  it('leaves the completion shape unset on every non-completing verdict', () => {
    for (const over of [
      { hasLiveRun: true } as const,
      { prState: 'open' } as const,
      { signoff: notSignedOff } as const,
      { buildStatus: 'failure' } as const,
    ]) expect(decideTicketReadiness(input(over)).completion).toBeNull();
  });
});
