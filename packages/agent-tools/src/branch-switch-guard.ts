/**
 * `run_command` never switches the branch of a checkout that has uncommitted changes.
 *
 * `git checkout other` / `git switch -c x` over a dirty tree carries the person's pending
 * edits onto the other branch, or aborts half-way through. The publish tools already obey
 * this (`git_commit` with `branch` commits through a sibling worktree; `git_cleanup_merged`
 * refuses a dirty tree); this is the same rule for the raw shell. A command that switches
 * (`detectBranchSwitch`) is checked with `git status --porcelain` in the directory it would run
 * in: changes ⇒ refused with the way to do it instead; a clean tree, or a status that fails
 * (not a repository), ⇒ it runs as written.
 */

import { detectBranchSwitch, type BranchSwitch } from "./branch-switch.js";
import type { ToolContext } from "./tool.js";

/** How many changed paths the refusal names. */
const NAMED_PATHS = 3;

/** `git status --porcelain`, in `git -C <dir>` when the command names one (quoted only when that is safe). */
function statusCommand(found: BranchSwitch): string {
  const dir = found.dir;
  return dir && !/["$`\\\n]/.test(dir) ? `git -C "${dir}" status --porcelain` : "git status --porcelain";
}

/** The changed paths of a porcelain listing (`XY path`, `XY old -> new`). */
function changedPaths(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim().replace(/^"(.*)"$/, "$1"));
}

/** The refusal: what is pending, why the switch is not run, and the four ways to do it instead. */
export function branchSwitchRefusal(command: string, found: BranchSwitch, paths: readonly string[]): string {
  const named = paths.slice(0, NAMED_PATHS).join(", ");
  const more = paths.length > NAMED_PATHS ? `, and ${paths.length - NAMED_PATHS} more` : "";
  const branch = found.target && found.target !== "-" ? found.target : "<branch>";
  return (
    `Refused: \`${command}\` switches branches, but the working tree has ${paths.length} uncommitted change(s) (${named}${more}). ` +
    "Switching branches would carry them onto the other branch or abort mid-way, so branches are never switched over pending changes — the command was not run. Instead: " +
    "(a) to put this work on a branch, call git_commit with `branch` (it commits through a worktree; this checkout is never switched), then push / open_pull_request; " +
    `(b) to read another branch, use \`git show ${branch}:<path>\` or \`git diff ${branch}\`; ` +
    `(c) to work on another branch side by side, run \`git worktree add ../<repo>-${branch}-wt ${branch}\` (\`git worktree add -b ${branch} ../<repo>-${branch}-wt\` to create it) and run your commands there; ` +
    "(d) to discard a file's edits, use `git restore <path>` (a bare `git checkout <x>` is read as a branch switch)."
  );
}

/**
 * The refusal for a branch switch over uncommitted changes, or undefined to run the command.
 * `dir` is the directory the command would run in (undefined = the shell's own).
 */
export async function refuseBranchSwitchOverChanges(command: string, dir: string | undefined, ctx: ToolContext): Promise<string | undefined> {
  const found = detectBranchSwitch(command);
  if (!found) return undefined;
  const status = await ctx.caps.shell!.run(statusCommand(found), { ...(dir ? { cwd: dir } : {}), ...(ctx.signal ? { signal: ctx.signal } : {}), fresh: true });
  if (!status.ok || (status.exitCode ?? 0) !== 0) return undefined; // not a repository (or no answer): git decides
  const paths = changedPaths(status.stdout ?? "");
  return paths.length > 0 ? branchSwitchRefusal(command, found, paths) : undefined;
}
