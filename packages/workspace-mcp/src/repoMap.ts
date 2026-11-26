import type { CapabilityProvider } from "@builderforce/agent-tools";
import { readRepoGraph } from "@builderforce/agent-tools/knowledge";
import {
  DEFAULT_REPO_MAP_LIMITS,
  RepoGraph,
  renderRepoMap,
  repoMapPort,
  type SerializedRepoGraph,
} from "@builderforce/repo-map";

export async function workspaceRepoMap(
  { caps }: { caps: CapabilityProvider },
  args: Record<string, unknown>,
) {
  const read = caps.repoRead!;
  const limits = DEFAULT_REPO_MAP_LIMITS;
  let bytes = 0;
  let partial = false;

  const snapshot = await readRepoGraph({
    path: "",
    repoGraph: repoMapPort,
    caps: { ...caps, repoRead: {
      ...read,
      async listFiles(scope, glob, options) {
        const result = await read.listFiles(scope, glob, options);
        const candidates = result.paths?.filter((path) => repoMapPort.accepts(path, 0));
        partial ||= !!result.truncated || (candidates?.length ?? 0) > limits.maxFiles;
        return { ...result, paths: candidates?.slice(0, limits.maxFiles) };
      },
      async readFile(path) {
        const result = await read.readFile(path);
        if (!result.ok || typeof result.content !== "string") {
          partial ||= repoMapPort.accepts(path, 0);
          return result;
        }
        const size = Buffer.byteLength(result.content);
        if (size > limits.maxFileBytes || size + bytes > limits.maxTotalBytes) {
          partial = true;
          return { ok: false, path };
        }
        bytes += size;
        return result;
      },
    } },
  });
  if (!snapshot) return { ok: false, error: "Workspace map unavailable" };
  // readRepoGraph exposes only the fields its callers need. repoMapPort returns the full graph.
  const graph = RepoGraph.fromJSON(snapshot as SerializedRepoGraph);
  const maxTokens = typeof args.maxTokens === "number" && Number.isFinite(args.maxTokens)
    ? Math.min(8_000, Math.max(200, Math.floor(args.maxTokens)))
    : 1_500;
  const focus = Array.isArray(args.focus) ? args.focus.slice(0, 50).filter((path): path is string => typeof path === "string") : [];
  const query = typeof args.query === "string" ? args.query.slice(0, 10_000) : undefined;
  return { ok: true, map: renderRepoMap(graph, { maxTokens, focus, query }), partial };
}
