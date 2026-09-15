/**
 * Formatting the calculators share.
 *
 * Its own module so a tool family (`startupFinanceTools.ts`) can import it without
 * importing the registry that imports the family — the cycle `toolDefinitions →
 * startupFinanceTools → toolDefinitions` is a real one with a VALUE on both sides.
 * `toolDefinitions.ts` re-exports `money` so its existing consumers keep one import.
 */

/**
 * A dollar figure in the reader's grouping — the tool engine has no viewer, but a
 * SAVED run is re-rendered for whoever opens the history, and a German reader
 * expects `1.234,56 $`. The currency stays USD (it is what the platform bills in);
 * only the grouping and the symbol placement follow the reader.
 */
export const money = (n: number, locale = 'en-US'): string =>
  n.toLocaleString(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 });

/** A percentage with one decimal when it is small enough to need one. */
export const percent = (fraction: number): string => {
  const value = fraction * 100;
  return `${Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10}%`;
};

/** Months, to one decimal, or a dash when there is no finite answer. */
export const monthsLabel = (months: number | null): string =>
  months === null || !Number.isFinite(months) ? '—' : `${Math.round(months * 10) / 10}`;
