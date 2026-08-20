/**
 * runCodingDispatch — the headless agentHost coding flow for a swimlane
 * `agent_dispatch` frame. This is the runtime side of the cloud-coding loop:
 *
 *   1. fetch the dispatch detail (task input + repo coords + host git-proxy path)
 *   2. clone the repo through the HOST git-proxy (token injected server-side)
 *   3. run the embedded agent session against the cloned workspace (it edits code)
 *   4. commit + push the working branch through the same proxy
 *   5. open a PR via the host PR endpoint
 *   6. report the terminal result so the SwimlaneCoordinator advances the ticket
 *
 * Pure orchestration over injected ports (http / git / agent) so it is unit
 * testable without a network, a real git, or a live gateway. The relay supplies
 * the concrete adapters in builderforce-coding-dispatch-adapters.ts.
 */

import { createGitRepoSync, type RepoSyncGitOps, type RepoSyncStrategy } from "./repo-sync.js";

export interface DispatchRepoDetail {
  repoId: string;
  provider: string;
  owner: string;
  repo: string;
  defaultBranch: string | null;
  /** Relative host git-proxy path, e.g. /api/agent-hosts/12/git-proxy/<repoId>. */
  gitProxyPath: string;
}

/**
 * The IDE workspace (R2) a repo-less dispatch codes against.
 *
 * WHY THIS EXISTS — the decision, in one place: a project created from the Brain
 * has no connected git repo, and the tenant behind it usually has no connected git
 * PROVIDER either (zero-setup onboarding creates a workspace + project before any
 * OAuth). So "auto-provision a scratch repo at project-create" cannot run for the
 * exact projects that need it. The IDE workspace, in contrast, ALWAYS exists — it
 * is the same tree the Designer and the WebContainer preview build against — needs
 * no credential and no external call. So a repo-less coding dispatch gets the
 * workspace as its working tree and writes REAL FILES; reasoning-only is now only
 * reached when there is neither a repo nor a workspace, and says which.
 *
 * The trade is explicit: a workspace run produces files, not a branch and not a
 * PR. Connecting a repo later pushes the workspace into it through the existing
 * IDE commit path. Server side: application/ide/taskWorkspaceTarget.ts.
 */
export interface DispatchWorkspaceDetail {
  /** The `projects` row whose R2 prefix holds the files. */
  projectId: number;
  projectName: string;
  /** Relative host workspace path, e.g. /api/agent-hosts/12/workspace/34/files. */
  filesPath: string;
}

export interface DispatchDetail {
  dispatchId: string;
  role: string;
  input: string | null;
  model: string | null;
  taskId: number | null;
  repo: DispatchRepoDetail | null;
  /** Present only when `repo` is null — the fallback working tree. */
  workspace?: DispatchWorkspaceDetail | null;
}

/** One workspace file, as carried between the host API and the local working tree. */
export interface WorkspaceFile {
  path: string;
  content: string;
}

/** What a workspace run changed, derived by diffing the tree before/after. */
export interface WorkspaceChangeSet {
  writes: WorkspaceFile[];
  deletes: string[];
}

export interface CodingDispatchHttp {
  /** GET host dispatch detail; null when not found / unauthorized. */
  fetchDispatchDetail(dispatchId: string): Promise<DispatchDetail | null>;
  /** POST the host PR-open endpoint; null when unsupported / failed (branch is still pushed). */
  openPullRequest(
    dispatchId: string,
    pr: { branch: string; base?: string; title?: string; body?: string },
  ): Promise<{ url: string; number: number } | null>;
  /** GET the project's IDE workspace tree (repo-less dispatch); null when unavailable. */
  fetchWorkspaceFiles(
    filesPath: string,
  ): Promise<{ files: WorkspaceFile[]; truncated: boolean } | null>;
  /** POST the workspace changes back; null when the push failed. */
  pushWorkspaceChanges(
    filesPath: string,
    body: { taskId: number | null; agent: string } & WorkspaceChangeSet,
  ): Promise<{ written: number; deleted: number; rejected: Array<{ path: string; reason: string }> } | null>;
  /** POST the terminal result so the swimlane advances. */
  reportResult(
    dispatchId: string,
    result: { status: "completed" | "failed"; output?: string; error?: string },
  ): Promise<void>;
}

export interface CodingDispatchGit extends RepoSyncGitOps {
  /** Stage + commit everything; returns whether anything was committed. */
  commitAll(dir: string, message: string): Promise<{ changed: boolean }>;
  /** Push `branch` from `dir` to `cloneUrl`. */
  push(dir: string, cloneUrl: string, branch: string): Promise<void>;
}

/**
 * Local-disk port for the workspace path. Kept behind an interface (rather than
 * importing node:fs here) so the orchestration below stays unit-testable without a
 * real filesystem — the same reason `git` is a port.
 */
export interface CodingDispatchFs {
  /** Materialise `files` under `dir`, creating parent directories. */
  materialize(dir: string, files: WorkspaceFile[]): Promise<void>;
  /** Every text file under `dir`, workspace-relative, for diffing after the run. */
  snapshot(dir: string): Promise<WorkspaceFile[]>;
}

export interface CodingDispatchAgent {
  /** Run the local agent on `sessionKey` with `message`; resolves on completion. */
  run(sessionKey: string, message: string): Promise<{ ok: boolean; summary: string }>;
}

export interface CodingDispatchDeps {
  http: CodingDispatchHttp;
  git: CodingDispatchGit;
  agent: CodingDispatchAgent;
  /** Local-disk port for the workspace path. Absent ⇒ that path is unavailable. */
  fs?: CodingDispatchFs;
  /**
   * Strategy that ensures the workspace holds the latest code on the right
   * branch before the agent runs. Defaults to the git-backed strategy over
   * `git`; injectable so tests and alternate agents can swap repo-prep policy.
   */
  repoSync?: RepoSyncStrategy;
  /** Absolute base URL of Builderforce, e.g. https://api.builderforce.ai. */
  baseUrl: string;
  /** Directory under which per-dispatch clones are created (the agent's workspace). */
  workspaceDir: string;
  /** Join path segments (injected so the module stays free of node:path in tests). */
  joinPath: (...parts: string[]) => string;
}

/** A short, branch-safe slug derived from arbitrary text. */
export function codingBranchSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "task"
  );
}

/** The instruction sent to the embedded agent for a repo-targeted dispatch. */
export function buildCodingPrompt(detail: DispatchDetail, dir: string): string {
  return [
    `You are the "${detail.role}" coding agent. A git repository is checked out at:`,
    `  ${dir}`,
    `It is already on a fresh working branch. Implement the task below by editing files in that directory.`,
    `Do NOT run git commit/push — that is handled for you after you finish. Just make the code changes.`,
    "",
    "TASK:",
    (detail.input ?? "").trim() || "No task description was provided.",
  ].join("\n");
}

/**
 * Execute one coding dispatch end-to-end. Never throws: every failure path
 * reports a terminal result so the swimlane stage cannot hang.
 */
export async function runCodingDispatch(
  deps: CodingDispatchDeps,
  dispatchId: string,
): Promise<void> {
  const { http, git, agent } = deps;

  let detail: DispatchDetail | null;
  try {
    detail = await http.fetchDispatchDetail(dispatchId);
  } catch (err) {
    await http.reportResult(dispatchId, {
      status: "failed",
      error: `fetch detail failed: ${errText(err)}`,
    });
    return;
  }
  if (!detail) {
    await http.reportResult(dispatchId, { status: "failed", error: "Dispatch detail not found" });
    return;
  }

  // No repo bound → the IDE workspace is the working tree (see
  // DispatchWorkspaceDetail for why this, and not an auto-provisioned scratch
  // repo). Only when there is NO workspace either does this degrade to prose.
  if (!detail.repo) {
    if (detail.workspace && deps.fs) {
      await runWorkspaceDispatch(deps, dispatchId, detail, detail.workspace, deps.fs);
      return;
    }
    // LAST RESORT — reached only when the server offered no repo AND no workspace
    // (or this runtime build has no disk port). The reason is reported, so
    // "the coder returned prose" is never again an unexplained default.
    const reason = detail.workspace
      ? "this runtime has no filesystem port, so the project workspace could not be used"
      : "this task's project has neither a connected git repository nor an IDE workspace";
    const r = await agent.run(`dispatch-${dispatchId}`, buildReasoningPrompt(detail, reason));
    const note = `\n\nNo files were written: ${reason}.`;
    await http.reportResult(
      dispatchId,
      r.ok
        ? { status: "completed", output: `${r.summary}${note}`.trim() }
        : { status: "failed", error: r.summary },
    );
    return;
  }

  const repo = detail.repo;
  const dir = deps.joinPath(deps.workspaceDir, `dispatch-${dispatchId}`);
  const cloneUrl = `${deps.baseUrl.replace(/\/$/, "")}${repo.gitProxyPath}`;
  const branch = `agent/${dispatchId.slice(0, 8)}-${codingBranchSlug(detail.input ?? detail.role)}`;

  // Modular repo preparation: ensure the latest code is checked out on a fresh
  // working branch. The policy lives in the repo-sync strategy, not inline here.
  const repoSync = deps.repoSync ?? createGitRepoSync(git);
  const prep = await repoSync.prepare({
    dir,
    repo: { cloneUrl, defaultBranch: repo.defaultBranch },
    workBranch: branch,
    mode: "new-branch",
  });
  if (!prep.ok) {
    await http.reportResult(dispatchId, {
      status: "failed",
      error: `repo sync failed: ${prep.error}`,
    });
    return;
  }

  const agentResult = await agent.run(`dispatch-${dispatchId}`, buildCodingPrompt(detail, dir));
  if (!agentResult.ok) {
    await http.reportResult(dispatchId, {
      status: "failed",
      error: agentResult.summary || "Agent run failed",
    });
    return;
  }

  let committed: { changed: boolean };
  try {
    committed = await git.commitAll(dir, commitMessage(detail));
  } catch (err) {
    await http.reportResult(dispatchId, {
      status: "failed",
      error: `commit failed: ${errText(err)}`,
    });
    return;
  }

  if (!committed.changed) {
    await http.reportResult(dispatchId, {
      status: "completed",
      output: `${agentResult.summary}\n\nNo file changes were produced; nothing to push.`.trim(),
    });
    return;
  }

  try {
    await git.push(dir, cloneUrl, branch);
  } catch (err) {
    await http.reportResult(dispatchId, {
      status: "failed",
      error: `push failed: ${errText(err)}`,
    });
    return;
  }

  // Open the PR (best-effort: an unsupported provider still leaves the branch pushed).
  let pr: { url: string; number: number } | null = null;
  try {
    pr = await http.openPullRequest(dispatchId, {
      branch,
      base: repo.defaultBranch ?? undefined,
      title: commitMessage(detail),
      body: agentResult.summary,
    });
  } catch {
    pr = null;
  }

  const output = pr
    ? `${agentResult.summary}\n\nPushed ${branch} and opened PR #${pr.number}: ${pr.url}`.trim()
    : `${agentResult.summary}\n\nPushed ${branch} (no PR opened — open one manually).`.trim();
  await http.reportResult(dispatchId, { status: "completed", output });
}

function buildReasoningPrompt(detail: DispatchDetail, reason?: string): string {
  return [
    `You are the "${detail.role}" agent. Complete the following task and return your result.`,
    ...(reason
      ? [
          "",
          `NOTE: you have no writable working tree for this task (${reason}). You cannot`,
          `create files. Return the complete deliverable inline in your answer instead.`,
        ]
      : []),
    "",
    (detail.input ?? "").trim() || "No task description was provided.",
  ].join("\n");
}

/** The instruction sent to the agent for a WORKSPACE-targeted dispatch. */
export function buildWorkspacePrompt(
  detail: DispatchDetail,
  workspace: DispatchWorkspaceDetail,
  dir: string,
): string {
  return [
    `You are the "${detail.role}" coding agent. The project "${workspace.projectName}" is`,
    `checked out at:`,
    `  ${dir}`,
    `This is the project's live IDE workspace. It is NOT a git repository: implement the`,
    `task by editing/creating files in that directory and nothing else. Do not run git.`,
    `Every file you leave behind is saved back to the project workspace when you finish,`,
    `so it opens in the IDE and runs in the preview.`,
    "",
    "TASK:",
    (detail.input ?? "").trim() || "No task description was provided.",
  ].join("\n");
}

/**
 * Execute one REPO-LESS coding dispatch against the project's IDE workspace:
 * pull the tree → materialise it locally → run the agent → diff → push the
 * changes back. Same shape as the git path (prepare, run, land, report) with R2
 * standing in for clone/commit/push; the terminal result is always reported.
 */
async function runWorkspaceDispatch(
  deps: CodingDispatchDeps,
  dispatchId: string,
  detail: DispatchDetail,
  workspace: DispatchWorkspaceDetail,
  fs: CodingDispatchFs,
): Promise<void> {
  const { http, agent } = deps;
  const dir = deps.joinPath(deps.workspaceDir, `dispatch-${dispatchId}`);

  const tree = await http.fetchWorkspaceFiles(workspace.filesPath).catch(() => null);
  if (!tree) {
    await http.reportResult(dispatchId, {
      status: "failed",
      error: `workspace fetch failed for project ${workspace.projectId}`,
    });
    return;
  }

  try {
    await fs.materialize(dir, tree.files);
  } catch (err) {
    await http.reportResult(dispatchId, {
      status: "failed",
      error: `workspace materialize failed: ${errText(err)}`,
    });
    return;
  }

  const before = new Map(tree.files.map((f) => [f.path, f.content] as const));
  const agentResult = await agent.run(
    `dispatch-${dispatchId}`,
    buildWorkspacePrompt(detail, workspace, dir),
  );
  if (!agentResult.ok) {
    await http.reportResult(dispatchId, {
      status: "failed",
      error: agentResult.summary || "Agent run failed",
    });
    return;
  }

  let after: WorkspaceFile[];
  try {
    after = await fs.snapshot(dir);
  } catch (err) {
    await http.reportResult(dispatchId, {
      status: "failed",
      error: `workspace snapshot failed: ${errText(err)}`,
    });
    return;
  }

  const changes = diffWorkspace(before, after, tree.truncated);
  if (changes.writes.length === 0 && changes.deletes.length === 0) {
    await http.reportResult(dispatchId, {
      status: "completed",
      output: `${agentResult.summary}\n\nNo file changes were produced; nothing to save.`.trim(),
    });
    return;
  }

  const pushed = await http
    .pushWorkspaceChanges(workspace.filesPath, {
      taskId: detail.taskId,
      agent: detail.role,
      writes: changes.writes,
      deletes: changes.deletes,
    })
    .catch(() => null);
  if (!pushed) {
    await http.reportResult(dispatchId, {
      status: "failed",
      error: `workspace save failed for project ${workspace.projectId}`,
    });
    return;
  }

  const rejected = pushed.rejected.length
    ? `\n\n${pushed.rejected.length} file(s) were rejected: ${pushed.rejected
        .map((r) => `${r.path} (${r.reason})`)
        .join("; ")}`
    : "";
  const removed = pushed.deleted ? ` and removed ${pushed.deleted}` : "";
  await http.reportResult(dispatchId, {
    status: "completed",
    output:
      `${agentResult.summary}\n\nSaved ${pushed.written} file(s)${removed} to the ` +
      `"${workspace.projectName}" workspace (no git repo is connected, so no branch ` +
      `or PR was created).${rejected}`.trim(),
  });
}

/**
 * Which files the agent actually changed. A file present before and unchanged is
 * not re-uploaded; a file the agent deleted is only reported as a delete when the
 * tree we handed it was COMPLETE — on a truncated tree an absent file may simply
 * never have been materialised, and deleting real project files on that basis
 * would be destructive.
 */
export function diffWorkspace(
  before: Map<string, string>,
  after: WorkspaceFile[],
  truncated: boolean,
): WorkspaceChangeSet {
  const writes: WorkspaceFile[] = [];
  const seen = new Set<string>();
  for (const file of after) {
    seen.add(file.path);
    if (before.get(file.path) !== file.content) writes.push(file);
  }
  const deletes = truncated ? [] : [...before.keys()].filter((p) => !seen.has(p));
  return { writes, deletes };
}

function commitMessage(detail: DispatchDetail): string {
  const first = (detail.input ?? "").trim().split("\n")[0]?.slice(0, 72);
  return first ? `feat: ${first}` : `chore: agent changes for ${detail.role}`;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
