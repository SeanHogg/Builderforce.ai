/**
 * policy/guards/readOnly.ts — D8: which tool calls only READ, so a turn's consecutive
 * reads may dispatch concurrently through the kernel's `isReadOnly` port.
 *
 * A DATA TABLE, not a rule: a tool belongs here only when running it changes nothing
 * another call in the same turn could observe — no repo write, no ticket write, no
 * lease, no human, no spend beyond its own read. Anything absent dispatches in order.
 *
 * Ported from `api/src/application/runtime/costLoop/readOnlyTools.ts` — ONE table for
 * every surface, deliberately dependency-free. (That file has no imports on purpose:
 * the Cloudflare Container has no build step, so a generator compiles it into
 * `container/readOnlyTools.mjs` for the image loop — the durable runner and the image
 * read the SAME names.)
 */

export const READ_ONLY_CLOUD_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "list_files",
  "search_code",
  "find_symbol",
  "file_outline",
  "repo_map",
  "semantic_search",
  "git_status",
  "git_diff",
  "git_log",
  "git_history",
  "git_show",
  "git_blame",
  "tool_search",
  "memory_recall",
  "workspace_read",
  "skill_list",
]);

/** Whether a call (by tool name) only reads. */
export function isReadOnlyCloudTool(name: string): boolean {
  return READ_ONLY_CLOUD_TOOLS.has(name);
}
