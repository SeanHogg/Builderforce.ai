/**
 * Types for the lexical TypeScript-source reader. Same reason as
 * `byoProviderMap.d.mts`: the module is `.mjs` so CI scripts can run it unbuilt, but
 * `src/application/llm/byoProviderMap.test.ts` imports it to prove the backfill reads
 * the same premium surcharge the ledger applies, and an untyped import would make
 * that assertion vacuous.
 */

/** The balanced `open`…`close` literal following `anchor`, delimiters included. */
export function blockAfter(
  source: string,
  anchor: RegExp,
  open: string,
  close: string,
  label: string,
): string;

/** A numeric literal constant (`export const X = 1_000;`) as a number. */
export function numericConstant(source: string, name: string, label: string): number;
