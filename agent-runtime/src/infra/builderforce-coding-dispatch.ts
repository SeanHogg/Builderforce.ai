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

export interface DispatchRepoDetail {
  repoId: string;
  provider: string;
  owner: string;
  repo: string;
  defaultBranch: string | null;
  /** Relative host git-proxy path, e.g. /api/agent-hosts/12/git-proxy/<repoId>. */
  gitProxyPath: string;
}

export interface DispatchDetail {
  dispatchId: string;
  role: string;
  input: string | null;
  model: string | null;
  taskId: number | null;
  repo: DispatchRepoDetail | null;
}

export interface CodingDispatchHttp {
  /** GET host dispatch detail; null when not found / unauthorized. */
  fetchDispatchDetail(dispatchId: string): Promise<DispatchDetail | null>;
  /** POST the host PR-open endpoint; null when unsupported / failed (branch is still pushed). */
  openPullRequest(
    dispatchId: string,
    pr: { branch: string; base?: string; title?: string; body?: string },
  ): Promise<{ url: string; number: number } | null>;
  /** POST the terminal result so the swimlane advances. */
  reportResult(
    dispatchId: string,
    result: { status: 'completed' | 'failed'; output?: string; error?: string },
  ): Promise<void>;
}

export interface CodingDispatchGit {
  /** Clone `cloneUrl` (an absolute host git-proxy URL) into `dir` at `branch`. */
  clone(cloneUrl: string, dir: string, branch: string | null): Promise<void>;
  /** Create and switch to a new working branch in `dir`. */
  checkoutNewBranch(dir: string, branch: string): Promise<void>;
  /** Stage + commit everything; returns whether anything was committed. */
  commitAll(dir: string, message: string): Promise<{ changed: boolean }>;
  /** Push `branch` from `dir` to `cloneUrl`. */
  push(dir: string, cloneUrl: string, branch: string): Promise<void>;
}

export interface CodingDispatchAgent {
  /** Run the local agent on `sessionKey` with `message`; resolves on completion. */
  run(sessionKey: string, message: string): Promise<{ ok: boolean; summary: string }>;
}

export interface CodingDispatchDeps {
  http: CodingDispatchHttp;
  git: CodingDispatchGit;
  agent: CodingDispatchAgent;
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
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'task'
  );
}

/** The instruction sent to the embedded agent for a repo-targeted dispatch. */
export function buildCodingPrompt(detail: DispatchDetail, dir: string): string {
  return [
    `You are the "${detail.role}" coding agent. A git repository is checked out at:`,
    `  ${dir}`,
    `It is already on a fresh working branch. Implement the task below by editing files in that directory.`,
    `Do NOT run git commit/push — that is handled for you after you finish. Just make the code changes.`,
    '',
    'TASK:',
    (detail.input ?? '').trim() || 'No task description was provided.',
  ].join('\n');
}

/**
 * Execute one coding dispatch end-to-end. Never throws: every failure path
 * reports a terminal result so the swimlane stage cannot hang.
 */
export async function runCodingDispatch(deps: CodingDispatchDeps, dispatchId: string): Promise<void> {
  const { http, git, agent } = deps;

  let detail: DispatchDetail | null;
  try {
    detail = await http.fetchDispatchDetail(dispatchId);
  } catch (err) {
    await http.reportResult(dispatchId, { status: 'failed', error: `fetch detail failed: ${errText(err)}` });
    return;
  }
  if (!detail) {
    await http.reportResult(dispatchId, { status: 'failed', error: 'Dispatch detail not found' });
    return;
  }

  // No repo bound → reasoning-only: run the agent and report its text.
  if (!detail.repo) {
    const r = await agent.run(`dispatch-${dispatchId}`, buildReasoningPrompt(detail));
    await http.reportResult(
      dispatchId,
      r.ok ? { status: 'completed', output: r.summary } : { status: 'failed', error: r.summary },
    );
    return;
  }

  const repo = detail.repo;
  const dir = deps.joinPath(deps.workspaceDir, `dispatch-${dispatchId}`);
  const cloneUrl = `${deps.baseUrl.replace(/\/$/, '')}${repo.gitProxyPath}`;
  const branch = `agent/${dispatchId.slice(0, 8)}-${codingBranchSlug(detail.input ?? detail.role)}`;

  try {
    await git.clone(cloneUrl, dir, repo.defaultBranch);
    await git.checkoutNewBranch(dir, branch);
  } catch (err) {
    await http.reportResult(dispatchId, { status: 'failed', error: `clone failed: ${errText(err)}` });
    return;
  }

  const agentResult = await agent.run(`dispatch-${dispatchId}`, buildCodingPrompt(detail, dir));
  if (!agentResult.ok) {
    await http.reportResult(dispatchId, { status: 'failed', error: agentResult.summary || 'Agent run failed' });
    return;
  }

  let committed: { changed: boolean };
  try {
    committed = await git.commitAll(dir, commitMessage(detail));
  } catch (err) {
    await http.reportResult(dispatchId, { status: 'failed', error: `commit failed: ${errText(err)}` });
    return;
  }

  if (!committed.changed) {
    await http.reportResult(dispatchId, {
      status: 'completed',
      output: `${agentResult.summary}\n\nNo file changes were produced; nothing to push.`.trim(),
    });
    return;
  }

  try {
    await git.push(dir, cloneUrl, branch);
  } catch (err) {
    await http.reportResult(dispatchId, { status: 'failed', error: `push failed: ${errText(err)}` });
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
  await http.reportResult(dispatchId, { status: 'completed', output });
}

function buildReasoningPrompt(detail: DispatchDetail): string {
  return [
    `You are the "${detail.role}" agent. Complete the following task and return your result.`,
    '',
    (detail.input ?? '').trim() || 'No task description was provided.',
  ].join('\n');
}

function commitMessage(detail: DispatchDetail): string {
  const first = (detail.input ?? '').trim().split('\n')[0]?.slice(0, 72);
  return first ? `feat: ${first}` : `chore: agent changes for ${detail.role}`;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
