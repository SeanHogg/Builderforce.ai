/**
 * Shared categorical palette for the chart primitives (DonutChart / BarChart /
 * TrendChart). One source of truth so every visualization across the surfaces
 * draws series in the same, brand-aligned order instead of re-inventing colours
 * inline. Literal hex (not theme vars) because chart series colours must stay
 * stable across light/dark and be passable to raw SVG fills.
 */

export const CHART_PALETTE = [
  '#7c5cff', // violet (brand)
  '#4d9eff', // coral-bright blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#14b8a6', // teal
  '#ec4899', // pink
  '#8b5cf6', // purple
  '#06b6d4', // cyan
  '#eab308', // yellow
] as const;

/** Stable colour for the i-th series/segment (wraps round the palette). */
export function colorAt(i: number): string {
  return CHART_PALETTE[((i % CHART_PALETTE.length) + CHART_PALETTE.length) % CHART_PALETTE.length];
}
