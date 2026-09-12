/**
 * The GIT / version-control tools — read, sync, rewind, publish and CLEAN UP — defined
 * ONCE here for every engine that has a real checkout (cloud Container, on-prem Node,
 * the VS Code editor surface). Split out of `core-tools.ts`, which had grown to hold
 * this whole subsystem alongside every unrelated tool; `CORE_TOOLS` imports the list
 * from here so the advertised catalog is unchanged.
 *
 * Two capabilities, deliberately distinct:
 *   - `shell` backs the READ/rewind verbs (status, diff, history, sync, undo, redo);
 *   - `git.write` backs everything that moves work out of the working tree (commit,
 *     push, pull request) or destroys a branch (cleanup) — see that capability for why
 *     the cloud surfaces must not be handed a second route to publishing.
 *
 * The command TEXT is built by pure functions (`buildGitCommand`, `buildCommitCommand`,
 * …) because two backends execute it: the registry's `execute` via
 * `ctx.caps.shell.run`, and the Container image's own `execTool`. One source, so they
 * cannot drift.
 */

import { defineTool, type ToolDefinition, type ToolResult } from "./tool.js";

// ---------------------------------------------------------------------------
// Git / version-control tools. Gated to `shell` (a real clone + Linux process),
// so they reach the Container and on-prem Node surfaces but NOT the shell-less
// durable Worker. Each is a thin, intent-named wrapper over a git command run
// through the shell capability — explicit tools the model can call reliably
// instead of hand-crafting git through run_command (the on-prem agent only ever
// had a read-only `git_history`; the mutating "get latest / undo / redo" verbs
// lived nowhere). The Container image runs its OWN loop, so it mirrors these via
// the SAME command strings (`buildGitCommand`) in its execTool — single source
// for the command text so the two execution backends can't drift.
// ---------------------------------------------------------------------------

/** A safe git ref/path token — blocks shell metacharacters so a model-supplied
 *  branch/path can't inject a second command. */
function safeGitArg(v: unknown): string | null {
  return typeof v === "string" && /^[\w./@-]+$/.test(v) ? v : null;
}

/** The git action verbs exposed as tools. */
export type GitAction = "status" | "diff" | "history" | "sync_latest" | "undo" | "redo";

/**
 * Build the shell command for a git action — the SINGLE source of the command
 * text, shared by the registry's `execute` (via `ctx.caps.shell.run`) and the
 * Container image's `execTool`. Pure + deterministic so both backends + the unit
 * tests agree byte-for-byte. `opts` are already-sanitised (see `safeGitArg`).
 *
 * `sync_latest` fetches the base branch and merges it into the working branch so
 * the agent never builds on stale code (the root cause of a branch that compiles
 * against old deps and whose PR would revert newer base work). On conflict it
 * aborts the merge and signals `MERGE_CONFLICT` rather than leaving a half-merged
 * tree. `undo`/`redo` are the classic reflog pair (`HEAD~1` / `HEAD@{1}`) and
 * refuse to run on a dirty tree so they can never silently discard uncommitted
 * work. Pushing the synced/rewound branch is the CALLER's job (surface-specific).
 */
/**
 * The validated `repo` subdirectory, or null.
 *
 * Held to a stricter rule than the other args: it becomes the target of a `cd`, so a
 * `..` segment would walk OUT of the workspace rather than merely widening a diff.
 * `safeGitArg` permits dots (a directory really can be named `Builderforce.ai`), so
 * traversal is rejected separately here — the one place it would actually escape.
 */
function safeRepoArg(repo: unknown): string | null {
  const arg = safeGitArg(repo);
  return arg && !arg.split(/[\\/]/).includes("..") && !arg.startsWith("/") ? arg : null;
}

/**
 * Scope a multi-line script into a repository subdirectory.
 *
 * A multi-line script cannot take the `cd X && Y` prefix — that would scope only its
 * FIRST line — so the `cd` becomes a guarded leading statement instead. Every script
 * that goes through here already requires a POSIX shell (they use `$(…)` and `[ … ]`),
 * which is what makes a bare `cd` line safe here and not for the one-liners.
 */
function repoScopedScript(script: string, repo: unknown): string {
  const dir = safeRepoArg(repo);
  return dir ? `cd "${dir}" || exit 1\n${script}` : script;
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
 * So the failure carries its own remedy: the tools take a `repo` subdirectory, and this
 * says so, names the tool that finds it, and shows the exact retry. Discovery is left to
 * `list_files` rather than a shell one-liner because that tool already works identically
 * on every surface, whereas a directory scan would need writing three ways for sh, cmd
 * and PowerShell.
 */
function notARepoResult(action: string): ToolResult {
  return {
    data: {
      ok: false,
      action,
      error:
        "not a git repository at the workspace root — this usually means the open folder CONTAINS the repositories rather than being one (several checkouts side by side). "
        + "Do not conclude git is unavailable: call `list_files` to see the top-level directories, then re-run this tool with `repo` set to the one holding the code you are working on "
        + `(e.g. { "repo": "my-project" }). If none of them is a checkout, say so plainly — file edits still work, only the git tools need a repository.`,
    },
  };
}

/** Resolve the remote's default branch into `$BASE`, falling back to `main`. Shared so
 *  "what is the base branch" has ONE answer across sync, commit, push and pull request. */
const RESOLVE_BASE = `BASE="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"; [ -n "$BASE" ] || BASE=main`;

export function buildGitCommand(action: GitAction, opts?: { path?: string; baseBranch?: string; limit?: number; repo?: string }): string {
  const path = safeGitArg(opts?.path);
  const pathArg = path ? ` -- "${path}"` : "";
  // A workspace root is not always the repository root: a monorepo checkout, or simply
  // a folder holding several projects, has its `.git` one level down. `repo` scopes the
  // command into that subdirectory. `cd X && Y` is the one chaining form that behaves
  // identically under sh, cmd and PowerShell, so this stays portable across every
  // surface that runs these strings. Omitted ⇒ byte-for-byte the previous command, so
  // the Container image's execTool and its tests are unaffected.
  //
  // `repo` is held to a stricter rule than the other args: it becomes the target of a
  // `cd`, so a `..` segment would walk OUT of the workspace rather than merely widening
  // a diff. `safeGitArg` permits dots (a directory really can be named `Builderforce.ai`),
  // so traversal is rejected separately here — the one place it would actually escape.
  const repo = safeRepoArg(opts?.repo);
  const scoped = (cmd: string): string => (repo ? `cd "${repo}" && ${cmd}` : cmd);
  // The multi-line actions cannot take the `cd X && Y` prefix — it would scope only the
  // first line — so they get the `cd` as their own leading statement instead. These
  // scripts already require a POSIX shell (they use `$(…)` and `[ … ]`), so a bare `cd`
  // line is safe here in a way it would not be for the one-liners above. Without this,
  // `sync_latest`/`undo`/`redo` could ONLY ever run at the workspace root: in a folder
  // that CONTAINS checkouts rather than being one, they were unusable and said nothing
  // about why, while `git_status` — which does take `repo` — worked one call earlier.
  const scopedScript = (lines: string[]): string => repoScopedScript(lines.join("\n"), opts?.repo);
  switch (action) {
    case "status":
      return scoped("git status --short --branch");
    case "diff":
      return scoped(`git --no-pager diff${pathArg}`);
    case "history": {
      const limit = Number.isFinite(opts?.limit) && (opts!.limit as number) > 0 ? Math.min(Math.floor(opts!.limit as number), 200) : 30;
      return scoped(`git --no-pager log --oneline -n ${limit}${pathArg}`);
    }
    case "sync_latest": {
      const base = safeGitArg(opts?.baseBranch);
      const resolveBase = base ? `BASE="${base}"` : RESOLVE_BASE;
      return scopedScript([
        "set -e",
        resolveBase,
        'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
        'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
        'git fetch origin "$BASE"',
        'git merge --no-edit "origin/$BASE" || { git merge --abort; echo MERGE_CONFLICT; exit 3; }',
        'echo "Synced with origin/$BASE"',
      ]);
    }
    case "undo":
      // Drop the last commit, reflog-recoverable via redo. Guard a dirty tree so
      // uncommitted work is never silently lost.
      return scopedScript([
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        "git reset --hard HEAD~1",
        'echo "Undid the last commit (use git_redo to reapply)"',
      ]);
    case "redo":
      // Reapply the change undone by the most recent reset (the reflog redo).
      return scopedScript([
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        'git reset --hard "HEAD@{1}"',
        'echo "Reapplied the last undone change"',
      ]);
  }
}

/** Map a git ShellResult to a uniform tool result, decoding the sentinel exits
 *  `buildGitCommand` emits (MERGE_CONFLICT / DIRTY) into actionable messages. */
function gitToolResult(action: GitAction, r: { ok: boolean; stdout?: string; exitCode?: number; error?: string }): ToolResult {
  const out = (r.stdout ?? "").trim();
  if (r.exitCode === 3 || /MERGE_CONFLICT/.test(out)) {
    return { data: { ok: false, action, error: "merge conflict — the base branch has changes that conflict with your branch; the merge was aborted (working tree is clean). Resolve by editing the conflicting files, or ask a human.", output: out } };
  }
  if (r.exitCode === 4 || /\bDIRTY\b/.test(out)) {
    return { data: { ok: false, action, error: "you have uncommitted changes — commit or discard them before git_" + action + " (it refuses to discard uncommitted work)." } };
  }
  return { data: { ok: r.ok, action, output: out.slice(0, 20_000), ...(r.error ? { error: r.error } : {}) } };
}

/** git's own wording when the working directory has no repository above it. */
const NOT_A_REPO = /not a git repository/i;

function isNotARepo(r: { stdout?: string; error?: string }): boolean {
  return NOT_A_REPO.test(`${r.stdout ?? ""} ${r.error ?? ""}`);
}

async function runGitTool(action: GitAction, opts: { path?: string; baseBranch?: string; limit?: number; repo?: string }, ctx: { caps: { shell?: { run(c: string): Promise<{ ok: boolean; stdout?: string; exitCode?: number; error?: string }> } } }): Promise<ToolResult> {
  const r = await ctx.caps.shell!.run(buildGitCommand(action, opts));
  // "fatal: not a git repository" is not the end of the road, and returning it raw is
  // what makes it look like one. It happens routinely when the OPEN FOLDER holds
  // several checkouts side by side (`/code/`, with `/code/app` and `/code/api` each a
  // repo): git is run at the root, finds no `.git`, and the agent — handed a bare
  // fatal with no next step — concludes the tool is unusable and gives up, or asks the
  // user a question it could have answered itself.
  //
  // So the failure carries its own remedy: the tools take a `repo` subdirectory, and
  // this says so, names the tool that finds it, and shows the exact retry. Discovery
  // is left to `list_files` rather than a shell one-liner because that tool already
  // works identically on every surface, whereas a directory-scan command would have to
  // be written three ways for sh, cmd and PowerShell.
  if (isNotARepo(r) && !opts.repo) return notARepoResult(action);
  const result = gitToolResult(action, r);
  // Say WHERE it ran whenever that was not the obvious place, so a later command in
  // the same run does not have to rediscover the scope.
  if (opts.repo && (result.data as { ok?: boolean }).ok) {
    (result.data as Record<string, unknown>).repo = opts.repo;
  }
  return result;
}

/** The `repo` parameter, shared by every git tool — one description so the six
 *  cannot drift into describing the same argument differently. */
const REPO_PARAM = {
  type: "string",
  description: 'Optional subdirectory holding the repository, when the open folder CONTAINS checkouts rather than being one (e.g. "my-project"). Omit when the workspace root is itself the repo.',
} as const;

export const gitStatusTool: ToolDefinition = defineTool({
  name: "git_status",
  description: "Show the current branch and any uncommitted changes (git status). Use it to see what you have modified before committing, syncing, or finishing. If the open folder contains several checkouts rather than being one repo, pass `repo` to name the one you mean.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("status", { repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

export const gitDiffTool: ToolDefinition = defineTool({
  name: "git_diff",
  description: "Show the uncommitted diff of your working tree (optionally for one path). Use it to review exactly what you changed before finishing.",
  parameters: { type: "object", properties: { path: { type: "string", description: "Optional repo-relative file/dir to scope the diff to." }, repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("diff", { path: typeof args.path === "string" ? args.path : undefined, repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

export const gitHistoryTool: ToolDefinition = defineTool({
  name: "git_history",
  description: "Show recent commit history (git log --oneline), optionally scoped to a path. Use it to understand how a file evolved before changing it.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional repo-relative file/dir to scope history to." },
      limit: { type: "number", description: "Max commits to return (default 30, max 200)." },
      repo: REPO_PARAM,
    },
  },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("history", { path: typeof args.path === "string" ? args.path : undefined, limit: typeof args.limit === "number" ? args.limit : undefined, repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

export const gitSyncLatestTool: ToolDefinition = defineTool({
  name: "git_sync_latest",
  description:
    "Fetch the latest base branch (e.g. main) and merge it into your working branch so you are NOT building on stale code. Run this FIRST, before editing — a branch created earlier can be far behind main, so its build fails against old dependencies and its pull request would revert newer work. On a merge conflict it safely aborts and tells you which to resolve.",
  parameters: { type: "object", properties: { baseBranch: { type: "string", description: "Base branch to sync from. Defaults to the remote's default branch (usually main)." }, repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("sync_latest", { baseBranch: typeof args.baseBranch === "string" ? args.baseBranch : undefined, repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

export const gitUndoTool: ToolDefinition = defineTool({
  name: "git_undo",
  description: "Undo your most recent commit (keeps the change recoverable — use git_redo to reapply). Refuses if you have uncommitted changes, so it can never discard unsaved work. Use it to back out a change that was wrong.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("undo", { repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

export const gitRedoTool: ToolDefinition = defineTool({
  name: "git_redo",
  description: "Reapply the change you most recently undid with git_undo (reflog redo). Refuses if you have uncommitted changes.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("redo", { repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

// ── Publishing: commit → push → pull request ─────────────────────────────────────
//
// The git tools above READ, sync and rewind; none of them could move work out of the
// working tree. On the cloud surfaces that is correct — a write there IS a commit and
// the engine opens the PR at finish — but on a LOCAL surface (the editor) an agent
// could edit a file and then had no verb for shipping it. Asked to "commit and push",
// it reported it had no git tool, hunted the catalog, found `run_command`, and shelled
// out `git add -A && git commit && git push` straight to `main`: everything the
// working tree happened to contain, unreviewed, on the base branch.
//
// So these three exist to make the SAFE path the reachable one. The default is a ticket
// branch, a pull request and a reviewer; pushing the base branch is a distinct, declared
// act that the surface's own approval gate prompts for (every tool here is mutating).
// They are gated on `git.write`, NOT `shell` — see that capability for why the cloud
// surfaces must not be handed a second route to publishing.

/** Shell-quote a model-supplied string for a single-quoted POSIX argument. Commit
 *  messages and PR bodies are free text — they cannot go through `safeGitArg`, which
 *  rejects spaces — so they are QUOTED rather than validated. */
function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the commit script. Commits ONLY the named paths — never `git add -A`.
 *
 * That is the whole point of requiring `paths`. A working tree is shared with the
 * human using it: the run that prompted this tool had three modified files and the
 * agent had touched one, so `git add -A` would have swept a colleague's in-flight work
 * into the agent's commit. An agent that cannot say what it changed should not be
 * committing.
 *
 * Refuses to commit onto the base branch: `branch` names the ticket branch, created
 * from the current HEAD if it does not exist yet.
 */
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
 * list and lets it pick the one that exists (see {@link buildCommitCommand}): the path
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

function buildCommitCommand(opts: { message: string; paths: string[]; branch?: string; allowBaseBranch?: boolean; repo?: string }): string {
  const branch = safeGitArg(opts.branch);
  // Resolve each path to a shell variable holding the candidate that actually exists,
  // so `git add` is handed real paths or the run stops with a message naming the ones
  // it could not find — never a silent empty stage.
  const resolveLines = opts.paths.map((p, i) => {
    const candidates = commitPathCandidates(p, opts.repo).map(shellQuote).join(" ");
    return `P${i}="$(pick ${candidates})" || MISSING="$MISSING ${shellQuote(p).slice(1, -1)}"`;
  });
  const paths = opts.paths.map((_, i) => `"$P${i}"`).join(" ");
  return [
    "set -e",
    RESOLVE_BASE,
    'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
    'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    // A ticket branch was named: switch to it, creating it if new. Otherwise the base
    // branch is refused — unless the caller DECLARED it, the same declared act `git_push`
    // takes. Without that declaration "commit and push to main" had no reachable path at
    // all: push accepted `allowBaseBranch`, but the commit before it could never land on
    // main, so an explicit human instruction ended in a refusal every time.
    ...(branch
      ? [`git rev-parse --verify --quiet "${branch}" >/dev/null && git checkout "${branch}" || git checkout -b "${branch}"`]
      : opts.allowBaseBranch
        ? []
        : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }']),
    // A path is "there" if it is on disk OR tracked by git — the second arm is what
    // lets a DELETION be committed, since the file is gone by definition.
    'pick() { for c in "$@"; do if [ -e "$c" ] || git ls-files --error-unmatch -- "$c" >/dev/null 2>&1; then printf %s "$c"; return 0; fi; done; return 1; }',
    'MISSING=""',
    ...resolveLines,
    '[ -z "$MISSING" ] || { echo "MISSING_PATHS:$MISSING"; exit 8; }',
    `git add -- ${paths}`,
    // Nothing staged is a fact, not a failure — say which rather than exiting 1 with
    // git's own "nothing to commit" that reads like a broken tool.
    'git diff --cached --quiet && { echo NOTHING_STAGED; exit 6; }',
    `git commit -m ${shellQuote(opts.message)}`,
    'echo "Committed on $(git rev-parse --abbrev-ref HEAD): $(git rev-parse --short HEAD)"',
  ].join("\n");
}

/** Build the push script. Refuses the base branch unless the caller DECLARED it. */
function buildPushCommand(opts: { allowBaseBranch?: boolean; repo?: string }): string {
  return [
    "set -e",
    RESOLVE_BASE,
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    ...(opts.allowBaseBranch ? [] : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }']),
    // `-u` so a brand-new ticket branch gets its upstream on the first push.
    'git push -u origin "$CUR"',
    'echo "Pushed $CUR to origin"',
    // Report where the push LANDED — the branch header (`## main...origin/main`, with any
    // `[ahead N]` still owed) plus whatever is still uncommitted. That is the evidence a
    // host needs to call the change shipped, so the push verifies itself rather than
    // depending on the agent remembering a separate status call. Never fails the push.
    'git status --short --branch 2>/dev/null || true',
  ].join("\n");
}

/** Build the `gh pr create` script. The GitHub CLI is used rather than the REST API
 *  because this surface has a shell and the user's own gh auth, so no token has to be
 *  plumbed through the agent. */
function buildPullRequestCommand(opts: { title: string; body: string; base?: string; reviewers?: string[]; repo?: string }): string {
  const base = safeGitArg(opts.base);
  const reviewers = (opts.reviewers ?? []).map((r) => safeGitArg(r)).filter((r): r is string => !!r);
  return [
    "set -e",
    'command -v gh >/dev/null 2>&1 || { echo NO_GH_CLI; exit 7; }',
    ...(base ? [`BASE="${base}"`] : [RESOLVE_BASE]),
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    '[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }',
    // Push first when the branch has no upstream — `gh pr create` fails on an unpushed
    // head, and "open a PR" plainly means the branch has to exist on the remote.
    'git rev-parse --abbrev-ref "@{upstream}" >/dev/null 2>&1 || git push -u origin "$CUR"',
    `gh pr create --base "$BASE" --head "$CUR" --title ${shellQuote(opts.title)} --body ${shellQuote(opts.body)}`
      + reviewers.map((r) => ` --reviewer "${r}"`).join(""),
  ].join("\n");
}

/**
 * Build the post-merge CLEANUP script — the verb that was missing from this set.
 *
 * Every other publish verb moves work FORWARD; nothing ever put the checkout back. So a
 * run that shipped left the machine on a dead ticket branch with a stale base, and the
 * agent, reaching for `run_command` to tidy up itself, hand-rolled
 * `git push origin --delete <branch>` — which failed with `remote ref does not exist`,
 * because GitHub had already deleted the branch when the pull request merged. Cleanup
 * that reports an error for the thing it wanted to be true is worse than no cleanup.
 *
 * Hence: idempotent by construction. Deleting the remote branch happens only if it is
 * still there; an already-pruned remote, an already-deleted local branch and an
 * already-current base are each a normal outcome, not a failure.
 *
 * It refuses to delete UNMERGED work (`NOT_MERGED`) and to run on a dirty tree
 * (`DIRTY`) — the two ways an automatic cleanup could destroy something. The one case
 * that legitimately looks unmerged is a SQUASH merge, where the branch's commits are in
 * the base under a new hash; that is what `force` is for, and it is also detected
 * automatically when the remote branch is gone but the local branch was pushed.
 */
function buildCleanupCommand(opts: { branch?: string; baseBranch?: string; force?: boolean; repo?: string }): string {
  const branch = safeGitArg(opts.branch);
  const base = safeGitArg(opts.baseBranch);
  return [
    "set -e",
    ...(base ? [`BASE="${base}"`] : [RESOLVE_BASE]),
    ...(branch ? [`TARGET="${branch}"`] : ['TARGET="$(git rev-parse --abbrev-ref HEAD)"']),
    '[ "$TARGET" != "$BASE" ] || { echo NOTHING_TO_CLEAN; exit 9; }',
    '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
    'git rev-parse --verify --quiet "$TARGET" >/dev/null || { echo NO_SUCH_BRANCH; exit 11; }',
    // Was this branch ever pushed? Read BEFORE the prune, which is what removes the
    // evidence — a branch that had an upstream and no longer exists on the remote was
    // merged and deleted by the host, however it was merged.
    'HAD_UPSTREAM=0; git rev-parse --verify --quiet "refs/remotes/origin/$TARGET" >/dev/null && HAD_UPSTREAM=1',
    'git fetch --prune origin',
    'REMOTE_EXISTS=0; git ls-remote --exit-code --heads origin "$TARGET" >/dev/null 2>&1 && REMOTE_EXISTS=1',
    // Get onto the base branch and bring it up to date — the state the user expects to
    // be left in. `--ff-only` so a divergent local base is reported, never merged.
    'git checkout "$BASE"',
    'git merge --ff-only "origin/$BASE" >/dev/null 2>&1 || echo "note: local $BASE has diverged from origin/$BASE and was left alone"',
    'MERGED=0; git branch --merged "origin/$BASE" | sed "s/^[* ] *//" | grep -qx "$TARGET" && MERGED=1',
    // Squash-merged: the commits are in the base under a new hash, so `--merged` says
    // no, but the host deleted the remote branch when the PR landed.
    '[ "$MERGED" = 1 ] || { [ "$HAD_UPSTREAM" = 1 ] && [ "$REMOTE_EXISTS" = 0 ] && MERGED=1; } || true',
    ...(opts.force ? ['MERGED=1'] : []),
    '[ "$MERGED" = 1 ] || { echo NOT_MERGED; exit 10; }',
    // `-D`, not `-d`: the merged-ness check above is STRICTER than git's own (it also
    // accepts the squash-merge case git cannot see), so `-d` would refuse exactly the
    // branches this tool exists to remove. Nothing reaches this line unmerged.
    'git branch -D "$TARGET"',
    // The remote branch is usually ALREADY gone (the host deletes it on merge). That is
    // the goal state, not an error, so it is only pushed when it is actually there.
    '[ "$REMOTE_EXISTS" = 0 ] || git push origin --delete "$TARGET"',
    'git remote prune origin >/dev/null 2>&1 || true',
    'echo "Cleaned up $TARGET — on $BASE (updated), branch deleted locally and on origin"',
  ].join("\n");
}

/** Decode the sentinels the publish scripts emit into an instruction the agent can
 *  act on, rather than a raw non-zero exit it can only report. */
function publishToolResult(action: string, r: { ok: boolean; stdout?: string; exitCode?: number; error?: string }): ToolResult {
  const out = (r.stdout ?? "").trim();
  const fail = (error: string): ToolResult => ({ data: { ok: false, action, error, output: out } });
  if (r.exitCode === 5 || /\bON_BASE_BRANCH\b/.test(out)) {
    return fail(
      action === "push"
        ? "you are on the BASE branch (main/master) and `allowBaseBranch` was not set — pushing here bypasses pull-request review. Open a pull request instead (git_commit with a `branch`, then open_pull_request). If the human has explicitly asked you to push the base branch, or your session instructions make you the reviewer of your own change and you have self-reviewed it, re-call with allowBaseBranch:true; they will be prompted to approve it."
        : "you are on the BASE branch (main/master) and `allowBaseBranch` was not set — committing here bypasses pull-request review. Pass `branch` to git_commit to work on a ticket branch (it is created for you), then open_pull_request. If the human has explicitly asked you to commit to the base branch directly, or your session instructions make you the reviewer of your own change and you have self-reviewed it, re-call with allowBaseBranch:true; they will be prompted to approve it.",
    );
  }
  if (r.exitCode === 6 || /\bNOTHING_STAGED\b/.test(out)) {
    return fail("none of the named paths have uncommitted changes — nothing was committed. Run git_status to see what actually differs; do not report a commit that did not happen.");
  }
  // Wrong paths used to reach the agent as "nothing to commit", which reads like an
  // empty diff and sends it looking for the wrong problem. Name the paths instead, and
  // say what they are relative to — the distinction `repo` introduces is exactly the
  // one that goes wrong.
  const missing = /MISSING_PATHS:([^\n]*)/.exec(out);
  if (r.exitCode === 8 || missing) {
    const named = (missing?.[1] ?? "").trim();
    return fail(
      `these paths do not exist in the repository, so nothing was committed:${named ? ` ${named}` : ""}. `
      + "`paths` are relative to the REPOSITORY root — when you pass `repo`, that means relative to the repo directory, NOT to the workspace root your file tools use. "
      + "Run git_status (with the same `repo`) and copy the paths it prints.",
    );
  }
  if (r.exitCode === 9 || /\bNOTHING_TO_CLEAN\b/.test(out)) {
    return fail("you are already on the base branch and no ticket branch was named — there is nothing to clean up. Pass `branch` to name the merged branch to delete.");
  }
  if (r.exitCode === 10 || /\bNOT_MERGED\b/.test(out)) {
    return fail(
      "that branch's commits are NOT in the base branch, so it was left alone — deleting it would destroy unmerged work. "
      + "If the pull request was SQUASH-merged (the commits are in main under a new hash and the remote branch still exists), re-call with force:true to delete it anyway.",
    );
  }
  if (r.exitCode === 11 || /\bNO_SUCH_BRANCH\b/.test(out)) {
    return fail("no local branch by that name — it has already been deleted. Nothing to do.");
  }
  if (r.exitCode === 4 || /\bDIRTY\b/.test(out)) {
    return fail("you have uncommitted changes — commit or discard them before cleaning up (this refuses to discard uncommitted work).");
  }
  if (r.exitCode === 7 || /\bNO_GH_CLI\b/.test(out)) {
    return fail("the GitHub CLI (`gh`) is not installed or not on PATH, so a pull request cannot be opened from here. The branch is committed and pushed; tell the human to open the PR, and give them the branch name.");
  }
  return { data: { ok: r.ok, action, output: out.slice(0, 20_000), ...(r.error ? { error: r.error } : {}) } };
}

/** Run a publish script through the shell capability, with the same not-a-repo remedy
 *  the read-only git tools give. */
async function runPublishTool(
  action: string,
  command: string,
  repo: string | undefined,
  ctx: { caps: { shell?: { run(c: string): Promise<{ ok: boolean; stdout?: string; exitCode?: number; error?: string }> } } },
): Promise<ToolResult> {
  const scoped = repoScopedScript(command, repo);
  const r = await ctx.caps.shell!.run(scoped);
  if (isNotARepo(r) && !repo) return notARepoResult(action);
  const result = publishToolResult(action, r);
  if (repo && (result.data as { ok?: boolean }).ok) (result.data as Record<string, unknown>).repo = repo;
  return result;
}

export const gitCommitTool: ToolDefinition = defineTool({
  name: "git_commit",
  description:
    "Commit the files you changed. You must list the exact `paths` to commit — the working tree is shared with the human using it, so committing everything would sweep up their unrelated in-flight work; run git_status/git_diff first if you are unsure what you touched. The DEFAULT route is a TICKET BRANCH: pass `branch` to name it (created for you if it does not exist), then use open_pull_request so the work is reviewed. Without `branch`, a commit is refused while you are on the base branch (main/master) — unless the human has EXPLICITLY asked you to commit to main directly, or your session instructions make you the reviewer of your own change (a local editor session, after you have verified and self-reviewed it); then pass allowBaseBranch:true (the human is prompted to approve it) and follow with git_push allowBaseBranch:true.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message. One line saying what changed and why." },
      paths: { type: "array", items: { type: "string" }, description: "Repo-relative paths to commit. Exactly the files YOU changed — never a catch-all." },
      branch: { type: "string", description: 'Ticket branch to commit on, created if new (e.g. "ticket/2394-mobile-board-height"). The default route; required when on the base branch unless allowBaseBranch is set.' },
      allowBaseBranch: { type: "boolean", description: "Set ONLY when the human explicitly asked to commit to the base branch (main/master) directly. Default false, which refuses on the base branch and tells you to use a ticket branch." },
      repo: REPO_PARAM,
    },
    required: ["message", "paths"],
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) return Promise.resolve({ data: { ok: false, action: "commit", error: "message is required" } });
    const paths = Array.isArray(args.paths) ? args.paths.filter((p): p is string => typeof p === "string" && p.trim() !== "") : [];
    if (paths.length === 0) {
      return Promise.resolve({ data: { ok: false, action: "commit", error: "paths is required — list the exact files you changed. Run git_status to see them. Do not pass '.' or '-A': the working tree may hold changes that are not yours." } });
    }
    const repo = typeof args.repo === "string" ? args.repo : undefined;
    return runPublishTool(
      "commit",
      buildCommitCommand({ message, paths, branch: typeof args.branch === "string" ? args.branch : undefined, allowBaseBranch: args.allowBaseBranch === true, repo }),
      repo,
      ctx,
    );
  },
});

export const gitPushTool: ToolDefinition = defineTool({
  name: "git_push",
  description:
    "Push the current branch to origin (setting its upstream on the first push), then report where it landed (`git status --short --branch`). Pushing the BASE branch (main/master) is refused unless you pass allowBaseBranch — that path skips pull-request review, so only set it when the human has explicitly asked for it, or when your session instructions make you the reviewer of your own change (a local editor session, after verifying and self-reviewing it); the human is prompted to approve it either way. Otherwise the route is a ticket branch: git_commit with a `branch`, git_push, then open_pull_request.",
  parameters: {
    type: "object",
    properties: {
      allowBaseBranch: { type: "boolean", description: "Set ONLY when the human explicitly asked to push the base branch directly. Default false, which refuses and tells you to open a pull request." },
      repo: REPO_PARAM,
    },
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const repo = typeof args.repo === "string" ? args.repo : undefined;
    return runPublishTool("push", buildPushCommand({ allowBaseBranch: args.allowBaseBranch === true, repo }), repo, ctx);
  },
});

export const openPullRequestTool: ToolDefinition = defineTool({
  name: "open_pull_request",
  description:
    "Open a pull request for the current ticket branch against the base branch, pushing it first if it has no upstream yet. This is how a change gets REVIEWED — prefer it over pushing the base branch, and say so when someone asks you to push directly. Pass `reviewers` to request review from specific people or teams. Returns the pull request URL; report that URL rather than claiming the work is shipped, because it is not until the PR is merged.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Pull request title — what this change does, in one line." },
      body: { type: "string", description: "Pull request description: what changed, why, and how a reviewer can verify it." },
      base: { type: "string", description: "Base branch to target. Defaults to the remote's default branch (usually main)." },
      reviewers: { type: "array", items: { type: "string" }, description: "GitHub usernames or org/team slugs to request review from." },
      repo: REPO_PARAM,
    },
    required: ["title", "body"],
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const body = typeof args.body === "string" ? args.body : "";
    if (!title) return Promise.resolve({ data: { ok: false, action: "pull_request", error: "title is required" } });
    const repo = typeof args.repo === "string" ? args.repo : undefined;
    const reviewers = Array.isArray(args.reviewers) ? args.reviewers.filter((r): r is string => typeof r === "string") : undefined;
    return runPublishTool(
      "pull_request",
      buildPullRequestCommand({ title, body, base: typeof args.base === "string" ? args.base : undefined, reviewers, repo }),
      repo,
      ctx,
    );
  },
});

/**
 * Put the checkout back the way the user expects to find it, once the work has landed.
 *
 * This closes the "the agent never cleans up after itself" gap: a shipped run used to
 * leave the machine parked on a dead ticket branch with a stale base, and the only way
 * to tidy up was a hand-written `run_command`, which is where
 * `git push origin --delete <branch>` → `remote ref does not exist` came from.
 */
export const gitCleanupMergedTool: ToolDefinition = defineTool({
  name: "git_cleanup_merged",
  description:
    "Clean up after work that has LANDED: switch to the base branch, fast-forward it to origin, and delete the merged ticket branch locally and on origin. Call it once the pull request is merged (or once you have pushed the base branch directly) so the checkout is not left sitting on a dead branch with a stale base — do not hand-roll this with run_command. It is IDEMPOTENT: a remote branch the host already deleted on merge is the expected state, not an error. It REFUSES to delete a branch whose commits are not in the base branch, and refuses to run on a dirty working tree, so it can never destroy unmerged or uncommitted work. If the pull request was SQUASH-merged and the remote branch still exists, git cannot see the merge — re-call with force:true.",
  parameters: {
    type: "object",
    properties: {
      branch: { type: "string", description: "The merged branch to delete. Defaults to the branch you are currently on." },
      baseBranch: { type: "string", description: "Branch to return to and update. Defaults to the remote's default branch (usually main)." },
      force: { type: "boolean", description: "Delete the branch even though git cannot see its commits in the base branch. ONLY for a squash-merged pull request you have confirmed is merged." },
      repo: REPO_PARAM,
    },
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const repo = typeof args.repo === "string" ? args.repo : undefined;
    return runPublishTool(
      "cleanup",
      buildCleanupCommand({
        branch: typeof args.branch === "string" ? args.branch : undefined,
        baseBranch: typeof args.baseBranch === "string" ? args.baseBranch : undefined,
        force: args.force === true,
        repo,
      }),
      repo,
      ctx,
    );
  },
});

/**
 * The git subsystem's tools, in the canonical order `CORE_TOOLS` splices them in at.
 * One list, so a new git verb reaches every engine by being added HERE — there is no
 * second place that enumerates them.
 */
export const GIT_TOOLS: readonly ToolDefinition[] = [
  gitStatusTool,
  gitDiffTool,
  gitHistoryTool,
  gitSyncLatestTool,
  gitUndoTool,
  gitRedoTool,
  gitCommitTool,
  gitPushTool,
  openPullRequestTool,
  gitCleanupMergedTool,
];
