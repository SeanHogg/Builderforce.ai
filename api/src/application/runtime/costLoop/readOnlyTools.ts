/**
 * D8 — which cloud tool calls only READ, so a turn's consecutive reads may dispatch
 * concurrently through the kernel's `isReadOnly` port (`@builderforce/agent-loop`).
 *
 * A data table, not a rule: a tool belongs here only when running it changes nothing
 * another call in the same turn could observe — no repo write, no ticket write, no
 * lease, no human, no spend beyond its own read. Anything absent dispatches in order.
 *
 * ONE table for every cloud surface. It has no imports on purpose: the Cloudflare
 * Container has no build step, so `api/scripts/gen-container-shared.mjs` compiles this
 * file into `container/readOnlyTools.mjs` for the image loop — the durable runner and
 * the image read the SAME names. Never hand-edit the generated copy.
 */
export const READ_ONLY_CLOUD_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'list_files',
  'search_code',
  'find_symbol',
  'file_outline',
  'repo_map',
  'semantic_search',
  'git_status',
  'git_diff',
  'git_log',
  'git_history',
  'git_show',
  'git_blame',
  'tool_search',
  'memory_recall',
  'workspace_read',
  'skill_list',
]);

/** Whether a call (by tool name) only reads. */
export function isReadOnlyCloudTool(name: string): boolean {
  return READ_ONLY_CLOUD_TOOLS.has(name);
}
