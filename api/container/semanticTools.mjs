/**
 * GENERATED FILE — do not edit by hand.
 *
 * Compiled from `packages/agent-tools/src` (tool.ts, semantic-tools.ts) into one dependency-free ESM
 * module for the Cloudflare Container, which has no build step.
 *
 * Regenerate with `node scripts/gen-container-shared.mjs` (from `api/`).
 * `--check` fails the build when the source no longer matches the hash below.
 *
 * @source-sha256 0617d18e10fa88ae2ec10d68f53ac5504cb88883cc036a692cdf18ece992ab38
 */
// ── tool.ts ──
/**
 * The unified tool contract. ONE shape, defined once, runnable on every surface.
 *
 * A {@link ToolDefinition} pairs an OpenAI-compatible function schema (what the
 * model sees) with a `requires` capability list (what surface can run it) and a
 * pure-ish `execute` that reaches the runtime ONLY through the injected
 * {@link ToolContext} — never through a Worker `Env`, `node:fs`, or a closure over
 * one runtime. That indirection is what lets the SAME definition run in the cloud
 * Worker, the cloud Container, and on-prem Node (Dependency Inversion: the tool
 * depends on the capability abstraction, the surface supplies the concretion).
 */
/** Small helper to build a {@link ToolDefinition} with the schema name kept in sync
 *  with `name` (one source of truth). */
function defineTool(def) {
    return {
        name: def.name,
        requires: def.requires ?? [],
        schema: {
            type: "function",
            function: { name: def.name, description: def.description, parameters: def.parameters },
        },
        execute: def.execute,
    };
}

// ── semantic-tools.ts ──
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
const SEARCH_DEFAULT_LIMIT = 8;
const SEARCH_MAX_LIMIT = 25;
const MAP_DEFAULT_TOKENS = 1500;
const MAP_MAX_TOKENS = 8000;
const semanticSearchTool = defineTool({
    name: "semantic_search",
    description: "Find code by MEANING or by name in one call — returns whole functions/classes (path, line range, symbol, snippet) ranked by identifier-aware keyword match (resolveMembership matches \"membership\") plus local embeddings. Use it FIRST for questions phrased in words — \"where is X handled\", \"how does Y work\", \"what validates Z\" — where search_code needs an exact substring you do not know yet. Then read_file only the hit you will edit, at its line range. For exact strings, usages and config values use search_code; for a known symbol's definition use find_symbol.",
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
    async execute(args, ctx) {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query)
            return { data: { ok: false, error: "query is required" } };
        const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : undefined;
        const explicit = typeof args.limit === "number" && Number.isFinite(args.limit);
        const requested = explicit ? Math.floor(args.limit) : SEARCH_DEFAULT_LIMIT;
        const limit = Math.min(SEARCH_MAX_LIMIT, Math.max(1, requested));
        const semantic = ctx.caps.semantic;
        const r = await semantic.search(query, { scope, limit });
        if (!r.ok)
            return { data: r };
        let hits = r.results ?? [];
        // C4: the model's own `limit` always wins; otherwise a clear head is sent alone. Hits
        // without a score give chooseK no head to find, so it keeps the full default.
        if (semantic.adaptive && !explicit && hits.length > 0) {
            hits = hits.slice(0, chooseK({ requested: limit, scores: hits.map((h) => (typeof h.score === "number" ? h.score : Number.NaN)) }));
        }
        const results = hits.map((h) => ({
            at: `${h.path}:${h.startLine}-${h.endLine}`,
            symbol: h.symbol ?? undefined,
            kind: h.kind,
            via: h.source,
            snippet: h.snippet,
        }));
        const data = { ok: true, query, total: results.length, results };
        if (r.indexing) {
            data.note = "The index is still being built — these results cover only the files scanned so far. A miss is not proof of absence yet; fall back to search_code if needed.";
        }
        else if (results.length === 0) {
            data.note = `Nothing matched "${query}"${scope ? ` under "${scope}"` : ""}. Rephrase with likely identifier words, drop \`path\`, or use search_code for an exact string.`;
        }
        return { data };
    },
});
const repoMapTool = defineTool({
    name: "repo_map",
    description: "The repository's SHAPE in one call: files ordered by how much the rest of the code depends on them, each with its most-referenced definitions as `line: signature`. Call it once at the start of unfamiliar work instead of exploring with list_files and reads; pass `focus` (paths you are working in) to rank that area first.",
    parameters: {
        type: "object",
        properties: {
            focus: { type: "array", items: { type: "string" }, description: 'Optional repo-relative paths to rank first, e.g. ["api/src/billing"].' },
            maxTokens: { type: "number", description: `Budget for the map (default ${MAP_DEFAULT_TOKENS}, max ${MAP_MAX_TOKENS}).` },
            query: { type: "string", description: 'Optional words describing the task, e.g. "stripe webhook retries" — ranks the files that match it first.' },
        },
    },
    requires: ["repo.semantic"],
    async execute(args, ctx) {
        const focus = Array.isArray(args.focus) ? args.focus.filter((f) => typeof f === "string" && f.trim() !== "") : [];
        const requested = typeof args.maxTokens === "number" && Number.isFinite(args.maxTokens) ? Math.floor(args.maxTokens) : MAP_DEFAULT_TOKENS;
        const maxTokens = Math.min(MAP_MAX_TOKENS, Math.max(200, requested));
        const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : undefined;
        const r = await ctx.caps.semantic.repoMap({ maxTokens, focus, ...(query ? { query } : {}) });
        if (!r.ok)
            return { data: r };
        const data = { ok: true, map: r.map ?? "" };
        if (r.indexing)
            data.note = "The index is still being built — the map covers only the files scanned so far.";
        return { data };
    },
});
/** The semantic tools, spliced into `CORE_TOOLS` beside the code-navigation tools. */
const SEMANTIC_TOOLS = [semanticSearchTool, repoMapTool];

export { defineTool, semanticSearchTool, repoMapTool, SEMANTIC_TOOLS };
