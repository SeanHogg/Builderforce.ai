import { describe, expect, it } from 'vitest';
import { ciLabelInput, pickRunPullRequest, reviewLabelInput, type RunPullRequest } from './labelInputs';

const now = new Date('2026-10-18T00:00:00.000Z');
const d = (iso: string) => new Date(iso);

function pr(overrides: Partial<RunPullRequest> = {}): RunPullRequest {
  return {
    id: 'pr-1', number: 42, taskId: 7, status: 'merged',
    createdAt: d('2026-10-01T00:00:00Z'), updatedAt: d('2026-10-02T00:00:00Z'),
    mergedAt: d('2026-10-02T00:00:00Z'), mergeSha: 'beef1234',
    buildStatus: 'success', mergeDeployment: { at: d('2026-10-02T00:05:00Z'), failed: false },
    ...overrides,
  };
}

describe('pickRunPullRequest', () => {
  it('picks the earliest PR still accepting the run after its last commit', () => {
    const earlier = pr({ id: 'old', createdAt: d('2026-09-01T00:00:00Z'), mergedAt: d('2026-09-02T00:00:00Z') });
    const current = pr({ id: 'cur', status: 'open', mergedAt: null, mergeSha: null });
    expect(pickRunPullRequest([current, earlier], d('2026-09-20T00:00:00Z'))?.id).toBe('cur');
    expect(pickRunPullRequest([current, earlier], d('2026-09-01T12:00:00Z'))?.id).toBe('old');
  });

  it('finds none when every PR closed before the run committed', () => {
    expect(pickRunPullRequest([pr()], d('2026-10-10T00:00:00Z'))).toBeUndefined();
  });
});

describe('ciLabelInput — the CI label job mapping', () => {
  it('has no input (nothing to label) for an open or missing PR', () => {
    expect(ciLabelInput(undefined, ['a.ts'], now)).toBeUndefined();
    expect(ciLabelInput(pr({ status: 'open', mergedAt: null }), ['a.ts'], now)).toBeUndefined();
  });

  it('has no input when no concluded CI run was ever observed on the merge', () => {
    expect(ciLabelInput(pr({ mergeDeployment: null }), ['a.ts'], now)).toBeUndefined();
    expect(ciLabelInput(pr({ buildStatus: 'pending' }), ['a.ts'], now)).toBeUndefined();
    expect(ciLabelInput(pr({ buildStatus: null }), ['a.ts'], now)).toBeUndefined();
  });

  it('maps a green merge to the one concluded run, dated from the deployment, never updated_at', () => {
    const input = ciLabelInput(pr({ updatedAt: d('2026-10-09T00:00:00Z') }), ['a.ts'], now);
    expect(input).toEqual({
      merge: { commitSha: 'beef1234', mergedAt: '2026-10-02T00:00:00.000Z' },
      ciRuns: [{ commitSha: 'beef1234', at: '2026-10-02T00:05:00.000Z', conclusion: 'success' }],
      changedPaths: ['a.ts'],
      now: now.toISOString(),
    });
  });

  it('keeps the first post-merge failure visible after a later green', () => {
    const input = ciLabelInput(pr({ updatedAt: d('2026-10-04T00:00:00Z'), buildStatus: 'success', mergeDeployment: { at: d('2026-10-02T00:05:00Z'), failed: true } }), [], now);
    expect(input?.ciRuns).toEqual([{ commitSha: 'beef1234', at: '2026-10-02T00:05:00.000Z', conclusion: 'failure' }]);
  });

  it('never dates the run before the merge (deployment written a moment earlier)', () => {
    const input = ciLabelInput(pr({ mergeDeployment: { at: d('2026-10-01T23:59:59Z'), failed: true } }), [], now);
    expect(input?.ciRuns[0]?.at).toBe('2026-10-02T00:00:00.000Z');
  });
});

describe('reviewLabelInput', () => {
  it('maps PRD 23 sign-offs from the PR\'s life to reviews, oldest first', () => {
    const input = reviewLabelInput(pr({ status: 'open', mergedAt: null }), [
      { verdict: 'approved', createdAt: d('2026-10-05T00:00:00Z') },
      { verdict: 'changes_requested', createdAt: d('2026-10-03T00:00:00Z') },
      { verdict: 'waived', createdAt: d('2026-10-04T00:00:00Z') },
      { verdict: 'changes_requested', createdAt: d('2026-09-01T00:00:00Z') },
    ], now);
    expect(input.pr).toEqual({ number: 42 });
    expect(input.reviews).toEqual([
      { state: 'changes_requested', at: '2026-10-03T00:00:00.000Z' },
      { state: 'approved', at: '2026-10-05T00:00:00.000Z' },
    ]);
  });

  it('closes the PR at its merge', () => {
    expect(reviewLabelInput(pr(), [], now).pr).toEqual({ number: 42, closedAt: '2026-10-02T00:00:00.000Z' });
  });
});
