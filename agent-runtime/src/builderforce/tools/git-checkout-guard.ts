/**
 * Guard against switching the branch of a checkout that has pending changes.
 *
 * Rule: a workflow never runs `git checkout -b` over someone's uncommitted
 * edits — git would carry them onto the new branch and a later `add -A` would
 * sweep them into the workflow's commit and push them. A dirty checkout is
 * refused with a message pointing at a worktree instead.
 */

import path from "node:path";
import { runExec } from "../../process/exec.js";

/** Paths with pending changes at `root` (staged, unstaged or untracked). */
export async function listPendingChanges(root: string): Promise<string[]> {
  const { stdout } = await runExec("git", ["-C", root, "status", "--porcelain"], {
    timeoutMs: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());
}

/** Refusal text for a dirty checkout; names up to three of the pending paths. */
export function dirtyCheckoutRefusal(root: string, branch: string, pending: string[]): string {
  const named = pending.slice(0, 3).join(", ");
  const more = pending.length > 3 ? `, and ${pending.length - 3} more` : "";
  const repoDir = path.basename(path.resolve(root));
  const wtDir = `../${repoDir}-${branch.replace(/\//g, "-")}-wt`;
  return (
    `The checkout at ${root} has ${pending.length} uncommitted change${pending.length === 1 ? "" : "s"} ` +
    `(${named}${more}). The workflow will not switch branches over them. ` +
    `Commit or stash them, or run the workflow from a worktree: ` +
    `git worktree add ${wtDir} -b ${branch}`
  );
}
