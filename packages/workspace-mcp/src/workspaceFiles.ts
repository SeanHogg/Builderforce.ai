import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { RepoReadCapability } from "@builderforce/agent-tools";
import { parseRecentCommits, RECENT_COMMITS_FORMAT, runGit } from "@builderforce/agent-tools/node-git-history";
import { resolveInsideRoot } from "@builderforce/agent-tools/node-path";

/** Resolve symlinks before using a caller-supplied path to access the disk. */
export async function workspacePath(root: string, requested: string): Promise<string | null> {
  if (isAbsolute(requested) || /^[A-Za-z]:/.test(requested)) return null;
  const target = resolveInsideRoot(root, requested);
  if (!target) return null;
  const rootPath = await realpath(root);
  try {
    return resolveInsideRoot(rootPath, await realpath(target));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Keep public MCP reads inside the selected real root, even through a symlink. */
export function workspaceRepoRead(root: string, read?: RepoReadCapability): RepoReadCapability {
  if (!read) throw new Error("Workspace read capability unavailable");
  return {
    listFiles: (scope, glob, options) => read.listFiles(scope, glob, options),
    async readFile(path) {
      const resolved = await workspacePath(root, path);
      if (!resolved) return { ok: false, path, error: "File is unavailable in the workspace" };
      const info = await stat(resolved);
      if (!info.isFile() || info.size > 1_000_000) return { ok: false, path, error: "File is not a supported source file" };
      return read.readFile(path);
    },
    async searchCode(query, path, options) {
      if (path && !await workspacePath(root, path)) {
        return { ok: false, query, error: "Search path is unavailable in the workspace" };
      }
      return read.searchCode(query, path, options);
    },
  };
}

export async function workspaceGitHistory({ root }: { root: string }, args: Record<string, unknown>) {
  const requested = typeof args.path === "string" && args.path.trim() ? args.path : ".";
  const path = await workspacePath(root, requested);
  if (!path) throw new Error("History path is unavailable in the workspace");
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit)
    ? Math.min(50, Math.max(1, Math.floor(args.limit)))
    : 20;
  const author = typeof args.author === "string" && args.author.trim() ? [`--author=${args.author}`] : [];
  const run = await runGit(root, [
    "log", `--max-count=${limit}`, "--name-only", "--relative", `--format=${RECENT_COMMITS_FORMAT}`,
    ...author, "--", relative(await realpath(root), path) || ".",
  ], { timeoutMs: 10_000 });
  if (run.stdout === undefined) throw new Error("Git history is unavailable");
  return { commits: parseRecentCommits(run.stdout) };
}
