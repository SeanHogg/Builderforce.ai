/**
 * How a founder object asks the model for MONEY — the two hints and the currency field
 * every money-carrying founder kind shares.
 *
 * A leaf module (it imports nothing at runtime) so that `founderObjects.ts` and the kind
 * modules split out of it (`founderMeasureSpecs.ts`) read ONE wording without a cycle.
 */

import type { SpecField } from './specObjects';

/**
 * Money is WRITTEN as prose and READ as a number.
 *
 * The original rule was prose-only, and its reasoning was sound: a founder object
 * routinely holds a figure that is a range, an estimate, or explicitly unknown
 * ("~$2–4M ARR", "not disclosed"), and forcing those into an integer either loses the
 * qualifier or invents a precision the source never had — an invented precision in a
 * competitor analysis being exactly what the empty-shell rule exists to stop.
 *
 * The conclusion was wrong, because it made the CFO's most basic operation
 * UNREPRESENTABLE rather than merely unimplemented: a cap table could not be totalled,
 * `committed` could not be compared to `targetAmount`, and no two entities could be
 * consolidated. Every real figure left for a spreadsheet and came back as a screenshot.
 *
 * `canvasMoney.ts` resolves it without changing what the model writes: {@link
 * parseMoney} reads the SAME prose and yields `{amount, currency, approximate, low,
 * high, qualifier}`, so "~$2–4M ARR" is both a preserved qualifier and a real number,
 * and "not disclosed" is `disclosed: false` with NO amount — never a silent zero. So the
 * hint below is unchanged for the research kinds (write what the source said), while the
 * operational kinds added under "the money, operated" ask for a plain number plus a
 * `currency` field, because an invoice's amount is a fact and not a characterisation.
 */
export const MONEY_HINT = 'A human-readable amount including its currency and any qualifier the source actually carried, e.g. "$1.2M ARR (2025 estimate)" or "not disclosed". Never invent a precise figure — it is parsed into a real number for totals, and "not disclosed" is preserved as undisclosed rather than counted as zero.';

/** For the operated kinds, where the number is a fact rather than a characterisation. */
export const EXACT_MONEY_HINT = 'A plain number in major units (dollars, not cents) — no symbols, no "k"/"M" suffix, no commas. The currency lives in the `currency` field so this object can be totalled and consolidated. Leave it empty rather than estimating.';

export const CURRENCY_FIELD: SpecField = {
  name: 'currency',
  render: 'stat',
  label: 'currency',
  hint: 'ISO-4217 code for every amount on this object, e.g. "USD", "EUR", "GBP". One currency per object — a mixed-currency total is refused rather than silently added.',
};
