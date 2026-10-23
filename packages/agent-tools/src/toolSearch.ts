/**
 * The ONE lexical relevance scorer for "which of these named things matches this text"
 * — tool selection (cost lever C1's `tool_search`), skill ranking (E1), and any other
 * catalog a loop has to narrow before sending it to a model.
 *
 * Deterministic and network-free: no embeddings, no extra round trip. A NAME hit is
 * strong evidence and prose is weak, so each candidate is scored over weighted fields.
 *
 * Extracted from the Brain's per-turn selector so the Worker can use it without importing
 * the Brain package. `brain-embedded/src/selectTools.ts` now ranks through this module too,
 * passing its product-synonym expansions as extra weighted fields, so the two cannot drift.
 */

import type { ToolSchema } from "./tool.js";

/** Words too common to carry signal when matching a query against a candidate. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "is", "are", "was", "be", "by",
  "with", "from", "this", "that", "these", "those", "it", "its", "as", "at", "me", "my",
  "i", "we", "you", "your", "please", "can", "could", "would", "should", "do", "does", "did",
  "get", "show", "give", "make", "now", "all", "any", "how", "what", "which", "who", "when",
]);

/** Split text into lower-cased, meaningful words. */
export function lexicalTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/** Singular/plural-insensitive stem ("tasks" matches "task"). */
export function lexicalStem(word: string): string {
  if (word.length > 3 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** The stem set of a text — compute once per query, reuse across candidates. */
export function lexicalStems(text: string): Set<string> {
  return new Set(lexicalTokens(text).map(lexicalStem));
}

/** One scored field of a candidate: its text and what a matching stem is worth. */
export interface LexicalField {
  text: string;
  weight: number;
}

/** Field weights: a name hit far outweighs a description/body hit. */
export const LEXICAL_WEIGHTS = { name: 10, description: 1, body: 0.25 } as const;

/** Relevance of one candidate: each distinct matching stem, per field, adds the field weight. */
export function lexicalScore(queryStems: ReadonlySet<string>, fields: readonly LexicalField[]): number {
  let score = 0;
  for (const field of fields) {
    for (const s of lexicalStems(field.text)) if (queryStems.has(s)) score += field.weight;
  }
  return score;
}

/**
 * Rank `items` by relevance to `query`; returns at most `limit` items with a score above
 * zero, best first, ties in input order (so a stable input yields a stable answer).
 */
export function rankLexically<T>(
  items: readonly T[],
  query: string,
  fieldsOf: (item: T) => readonly LexicalField[],
  limit: number,
): T[] {
  const queryStems = lexicalStems(query);
  if (queryStems.size === 0 || limit <= 0) return [];
  return items
    .map((item, index) => ({ item, index, score: lexicalScore(queryStems, fieldsOf(item)) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, limit)
    .map((e) => e.item);
}

/** The fields a tool schema is scored on. */
export function toolSchemaFields(tool: ToolSchema): LexicalField[] {
  return [
    { text: tool.function.name.replace(/^builtin_/, ""), weight: LEXICAL_WEIGHTS.name },
    { text: tool.function.description ?? "", weight: LEXICAL_WEIGHTS.description },
  ];
}

/** The best `limit` tool schemas for `query`. */
export function searchToolSchemas(catalog: readonly ToolSchema[], query: string, limit: number): ToolSchema[] {
  return rankLexically(catalog, query, toolSchemaFields, limit);
}

/** Name of the deferred-tool meta tool (cost lever C1). */
export const TOOL_SEARCH_TOOL = "tool_search";

/**
 * The `tool_search` schema. Its description is static so it never perturbs the cached
 * tools prefix; the matched tools become callable from the next turn for the rest of
 * the run.
 */
export const TOOL_SEARCH_SCHEMA: ToolSchema = {
  type: "function",
  function: {
    name: TOOL_SEARCH_TOOL,
    description:
      "Only a core set of tools is loaded. When you need a capability that is not in your tool list "
      + "(project tasks, OKRs, specs, incidents, knowledge base, marketing, executions, …) call this with a few "
      + "keywords. Returns the best-matching tools with their full schemas; they stay callable for the rest of the run.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: 'Keywords for the capability, e.g. "create task" or "update key result".' },
        limit: { type: "number", description: "Max tools to return (default 8, max 15)." },
      },
      required: ["query"],
    },
  },
};
