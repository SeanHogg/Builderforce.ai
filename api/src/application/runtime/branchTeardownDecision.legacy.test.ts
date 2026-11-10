/**
 * H4 — a run snapshotted BEFORE per-run commit subjects (`— task #N (Agent)`, no `· run #`)
 * stays revertable: in REVERT mode a commit carrying the legacy per-task marker is the run's
 * own when, and only when, the snapshot recorded its exact sha. Teardown never accepts it,
 * and nothing about the legacy marker may match another task or a sha prefix.
 */
import { describe, expect, it } from 'vitest';
import { decideBranchTeardown, runCommitMarker, type BranchTeardownFacts } from './branchTeardownDecision';
import type { ListBranchCommitsResult } from '../repos/branchLifecycle';

const legacyCommit = (sha: string, taskId = 12, path = 'src/a.ts') => ({
  sha, message: `Add ${path} — task #${taskId} (Coder)`, authorName: 'BuilderForce',
});
const perRunCommit = (sha: string, executionId: number, path = 'src/a.ts') => ({
  sha, message: `Add ${path} — task #12 · run #${executionId} (Coder)`, authorName: 'BuilderForce',
});
const listed = (...commits: Array<{ sha: string; message: string; authorName: string }>): ListBranchCommitsResult =>
  ({ ok: true, commits, truncated: false });

function revertFacts(over: Partial<BranchTeardownFacts> = {}): BranchTeardownFacts {
  return {
    mode: 'revert',
    branch: 'builderforce/task-12',
    defaultBranch: 'main',
    commits: listed(legacyCommit('aaa1111')),
    pullRequest: { number: 7, status: 'open' },
    changedPaths: ['src/a.ts'],
    run: { writtenPaths: ['src/a.ts'], commitShas: ['aaa1111'] },
    runCommitMarker: runCommitMarker(12, 345),
    legacyRunCommitMarker: runCommitMarker(12),
    ...over,
  };
}

const refusalOf = (facts: BranchTeardownFacts) => {
  const d = decideBranchTeardown(facts);
  return d.safe ? null : d.refusal;
};

describe('decideBranchTeardown — legacy per-task commits (revert only)', () => {
  it('reverts a run whose recorded commits carry the legacy per-task marker', () => {
    const d = decideBranchTeardown(revertFacts());
    expect(d.safe).toBe(true);
    if (d.safe) expect(d.closePrNumber).toBe(7);
  });

  it('teardown keeps refusing legacy commits, recorded or not', () => {
    expect(refusalOf(revertFacts({ mode: 'teardown', pullRequest: null }))).toBe('foreign_commits');
  });

  it('a retried task: the earlier run\'s legacy commits (not in this snapshot) stay foreign', () => {
    const commits = listed(legacyCommit('old0001'), perRunCommit('new0002', 345));
    expect(refusalOf(revertFacts({ commits, run: { writtenPaths: ['src/a.ts'], commitShas: ['new0002'] } }))).toBe('foreign_commits');
  });

  it('a legacy commit is foreign without a recorded sha set at all', () => {
    expect(refusalOf(revertFacts({ run: { writtenPaths: ['src/a.ts'], commitShas: [] } }))).toBe('foreign_commits');
  });

  it('task #1\'s legacy marker never matches task #12\'s commits', () => {
    expect(refusalOf(revertFacts({ legacyRunCommitMarker: runCommitMarker(1), runCommitMarker: runCommitMarker(1, 345) }))).toBe('foreign_commits');
  });

  it('task #12\'s legacy marker never matches a per-run commit of another run', () => {
    const commits = listed(perRunCommit('aaa1111', 999));
    expect(refusalOf(revertFacts({ commits }))).toBe('foreign_commits');
  });

  it('a recorded sha PREFIX does not make a legacy commit the run\'s own', () => {
    const commits = listed(legacyCommit('aaa1111bbbb2222'));
    expect(refusalOf(revertFacts({ commits, run: { writtenPaths: ['src/a.ts'], commitShas: ['aaa1111'] } }))).toBe('foreign_commits');
  });

  it('without the legacy marker supplied, a legacy commit is foreign (the old behaviour)', () => {
    expect(refusalOf(revertFacts({ legacyRunCommitMarker: undefined }))).toBe('foreign_commits');
  });
});
