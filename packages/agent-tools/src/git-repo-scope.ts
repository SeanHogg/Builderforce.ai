/**
 * WHERE a git command runs — the repo scope every git tool shares (split from
 * `git-tools.ts`, which is the tools themselves).
 *
 * A workspace root is not always a repository: a folder holding several checkouts side by
 * side has its `.git` one level down. So a git call with no explicit `repo` is tried, in
 * order: at the root; in the checkout its `path` starts with; in the run's DEFAULT
 * checkout (`ShellCapability.defaultRepo`, resolved once per run by the surface — PRD 35
 * E3). Once a shell has answered "not a git repository" at its root, a run that has a
 * default goes there directly (the verdict is cached per shell). If nothing is a
 * repository, the failure names the candidate checkouts instead of git's bare fatal.
 *
 * Pure apart from that per-shell verdict; the command TEXT stays in `git-tools.ts`.
 */

import type { ToolResult } from "./tool.js";

/** A safe git ref/path token — blocks shell metacharacters so a model-supplied
 *  branch/path can't inject a second command. */
export function safeGitArg(v: unknown): string | null {
  return typeof v === "string" && /^[\w./@-]+$/.test(v) ? v : null;
}

/**
 * The validated `repo` subdirectory, or null.
 *
 * Held to a stricter rule than the other args: it becomes the target of a `cd`, so a
 * `..` segment would walk OUT of the workspace rather than merely widening a diff.
 * `safeGitArg` permits dots (a directory really can be named `Builderforce.ai`), so
 * traversal is rejected separately here — the one place it would actually escape.
 */
export function safeRepoArg(repo: unknown): string | null {
  const arg = safeGitArg(repo);
  return arg && !arg.split(/[\\/]/).includes("..") && !arg.startsWith("/") ? arg : null;
}

/**
 * Infer a `repo` subdirectory from a workspace-relative `path`.
 *
 * File tools speak in workspace-root paths (`Builderforce.ai/packages/…`). When the
 * open folder CONTAINS checkouts rather than being one, that first segment is the
 * checkout — but only when there is a nested path to take a segment FROM (a bare
 * `README.md` is a file, not a repo). `..` / absolute segments are rejected by
 * {@link safeRepoArg}.
 */
export function inferRepoFromPath(path?: string): string | null {
  if (typeof path !== "string" || !path.trim()) return null;
  const parts = path.split(/[\\/]/).filter((s) => s.length > 0 && s !== ".");
  if (parts.length < 2) return null;
  return safeRepoArg(parts[0]);
}

/**
 * POSIX one-liner that prints top-level checkout directory names, one per line.
 *
 * `$d` from a directory glob (`foo/`) so `$d.git` is `foo/.git` (a directory, or a file
 * for a worktree/submodule). Routed to bash on Windows the same way the other multi-line
 * git scripts are (`[ … ]` is a POSIX-only form).
 */
export function buildListCheckoutsCommand(): string {
  return 'for d in */; do [ -e "$d.git" ] && printf "%s\\n" "${d%/}"; done';
}

function parseCheckoutList(stdout?: string): string[] {
  if (!stdout) return [];
  const names: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const name = line.trim().replace(/\/+$/, "");
    if (!name || name === "*" || name === "." || name === "..") continue;
    const safe = safeRepoArg(name);
    if (safe) names.push(safe);
  }
  return names;
}

/**
 * The remedy for "fatal: not a git repository", shared by every git tool.
 *
 * Returning git's raw fatal is what makes this look like the end of the road. It happens
 * routinely when the OPEN FOLDER holds several checkouts side by side (`/code/`, with
 * `/code/app` and `/code/api` each a repo): git runs at the root, finds no `.git`, and
 * the agent — handed a bare fatal with no next step — concludes the tool is unusable and
 * gives up, or asks the user a question it could have answered itself.
 *
 * So the failure carries its own remedy: name the candidate checkouts that ARE sitting
 * at the top level, and show the exact retry with `repo`. Do not send the model to
 * `list_files` — that is a round trip it already failed to take (chat #141).
 */
export function notARepoResult(action: string, candidates: string[] = []): ToolResult {
  const named = candidates.filter(Boolean);
  const extra = named.length
    ? `Candidate repositories: ${named.map((c) => `"${c}"`).join(", ")}. Re-run this tool with \`repo\` set to the one holding the code you are working on (e.g. { "repo": "${named[0]}" }).`
    : "No git checkouts were found at the top level of the open folder. File edits still work; only the git tools need a repository.";
  return {
    data: {
      ok: false,
      action,
      error:
        "not a git repository at the workspace root — this usually means the open folder CONTAINS the repositories rather than being one (several checkouts side by side). "
        + extra,
      ...(named.length ? { candidates: named } : {}),
    },
  };
}

export type GitShellCtx = {
  caps: { shell?: { run(c: string, opts?: { signal?: AbortSignal; cwd?: string }): Promise<{ ok: boolean; stdout?: string; exitCode?: number; error?: string }>; trackedBranch?: string; defaultRepo?: string } };
  /** The call's Stop (`ToolContext.signal`): a git command in flight is killed with the run. */
  signal?: AbortSignal;
};

/**
 * Run one command through the call's shell WITH the call's Stop (`ToolContext.signal`,
 * PRD 35 E10): a hung `git push`, an analyzer or a build dies with the run instead of
 * holding it to the shell's timeout. `cwd` is the (validated, workspace-relative) directory the
 * command runs in — handed to the shell as an option, never prefixed to the command. Neither a
 * signal nor a cwd ⇒ the shell is called exactly as before.
 * The one way a tool runs a shell command.
 */
export function shellRunWithStop<R>(
  ctx: { caps: { shell?: { run(c: string, opts?: { signal?: AbortSignal; cwd?: string }): Promise<R> } }; signal?: AbortSignal },
  command: string,
  cwd?: string,
): Promise<R> {
  const shell = ctx.caps.shell!;
  const opts = { ...(ctx.signal ? { signal: ctx.signal } : {}), ...(cwd ? { cwd } : {}) };
  return Object.keys(opts).length > 0 ? shell.run(command, opts) : shell.run(command);
}

/** The run's resolved default checkout (`ShellCapability.defaultRepo`), validated — the
 *  retry a not-a-repo result takes before it falls back to naming the candidates. */
function defaultRepoOf(ctx: GitShellCtx): string | null {
  return safeRepoArg(ctx.caps.shell?.defaultRepo);
}

/** A workspace-relative path re-expressed inside `repo` (`app/src/x.ts` → `src/x.ts`). */
function pathInRepo(path: string | undefined, repo: string): string | undefined {
  if (!path) return path;
  const inner = commitPathCandidates(path, repo);
  return inner.length > 0 ? inner[inner.length - 1] : undefined;
}

export async function notARepoWithCandidates(action: string, ctx: GitShellCtx): Promise<ToolResult> {
  const listed = await shellRunWithStop(ctx, buildListCheckoutsCommand());
  return notARepoResult(action, parseCheckoutList(listed.stdout));
}

/** git's own wording when the working directory has no repository above it. */
const NOT_A_REPO = /not a git repository/i;

export function isNotARepo(r: { stdout?: string; error?: string }): boolean {
  return NOT_A_REPO.test(`${r.stdout ?? ""} ${r.error ?? ""}`);
}

/**
 * The paths a commit should TRY for one path the model supplied, best guess first.
 *
 * `paths` are documented as repo-relative, but the model reads and edits through the
 * FILE tools, whose paths are relative to the workspace ROOT — and when the workspace
 * contains checkouts rather than being one, those two are different. A real run passed
 * `api/src/…` with `repo` scoping git into the `api` directory and git answered
 * `warning: could not open directory 'api/api/src/…'`, staged nothing, and the commit
 * was reported as "nothing to commit" — a wrong-path failure wearing an empty-diff
 * message.
 *
 * Rather than rewriting the path and hoping, this hands the SCRIPT an ordered candidate
 * list and lets it pick the one that exists (see `buildCommitCommand` in `git-tools.ts`): the path
 * as given always wins, so a repo that really does contain a nested `api/` directory is
 * never mis-resolved. Pure and exported for the unit tests.
 */
export function commitPathCandidates(path: string, repo?: string): string[] {
  const out = [path];
  const dir = safeRepoArg(repo);
  if (dir) {
    const prefix = `${dir.replace(/\/+$/, "")}/`;
    if (path.startsWith(prefix)) out.push(path.slice(prefix.length));
    // `repo: "Builderforce.ai/api"` + `path: "api/src/x.ts"` — the model repeated the
    // repo's LAST segment, which is the segment it was reading paths through.
    const leaf = dir.split("/").filter(Boolean).pop();
    if (leaf && path.startsWith(`${leaf}/`)) out.push(path.slice(leaf.length + 1));
  }
  return [...new Set(out)].filter((p) => p.trim() !== "");
}


/** A shell command's outcome, as the git tools read it. */
export type GitShellResult = { ok: boolean; stdout?: string; exitCode?: number; error?: string };

/** Shells whose ROOT answered "not a git repository" — a run with a default goes straight there. */
const rootNotARepo = new WeakSet<object>();

/** Every scope a call with no explicit `repo` is tried in, in order (see the module note). */
function scopeAttempts(ctx: GitShellCtx, path: string | undefined): Array<{ repo?: string; path?: string }> {
  const fallback = defaultRepoOf(ctx);
  const shell = ctx.caps.shell;
  const attempts: Array<{ repo?: string; path?: string }> = [];
  if (!(fallback && shell && rootNotARepo.has(shell))) attempts.push({ path });
  const inferred = inferRepoFromPath(path);
  if (inferred) attempts.push({ repo: inferred, path: pathInRepo(path, inferred) });
  if (fallback && fallback !== inferred) attempts.push({ repo: fallback, path: pathInRepo(path, fallback) });
  return attempts;
}

/**
 * Run a git command where the code lives. `run(repo, path)` executes the command scoped
 * to `repo` (undefined = the root) with `path` re-expressed inside it. An explicit `repo`
 * runs once, as the caller chose. Returns the first result that found a repository and
 * the scope it ran in, or null when none did (the caller names the candidates).
 */
export async function runInRepoScope(
  ctx: GitShellCtx,
  scope: { repo?: string; path?: string },
  run: (repo: string | undefined, path: string | undefined) => Promise<GitShellResult>,
): Promise<{ r: GitShellResult; repo?: string } | null> {
  if (scope.repo) return { r: await run(scope.repo, scope.path), repo: scope.repo };
  for (const attempt of scopeAttempts(ctx, scope.path)) {
    const r = await run(attempt.repo, attempt.path);
    if (!isNotARepo(r)) return attempt.repo ? { r, repo: attempt.repo } : { r };
    if (!attempt.repo && ctx.caps.shell) rootNotARepo.add(ctx.caps.shell);
  }
  return null;
}
