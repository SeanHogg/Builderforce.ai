/**
 * The git PUBLISH and CLEANUP tools — commit, push, pull request, post-merge cleanup —
 * and the pure script builders behind them. Split out of `git-tools.ts` (which keeps the
 * read / sync / rewind verbs and re-exports these, so every import path still works and
 * `GIT_TOOLS` lists them in the same order).
 */

import { defineTool, type ToolDefinition, type ToolResult } from "./tool.js";
import {
  commitPathCandidates,
  invalidRepoResult,
  notARepoWithCandidates,
  runInRepoScope,
  safeGitArg,
  safeRepoArg,
  shellQuote,
  shellRunWithStop,
  type GitShellCtx,
} from "./git-repo-scope.js";
import { REPO_PARAM, RESOLVE_BASE } from "./git-script-parts.js";

// ── Publishing: commit → push → pull request ─────────────────────────────────────
//
// The read git tools (`git-tools.ts`) READ, sync and rewind; none of them could move work out of the
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
function buildCommitCommand(opts: { message: string; paths: string[]; branch?: string; allowBaseBranch?: boolean; repo?: string }): string {
  const branch = safeGitArg(opts.branch);
  // Resolve each path to a shell variable holding the candidate that actually exists,
  // so `git add` is handed real paths or the run stops with a message naming the ones
  // it could not find — never a silent empty stage.
  const resolveLines = opts.paths.map((p, i) => {
    const candidates = commitPathCandidates(p, opts.repo).map(shellQuote).join(" ");
    // The path goes into MISSING as its own SINGLE-QUOTED word, concatenated after the
    // double-quoted prefix: stripping the quotes and splicing it inside "…" let a
    // nonexistent path like `$(touch pwned)` or `` `id` `` execute.
    return `P${i}="$(pick ${candidates})" || MISSING="$MISSING "${shellQuote(p)}`;
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
function buildPushCommand(opts: { allowBaseBranch?: boolean }): string {
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
function buildPullRequestCommand(opts: { title: string; body: string; base?: string; reviewers?: string[] }): string {
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
function buildCleanupCommand(opts: { branch?: string; baseBranch?: string; force?: boolean }): string {
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
  command: string | ((repo: string | undefined) => string),
  repo: string | undefined,
  ctx: GitShellCtx,
): Promise<ToolResult> {
  const refused = invalidRepoResult(action, repo);
  if (refused) return refused;
  // A builder, when the script's own text depends on the repo (commit's path candidates).
  const build = (scope: string | undefined): string => (typeof command === "string" ? command : command(scope));
  const ran = await runInRepoScope(ctx, repo ? { repo } : {}, (scope) => shellRunWithStop(ctx, build(scope), safeRepoArg(scope) ?? undefined));
  if (!ran) return notARepoWithCandidates(action, ctx);
  const result = publishToolResult(action, ran.r);
  if (ran.repo && (result.data as { ok?: boolean }).ok) (result.data as Record<string, unknown>).repo = ran.repo;
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
      (scope) => buildCommitCommand({ message, paths, branch: typeof args.branch === "string" ? args.branch : undefined, allowBaseBranch: args.allowBaseBranch === true, repo: scope }),
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
    return runPublishTool("push", buildPushCommand({ allowBaseBranch: args.allowBaseBranch === true }), repo, ctx);
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
      buildPullRequestCommand({ title, body, base: typeof args.base === "string" ? args.base : undefined, reviewers }),
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
      }),
      repo,
      ctx,
    );
  },
});
