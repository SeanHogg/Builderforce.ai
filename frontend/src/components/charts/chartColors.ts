/**
 * Shared categorical palette for the chart primitives (DonutChart / BarChart /
 * TrendChart). One source of truth so every visualization across the surfaces
 * draws series in the same, brand-aligned order instead of re-inventing colours
 * inline.
 *
 * Every entry is a TOKEN. The older half of this file argued the opposite —
 * "literal hex because chart series colours must stay stable across light/dark"
 * — and it was already contradicting itself, since four of the ten had been
 * moved onto tokens. Stability across themes is not what a literal buys: a
 * series drawn as one fixed violet is that SAME violet on near-black and on warm
 * paper, which means it is legible on one of them and washed out on the other. What
 * has to stay stable is the series' IDENTITY — index 4 is always "the red one"
 * — and a token holds that better than a literal does, because it can be the
 * right red for the stock it is printed on. PRD 21 §2.2: "Categorical hues …
 * never hardcode: they flip per theme like everything else."
 */

export const CHART_PALETTE = [
  'var(--violet-bright)',
  'var(--coral-bright)', // the brand blue (§2.1 trap 1: the name is historical)
  'var(--success)',
  'var(--warning)',
  'var(--red-bright)',
  'var(--teal-bright)',
  'var(--pink-bright)',
  'var(--purple-bright)',
  'var(--cyan-bright)',
  'var(--yellow-bright)',
] as const;

/** Stable colour for the i-th series/segment (wraps round the palette). */
export function colorAt(i: number): string {
  return CHART_PALETTE[((i % CHART_PALETTE.length) + CHART_PALETTE.length) % CHART_PALETTE.length];
}
