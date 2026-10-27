/**
 * The code maps a run starts with, from EVERYTHING its request says about where the work
 * is — not only the paths it names (PRD 35 E2, cost-lever parity WS-M):
 *
 *   1. paths — the focus files and the paths their contents name (`areasNamed`);
 *   2. identifiers — `buildContextPack`, `RunKnowledgeRecorder`, `run_store` (the ONE
 *      rule, `extractIdentifiers`, the pre-search uses too): each is looked up in the
 *      workspace symbol index and its definition's directory is an area;
 *   3. words — "the run store" names the stored area `…/runStore` (`areasNamedIn`).
 *
 * One recall of the project's facts serves all three: it is queried with the areas and
 * the request, and the stored map areas it returns are what the words are matched to.
 * Every part is best-effort and bounded — a slow symbol index is skipped, never waited on.
 */

import { extractIdentifiers, type RepoSymbolsCapability } from "@builderforce/agent-tools";
import { areaOfPath, areasNamedIn, consolidatedArea } from "@seanhogg/builderforce-memory/working";
import { areasNamed, codemapFactsFor } from "./codemapFacts";
import { withinMs } from "./withinMs";

/** Facts pulled before the area filter keeps the codemap ones. */
export const FACTS_PULLED = 20;
/** Definitions read per identifier. */
const MATCHES_PER_IDENTIFIER = 5;
/** The symbol lookups' share of the pack deadline. A cold index walk is not waited on. */
export const SYMBOL_LOOKUP_MS = 700;
/** The recall query is a search string, not a document. */
const MAX_QUERY_CHARS = 600;

/** The directories where the request's identifiers are DEFINED (exact name, any case). */
export async function areasOfIdentifiers(
  symbols: Pick<RepoSymbolsCapability, "find">,
  identifiers: readonly string[],
  ms: number = SYMBOL_LOOKUP_MS,
): Promise<string[]> {
  if (identifiers.length === 0) return [];
  const found = await withinMs(
    Promise.all(identifiers.map(async (id) => {
      const result = await symbols.find(id, { limit: MATCHES_PER_IDENTIFIER }).catch(() => undefined);
      const exact = (result?.ok ? result.matches ?? [] : []).filter((m) => m.name.toLowerCase() === id.toLowerCase());
      return exact.map((m) => areaOfPath(m.path)).filter(Boolean);
    })),
    ms,
    [] as string[][],
  );
  return [...new Set(found.flat())];
}

export interface RequestCodemapInput {
  /** The user's request for this run. */
  request: string;
  /** Workspace-relative focus files the pack loaded, and their contents. */
  focusPaths: readonly string[];
  focusContents: readonly string[];
}

export interface RequestCodemapDeps {
  /** The project's facts recall (hybrid, server-side). */
  recall(query: string, limit: number): Promise<Array<{ key: string; content: string }>>;
  /** The workspace symbol index — the run's shared look-up (`requestSymbolLookup`), so
   *  the pre-search asks nothing twice; absent ⇒ identifiers are not resolved. */
  symbols?: Pick<RepoSymbolsCapability, "find">;
  symbolLookupMs?: number;
}

/** The code maps for every area the request is about, most specific first, capped. */
export async function codemapFactsForRequest(
  input: RequestCodemapInput,
  deps: RequestCodemapDeps,
): Promise<Array<{ key: string; content: string }>> {
  const request = input.request.trim();
  const pathAreas = areasNamed(input.focusPaths, input.focusContents);
  const idAreas = deps.symbols
    ? await areasOfIdentifiers(deps.symbols, extractIdentifiers(request), deps.symbolLookupMs ?? SYMBOL_LOOKUP_MS)
    : [];
  const known = [...new Set([...pathAreas, ...idAreas])];
  if (known.length === 0 && !request) return [];
  const query = [...known, request].join(" ").slice(0, MAX_QUERY_CHARS);
  const pulled = await deps.recall(query, FACTS_PULLED);
  const stored = pulled.map((f) => consolidatedArea(f.key)).filter((a): a is string => a !== undefined);
  const areas = [...new Set([...known, ...areasNamedIn(request, stored)])];
  return codemapFactsFor(pulled, areas);
}
