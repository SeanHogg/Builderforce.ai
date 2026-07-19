/**
 * branchTeardownDecision — THE one place the safety rules for destroying an
 * autonomous run's artifacts live.
 *
 * Two callers, one rulebook (deliberately not two copies):
 *   • terminal-state teardown — a run ended failed/cancelled without opening a PR,
 *     so its `builderforce/task-<id>` branch is residue to sweep;
 *   • revert — a human undoes a COMPLETED run: close its PR and delete its branch.
 *
 * The function is PURE. It takes already-gathered facts and returns a verdict, so
 * every refusal path is unit-testable without a provider. The caller gathers the
 * evidence (commit listing, branch diff, recorded PR row) and then does exactly
 * what this says — it never decides for itself.
 *
 * BIAS: refuse. A wrong delete here is unrecoverable — the branch is the only copy
 * of the run's work and, worse, may carry a human's commits. Every ambiguity
 * (unreadable commit list, truncated evidence, an unsupported provider) resolves
 * to a refusal, so the failure mode is leftover residue, which is recoverable, and
 * never destroyed work, which is not.
 */
import type { BranchCommit, ListBranchCommitsResult } from '../repos/branchLifecycle';

/** Why a teardown/revert was refused. Every value is surfaced verbatim to the
 *  caller (route → UI, and the tool-audit + activity records) so a refusal is
 *  always explainable without reading the server logs. */
export type TeardownRefusal =
  /** The branch to delete IS the repo's default/base branch (or is empty). */
  | 'branch_is_default'
  /** The provider cannot list commits (or delete branches) at all. */
  | 'provider_unsupported'
  /** The commit evidence could not be obtained, or was truncated — cannot prove
   *  the branch carries only this run's work. */
  | 'commits_unverifiable'
  /** No commits ahead of base — there is no branch/work to tear down. */
  | 'branch_missing'
  /** A pull request is open against the branch (teardown must not orphan it). */
  | 'open_pull_request'
  /** The pull request was already merged — its work is on the base branch now. */
  | 'pull_request_merged'
  /** The branch carries commits this run did not author. */
  | 'foreign_commits'
  /** The branch head moved past the last commit the run recorded. */
  | 'branch_advanced'
  /** The branch changed paths outside the set this run wrote. */
  | 'foreign_paths';

export type TeardownMode = 'teardown' | 'revert';

export interface BranchTeardownFacts {
  /** Which of the two callers is asking — see {@link TeardownMode}. */
  mode: TeardownMode;
  /** The branch the run committed to. */
  branch: string;
  /** The repo's default/base branch. NEVER deletable. */
  defaultBranch: string;
  /** Commits the branch carries ahead of `defaultBranch`, as gathered from the
   *  provider. Passed through as the provider result (not unwrapped) so this
   *  function — not the caller — decides what an error/truncation means. */
  commits: ListBranchCommitsResult;
  /** The pull request recorded for this run, or null if none was ever opened.
   *  `status` mirrors `pull_requests.status`: draft | open | merged | closed. */
  pullRequest: { number: number | null; status: string } | null;
  /** Paths the branch changed relative to base, or null when the diff could not
   *  be read. Only consulted in `revert` mode. */
  changedPaths: string[] | null;
  /** What the run itself recorded having done. */
  run: {
    /** `CloudLoopState.writtenPaths` — every path this run wrote. */
    writtenPaths: string[];
    /** Commit shas the run produced, when they were captured. An empty array
     *  means "not recorded", which disables the `branch_advanced` check (the
     *  authorship check still applies). */
    commitShas: string[];
  };
  /** Substring EVERY commit this run made carries in its message. Produced by
   *  `agentCommitMessage`, which appends `— task #<id> (<agent>)`, so the marker
   *  is task-scoped and a commit for a different task on the same branch reads as
   *  foreign. Supplied by the caller so this module stays free of message format. */
  runCommitMarker: string;
}

export type TeardownDecision =
  | {
      safe: true;
      /** The branch is safe to delete. */
      branch: string;
      /** The commits that will be destroyed — recorded in the audit trail. */
      commits: BranchCommit[];
      /** The PR to close first, if one is open. */
      closePrNumber: number | null;
    }
  | { safe: false; refusal: TeardownRefusal; reason: string };

const refuse = (refusal: TeardownRefusal, reason: string): TeardownDecision => ({ safe: false, refusal, reason });

function normalizeRef(ref: string): string {
  return ref.trim().replace(/^refs\/heads\//, '');
}

/**
 * Decide whether an autonomous run's branch may be destroyed.
 *
 * Rules, in evaluation order. The order matters: the cheapest and most absolute
 * prohibitions come first so an unsafe input can never fall through to a later
 * rule that happens to pass.
 *
 *  1. NEVER the default branch. Absolute, checked first, no override.
 *  2. NEVER when the provider can't support the operation — record the residue.
 *  3. NEVER on evidence we could not read or that was truncated.
 *  4. Nothing to do when the branch carries no commits.
 *  5. NEVER while a PR is open (teardown) — a teardown must not orphan a review.
 *  6. NEVER once the PR is merged (both modes) — the work is on the base branch,
 *     and deleting the branch would not undo it while closing the PR is impossible.
 *  7. NEVER when a commit on the branch was not authored by this run.
 *  8. (revert) NEVER when the branch head advanced past the run's last commit.
 *  9. (revert) NEVER when the branch touched a path outside what the run wrote.
 */
export function decideBranchTeardown(facts: BranchTeardownFacts): TeardownDecision {
  const branch = normalizeRef(facts.branch);
  const base = normalizeRef(facts.defaultBranch);

  // 1 — the default branch is never a run artifact. An empty branch name is
  //     treated the same way: we will not issue a delete we cannot name.
  if (!branch) return refuse('branch_is_default', 'no branch recorded for this run');
  if (!base || branch.toLowerCase() === base.toLowerCase()) {
    return refuse('branch_is_default', `refusing to delete '${branch}': it is the repository's default branch`);
  }

  // 2/3 — evidence. Without a verifiable commit list we cannot prove the branch
  //       holds only this run's work, so we do not touch it.
  if (!facts.commits.ok) {
    if (facts.commits.code === 'unsupported') {
      return refuse('provider_unsupported', `cannot verify '${branch}': ${facts.commits.reason}`);
    }
    return refuse('commits_unverifiable', `cannot verify the commits on '${branch}': ${facts.commits.reason}`);
  }
  if (facts.commits.truncated) {
    return refuse('commits_unverifiable', `'${branch}' carries more commits than can be verified in one page — refusing to delete on partial evidence`);
  }

  const commits = facts.commits.commits;
  // 4 — nothing was ever pushed (or the branch does not exist). Not an error, but
  //     also not a teardown: there is no artifact.
  if (commits.length === 0) {
    return refuse('branch_missing', `'${branch}' has no commits ahead of '${base}' — nothing to tear down`);
  }

  const pr = facts.pullRequest;
  const prStatus = (pr?.status ?? '').toLowerCase();

  // 6 — a merged PR is checked BEFORE the open-PR rule because it applies to both
  //     modes and is the more dangerous case: the run's work already landed on the
  //     base branch, so neither closing the PR nor deleting the branch undoes it.
  if (prStatus === 'merged') {
    return refuse('pull_request_merged', `pull request #${pr?.number ?? '?'} was already merged — its commits are on '${base}' and cannot be undone by deleting the branch`);
  }
  // 5 — teardown only. A revert is EXPECTED to close its own open PR; a teardown
  //     is an automatic sweep and must never remove a branch under active review.
  if (facts.mode === 'teardown' && (prStatus === 'open' || prStatus === 'draft')) {
    return refuse('open_pull_request', `pull request #${pr?.number ?? '?'} is still ${prStatus} against '${branch}' — refusing to delete a branch under review`);
  }

  // 7 — authorship. Every commit ahead of base must carry this run's marker.
  //     Anything else is somebody's (or another task's) work.
  const foreign = commits.filter((c) => !c.message.includes(facts.runCommitMarker));
  if (foreign.length > 0) {
    const sample = foreign.slice(0, 3).map((c) => `${c.sha.slice(0, 7)} "${(c.message.split('\n')[0] ?? '').slice(0, 60)}"`).join(', ');
    return refuse('foreign_commits', `'${branch}' carries ${foreign.length} commit(s) this run did not author (${sample}) — refusing to delete someone else's work`);
  }

  if (facts.mode === 'revert') {
    // 8 — the branch must be exactly where the run left it. A recorded sha set is
    //     the strongest signal available; when the run captured none, this check is
    //     skipped and rule 7 remains the guarantee.
    if (facts.run.commitShas.length > 0) {
      const recorded = new Set(facts.run.commitShas);
      const unrecorded = commits.filter((c) => !recorded.has(c.sha));
      if (unrecorded.length > 0) {
        return refuse('branch_advanced', `'${branch}' advanced by ${unrecorded.length} commit(s) after the run finished — refusing to revert a branch that moved`);
      }
    }

    // 9 — path containment. The diff must be a subset of what the run wrote; a
    //     path outside that set means something else edited this branch. An
    //     unreadable diff is an unverifiable revert, not a permissive one.
    if (facts.changedPaths === null) {
      return refuse('commits_unverifiable', `cannot read the file changes on '${branch}' — refusing to revert without knowing what would be discarded`);
    }
    const written = new Set(facts.run.writtenPaths);
    const outside = facts.changedPaths.filter((p) => !written.has(p));
    if (outside.length > 0) {
      return refuse('foreign_paths', `'${branch}' changed ${outside.length} path(s) this run never wrote (${outside.slice(0, 3).join(', ')}) — refusing to discard changes that are not the run's`);
    }
  }

  return {
    safe: true,
    branch,
    commits,
    // Only an actually-open PR needs closing. `closed` PRs are already in the
    // desired end state, and `merged` was refused above.
    closePrNumber: (prStatus === 'open' || prStatus === 'draft') && pr?.number != null ? pr.number : null,
  };
}

/** The commit-message marker every commit of a given task's run carries. Mirrors
 *  `agentCommitMessage` in cloudAgentEngine (`<verb> <path> — task #<id> (<agent>)`).
 *  Kept beside the rule that consumes it so the two cannot drift apart silently. */
export function runCommitMarker(taskId: number): string {
  return `— task #${taskId} (`;
}
