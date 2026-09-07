/**
 * The ONE dollar-figure formatter for LLM spend — every surface that shows "what
 * did this cost" (ticket chip, run drawer, routing analytics) renders through it,
 * so sub-cent spend reads the same everywhere instead of three inline ternaries.
 * Currency notation is not translated copy; the `<` and `$` are the same in every
 * catalog the product ships.
 */
export function formatUsdSpend(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}
