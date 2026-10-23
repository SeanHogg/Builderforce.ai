/**
 * GENERATED FILE — do not edit by hand.
 *
 * Compiled from `api/src/application/runtime/costLoop` (readOnlyTools.ts) into one dependency-free ESM
 * module for the Cloudflare Container, which has no build step.
 *
 * Regenerate with `node scripts/gen-container-shared.mjs` (from `api/`).
 * `--check` fails the build when the source no longer matches the hash below.
 *
 * @source-sha256 950e96e559ba39176c419d218dd2826392014a9bbfa6e50c7b3c8569526b965b
 */
// ── readOnlyTools.ts ──
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
const READ_ONLY_CLOUD_TOOLS = new Set([
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
function isReadOnlyCloudTool(name) {
    return READ_ONLY_CLOUD_TOOLS.has(name);
}

export { READ_ONLY_CLOUD_TOOLS, isReadOnlyCloudTool };
