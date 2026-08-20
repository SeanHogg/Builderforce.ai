/**
 * The three summary statistics, declared once.
 *
 * `median` and `avg` were exported from `insights/bottleneckInsights.ts`, a
 * module that imports the Drizzle schema and a tenant-scoping helper. Every
 * consumer of a MEDIAN therefore had to pull the delivery-insights query layer in
 * with it — which is fine for the four modules that were already there and is not
 * fine for a pure domain module whose entire contract is "no database, no
 * network, no clock" (`people/roster.ts` says so in its header).
 *
 * So the arithmetic lives here and `bottleneckInsights` re-exports it, leaving
 * its existing importers untouched. There is exactly one implementation of the
 * even-length median in the api, which is the point: the two conventions
 * (mean-of-the-middle-two versus lower-of-the-two) differ on every even-sized
 * sample, and two copies eventually disagree.
 */

/** The middle value, or the mean of the middle two. `null` for an empty sample —
 *  never 0, which would read as a real measurement of a company with no people. */
export const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** The arithmetic mean, or `null` for an empty sample. */
export const avg = (xs: readonly number[]): number | null =>
  (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** The total. 0 for an empty sample, which for a sum is the honest answer. */
export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
