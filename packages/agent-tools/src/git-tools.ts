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
import {
  invalidRepoResult,
  notARepoWithCandidates,
  runInRepoScope,
  safeGitArg,
  safeRepoArg,
  shellRunWithStop,
  type GitShellCtx,
} from "./git-repo-scope.js";
import { buildStatusCommand, GIT_STATUS_MAX_PATHS, parseGitStatusOutput, statusPaths } from "./git-status.js";
import { IDENTITY_EMAIL, IDENTITY_NAME, REPO_PARAM, RESOLVE_BASE } from "./git-script-parts.js";
import { gitCleanupMergedTool, gitCommitTool, gitPushTool, openPullRequestTool } from "./git-publish-tools.js";

// The publish / cleanup verbs live in `git-publish-tools.ts`; these were this module's exports.
export { gitCleanupMergedTool, gitCommitTool, gitPushTool, openPullRequestTool } from "./git-publish-tools.js";

export { buildStatusCommand, GIT_STATUS_MAX_PATHS, parseGitStatusOutput, type GitPathCommit, type GitStatusEntry, type GitStatusReport } from "./git-status.js";

// The repo-scope helpers live in `git-repo-scope.ts`; these were this module's exports.
export { buildListCheckoutsCommand, commitPathCandidates, inferRepoFromPath, isNotARepo, notARepoResult, posixCommandIn, safeRepoArg } from "./git-repo-scope.js";

// ---------------------------------------------------------------------------
// Git / version-control tools. Gated to `shell` (a real clone + Linux process),
// so they reach the Container and on-prem Node surfaces but NOT the shell-less
// durable Worker. Each is a thin, intent-named wrapper over a git command run
// through the shell capability — explicit tools the model can call reliably
// instead of hand-crafting git through run_command (the on-prem agent only ever
// had a read-only `git_history`; the mutating "get latest / undo / redo" verbs
// lived nowhere). `runGitTool` is the one consumer of `buildGitCommand` (nothing outside
// this package runs these strings), and the unborn-HEAD diff fallback lives there too.
// ---------------------------------------------------------------------------

/** ` -- "a" "b"` for the (sanitised) pathspecs — `pathspecs` when given, else the single `path`; "" when none survive. */
function pathspecArg(opts?: { path?: string; pathspecs?: readonly string[] }): string {
  const specs = (opts?.pathspecs ?? [opts?.path]).map((p) => safeGitArg(p)).filter((p): p is string => !!p);
  return specs.length > 0 ? ` -- ${specs.map((p) => `"${p}"`).join(" ")}` : "";
}

/**
 * The diff of a repository with NO commits (no HEAD): what is staged, then what is not — two plain git
 * invocations the caller runs in turn. Pure, so the unit tests pin the text.
 */
export function buildUnbornDiffCommands(opts?: { path?: string; pathspecs?: readonly string[] }): string[] {
  const pathArg = pathspecArg(opts);
  return [`git --no-pager diff --cached${pathArg}`, `git --no-pager diff${pathArg}`];
}

/**
 * git's `fatal:` line when `HEAD` does not resolve (a repository with no commits yet). Anchored to a `fatal:` line so a
 * timed-out diff whose partial stdout merely CONTAINS these words (a diff of this very file) is not mistaken for it.
 */
const UNBORN_HEAD = /^fatal: .*(bad revision 'HEAD'|ambiguous argument 'HEAD'|unknown revision)/m;

/** A failed HEAD diff is the unborn-HEAD case: git exits 128 with that `fatal:` line (exit code unknown on some shells ⇒ the line alone decides). */
function isUnbornHead(r: { ok: boolean; stdout?: string; exitCode?: number; error?: string }): boolean {
  if (r.ok || (r.exitCode !== undefined && r.exitCode !== 128)) return false;
  return UNBORN_HEAD.test(`${r.stdout ?? ""}\n${r.error ?? ""}`);
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
 * work. Pushing the synced/rewound branch is the surface's call: a shell whose clone
 * mirrors a surface-owned branch names it (`ShellCapability.trackedBranch`), and the
 * script then absorbs that branch first and publishes to it after.
 */
export function buildGitCommand(
  action: GitAction,
  opts?: { path?: string; pathspecs?: readonly string[]; baseBranch?: string; limit?: number; trackedBranch?: string; remoteViaSandbox?: boolean; paths?: readonly string[]; repo?: string },
): string {
  const pathArg = pathspecArg(opts);
  // A workspace root is not always the repository root: a monorepo checkout, or simply a
  // folder holding several projects, has its `.git` one level down. Where the command runs is
  // NOT part of its text: the tool hands `repo` to the shell as the working directory
  // (`ShellRunOptions.cwd`, validated by `safeRepoArg` — a `..` segment would walk OUT of the
  // workspace), so the same command text runs under sh, cmd and PowerShell alike.
  // A clone that mirrors a surface-owned branch (`ShellCapability.trackedBranch`): absorb
  // that branch before moving history (the surface may have committed since) and
  // publish the result, or the pull request never sees the sync / rewind.
  const tracked = safeGitArg(opts?.trackedBranch);
  // `remoteViaSandbox`: the clone has no credential and no network of its own (a cloud sandbox). The SANDBOX does the
  // remote half — `ShellGit.sync` brings `origin/<branch>` up to date BEFORE this script, `ShellGit.publish` pushes AFTER
  // it — so the script keeps only the local half (no `git fetch`, no `git push`).
  const viaSandbox = opts?.remoteViaSandbox === true;
  const fetchTracked = viaSandbox ? "" : `git fetch origin "${tracked}" 2>/dev/null && `;
  const absorb = tracked
    ? ["set -e", IDENTITY_EMAIL, IDENTITY_NAME, `${fetchTracked}git merge --ff-only "origin/${tracked}" 2>/dev/null || true`]
    : [];
  const publish = (force: boolean): string[] => (tracked && !viaSandbox ? [force ? "git push --force-with-lease origin HEAD" : "git push origin HEAD"] : []);
  switch (action) {
    case "status":
      // No `paths` ⇒ the unchanged one-liner; `paths` adds each one's last commit (see git-status.ts).
      return buildStatusCommand(opts?.paths, opts?.repo);
    case "diff":
      // Staged AND unstaged (against HEAD) — plain `git diff` shows only the unstaged half, so a file the
      // agent already `git add`ed read as "no changes". ONE plain git invocation (no `||`: a Windows host
      // without bash refuses it). A repository with no commits has no HEAD; `runGitTool` then runs
      // `buildUnbornDiffCommands`.
      return `git --no-pager diff HEAD${pathArg}`;
    case "history": {
      const limit = Number.isFinite(opts?.limit) && (opts!.limit as number) > 0 ? Math.min(Math.floor(opts!.limit as number), 200) : 30;
      return `git --no-pager log --oneline -n ${limit}${pathArg}`;
    }
    case "sync_latest": {
      const base = safeGitArg(opts?.baseBranch);
      const resolveBase = base ? `BASE="${base}"` : RESOLVE_BASE;
      return [
        ...(tracked ? absorb : ["set -e"]),
        resolveBase,
        ...(tracked ? [] : [IDENTITY_EMAIL, IDENTITY_NAME]),
        ...(viaSandbox ? [] : ['git fetch origin "$BASE"']),
        'git merge --no-edit "origin/$BASE" || { git merge --abort; echo MERGE_CONFLICT; exit 3; }',
        ...publish(false),
        'echo "Synced with origin/$BASE"',
      ].join("\n");
    }
    case "undo":
      // Drop the last commit, reflog-recoverable via redo. Guard a dirty tree so
      // uncommitted work is never silently lost.
      return [
        ...absorb,
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        "git reset --hard HEAD~1",
        ...publish(true),
        'echo "Undid the last commit (use git_redo to reapply)"',
      ].join("\n");
    case "redo":
      // Reapply the change undone by the most recent reset (the reflog redo).
      return [
        ...absorb,
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        'git reset --hard "HEAD@{1}"',
        ...publish(true),
        'echo "Reapplied the last undone change"',
      ].join("\n");
  }
}

/** Map a git ShellResult to a uniform tool result, decoding the sentinel exits
 *  `buildGitCommand` emits (MERGE_CONFLICT / DIRTY) into actionable messages. */
function gitToolResult(action: GitAction, r: { ok: boolean; stdout?: string; exitCode?: number; error?: string }, paths?: readonly string[]): ToolResult {
  const out = (r.stdout ?? "").trim();
  if (action === "status" && r.ok) {
    // `output` keeps the raw `--short --branch` text (the ship verification parses its header);
    // the report beside it is what lets ONE call answer "committed? pushed? by whom?".
    const { output, report } = parseGitStatusOutput(out, paths);
    return { data: { ok: true, action, output: output.slice(0, 20_000), ...report, ...(r.error ? { error: r.error } : {}) } };
  }
  if (r.exitCode === 3 || /MERGE_CONFLICT/.test(out)) {
    return { data: { ok: false, action, error: "merge conflict — the base branch has changes that conflict with your branch; the merge was aborted (working tree is clean). Resolve by editing the conflicting files, or ask a human.", output: out } };
  }
  if (r.exitCode === 4 || /\bDIRTY\b/.test(out)) {
    return { data: { ok: false, action, error: "you have uncommitted changes — commit or discard them before git_" + action + " (it refuses to discard uncommitted work)." } };
  }
  return { data: { ok: r.ok, action, output: out.slice(0, 20_000), ...(r.error ? { error: r.error } : {}) } };
}

async function runGitTool(action: GitAction, opts: { path?: string; paths?: string[]; baseBranch?: string; limit?: number; repo?: string }, ctx: GitShellCtx): Promise<ToolResult> {
  const refused = invalidRepoResult(action, opts.repo);
  if (refused) return refused;
  const trackedBranch = ctx.caps.shell?.trackedBranch;
  // A sandbox clone has no credential: the sandbox itself does the remote half of the history-moving verbs (see
  // `buildGitCommand`'s `remoteViaSandbox`). Only those verbs, and only when the surface owns the branch.
  const remote = trackedBranch && (action === "sync_latest" || action === "undo" || action === "redo") ? ctx.caps.shell?.git : undefined;
  let baseBranch = opts.baseBranch;
  if (remote) {
    const synced = await remote.sync({ baseBranch: opts.baseBranch });
    if (!synced.ok) return { data: { ok: false, action, error: `could not fetch from the remote: ${synced.error ?? "unknown error"}` } };
    baseBranch = synced.baseBranch ?? baseBranch;
  }
  // "fatal: not a git repository" at the root is not the end of the road: the checkout
  // the path names, then the run's default — and if none is a repository, NAME the
  // candidates (never send the model to `list_files` for a list we can produce here).
  // `paths` (git_status) scope like `path` does: the first one names the checkout to try.
  const scope = { repo: opts.repo, path: opts.path ?? opts.paths?.[0] };
  const ran = await runInRepoScope(ctx, scope, async (repo, pathspecs) => {
    const cwd = safeRepoArg(repo) ?? undefined;
    const r = await shellRunWithStop(ctx, buildGitCommand(action, {
      baseBranch,
      limit: opts.limit,
      pathspecs,
      ...(opts.paths?.length ? { paths: opts.paths, ...(repo ? { repo } : {}) } : {}),
      ...(trackedBranch ? { trackedBranch } : {}),
      ...(remote ? { remoteViaSandbox: true } : {}),
    }), cwd);
    if (action !== "diff" || !isUnbornHead(r)) return r;
    // No commits yet ⇒ no HEAD: the diff is the staged half plus the unstaged half. Git's `fatal:` is dropped.
    const [staged, unstaged] = buildUnbornDiffCommands({ pathspecs });
    const a = await shellRunWithStop(ctx, staged!, cwd);
    if (!a.ok) return a;
    const b = await shellRunWithStop(ctx, unstaged!, cwd);
    if (!b.ok) return b;
    return { ...b, stdout: [a.stdout, b.stdout].map((s) => (s ?? "").trim()).filter(Boolean).join("\n") };
  });
  if (!ran) return notARepoWithCandidates(action, ctx);
  if (remote && ran.r.ok) {
    const published = await remote.publish({ force: action !== "sync_latest" });
    if (!published.ok) return { data: { ok: false, action, error: `the change was made locally but could not be published: ${published.error ?? "unknown error"}` } };
  }
  const result = gitToolResult(action, ran.r, opts.paths);
  // Say WHERE it ran whenever that was not the obvious place, so a later command in
  // the same run does not have to rediscover the scope.
  if (ran.repo && (result.data as { ok?: boolean }).ok) {
    (result.data as Record<string, unknown>).repo = ran.repo;
  }
  return result;
}

export const gitStatusTool: ToolDefinition = defineTool({
  name: "git_status",
  description:
    "ONE call answers \"is it committed? is it pushed? by whom?\" — do not chain git_diff / git_history / run_command `git log` for that. Returns the branch, its upstream, ahead/behind counts, and the staged / unstaged / untracked / conflicted files. Pass `paths` to limit it to those files AND get, for each, the last commit that touched it (sha, subject, author, date) and `onUpstream` (true = already pushed). A path with no uncommitted entry and `onUpstream: true` is committed and pushed — possibly by someone else; the author says who. If the open folder contains several checkouts rather than being one repo, pass `repo` to name the one you mean.",
  parameters: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" }, description: `Optional files/dirs to ask about (at most ${GIT_STATUS_MAX_PATHS}): limits the entries to them and reports each one's last commit and whether it is pushed.` },
      repo: REPO_PARAM,
    },
  },
  requires: ["shell"],
  execute: (args, ctx) => {
    const paths = statusPaths(Array.isArray(args.paths) ? args.paths : undefined);
    return runGitTool("status", { repo: typeof args.repo === "string" ? args.repo : undefined, ...(paths.length ? { paths } : {}) }, ctx);
  },
});

export const gitDiffTool: ToolDefinition = defineTool({
  name: "git_diff",
  description: "Show the uncommitted diff of your working tree (optionally for one path). Use it to review exactly what you changed before finishing.",
  parameters: { type: "object", properties: { path: { type: "string", description: "Optional file/dir to scope the diff to — repo-relative or workspace-relative (with the repo folder prefix); both are accepted." }, repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("diff", { path: typeof args.path === "string" ? args.path : undefined, repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

export const gitHistoryTool: ToolDefinition = defineTool({
  name: "git_history",
  description: "Show recent commit history (git log --oneline), optionally scoped to a path. Use it to understand how a file evolved before changing it.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional file/dir to scope history to — repo-relative or workspace-relative (with the repo folder prefix); both are accepted." },
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
