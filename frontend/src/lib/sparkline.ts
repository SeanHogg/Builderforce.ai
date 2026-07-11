/**
 * sparkline.ts — one place that turns a numeric series into an SVG polyline
 * geometry (points string + per-point dots), normalised so the lowest value sits
 * at the bottom. Shared by every mini loss/metric sparkline (the Evermind Knowledge
 * Map training readout, the build-pipeline metrics view, …) so the layout math
 * isn't re-derived per component. Needs ≥2 points; returns null otherwise.
 */

export interface SparklineGeom {
  w: number;
  h: number;
  /** `<polyline points>` value. */
  points: string;
  /** Per-point coordinates (for dots / the latest-point marker). */
  dots: Array<{ x: number; y: number }>;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

export function buildSparkline(
  values: number[],
  opts: { w?: number; h?: number; pad?: number } = {},
): SparklineGeom | null {
  if (values.length < 2) return null;
  const w = opts.w ?? 128;
  const h = opts.h ?? 34;
  const pad = opts.pad ?? 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const dots = values.map((v, i) => ({
    x: r2(pad + (i / (values.length - 1)) * (w - 2 * pad)),
    // Lowest value → bottom of the box (a falling loss curve reads as "improving").
    y: r2(pad + (1 - (v - min) / span) * (h - 2 * pad)),
  }));
  return { w, h, points: dots.map((d) => `${d.x},${d.y}`).join(' '), dots };
}
