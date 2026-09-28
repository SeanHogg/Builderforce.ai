/**
 * The significant words of a search query — each becomes one ILIKE matcher.
 *
 * Lowercase alphanumeric runs, one-character noise dropped, duplicates removed, and
 * capped so a pasted paragraph cannot fan out into dozens of LIKE clauses. Memory
 * recall, project facts and the coordination blackboard all filter this way, so
 * "which words does a lexical recall match on" has one answer.
 */
export const MAX_QUERY_TERMS = 12;

export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length > 1))].slice(0, MAX_QUERY_TERMS);
}
