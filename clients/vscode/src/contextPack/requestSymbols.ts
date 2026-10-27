/**
 * The run's ONE look-up of the request's symbols. The pre-search hits
 * (`preSearchSource.ts`) and the codemap areas (`requestAreas.ts`) both ask the
 * workspace symbol index about the same identifiers (`extractIdentifiers`); this wraps
 * the index so each name is asked ONCE per run, at the larger of the two limits, and
 * every caller reads its own slice of the shared answer.
 *
 * Pure (no `vscode` import).
 */

import type { RepoSymbolsCapability, SymbolFindResult } from "@builderforce/agent-tools";

type SymbolFinder = Pick<RepoSymbolsCapability, "find">;

/** The most definitions any pre-turn caller reads per name (the pre-search's). */
export const REQUEST_SYMBOL_LIMIT = 20;

/**
 * `symbols`, memoised per name for one run: the first `find(name)` asks the index for
 * {@link REQUEST_SYMBOL_LIMIT} definitions, later ones (any limit up to that) reuse the
 * answer. A scoped or kind-filtered find is not the shared question and goes straight
 * to the index.
 */
export function requestSymbolLookup(symbols: SymbolFinder, limit: number = REQUEST_SYMBOL_LIMIT): SymbolFinder {
  const asked = new Map<string, Promise<SymbolFindResult>>();
  return {
    find(query, opts) {
      if (opts?.scope || opts?.kind || (opts?.limit ?? 0) > limit) return symbols.find(query, opts);
      let answer = asked.get(query);
      if (!answer) {
        answer = symbols.find(query, { limit });
        // A failed look-up is not memoised as a failure for the next caller to inherit.
        answer.catch(() => asked.delete(query));
        asked.set(query, answer);
      }
      const want = opts?.limit;
      return answer.then((r) => (want !== undefined && r.ok && r.matches && r.matches.length > want ? { ...r, matches: r.matches.slice(0, want) } : r));
    },
  };
}
