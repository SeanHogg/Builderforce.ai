/**
 * The "~4 chars per token" heuristic — the ONE definition every host estimates with:
 * the gateway's context-fit check, the cost forecast, the router's expected-cost
 * ranking and the on-prem context guards.
 *
 * Estimation only, never billing: accurate to ~15% for English and code and errs
 * slightly high on JSON punctuation, which is the safe direction for a fit check.
 */

export const CHARS_PER_TOKEN = 4;

export function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

/** The same heuristic over a text; absent text is zero tokens. */
export function estimateTokensFromText(text: string | null | undefined): number {
  return text ? estimateTokensFromChars(text.length) : 0;
}
