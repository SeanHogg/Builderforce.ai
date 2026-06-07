import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

/**
 * Per-ticket shared workspace.
 *
 * Every agent that executes on a task works out of ONE ephemeral directory
 * (`<workspaceDir>/.builderforce/tasks/<taskId>`) — the ticket is the shared
 * context. The repo is cloned into it once; WIP accumulates across runs without
 * committing. On task → Done the directory is committed to a branch, pushed, a
 * PR is opened, and the directory is torn down.
 *
 * File changes are attributed to the agent that produced them (traceability:
 * "Agent X created 2 files; Agent Y ran the tests") by diffing the worktree
 * after each run and tagging the result with the executing agent's label.
 *
 * The path/URL/branch builders and the `git status` parser are pure so they can
 * be unit-tested without a real clone.
 */

export type FileChangeKind = "created" | "modified" | "deleted";

export interface AttributedFileChange {
  path: string;
  change: FileChangeKind;
  /** The agent (cloud agent name / engine label) that produced the change. */
  agent: string;
}

/** Stable per-task workspace dir, shared by every agent on the ticket. */
export function taskWorkspaceDir(baseDir: string, taskId: number | string): string {
  return path.join(baseDir, ".builderforce", "tasks", String(taskId));
}

/** Host git-proxy clone URL for a repo (the receiving agent host proxies auth). */
export function buildTaskCloneUrl(baseUrl: string, agentNodeId: string, repoId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/agent-hosts/${agentNodeId}/git-proxy/${repoId}`;
}

/** Deterministic branch name for a ticket's accumulated work. */
export function taskBranchName(taskId: number | string): string {
  return `builderforce/task-${taskId}`;
}

/**
 * Parse `git status --porcelain` output into attributed changes. Pure.
 * Untracked (`??`) and added (`A`) → created; any `D` → deleted; else modified.
 * Renames (`old -> new`) attribute the new path.
 */
export function parseGitPorcelain(porcelain: string, agent: string): AttributedFileChange[] {
  const out: AttributedFileChange[] = [];
  for (const raw of porcelain.split("\n")) {
    if (raw.length < 4) continue;
    const x = raw[0];
    const y = raw[1];
    let pathPart = raw.slice(3);
    const arrow = pathPart.indexOf(" -> ");
    if (arrow >= 0) pathPart = pathPart.slice(arrow + 4);
    const filePath = pathPart.trim().replace(/^"|"$/g, "");
    if (!filePath) continue;
    let change: FileChangeKind;
    if (x === "?" || x === "A") change = "created";
    else if (x === "D" || y === "D") change = "deleted";
    else change = "modified";
    out.push({ path: filePath, change, agent });
  }
  return out;
}

/** Run `git status --porcelain` in `dir` and return attributed changes. Empty on error. */
export async function detectTaskChanges(dir: string, agent: string): Promise<AttributedFileChange[]> {
  try {
    const { stdout } = await pExecFile("git", ["-C", dir, "status", "--porcelain"], { maxBuffer: 8 * 1024 * 1024 });
    return parseGitPorcelain(stdout, agent);
  } catch {
    return [];
  }
}

/** True when `dir` already contains a git clone. */
export async function isCloned(dir: string): Promise<boolean> {
  try {
    await pExecFile("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}
