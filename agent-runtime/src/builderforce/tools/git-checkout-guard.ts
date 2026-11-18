/**
 * Guard against switching the branch of a checkout that has pending changes.
 *
 * Rule: a workflow never runs `git checkout -b` over someone's uncommitted
 * edits — git would carry them onto the new branch and a later `add -A` would
 * sweep them into the workflow's commit and push them. The workflow's agents
 * edit their configured agent workspace, not a per-call root, so they cannot be
 * redirected into a worktree: a dirty checkout is refused, and the person
 * commits or stashes first, or points the agent workspace at a clean checkout.
 *
 * The pending paths come from THE porcelain reader and are phrased by THE
 * pending-changes summary `run_command`'s refusal uses (`@builderforce/agent-tools`).
 */

import { pendingChangesSummary } from "@builderforce/agent-tools";

/** Refusal text for a dirty checkout; names up to three of the pending paths. */
export function dirtyCheckoutRefusal(root: string, pending: readonly string[]): string {
  return (
    `The checkout at ${root} has ${pendingChangesSummary(pending)}. ` +
    "The workflow will not switch branches over them. Commit or stash them first, " +
    "or point the agent workspace at a clean checkout (`agents.defaults.workspace`, or the agent's own `workspace` in its agents entry)."
  );
}
