/**
 * `run_command` never switches the branch of a checkout that has uncommitted changes.
 *
 * `git checkout other` / `git switch -c x` over a dirty tree carries the person's pending
 * edits onto the other branch, or aborts half-way through. The publish tools already obey
 * this (`git_commit` with `branch` commits through a sibling worktree; `git_cleanup_merged`
 * refuses a dirty tree); this is the same rule for the raw shell. A command that switches
 * (`detectBranchSwitch`) is checked with `git status --porcelain` in the checkout it would
 * switch: changes ⇒ refused with the way to do it instead; a clean tree, or a status that
 * fails (not a repository), ⇒ it runs as written. A bare `git checkout <x>` whose `<x>` names
 * no commit (locally or as a remote branch git would track) is a file restore, and runs.
 * A checkout whose directory cannot be named to git safely (`~`, shell metacharacters) cannot
 * be verified clean, so the switch is refused — fail closed.
 */

import { detectBranchSwitch, type BranchSwitch } from "./branch-switch.js";
import { parsePorcelainPaths, pendingChangesSummary } from "./git-status.js";
import type { ShellResult } from "./capabilities.js";
import type { ToolContext } from "./tool.js";
import { worktreePathFor } from "./worktree-path.js";

/** Characters a double-quoted argument cannot carry safely across bash, cmd.exe and PowerShell. */
const UNSAFE = /["$`%!\n\r]/;

/** `-C "<dir>" ` for git (`\` → `/`), `""` for the shell's own directory, or null when it cannot be named safely. */
function gitDirArg(dir: string | undefined): string | null {
  if (dir === undefined) return "";
  const normal = dir.replace(/\\/g, "/");
  if (normal.startsWith("~") || UNSAFE.test(normal)) return null;
  return `-C "${normal}" `;
}

/** The refusal: what is pending, why the switch is not run, and the ways to do it instead. */
export function branchSwitchRefusal(command: string, found: BranchSwitch, paths: readonly string[]): string {
  const branch = found.target && found.target !== "-" ? found.target : "<branch>";
  return (
    `Refused: \`${command}\` switches branches, but the working tree has ${pendingChangesSummary(paths)}. ` +
    "Switching branches would carry them onto the other branch or abort mid-way, so branches are never switched over pending changes — the command was not run. Instead: " +
    "(a) to put this work on a branch, call git_commit with `branch` (it commits through a worktree; this checkout is never switched), then push / open_pull_request; " +
    `(b) to read another branch, use \`git show ${branch}:<path>\` or \`git diff ${branch}\`; ` +
    `(c) to work on another branch side by side, run \`git worktree add ${worktreePathFor(branch)} ${branch}\` from the repository's top level (\`git worktree add -b ${branch} ${worktreePathFor(branch)}\` to create it) and run your commands there; ` +
    "(d) to discard a file's edits, use `git restore <path>` (a bare `git checkout <x>` is read as a branch switch when `<x>` names a commit). " +
    "If this command commits or stashes first, run that part on its own, then the switch."
  );
}

/** The refusal when the checkout the switch would affect cannot be checked. */
function unverifiableRefusal(command: string, dir: string): string {
  return (
    `Refused: \`${command}\` switches branches in \`${dir}\`, which could not be verified clean (that directory cannot be passed to git safely) — the command was not run. ` +
    "Pass the checkout as `cwd` (relative to the workspace root) and run the git command without `cd` / `-C`, so its working tree can be checked first."
  );
}

const succeeded = (r: ShellResult): boolean => r.ok && (r.exitCode ?? 0) === 0;
/** git gave NO answer: the host stopped it (timeout, output over its buffer, Stop) before an exit code. */
const unanswered = (r: ShellResult): boolean => !r.ok && r.exitCode === undefined;

/** The refusal when the checkout's state could not be read at all. */
function unreadableRefusal(command: string, why: string | undefined): string {
  return (
    `Refused: \`${command}\` switches branches, but this checkout's state could not be read (${why ?? "git timed out or its output was too large"}), so it could not be verified clean — the command was not run. ` +
    "Pass the checkout as `cwd` and retry, or commit (git_commit with `branch`) first."
  );
}

/** Does `target` name a commit — a local ref/sha, or a remote branch `git checkout` would track?
 *  Judged on WHAT git printed, not on "something was printed": a host that reports an empty stdout
 *  as `(no output)` must not turn "no such ref" into a ref. */
async function namesCommit(git: (args: string) => Promise<ShellResult>, target: string): Promise<boolean> {
  if (UNSAFE.test(target)) return true; // cannot ask: treat it as the branch it looks like
  const sha = await git(`rev-parse --verify --quiet "${target}^{commit}"`);
  if (unanswered(sha)) return true; // no answer is not "a path": refuse
  if (succeeded(sha) && /^[0-9a-f]{7,64}\r?$/m.test(sha.stdout ?? "")) return true;
  const remote = await git(`for-each-ref --count=1 "--format=%(refname)" "refs/remotes/*/${target}"`);
  if (unanswered(remote)) return true;
  return succeeded(remote) && /^refs\/remotes\//m.test(remote.stdout ?? "");
}

/**
 * The refusal for a branch switch over uncommitted changes, or undefined to run the command.
 * `dir` is the directory the command would run in (undefined = the shell's own).
 */
export async function refuseBranchSwitchOverChanges(command: string, dir: string | undefined, ctx: ToolContext): Promise<string | undefined> {
  const found = detectBranchSwitch(command);
  if (!found) return undefined;
  const at = gitDirArg(found.dir);
  if (at === null) return unverifiableRefusal(command, found.dir ?? "");
  const opts = { ...(dir ? { cwd: dir } : {}), ...(ctx.signal ? { signal: ctx.signal } : {}), fresh: true };
  const git = (args: string): Promise<ShellResult> => ctx.caps.shell!.run(`git ${at}${args}`, opts);
  // `--branch` puts a `## …` header FIRST, so a host that trims its output trims the header, never
  // the first entry's leading blank (the parser copes either way).
  const status = await git("status --porcelain --branch");
  if (unanswered(status)) return unreadableRefusal(command, status.error); // fail closed
  if (!succeeded(status)) return undefined; // a real non-zero exit (128: not a repository): git decides
  const paths = parsePorcelainPaths(status.stdout ?? "");
  if (paths.length === 0) return undefined;
  if (found.ambiguous && found.target && !(await namesCommit(git, found.target))) return undefined; // a path: a restore
  return branchSwitchRefusal(command, found, paths);
}
