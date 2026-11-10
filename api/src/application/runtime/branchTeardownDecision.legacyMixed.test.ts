/**
 * M-A — the rollback snapshot records EVERY commit ahead of base on the shared task branch, so
 * a per-run run's snapshot can include an earlier legacy run's commits. The legacy marker is
 * accepted only when the run itself is entirely legacy (no listed commit carries the per-run
 * marker); otherwise a recorded legacy commit is another run's work and stays foreign.
 */
import { describe, expect, it } from 'vitest';
import { decideBranchTeardown, runCommitMarker, type BranchTeardownFacts } from './branchTeardownDecision';

const legacyCommit = (sha: string) => ({ sha, message: 'Add src/a.ts — task #12 (Coder)', authorName: 'BuilderForce' });
const perRunCommit = (sha: string, executionId: number) => ({
  sha, message: `Add src/a.ts — task #12 · run #${executionId} (Coder)`, authorName: 'BuilderForce',
});

function revertFacts(over: Partial<BranchTeardownFacts> = {}): BranchTeardownFacts {
  return {
    mode: 'revert',
    branch: 'builderforce/task-12',
    defaultBranch: 'main',
    commits: { ok: true, commits: [legacyCommit('old0001'), perRunCommit('new0002', 345)], truncated: false },
    pullRequest: { number: 7, status: 'open' },
    changedPaths: ['src/a.ts'],
    run: { writtenPaths: ['src/a.ts'], commitShas: ['old0001', 'new0002'] },
    runCommitMarker: runCommitMarker(12, 345),
    legacyRunCommitMarker: runCommitMarker(12),
    ...over,
  };
}

describe('decideBranchTeardown — legacy acceptance needs an entirely-legacy run', () => {
  it('a per-run run whose snapshot swept up an earlier legacy commit refuses foreign_commits', () => {
    const d = decideBranchTeardown(revertFacts());
    expect(d.safe).toBe(false);
    if (!d.safe) expect(d.refusal).toBe('foreign_commits');
  });

  it('an entirely-legacy run with every commit recorded stays revertable', () => {
    const d = decideBranchTeardown(revertFacts({
      commits: { ok: true, commits: [legacyCommit('old0001'), legacyCommit('old0002')], truncated: false },
      run: { writtenPaths: ['src/a.ts'], commitShas: ['old0001', 'old0002'] },
    }));
    expect(d.safe).toBe(true);
  });
});
