/**
 * The safety rules for destroying an autonomous run's artifacts. These tests ARE
 * the specification: every refusal condition gets a case, because the whole point
 * of the decision function is that it says no.
 */
import { describe, it, expect } from 'vitest';
import {
  decideBranchTeardown, runCommitMarker,
  type BranchTeardownFacts,
} from './branchTeardownDecision';
import type { ListBranchCommitsResult } from '../repos/branchLifecycle';

const MARKER = runCommitMarker(12);

const runCommit = (sha: string, path = 'src/a.ts') => ({
  sha,
  message: `Add ${path} — task #12 (Coder)`,
  authorName: 'BuilderForce',
});

const okCommits = (...c: ReturnType<typeof runCommit>[]): ListBranchCommitsResult =>
  ({ ok: true, commits: c, truncated: false });

function facts(over: Partial<BranchTeardownFacts> = {}): BranchTeardownFacts {
  return {
    mode: 'teardown',
    branch: 'builderforce/task-12',
    defaultBranch: 'main',
    commits: okCommits(runCommit('aaa1111')),
    pullRequest: null,
    changedPaths: ['src/a.ts'],
    run: { writtenPaths: ['src/a.ts'], commitShas: ['aaa1111'] },
    runCommitMarker: MARKER,
    ...over,
  };
}

describe('decideBranchTeardown — allows', () => {
  it('tears down an abandoned run branch with only its own commits', () => {
    const d = decideBranchTeardown(facts());
    expect(d.safe).toBe(true);
    if (d.safe) {
      expect(d.branch).toBe('builderforce/task-12');
      expect(d.commits).toHaveLength(1);
      expect(d.closePrNumber).toBeNull();
    }
  });

  it('reverts a completed run and reports the PR to close', () => {
    const d = decideBranchTeardown(facts({ mode: 'revert', pullRequest: { number: 7, status: 'open' } }));
    expect(d.safe).toBe(true);
    if (d.safe) expect(d.closePrNumber).toBe(7);
  });

  it('normalises a refs/heads/ prefix rather than treating it as a different branch', () => {
    const d = decideBranchTeardown(facts({ branch: 'refs/heads/builderforce/task-12' }));
    expect(d.safe).toBe(true);
    if (d.safe) expect(d.branch).toBe('builderforce/task-12');
  });

  it('skips the branch-advanced check when the run recorded no shas', () => {
    const d = decideBranchTeardown(facts({
      mode: 'revert',
      commits: okCommits(runCommit('zzz9999')),
      run: { writtenPaths: ['src/a.ts'], commitShas: [] },
    }));
    expect(d.safe).toBe(true);
  });

  it('does not ask to close an already-closed PR', () => {
    const d = decideBranchTeardown(facts({ mode: 'revert', pullRequest: { number: 7, status: 'closed' } }));
    expect(d.safe).toBe(true);
    if (d.safe) expect(d.closePrNumber).toBeNull();
  });
});

describe('decideBranchTeardown — refuses', () => {
  it('branch_is_default: the branch IS the default branch', () => {
    const d = decideBranchTeardown(facts({ branch: 'main' }));
    expect(d).toMatchObject({ safe: false, refusal: 'branch_is_default' });
  });

  it('branch_is_default: case-insensitively', () => {
    const d = decideBranchTeardown(facts({ branch: 'MAIN' }));
    expect(d).toMatchObject({ safe: false, refusal: 'branch_is_default' });
  });

  it('branch_is_default: no branch was recorded at all', () => {
    const d = decideBranchTeardown(facts({ branch: '   ' }));
    expect(d).toMatchObject({ safe: false, refusal: 'branch_is_default' });
  });

  it('provider_unsupported: the provider cannot list commits', () => {
    const d = decideBranchTeardown(facts({
      commits: { ok: false, code: 'unsupported', reason: "not implemented for provider 'bitbucket-server'" },
    }));
    expect(d).toMatchObject({ safe: false, refusal: 'provider_unsupported' });
  });

  it('commits_unverifiable: the commit listing errored', () => {
    const d = decideBranchTeardown(facts({
      commits: { ok: false, code: 'provider_error', reason: 'github 500: boom' },
    }));
    expect(d).toMatchObject({ safe: false, refusal: 'commits_unverifiable' });
  });

  it('commits_unverifiable: the commit listing was truncated', () => {
    const d = decideBranchTeardown(facts({
      commits: { ok: true, commits: [runCommit('aaa1111')], truncated: true },
    }));
    expect(d).toMatchObject({ safe: false, refusal: 'commits_unverifiable' });
  });

  it('commits_unverifiable: the revert diff could not be read', () => {
    const d = decideBranchTeardown(facts({ mode: 'revert', changedPaths: null }));
    expect(d).toMatchObject({ safe: false, refusal: 'commits_unverifiable' });
  });

  it('branch_missing: nothing was ever committed ahead of base', () => {
    const d = decideBranchTeardown(facts({ commits: okCommits() }));
    expect(d).toMatchObject({ safe: false, refusal: 'branch_missing' });
  });

  it('open_pull_request: teardown never removes a branch under review', () => {
    const d = decideBranchTeardown(facts({ pullRequest: { number: 7, status: 'open' } }));
    expect(d).toMatchObject({ safe: false, refusal: 'open_pull_request' });
  });

  it('open_pull_request: a draft PR counts as under review', () => {
    const d = decideBranchTeardown(facts({ pullRequest: { number: 7, status: 'draft' } }));
    expect(d).toMatchObject({ safe: false, refusal: 'open_pull_request' });
  });

  it('pull_request_merged: refuses in revert mode — the work already landed', () => {
    const d = decideBranchTeardown(facts({ mode: 'revert', pullRequest: { number: 7, status: 'merged' } }));
    expect(d).toMatchObject({ safe: false, refusal: 'pull_request_merged' });
    if (!d.safe) expect(d.reason).toContain('already merged');
  });

  it('pull_request_merged: refuses in teardown mode too', () => {
    const d = decideBranchTeardown(facts({ pullRequest: { number: 7, status: 'merged' } }));
    expect(d).toMatchObject({ safe: false, refusal: 'pull_request_merged' });
  });

  it('foreign_commits: a human commit on the branch blocks everything', () => {
    const d = decideBranchTeardown(facts({
      commits: okCommits(runCommit('aaa1111'), { sha: 'bbb2222', message: 'hotfix: prod is down', authorName: 'Sean' }),
    }));
    expect(d).toMatchObject({ safe: false, refusal: 'foreign_commits' });
    if (!d.safe) expect(d.reason).toContain('bbb2222');
  });

  it("foreign_commits: another TASK's agent commit is foreign too", () => {
    const d = decideBranchTeardown(facts({
      commits: okCommits(runCommit('aaa1111'), { sha: 'ccc3333', message: 'Add x.ts — task #99 (Coder)', authorName: 'BuilderForce' }),
    }));
    expect(d).toMatchObject({ safe: false, refusal: 'foreign_commits' });
  });

  it('branch_advanced: the branch moved past the recorded shas', () => {
    const d = decideBranchTeardown(facts({
      mode: 'revert',
      commits: okCommits(runCommit('aaa1111'), runCommit('ddd4444')),
      run: { writtenPaths: ['src/a.ts'], commitShas: ['aaa1111'] },
    }));
    expect(d).toMatchObject({ safe: false, refusal: 'branch_advanced' });
  });

  it('foreign_paths: the branch touched a path the run never wrote', () => {
    const d = decideBranchTeardown(facts({
      mode: 'revert',
      changedPaths: ['src/a.ts', 'infra/secrets.tf'],
    }));
    expect(d).toMatchObject({ safe: false, refusal: 'foreign_paths' });
    if (!d.safe) expect(d.reason).toContain('infra/secrets.tf');
  });

  it('checks the default branch BEFORE anything else', () => {
    // Even with otherwise-unverifiable evidence, the default-branch rule wins —
    // ordering matters so an unsafe input can never fall through to a looser rule.
    const d = decideBranchTeardown(facts({
      branch: 'main',
      commits: { ok: false, code: 'provider_error', reason: 'boom' },
    }));
    expect(d).toMatchObject({ safe: false, refusal: 'branch_is_default' });
  });
});

describe('runCommitMarker', () => {
  it('is task-scoped so another task cannot pass as this run', () => {
    expect(runCommitMarker(12)).toBe('— task #12 (');
    expect('Add a.ts — task #123 (Coder)'.includes(runCommitMarker(12))).toBe(false);
  });
});
