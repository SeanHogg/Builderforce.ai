/**
 * The semantic code tools — `semantic_search` and `repo_map` — defined once for every
 * surface that backs capability `repo.semantic` (a warm local index: Builderforce
 * Desktop). A surface without one never sees them.
 *
 * They replace the most expensive habit a coding run has: orienting by grep. A question
 * phrased in words ("where do we enforce plan limits?") shares no exact substring with
 * the code that answers it, so `search_code` finds nothing or everything and the run
 * pages through files to find its footing. `semantic_search` returns the whole function
 * that answers it; `repo_map` hands over the codebase's shape in one call.
 */

import type { RepoMapResult, SemanticSearchResult } from "./capabilities.js";
import { defineTool, type ToolDefinition, type ToolResult } from "./tool.js";

const SEARCH_DEFAULT_LIMIT = 8;
const SEARCH_MAX_LIMIT = 25;
const MAP_DEFAULT_TOKENS = 1500;
const MAP_MAX_TOKENS = 8000;

export const semanticSearchTool: ToolDefinition = defineTool({
  name: "semantic_search",
  description:
    "Find code by MEANING or by name in one call — returns whole functions/classes (path, line range, symbol, snippet) ranked by identifier-aware keyword match (resolveMembership matches \"membership\") plus local embeddings. Use it FIRST for questions phrased in words — \"where is X handled\", \"how does Y work\", \"what validates Z\" — where search_code needs an exact substring you do not know yet. Then read_file only the hit you will edit, at its line range. For exact strings, usages and config values use search_code; for a known symbol's definition use find_symbol.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What you are looking for, in words or identifiers, e.g. \"stripe webhook to ledger\"." },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict to, e.g. "api/src".' },
      limit: { type: "number", description: `Max results (default ${SEARCH_DEFAULT_LIMIT}, max ${SEARCH_MAX_LIMIT}).` },
    },
    required: ["query"],
  },
  requires: ["repo.semantic"],
  async execute(args, ctx): Promise<ToolResult> {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { data: { ok: false, error: "query is required" } };
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : undefined;
    const requested = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.floor(args.limit) : SEARCH_DEFAULT_LIMIT;
    const limit = Math.min(SEARCH_MAX_LIMIT, Math.max(1, requested));
    const r: SemanticSearchResult = await ctx.caps.semantic!.search(query, { scope, limit });
    if (!r.ok) return { data: r as unknown as Record<string, unknown> };
    const results = (r.results ?? []).map((h) => ({
      at: `${h.path}:${h.startLine}-${h.endLine}`,
      symbol: h.symbol ?? undefined,
      kind: h.kind,
      via: h.source,
      snippet: h.snippet,
    }));
    const data: Record<string, unknown> = { ok: true, query, total: results.length, results };
    if (r.indexing) {
      data.note = "The index is still being built — these results cover only the files scanned so far. A miss is not proof of absence yet; fall back to search_code if needed.";
    } else if (results.length === 0) {
      data.note = `Nothing matched "${query}"${scope ? ` under "${scope}"` : ""}. Rephrase with likely identifier words, drop \`path\`, or use search_code for an exact string.`;
    }
    return { data };
  },
});

export const repoMapTool: ToolDefinition = defineTool({
  name: "repo_map",
  description:
    "The repository's SHAPE in one call: files ordered by how much the rest of the code depends on them, each with its most-referenced definitions as `line: signature`. Call it once at the start of unfamiliar work instead of exploring with list_files and reads; pass `focus` (paths you are working in) to rank that area first.",
  parameters: {
    type: "object",
    properties: {
      focus: { type: "array", items: { type: "string" }, description: 'Optional repo-relative paths to rank first, e.g. ["api/src/billing"].' },
      maxTokens: { type: "number", description: `Budget for the map (default ${MAP_DEFAULT_TOKENS}, max ${MAP_MAX_TOKENS}).` },
    },
  },
  requires: ["repo.semantic"],
  async execute(args, ctx): Promise<ToolResult> {
    const focus = Array.isArray(args.focus) ? args.focus.filter((f): f is string => typeof f === "string" && f.trim() !== "") : [];
    const requested = typeof args.maxTokens === "number" && Number.isFinite(args.maxTokens) ? Math.floor(args.maxTokens) : MAP_DEFAULT_TOKENS;
    const maxTokens = Math.min(MAP_MAX_TOKENS, Math.max(200, requested));
    const r: RepoMapResult = await ctx.caps.semantic!.repoMap({ maxTokens, focus });
    if (!r.ok) return { data: r as unknown as Record<string, unknown> };
    const data: Record<string, unknown> = { ok: true, map: r.map ?? "" };
    if (r.indexing) data.note = "The index is still being built — the map covers only the files scanned so far.";
    return { data };
  },
});

/** The semantic tools, spliced into `CORE_TOOLS` beside the code-navigation tools. */
export const SEMANTIC_TOOLS: readonly ToolDefinition[] = [semanticSearchTool, repoMapTool];
