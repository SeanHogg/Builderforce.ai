/**
 * Heat layers and the colour ramp (PRD 33 §4.3, §8 S4).
 *
 * A LAYER is what an overlay paints: a lattice (`cols × rows`) and the cells
 * on it, each with an intensity `t`. Heat is `0..1`; a difference is `-1..1`
 * (negative = the compare release had more). The lattice is laid over the
 * WHOLE document (`GRID` in the contract), so the overlay maps a cell to page
 * pixels from the document's size, never the viewport's.
 *
 * Colours come ONLY from the CSS custom properties `--heat-cold`, `--heat-hot`
 * and `--heat-drop` (`heatmap.module.css`), read with getComputedStyle and
 * normalised through a canvas context, so any colour syntax a token uses works.
 */

import { GRID, type ReplayHeatGridDto } from '@builderforce/interaction-contract';

export interface HeatCell {
  gx: number;
  gy: number;
  /** 0..1 heat, or -1..1 for a difference. */
  t: number;
}

export interface HeatLayer {
  cols: number;
  rows: number;
  cells: HeatCell[];
}

export const EMPTY_LAYER: HeatLayer = { cols: GRID, rows: GRID, cells: [] };

/** Scroll depth is reported per decile (`gy` = decile, `gx` = 0). */
const SCROLL_DECILES = 10;

/**
 * Each cell's share of the layer. Click-like kinds: the cell's count over the
 * total. Scroll: the share of page views REACHING each decile (a page view
 * whose deepest decile is 7 reached 0..7), which is what a fold reader wants.
 */
export function gridShares(grid: ReplayHeatGridDto): Map<string, number> {
  const shares = new Map<string, number>();
  if (grid.kind === 'scroll') {
    const deepest = new Array<number>(SCROLL_DECILES).fill(0);
    for (const cell of grid.cells) {
      if (cell.gy >= 0 && cell.gy < SCROLL_DECILES) deepest[cell.gy] = (deepest[cell.gy] ?? 0) + cell.n;
    }
    const total = deepest.reduce((sum, n) => sum + n, 0);
    let reaching = total;
    for (let decile = 0; decile < SCROLL_DECILES; decile += 1) {
      if (total > 0) shares.set(`0:${decile}`, reaching / total);
      reaching -= deepest[decile] ?? 0;
    }
    return shares;
  }
  const total = grid.total > 0 ? grid.total : grid.cells.reduce((sum, cell) => sum + cell.n, 0);
  if (total <= 0) return shares;
  for (const cell of grid.cells) shares.set(`${cell.gx}:${cell.gy}`, (shares.get(`${cell.gx}:${cell.gy}`) ?? 0) + cell.n / total);
  return shares;
}

function latticeOf(grid: ReplayHeatGridDto): { cols: number; rows: number } {
  return grid.kind === 'scroll' ? { cols: 1, rows: SCROLL_DECILES } : { cols: GRID, rows: GRID };
}

function cellsFrom(shares: Map<string, number>, scale: number): HeatCell[] {
  const cells: HeatCell[] = [];
  if (scale <= 0) return cells;
  for (const [key, share] of shares) {
    const [gx, gy] = key.split(':').map(Number) as [number, number];
    const t = share / scale;
    if (t !== 0) cells.push({ gx, gy, t: Math.max(-1, Math.min(1, t)) });
  }
  return cells;
}

/** One release's heat, normalised to its hottest cell. */
export function heatLayer(grid: ReplayHeatGridDto | null): HeatLayer {
  if (!grid) return EMPTY_LAYER;
  const shares = gridShares(grid);
  // Scroll reach is already a 0..1 share of page views; heat is relative to the hottest cell.
  const scale = grid.kind === 'scroll' ? 1 : Math.max(0, ...shares.values());
  return { ...latticeOf(grid), cells: cellsFrom(shares, scale) };
}

/**
 * Where this release differs from the compare release, as SHARES (so a release
 * with twice the traffic is not twice as hot): `t > 0` this release has more,
 * `t < 0` the compare release had more, normalised to the largest change.
 */
export function differenceLayer(current: ReplayHeatGridDto | null, compare: ReplayHeatGridDto | null): HeatLayer {
  if (!current || !compare) return EMPTY_LAYER;
  const a = gridShares(current);
  const b = gridShares(compare);
  const diff = new Map<string, number>();
  for (const key of new Set([...a.keys(), ...b.keys()])) diff.set(key, (a.get(key) ?? 0) - (b.get(key) ?? 0));
  const scale = Math.max(0, ...[...diff.values()].map(Math.abs));
  return { ...latticeOf(current), cells: cellsFrom(diff, scale) };
}

// ── Colour ─────────────────────────────────────────────────────────────────

export type Rgb = readonly [number, number, number];

export interface HeatPalette {
  cold: Rgb;
  hot: Rgb;
  drop: Rgb;
}

export const PALETTE_VARS = { cold: '--heat-cold', hot: '--heat-hot', drop: '--heat-drop' } as const;

/**
 * Any CSS colour → rgb, by letting a canvas context parse it (it normalises to
 * `#rrggbb` or `rgba(…)`). Null when the value is not a colour.
 */
export function parseCssColor(ctx: Pick<CanvasRenderingContext2D, 'fillStyle'>, value: string): Rgb | null {
  const raw = value.trim();
  if (!raw) return null;
  const sentinel = 'rgba(1, 2, 3, 0)';
  ctx.fillStyle = sentinel;
  ctx.fillStyle = raw;
  const normalised = String(ctx.fillStyle);
  if (normalised === sentinel && raw !== sentinel) return null;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normalised);
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)];
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(normalised);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** The ramp's three colours from the element's computed custom properties; null when a token is missing. */
export function readHeatPalette(el: Element, ctx: Pick<CanvasRenderingContext2D, 'fillStyle'>): HeatPalette | null {
  const style = getComputedStyle(el);
  const cold = parseCssColor(ctx, style.getPropertyValue(PALETTE_VARS.cold));
  const hot = parseCssColor(ctx, style.getPropertyValue(PALETTE_VARS.hot));
  const drop = parseCssColor(ctx, style.getPropertyValue(PALETTE_VARS.drop));
  return cold && hot && drop ? { cold, hot, drop } : null;
}

const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** A cell's fill: cold → hot for heat, drop for a negative difference; stronger cells are more opaque. */
export function rampColor(palette: HeatPalette, t: number): string {
  const strength = Math.min(1, Math.abs(t));
  const alpha = (0.12 + 0.6 * strength).toFixed(3);
  if (t < 0) {
    const [r, g, b] = palette.drop;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const [r, g, b] = [0, 1, 2].map((i) => mix(palette.cold[i]!, palette.hot[i]!, strength)) as [number, number, number];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
