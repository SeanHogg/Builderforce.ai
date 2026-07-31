/**
 * Task PR Status Tracker tool
 *
 * Queries GitHub to determine which development tasks have their associated
 * Pull Requests merged vs still open. Accepts a list of task identifiers,
 * searches PRs whose title / body / branch name reference those IDs, and
 * produces a structured report.
 *
 * Requires: GITHUB_TOKEN in the environment (or process.env.GITHUB_TOKEN).
 *
 * Usage by an agent:
 *   task_pr_status({ taskIds: ["PROJ-42", "PROJ-57"], owner: "myorg", repo: "myrepo" })
 *   task_pr_status({ taskIds: ["123", "456"], owner: "myorg" })  // scans all repos in org
 */

import type { AgentTool, AgentToolResult } from "../model/agent-types.js";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const TaskPrStatusSchema = Type.Object({
  taskIds: Type.Array(Type.String(), {
    description: "List of task identifiers to check (e.g. Jira ticket numbers, internal tracking IDs).",
  }),
  owner: Type.String({
    description: "GitHub organization or user that owns the repository(ies).",
  }),
  repo: Type.Optional(
    Type.String({
      description:
        "Specific repository to search within. If omitted, all repos accessible to the token in the org are scanned.",
    }),
  ),
});

type TaskPrStatusParams = {
  taskIds: string[];
  owner: string;
  repo?: string;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GhPullRequest {
  number: number;
  title: string;
  html_url: string;
  state: string; // "open" | "closed"
  merged_at: string | null;
  user: { login: string } | null;
  created_at: string;
}

interface PrResult {
  number: number;
  title: string;
  url: string;
  state: "Open" | "Merged" | "Closed (Unmerged)";
  author: string | null;
  createdAt: string;
}

interface TaskStatus {
  taskId: string;
  prs: PrResult[];
  summary: "All PRs Merged" | "PR(s) Open" | "No PR Found";
}

interface TrackerReport {
  tasks: TaskStatus[];
  summary: {
    totalTasks: number;
    allMerged: number;
    someOpen: number;
    noPrFound: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build standard GitHub API fetch headers. */
function ghHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "BuilderForceAgents/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Search PRs across a specific repo for references to a task ID.
 * Matches the ID in PR title, body (via search qualifier `in:title,body`),
 * and also pulls the open/closed lists to catch branch-name references.
 */
async function searchPrsForTaskId(
  owner: string,
  repo: string,
  taskId: string,
  token: string,
): Promise<GhPullRequest[]> {
  const results: Map<number, GhPullRequest> = new Map();

  // Strategy 1 — GitHub issue/PR search: `type:pr` + the task ID in title/body.
  // This catches the common case where a PR title or description mentions the
  // task ID (e.g. "Fix PROJ-42 …" or "Closes #PROJ-42").
  try {
    const q = encodeURIComponent(`"${taskId}" type:pr repo:${owner}/${repo} in:title,body`);
    const url = `https://api.github.com/search/issues?q=${q}&per_page=30`;
    const res = await fetch(url, { headers: ghHeaders(token) });
    if (res.ok) {
      const data = (await res.json()) as {
        items?: Array<{
          number: number;
          title: string;
          html_url: string;
          state: string;
          pull_request?: unknown;
          user: { login: string } | null;
          created_at: string;
        }>;
      };
      for (const item of data.items ?? []) {
        // The search/issues endpoint returns issues; PRs have a pull_request field.
        // `type:pr` already filters, but we double-check.
        if (item.pull_request == null) continue;
        if (results.has(item.number)) continue;
        // We have to fetch individual PR to get merged_at (search doesn't include it).
        const prDetail = await fetchPrDetail(owner, repo, item.number, token);
        if (prDetail) {
          results.set(item.number, {
            number: prDetail.number,
            title: prDetail.title,
            html_url: prDetail.html_url,
            state: prDetail.state,
            merged_at: prDetail.merged_at,
            user: prDetail.user,
            created_at: prDetail.created_at,
          });
        }
      }
    }
  } catch {
    // Non-fatal: continue to strategy 2.
  }

  // Strategy 2 — list open PRs and filter by branch name / title containing
  // the task ID. Catches PRs that don't mention the ID in the body (e.g. the
  // branch name `feature/PROJ-42-fix-login` is how the ID is associated).
  try {
    const openUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`;
    const openRes = await fetch(openUrl, { headers: ghHeaders(token) });
    if (openRes.ok) {
      const pulls = (await openRes.json()) as Array<{
        number: number;
        title: string;
        html_url: string;
        state: string;
        merged_at: string | null;
        user: { login: string } | null;
        created_at: string;
        head: { ref: string };
        body: string | null;
      }>;
      for (const pr of pulls) {
        if (results.has(pr.number)) continue;
        if (
          pr.title.includes(taskId) ||
          (pr.body ?? "").includes(taskId) ||
          (pr.head?.ref ?? "").includes(taskId)
        ) {
          results.set(pr.number, {
            number: pr.number,
            title: pr.title,
            html_url: pr.html_url,
            state: pr.state,
            merged_at: pr.merged_at,
            user: pr.user,
            created_at: pr.created_at,
          });
        }
      }
    }
  } catch {
    // Non-fatal.
  }

  // Strategy 3 — list recently closed PRs (merged + unmerged). The open-list
  // above only returns open PRs; closed ones also match.
  try {
    const closedUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&per_page=100&sort=updated&direction=desc`;
    const closedRes = await fetch(closedUrl, { headers: ghHeaders(token) });
    if (closedRes.ok) {
      const pulls = (await closedRes.json()) as Array<{
        number: number;
        title: string;
        html_url: string;
        state: string;
        merged_at: string | null;
        user: { login: string } | null;
        created_at: string;
        head: { ref: string };
        body: string | null;
      }>;
      for (const pr of pulls) {
        if (results.has(pr.number)) continue;
        if (
          pr.title.includes(taskId) ||
          (pr.body ?? "").includes(taskId) ||
          (pr.head?.ref ?? "").includes(taskId)
        ) {
          results.set(pr.number, {
            number: pr.number,
            title: pr.title,
            html_url: pr.html_url,
            state: pr.state,
            merged_at: pr.merged_at,
            user: pr.user,
            created_at: pr.created_at,
          });
        }
      }
    }
  } catch {
    // Non-fatal.
  }

  return Array.from(results.values());
}

/** Fetch a single PR's detail (needed for merged_at from search results). */
async function fetchPrDetail(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<GhPullRequest | null> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`;
    const res = await fetch(url, { headers: ghHeaders(token) });
    if (!res.ok) return null;
    const pr = (await res.json()) as {
      number: number;
      title: string;
      html_url: string;
      state: string;
      merged_at: string | null;
      user: { login: string } | null;
      created_at: string;
    };
    return {
      number: pr.number,
      title: pr.title,
      html_url: pr.html_url,
      state: pr.state,
      merged_at: pr.merged_at,
      user: pr.user,
      created_at: pr.created_at,
    };
  } catch {
    return null;
  }
}

/** List all repos in an org (paginated). */
async function listOrgRepos(
  owner: string,
  token: string,
): Promise<Array<{ name: string }>> {
  const repos: Array<{ name: string }> = [];
  let page = 1;
  while (page <= 5) {
    try {
      const url = `https://api.github.com/orgs/${owner}/repos?per_page=100&page=${page}&sort=updated`;
      const res = await fetch(url, { headers: ghHeaders(token) });
      if (!res.ok) break;
      const pageRepos = (await res.json()) as Array<{ name: string }>;
      if (pageRepos.length === 0) break;
      repos.push(...pageRepos);
      page++;
    } catch {
      break;
    }
  }
  return repos;
}

/** Map GitHub state + merged_at → human-readable PR status. */
function classifyPrStatus(pr: GhPullRequest): PrResult["state"] {
  if (pr.merged_at != null) return "Merged";
  if (pr.state === "closed") return "Closed (Unmerged)";
  return "Open";
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export async function runTaskPrStatus(
  params: TaskPrStatusParams,
): Promise<TrackerReport> {
  const { taskIds, owner, repo } = params;

  // Resolve GitHub token
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Export it in your environment or set it in .builderForceAgents config env.vars.",
    );
  }

  // Determine which repos to scan
  let reposToScan: string[];
  if (repo) {
    reposToScan = [repo];
  } else {
    const orgRepos = await listOrgRepos(owner, token);
    reposToScan = orgRepos.map((r) => r.name);
    if (reposToScan.length === 0) {
      // Fallback: try the owner AS a repo name (user-owned single repo)
      reposToScan = [owner];
    }
  }

  // For each task ID, search across all target repos
  const tasks: TaskStatus[] = [];

  for (const taskId of taskIds) {
    const allPrs: GhPullRequest[] = [];

    for (const scanRepo of reposToScan) {
      try {
        const prs = await searchPrsForTaskId(owner, scanRepo, taskId, token);
        allPrs.push(...prs);
      } catch {
        // Non-fatal: skip this repo.
      }
    }

    // Deduplicate by PR number (same PR may appear across strategies/repos).
    const deduped = new Map<number, GhPullRequest>();
    for (const pr of allPrs) {
      if (!deduped.has(pr.number)) {
        deduped.set(pr.number, pr);
      }
    }

    const prResults: PrResult[] = Array.from(deduped.values()).map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: classifyPrStatus(pr),
      author: pr.user?.login ?? null,
      createdAt: pr.created_at,
    }));

    // Sort by PR number descending (newest first typically).
    prResults.sort((a, b) => b.number - a.number);

    let summary: TaskStatus["summary"];
    if (prResults.length === 0) {
      summary = "No PR Found";
    } else if (prResults.every((p) => p.state === "Merged")) {
      summary = "All PRs Merged";
    } else {
      summary = "PR(s) Open";
    }

    tasks.push({ taskId, prs: prResults, summary });
  }

  const summary = {
    totalTasks: tasks.length,
    allMerged: tasks.filter((t) => t.summary === "All PRs Merged").length,
    someOpen: tasks.filter((t) => t.summary === "PR(s) Open").length,
    noPrFound: tasks.filter((t) => t.summary === "No PR Found").length,
  };

  return { tasks, summary };
}

// ---------------------------------------------------------------------------
// Legacy pi AgentTool wrapper
// ---------------------------------------------------------------------------

export const taskPrStatusTool: AgentTool<typeof TaskPrStatusSchema, string> = {
  name: "task_pr_status",
  label: "Task PR Status Tracker",
  description:
    "Check Pull Request status for a set of task IDs across GitHub repositories. " +
    "Returns which tasks have all PRs merged, which have open PRs, and which have no PRs found. " +
    "Requires GITHUB_TOKEN in the environment.",
  parameters: TaskPrStatusSchema,
  async execute(
    _toolCallId: string,
    params: TaskPrStatusParams,
  ): Promise<AgentToolResult<string>> {
    try {
      const report = await runTaskPrStatus(params);
      return jsonResult(report) as AgentToolResult<string>;
    } catch (err) {
      return jsonResult({
        error: String(err),
        taskIds: params.taskIds,
      }) as AgentToolResult<string>;
    }
  },
};
