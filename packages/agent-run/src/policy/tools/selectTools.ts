/**
 * selectTools — the per-turn lexical tool selection with synonym expansion and pinning.
 *
 * Ported VERBATIM from `brain-embedded/src/selectTools.ts` (PRD 35 WS2f). The only
 * change is the tool-spec type: brain-embedded scored its own `BrainToolSpec`; here the
 * catalog is `@builderforce/agent-tools`' shared `ToolSchema` (the same OpenAI-style
 * `{ type:'function', function:{ name, description, parameters } }` shape — the two are
 * structurally identical, so the scorer is unchanged).
 *
 * The scorer ranks by the turn's word stems against the tool NAME and DESCRIPTION,
 * expands query stems through {@link ./toolVocabulary}, and:
 *   • leaves a catalog at or under the limit untouched (advertised bytes stay stable);
 *   • trims an oversized catalog to required (never dropped) → lexical rank → catalog
 *     backfill, restored to CATALOG order so the vendor's cached prompt prefix does not
 *     churn between turns;
 *   • appends the pinned (already-called) tools beyond the limit, up to a hard ceiling,
 *     never evicting a tool from the turn's fixed set.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import { lexicalStems, LEXICAL_WEIGHTS } from "@builderforce/agent-tools";
import { expandWithSynonyms } from "./toolVocabulary.js";

/** A catalog entry, in the shared OpenAI-style shape. */
export interface ToolSchemaLike {
  type?: string;
  function?: { name?: string; description?: string; parameters?: unknown };
}

/** What the caller hands the selector. */
export interface SelectToolsOptions {
  /** The user's request — the text that drives the selection, not loop-injected nudges. */
  query?: string;
  /** The fixed advertised-set size. Default {@link DEFAULT_TOOL_LIMIT}. */
  limit?: number;
  /** Tools the run has already called (first-called order) — appended beyond the limit. */
  pinned?: readonly string[];
  /** Tools the system prompt names — kept no matter how the query scores. */
  required?: readonly string[];
}

/** What the selector returns. */
export interface SelectToolsResult<T> {
  /** The schemas to advertise, in stable catalog order (pins appended at the end). */
  tools: T[];
  /** Whether an oversized catalog was trimmed. */
  trimmed: boolean;
  /** How many tools the catalog offered. */
  available: number;
}

export const DEFAULT_TOOL_LIMIT = 64;
/** Pinned tools are appended up to `limit + PINNED_OVERFLOW`, never evicting. */
export const PINNED_OVERFLOW = 16;

const NAME_HIT = LEXICAL_WEIGHTS.name;
const NAME_SYNONYM_HIT = 7;
const DESCRIPTION_HIT = LEXICAL_WEIGHTS.description;

/** score the turn's stems against one tool, exact hits above synonym hits. */
function scoreTool(
  toolName: string,
  description: string,
  stems: ReadonlySet<string>,
  synonyms: ReadonlySet<string>,
): number {
  let score = 0;
  for (const token of lexicalStems(toolName)) {
    if (stems.has(token)) score += NAME_HIT;
    else if (synonyms.has(token)) score += NAME_SYNONYM_HIT;
  }
  for (const token of lexicalStems(description)) {
    if (stems.has(token)) score += DESCRIPTION_HIT;
    else if (synonyms.has(token)) score += Math.ceil(DESCRIPTION_HIT / 2);
  }
  return score;
}

/**
 * Select the tools to advertise for a turn. Pure and deterministic: the same catalog,
 * query, pins and required yield the same array.
 */
export function selectToolsForTurn<T extends ToolSchemaLike>(
  tools: readonly T[] | undefined,
  options: SelectToolsOptions = {},
): SelectToolsResult<T> {
  const catalog = tools ?? [];
  const available = catalog.length;
  if (available === 0) return { tools: [], trimmed: false, available: 0 };

  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_TOOL_LIMIT));
  if (available <= limit) {
    return { tools: [...catalog], trimmed: false, available };
  }

  const byName = new Map<string, T>();
  for (const tool of catalog) {
    const name = tool.function?.name;
    if (name && !byName.has(name)) byName.set(name, tool);
  }

  const query = (options.query ?? "").toLowerCase();
  const stems = lexicalStems(query);
  const synonyms = expandWithSynonyms(stems);

  const wanted: T[] = [];
  const seen = new Set<string>();
  const push = (tool: T | undefined) => {
    const name = tool?.function?.name;
    if (!tool || !name || seen.has(name)) return;
    seen.add(name);
    wanted.push(tool);
  };

  // Required outranks everything — a tool the prompt names is never dropped, even at
  // limit 1, so the model is never told to call a tool and then not given it.
  for (const name of options.required ?? []) push(byName.get(name));
  const roomAfterRequired = Math.max(0, limit - wanted.length);

  // Lexical rank over the rest, then catalog backfill to a full fixed set, restored to
  // catalog order so the advertised bytes are stable across turns.
  const rest = catalog.filter((t) => t.function?.name && !seen.has(t.function.name));
  const ranked = [...rest]
    .map((tool) => ({
      tool,
      score: scoreTool(tool.function?.name ?? "", tool.function?.description ?? "", stems, synonyms),
    }))
    .sort((a, b) => b.score - a.score || (a.tool.function?.name ?? "").localeCompare(b.tool.function?.name ?? ""));
  for (const { tool } of ranked.slice(0, roomAfterRequired)) push(tool);

  const inFixed = new Set(wanted.map((t) => t.function?.name));
  for (const tool of catalog) {
    const name = tool.function?.name;
    if (name && !inFixed.has(name) && wanted.length < limit) push(tool);
  }

  const fixed: T[] = [];
  const fixedNames = new Set(wanted.map((t) => t.function?.name));
  for (const tool of catalog) {
    const name = tool.function?.name;
    if (name && fixedNames.has(name)) fixed.push(tool);
  }

  // Pinned (already-called) tools append BEYOND the cap, first-called order, up to the
  // hard ceiling — the advertised list only ever grows at its end.
  const overflowCap = limit + PINNED_OVERFLOW;
  const pinnedOut: T[] = [];
  for (const name of options.pinned ?? []) {
    if (pinnedOut.length >= Math.max(0, overflowCap - fixed.length)) break;
    const tool = byName.get(name);
    const toolName = tool?.function?.name;
    if (!tool || !toolName || fixedNames.has(toolName)) continue;
    if (pinnedOut.some((t) => t.function?.name === toolName)) continue;
    pinnedOut.push(tool);
  }

  return { tools: [...fixed, ...pinnedOut], trimmed: true, available };
}
