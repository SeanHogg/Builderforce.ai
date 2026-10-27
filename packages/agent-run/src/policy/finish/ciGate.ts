/**
 * policy/finish/ciGate.ts — the pure finish-gate for branch CI, ported from
 * `api/src/application/ci/pollCommitCiStatus.ts` (`ciFinishDecision`).
 *
 * The Worker has no shell, so it cannot `npm test`. What it CAN poll is the branch
 * HEAD's combined commit status / check-runs — the same HTTP a PR's CI light uses.
 * This module is the DECISION half: given a CI verdict and the run's block counters,
 * does finish wait or ship? Polling the provider stays on the host (the port).
 *
 * Failure and pending block up to a cap so a repo with no checks, a flaky pipeline, or
 * a PR-only workflow cannot deadlock the run; automerge-on-green still waits after we
 * relent. Never throws.
 *
 * No `node:*` imports, no DOM.
 */

/** Cap on finish attempts blocked because branch CI is still running. Durable ticks are
 *  one LLM call each, so waiting forever would burn the run. */
export const MAX_CI_PENDING_FINISH_BLOCKS = 2;
/** Cap on finish attempts blocked because branch CI is red. Automerge-on-green and the
 *  webhook auto-fix loop remain the backstop after we relent. */
export const MAX_CI_FAILURE_FINISH_BLOCKS = 3;

export type CommitCiStatus = "success" | "failure" | "pending" | "none";

/** What the host's CI poll produced for the branch HEAD. */
export interface CommitCiVerdict {
  status: CommitCiStatus;
  sha: string;
  count: number;
  failed: string[];
  url?: string | null;
}

export interface CiFinishState {
  pendingBlocks: number;
  failureBlocks: number;
}

export interface CiFinishDecision {
  block: string | null;
  ciVerified: boolean;
  pendingBlocks: number;
  failureBlocks: number;
}

function shortSha(sha: string): string {
  return sha ? sha.slice(0, 7) : "HEAD";
}

function formatSummary(status: CommitCiStatus, sha: string, count: number, failed: string[]): string {
  const short = shortSha(sha);
  if (status === "none") return `No CI checks on ${short} yet.`;
  if (status === "success") return `CI green on ${short} (${count} check(s)).`;
  if (status === "pending") return `CI pending on ${short} (${count} check(s)).`;
  return `CI failed on ${short} (${count} check(s))${failed.length ? `: ${failed.join(", ")}` : ""}.`;
}

/**
 * Pure finish-gate for branch CI. `success` keeps the counters and marks the run CI
 * verified; a `failure` or `pending` under its cap blocks with a corrective message and
 * spends one allowance; past the cap it relents (`ciVerified: false`, block null) so a
 * broken pipeline cannot deadlock the run.
 */
export function ciFinishDecision(ci: CommitCiVerdict, state: CiFinishState): CiFinishDecision {
  const keep = { pendingBlocks: state.pendingBlocks, failureBlocks: state.failureBlocks };
  if (ci.status === "success") {
    return { block: null, ciVerified: true, ...keep };
  }
  if (ci.status === "failure" && state.failureBlocks < MAX_CI_FAILURE_FINISH_BLOCKS) {
    const failed = ci.failed.length ? `\nFailed: ${ci.failed.join(", ")}` : "";
    const url = ci.url ? `\n${ci.url}` : "";
    return {
      block:
        `Cannot finish — CI failed on ${shortSha(ci.sha)} (${ci.count} check(s)). ${formatSummary(ci.status, ci.sha, ci.count, ci.failed)}${failed}${url}\n`
        + "Fix the failures with write_file, then call run_checks and finish again. "
        + "Do not claim tests passed until run_checks reports CI success.",
      ciVerified: false,
      pendingBlocks: state.pendingBlocks,
      failureBlocks: state.failureBlocks + 1,
    };
  }
  if (ci.status === "pending" && state.pendingBlocks < MAX_CI_PENDING_FINISH_BLOCKS) {
    return {
      block:
        `Cannot finish — CI is still running on ${shortSha(ci.sha)} (${ci.count} check(s)). ${formatSummary(ci.status, ci.sha, ci.count, [])}\n`
        + "Call run_checks again shortly; do not claim tests passed until it reports success. "
        + "This executor has no shell — branch CI is the in-run build/type-check/test.",
      ciVerified: false,
      pendingBlocks: state.pendingBlocks + 1,
      failureBlocks: state.failureBlocks,
    };
  }
  return { block: null, ciVerified: false, ...keep };
}
