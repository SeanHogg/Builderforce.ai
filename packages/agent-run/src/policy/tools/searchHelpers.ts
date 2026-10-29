/**
 * searchHelpers — the `tool_search` meta-tool's pure helpers and the prompt-named-tools
 * extractor, ported from `costLoop/deferredTools.ts`.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { ToolSchema } from "@builderforce/agent-tools";
import { searchToolSchemas, TOOL_SEARCH_TOOL } from "@builderforce/agent-tools";

/** Hard ceiling on one `tool_search` answer (`deferredTools.ts`). */
export const TOOL_SEARCH_MAX = 15;
/** Default `tool_search` limit when the call passes none. */
export const TOOL_SEARCH_DEFAULT_LIMIT = 8;

/** Tool names the request or the turn's text names outright (`deferredTools.ts`). */
export function promptNamedTools(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/\b[a-z][a-z0-9_]{2,}\b/g)) {
    out.add(match[0]);
  }
  return [...out];
}

/**
 * Run `tool_search` over the schemas the run does NOT currently advertise (`deferredTools.ts`
 * `runToolSearch`): a `query` is required (returned as an `ok:false` refusal, never a throw),
 * `limit` clamps to `[1, TOOL_SEARCH_MAX]` with a default of {@link TOOL_SEARCH_DEFAULT_LIMIT},
 * and the search ranks the un-advertised remainder lexically. Returns the payload and the
 * names to load for the rest of the run.
 */
export function runToolSearch(
  catalog: readonly ToolSchema[],
  advertised: ReadonlySet<string>,
  args: Record<string, unknown>,
): { data: Record<string, unknown>; load: string[] } {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { data: { ok: false, error: "query is required" }, load: [] };
  const limit = Math.max(1, Math.min(TOOL_SEARCH_MAX, typeof args.limit === "number" ? Math.trunc(args.limit) : TOOL_SEARCH_DEFAULT_LIMIT));
  const matches = searchToolSchemas(catalog.filter((t) => !advertised.has(t.function.name)), query, limit);
  return {
    data: {
      ok: true,
      query,
      matches: matches.map((t) => t.function),
      note: matches.length
        ? "These tools are now loaded and callable for the rest of the run."
        : "No unloaded tool matched — try other keywords, or use the tools you already have.",
    },
    load: matches.map((t) => t.function.name),
  };
}

export { TOOL_SEARCH_TOOL };
