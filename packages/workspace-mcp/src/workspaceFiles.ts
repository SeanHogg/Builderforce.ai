import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { RepoReadCapability } from "@builderforce/agent-tools";
import { readRecentCommits } from "@builderforce/agent-tools/node-git-history";
import { resolveInsideRoot } from "@builderforce/agent-tools/node-path";
import { nodeWorkspaceFs } from "@builderforce/agent-tools/node-workspace";
import { createRepoCapabilities } from "@builderforce/agent-tools/workspace";

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

/** Public MCP reads are the ONE shared provider over the selected root: containment (links included) and a 1 MB read cap live there, once. */
const MCP_MAX_READ_BYTES = 1_000_000;

/**
 * The MCP's read capability: reads come from the shared provider (contained to the root,
 * byte-capped at 1 MB); list and search stay on the host's own `read`, which is built from the
 * same provider and already confined, so it keeps the host's ripgrep.
 */
export function workspaceRepoRead(root: string, read?: RepoReadCapability): RepoReadCapability {
  if (!read) throw new Error("Workspace read capability unavailable");
  const own = createRepoCapabilities(nodeWorkspaceFs(root), { maxReadBytes: MCP_MAX_READ_BYTES }).repoRead;
  return {
    listFiles: (scope, glob, options) => read.listFiles(scope, glob, options),
    readFile: (path) => own.readFile(path),
    searchCode: (query, path, options) => read.searchCode(query, path, options),
  };
}

export async function workspaceGitHistory({ root }: { root: string }, args: Record<string, unknown>) {
  const requested = typeof args.path === "string" && args.path.trim() ? args.path : ".";
  const path = await workspacePath(root, requested);
  if (!path) throw new Error("History path is unavailable in the workspace");
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit)
    ? Math.min(50, Math.max(1, Math.floor(args.limit)))
    : 20;
  const author = typeof args.author === "string" && args.author.trim() ? args.author : undefined;
  const history = await readRecentCommits(root, limit, {
    path: relative(await realpath(root), path) || ".",
    author,
    timeoutMs: 10_000,
  });
  if (!("commits" in history)) throw new Error("Git history is unavailable");
  return history;
}
