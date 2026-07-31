/**
 * Task PR Status Tracker tool (PRD #202)
 *
 * Queries GitHub to determine which development tasks have their associated
 * Pull Requests merged vs still open. Accepts a list of task identifiers,
 * searches PRs whose title / body / branch name reference those IDs, and
 * produces a structured report plus a human-readable summary (AC5/F5).
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

export interface GhPullRequest {
  number: number;
  title: string;
  html_url: string;
  state: string; // "open" | "closed"
  merged_at: string | null;
  user: { login: string } | null;
  created_at: string;
  /** Repository the PR was found in ("owner/name"). Set when scanning multiple repos (F4). */
  repo?: string;
}

export interface PrResult {
  number: number;
  title: string;
  url: string;
  state: "Open" | "Merged" | "Closed (Unmerged)";
  author: string | null;
  createdAt: string;
  repo?: string;
}

export interface TaskStatusEntry {
  taskId: string;
  prs: PrResult[];
  summary: "All PRs Merged" | "PR(s) Open" | "No PR Found";
}

export interface TrackerReportSummary {
  totalTasks: number;
  allMerged: number;
  someOpen: number;
  noPrFound: number;
}

export interface TrackerReport {
  tasks: TaskStatusEntry[];
  summary: TrackerReportSummary;
  textReport: string;
  diagnostics?: string[];
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests (AC1–AC4, AC5)
// ---------------------------------------------------------------------------

/** Map GitHub state + merged_at → human-readable PR status. */
export function classifyPrStatus(pr: GhPullRequest): PrResult["state"] {
  if (pr.merged_at != null) return "Merged";
  if (pr.state === "closed") return "Closed (Unmerged)";
  return "Open";
}

/** Derive per-task human summary from a list of PR states. */
export function deriveTaskSummary(prStates: Array<PrResult["state"]>): TaskStatusEntry["summary"] {
  if (prStates.length === 0) return "No PR Found";
  if (prStates.every((s) => s === "Merged")) return "All PRs Merged";
  return "PR(s) Open";
}

/**
 * Identity of a pull request within a report.
 *
 * PR numbers are allocated PER REPOSITORY, so a number alone is not unique once an
 * org-wide scan (F4) is in play: `org/alpha#12` and `org/beta#12` are different PRs.
 * Keying on `repo#number` keeps them distinct; PRs with no repo attribution (the
 * single-repo path, where every PR is from the same repo) fall back to the bare
 * number so behaviour there is unchanged.
 */
function prIdentity(pr: GhPullRequest): string {
  return pr.repo ? `${pr.repo}#${pr.number}` : `#${pr.number}`;
}

/**
 * Remove PRs that the several search strategies surfaced more than once.
 *
 * De-duplicating by number ALONE would silently discard a genuine PR from a second
 * repository that happened to share a number. That is not cosmetic: dropping an open
 * PR can flip a task's summary from "PR(s) Open" to "All PRs Merged" and report work
 * as release-ready when it is not (AC1/AC2/AC4). First occurrence wins.
 */
export function deduplicateByNumber(prs: GhPullRequest[]): GhPullRequest[] {
  const seen = new Map<string, GhPullRequest>();
  for (const pr of prs) {
    const key = prIdentity(pr);
    if (!seen.has(key)) seen.set(key, pr);
  }
  return Array.from(seen.values());
}

export function buildReportSummary(tasks: TaskStatusEntry[]): TrackerReportSummary {
  return {
    totalTasks: tasks.length,
    allMerged: tasks.filter((t) => t.summary === "All PRs Merged").length,
    someOpen: tasks.filter((t) => t.summary === "PR(s) Open").length,
    noPrFound: tasks.filter((t) => t.summary === "No PR Found").length,
  };
}

/** Build a human-readable multi-line text report (AC5/F5). */
export function buildTextReport(report: { tasks: TaskStatusEntry[]; summary: TrackerReportSummary }): string {
  const lines: string[] = [];
  const { tasks, summary } = report;

  lines.push("= Task PR Status Report =");
  lines.push("");
  lines.push(`Total tasks: ${summary.totalTasks} | All Merged: ${summary.allMerged} | Open: ${summary.someOpen} | No PR: ${summary.noPrFound}`);
  lines.push("─".repeat(72));
  lines.push("");

  for (const task of tasks) {
    lines.push(`Task: ${task.taskId} — ${task.summary}`);
    if (task.prs.length === 0) {
      lines.push("  No PR Found");
    } else {
      for (const pr of task.prs) {
        lines.push(`  [#${pr.number}] ${pr.title} — ${pr.state}${pr.repo ? ` (${pr.repo})` : ""}`);
        lines.push(`         ${pr.url}`);
      }
    }
    lines.push("");
  }

  // Summary verdict per the PRD's F5 requirement.
  if (tasks.length > 0) {
    lines.push("Summary:");
    for (const task of tasks) {
      if (task.summary === "All PRs Merged") {
        lines.push(`  ✓ ${task.taskId}: All PRs Merged — ready for release`);
      } else if (task.summary === "PR(s) Open") {
        lines.push(`  ✗ ${task.taskId}: PR(s) Open — not ready`);
      } else {
        lines.push(`  ? ${task.taskId}: No PR Found`);
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GitHub fetch helpers — stateful I/O
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

/** Returns true if the response indicates API rate-limit. */
function isRateLimited(res: Response): boolean {
  return res.status === 403 || res.status === 429;
}

/**
 * Search PRs across a specific repo for references to a task ID.
 * Three strategies (all best-effort, non-fatal on failure):
 *  1. GitHub Search API (`type:pr in:title,body`)
 *  2. Open PRs list filtered by title/body/head ref containing task ID
 *  3. Closed PRs list (recently updated) filtered the same way
 */
async function searchPrsForTaskId(
  owner: string,
  repo: string,
  taskId: string,
  token: string,
  diagnostics: string[],
): Promise<GhPullRequest[]> {
  const results: Map<number, GhPullRequest> = new Map();

  // Strategy 1 — GitHub issue/PR search.
  try {
    const q = encodeURIComponent(`"${taskId}" type:pr repo:${owner}/${repo} in:title,body`);
    const url = `https://api.github.com/search/issues?q=${q}&per_page=30`;
    const res = await fetch(url, { headers: ghHeaders(token) });
    if (isRateLimited(res)) {
      diagnostics.push(`Rate-limited while searching ${owner}/${repo} for "${taskId}". Try again later.`);
    } else if (res.ok) {
      const data = (await res.json()) as {
        items?: Array<{
          number: number;
          title: string;
          html_url: string;
          state: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pull_request?: any;
          user: { login: string } | null;
          created_at: string;
        }>;
      };
      for (const item of data.items ?? []) {
        if (item.pull_request == null) continue;
        if (results.has(item.number)) continue;
        const prDetail = await fetchPrDetail(owner, repo, item.number, token, diagnostics);
        if (prDetail) {
          results.set(item.number, {
            number: prDetail.number,
            title: prDetail.title,
            html_url: prDetail.html_url,
            state: prDetail.state,
            merged_at: prDetail.merged_at,
            user: prDetail.user,
            created_at: prDetail.created_at,
            repo: `${owner}/${repo}`,
          });
        }
      }
    } else if (res.status === 404) {
      diagnostics.push(`Repository ${owner}/${repo} not found or not accessible.`);
    }
  } catch (err) {
    diagnostics.push(`Search error for ${owner}/${repo} "${taskId}": ${String(err)}`);
  }

  // Strategy 2 — list open PRs and filter by branch name / title / body containing task ID.
  // Catches PRs whose association is via branch name (e.g. feature/PROJ-42-fix-login).
  try {
    const openUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`;
    const openRes = await fetch(openUrl, { headers: ghHeaders(token) });
    if (isRateLimited(openRes)) {
      diagnostics.push(`Rate-limited listing open PRs in ${owner}/${repo}.`);
    } else if (openRes.ok) {
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
            repo: `${owner}/${repo}`,
          });
        }
      }
    }
  } catch (err) {
    diagnostics.push(`Error listing open PRs in ${owner}/${repo}: ${String(err)}`);
  }

  // Strategy 3 — list recently closed PRs (merged + unmerged), sorted by update recency.
  try {
    const closedUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&per_page=100&sort=updated&direction=desc`;
    const closedRes = await fetch(closedUrl, { headers: ghHeaders(token) });
    if (isRateLimited(closedRes)) {
      diagnostics.push(`Rate-limited listing closed PRs in ${owner}/${repo}.`);
    } else if (closedRes.ok) {
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
            repo: `${owner}/${repo}`,
          });
        }
      }
    }
  } catch (err) {
    diagnostics.push(`Error listing closed PRs in ${owner}/${repo}: ${String(err)}`);
  }

  return Array.from(results.values());
}

/** Fetch a single PR's detail (needed for merged_at from the /search endpoint results). */
async function fetchPrDetail(
  owner: string,
  repo: string,
  number: number,
  token: string,
  diagnostics: string[],
): Promise<GhPullRequest | null> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`;
    const res = await fetch(url, { headers: ghHeaders(token) });
    if (isRateLimited(res)) {
      diagnostics.push(`Rate-limited fetching PR #${number} in ${owner}/${repo}.`);
      return null;
    }
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
  } catch (err) {
    diagnostics.push(`Error fetching PR #${number} ${owner}/${repo}: ${String(err)}`);
    return null;
  }
}

/** List all repos in an org (max 5 pages = 500 repos). */
async function listOrgRepos(
  owner: string,
  token: string,
  diagnostics: string[],
): Promise<Array<{ name: string }>> {
  const repos: Array<{ name: string }> = [];
  let page = 1;
  while (page <= 5) {
    try {
      const url = `https://api.github.com/orgs/${owner}/repos?per_page=100&page=${page}&sort=updated`;
      const res = await fetch(url, { headers: ghHeaders(token) });
      if (isRateLimited(res)) {
        diagnostics.push(`Rate-limited while listing repos in org ${owner} — partial repo list returned.`);
        break;
      }
      if (!res.ok) {
        if (res.status === 404) {
          diagnostics.push(`Organization or user "${owner}" not found or not accessible.`);
        }
        break;
      }
      const pageRepos = (await res.json()) as Array<{ name: string }>;
      if (pageRepos.length === 0) break;
      repos.push(...pageRepos);
      page++;
    } catch (err) {
      diagnostics.push(`Error listing repos in org ${owner}: ${String(err)}`);
      break;
    }
  }
  return repos;
}

// ---------------------------------------------------------------------------
// Core public function — pure report generator for callers outside the agent wrapper
// ---------------------------------------------------------------------------

export async function runTaskPrStatus(params: TaskPrStatusParams): Promise<TrackerReport> {
  const { taskIds, owner, repo } = params;

  if (!taskIds?.length) {
    throw new Error("taskIds must contain at least one task identifier. (F1)");
  }
  if (!owner?.trim()) {
    throw new Error("owner (GitHub organization or user) is required. (F4)");
  }

  // Resolve GitHub token — F6 / AC6.
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Export it in your environment or set it in .builderForceAgents config env.vars.",
    );
  }

  const diagnostics: string[] = [];

  // Determine which repos to scan.
  let reposToScan: string[];
  if (repo) {
    reposToScan = [repo];
  } else {
    const orgRepos = await listOrgRepos(owner, token, diagnostics);
    reposToScan = orgRepos.map((r) => r.name);
    if (reposToScan.length === 0) {
      diagnostics.push(
        `No repositories could be listed for org "${owner}" — falling back to a single repo name "${owner}".`,
      );
      reposToScan = [owner];
    }
  }

  // For each task ID, search across all target repos.
  const tasks: TaskStatusEntry[] = [];

  for (const taskId of taskIds) {
    const allPrs: GhPullRequest[] = [];

    for (const scanRepo of reposToScan) {
      try {
        const prs = await searchPrsForTaskId(owner, scanRepo, taskId, token, diagnostics);
        allPrs.push(...prs);
      } catch (err) {
        diagnostics.push(`Unexpected error scanning ${owner}/${scanRepo} for "${taskId}": ${String(err)}`);
      }
    }

    // Deduplicate by PR number (same PR may surface across strategies).
    const deduped = deduplicateByNumber(allPrs);

    const prResults: PrResult[] = deduped.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: classifyPrStatus(pr),
      author: pr.user?.login ?? null,
      createdAt: pr.created_at,
      // The repo the PR was actually found in — meaningful when scanning a whole org (F4).
      repo: pr.repo ?? (repo ? `${owner}/${repo}` : undefined),
    }));

    // Sort by PR number descending (newest first typically).
    prResults.sort((a, b) => b.number - a.number);

    const summary = deriveTaskSummary(prResults.map((p) => p.state));
    tasks.push({ taskId, prs: prResults, summary });
  }

  const summary = buildReportSummary(tasks);
  const textReport = buildTextReport({ tasks, summary });

  return { tasks, summary, textReport, diagnostics: diagnostics.length ? diagnostics : undefined };
}

// ---------------------------------------------------------------------------
// Legacy pi AgentTool wrapper — retains JSON-structured + text-report payloads
// ---------------------------------------------------------------------------

export const taskPrStatusTool: AgentTool<typeof TaskPrStatusSchema, string> = {
  name: "task_pr_status",
  label: "Task PR Status Tracker",
  description:
    "Check Pull Request status for a set of task IDs across GitHub repositories. " +
    "Returns which tasks have all PRs merged, which have open PRs, and which have no PRs found. " +
    "Includes a human-readable text report. Requires GITHUB_TOKEN in the environment.",
  parameters: TaskPrStatusSchema,
  async execute(_toolCallId: string, params: TaskPrStatusParams): Promise<AgentToolResult<string>> {
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
