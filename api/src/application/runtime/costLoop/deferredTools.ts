/**
 * Deferred tools (cost lever C1) — the DATA half: which tools a cloud run advertises up
 * front by role, and how the rest are reached.
 *
 * A cloud run's catalog is ~26 core tools + ~150 curated platform tools, and every
 * schema rides every request. Under C1 a run advertises only its role's core set (≤ 20,
 * below), the tools its own prompt names, and `tool_search`; whatever `tool_search`
 * returns — or the model calls anyway — stays loaded for the rest of the run (persisted
 * in `CloudLoopState.loadedTools`, so durable ticks keep them). Dispatch is unchanged:
 * `resolveCloudAgentPlatformTool` stays the call-time guard, so deferral narrows what is
 * ADVERTISED, never what is permitted.
 */
import { TOOL_SEARCH_SCHEMA, TOOL_SEARCH_TOOL, searchToolSchemas, type ToolSchema } from '@builderforce/agent-tools';

export type DeferredToolRole = 'explore' | 'code' | 'verify' | 'plan';

/** Every role keeps these: read / search / edit / run / finish / ask / delegate. */
const ALWAYS = ['read_file', 'search_code', 'list_files', 'edit_file', 'run_checks', 'run_command', 'finish', 'ask_human', 'spawn_agent'] as const;

/**
 * Role → core tool manifest. Names absent from a surface's catalog are skipped, so one
 * row serves the durable surface (run_checks) and a shell surface (run_command) alike.
 * `tool_search` and `update_task_state` are added by the session, not listed here.
 */
export const ROLE_CORE_TOOLS: Readonly<Record<DeferredToolRole, readonly string[]>> = {
  explore: [...ALWAYS, 'memory_recall', 'workspace_read', 'web_search', 'web_fetch'],
  code: [...ALWAYS, 'write_file', 'delete_file', 'update_prd', 'memory_recall', 'memory_remember', 'claim_resource', 'release_resource', 'workspace_note', 'web_search'],
  verify: [...ALWAYS, 'memory_recall', 'workspace_read'],
  plan: [...ALWAYS, 'spawn_agents', 'wait_agents', 'message_agent', 'update_prd', 'memory_recall', 'memory_remember', 'workspace_note', 'workspace_read'],
};

/** A run role → its manifest row (anything unknown codes). */
export function deferredToolRole(role: string | null | undefined): DeferredToolRole {
  return role === 'explore' || role === 'verify' || role === 'plan' ? role : 'code';
}

/** Catalog tool names the given texts mention verbatim (e.g. `builtin_kanban_signoff` in the prompt). */
export function promptNamedTools(catalog: readonly ToolSchema[], texts: readonly string[]): string[] {
  const words = new Set(texts.join('\n').match(/\b[a-z][a-z0-9_]{2,}\b/g) ?? []);
  return catalog.map((t) => t.function.name).filter((name) => words.has(name));
}

/**
 * The tools to advertise this turn: the role's core set plus every loaded tool, in
 * CATALOG order (the order is part of the cached prefix, so a stable set is stable
 * bytes), then the meta tools.
 */
export function advertisedTools(
  catalog: readonly ToolSchema[],
  role: DeferredToolRole,
  loaded: ReadonlySet<string>,
  meta: readonly ToolSchema[],
): ToolSchema[] {
  const core = new Set(ROLE_CORE_TOOLS[role]);
  return [...catalog.filter((t) => core.has(t.function.name) || loaded.has(t.function.name)), ...meta];
}

/** Hard ceiling on one `tool_search` answer. */
const TOOL_SEARCH_MAX = 15;

/** Run `tool_search` over the tools NOT yet advertised. Returns the payload and the names to load. */
export function runToolSearch(
  catalog: readonly ToolSchema[],
  advertised: ReadonlySet<string>,
  args: Record<string, unknown>,
): { data: Record<string, unknown>; load: string[] } {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { data: { ok: false, error: 'query is required' }, load: [] };
  const limit = Math.max(1, Math.min(TOOL_SEARCH_MAX, typeof args.limit === 'number' ? Math.trunc(args.limit) : 8));
  const matches = searchToolSchemas(catalog.filter((t) => !advertised.has(t.function.name)), query, limit);
  return {
    data: {
      ok: true,
      query,
      matches: matches.map((t) => t.function),
      note: matches.length
        ? 'These tools are now loaded and callable for the rest of the run.'
        : 'No unloaded tool matched — try other keywords, or use the tools you already have.',
    },
    load: matches.map((t) => t.function.name),
  };
}

export { TOOL_SEARCH_SCHEMA, TOOL_SEARCH_TOOL };
