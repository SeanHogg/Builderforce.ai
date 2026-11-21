/**
 * LIKE / ILIKE literal matching. Postgres' default LIKE escape character is `\`, so
 * escaping `\`, `%` and `_` makes user text match itself and nothing else.
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
