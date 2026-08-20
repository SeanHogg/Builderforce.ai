import { describe, expect, it } from "vitest";
import {
  ARC_PAD_DEG,
  CX,
  CY,
  labelAt,
  padSlice,
  polar,
  R_CENTER,
  R_INNER_0,
  R_INNER_1,
  R_OUTER_0,
  R_OUTER_1,
  sector,
  slice,
  twoLines,
  VIEWBOX,
} from "./sunburstGeometry";

/**
 * The Project 360 wheel is drawn with hand-rolled trigonometry and no chart library, so
 * nothing but these assertions stands between a sign error and a wheel that looks
 * plausible while pointing every arc at the wrong dimension.
 */

/** Parse the "M x,y" move that starts a sector path. */
function startPoint(d: string): [number, number] {
  const m = /^M(-?[\d.]+),(-?[\d.]+)/.exec(d);
  if (!m) throw new Error(`no move command in ${d}`);
  return [Number(m[1]), Number(m[2])];
}

/** Pull the two arc commands' flags out of a sector path, in order. */
function arcFlags(d: string): Array<{ large: number; sweep: number }> {
  return [...d.matchAll(/A[\d.]+,[\d.]+ 0 (\d) (\d)/g)].map((m) => ({
    large: Number(m[1]),
    sweep: Number(m[2]),
  }));
}

describe("polar", () => {
  it("puts 0° at twelve o'clock, not at three", () => {
    const [x, y] = polar(100, 0);
    expect(x).toBeCloseTo(CX, 6);
    expect(y).toBeCloseTo(CY - 100, 6);
  });

  it("increases CLOCKWISE — 90° is to the right", () => {
    const [x, y] = polar(100, 90);
    expect(x).toBeCloseTo(CX + 100, 6);
    expect(y).toBeCloseTo(CY, 6);
  });

  it("continues clockwise through the bottom and the left", () => {
    const [bx, by] = polar(100, 180);
    expect(bx).toBeCloseTo(CX, 6);
    expect(by).toBeCloseTo(CY + 100, 6);
    const [lx, ly] = polar(100, 270);
    expect(lx).toBeCloseTo(CX - 100, 6);
    expect(ly).toBeCloseTo(CY, 6);
  });

  it("wraps: 360° lands exactly where 0° does", () => {
    const [x0, y0] = polar(70, 0);
    const [x360, y360] = polar(70, 360);
    expect(x360).toBeCloseTo(x0, 6);
    expect(y360).toBeCloseTo(y0, 6);
  });

  it("keeps the outermost radius inside the viewBox", () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const [x, y] = polar(R_OUTER_1, deg);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(VIEWBOX);
      expect(y).toBeLessThanOrEqual(VIEWBOX);
    }
  });
});

describe("sector", () => {
  it("starts on the OUTER radius at the start angle", () => {
    const [x, y] = startPoint(sector(R_INNER_0, R_INNER_1, 0, 90));
    const [ex, ey] = polar(R_INNER_1, 0);
    expect(x).toBeCloseTo(Number(ex.toFixed(2)), 2);
    expect(y).toBeCloseTo(Number(ey.toFixed(2)), 2);
  });

  it("sweeps the outer edge clockwise and the inner edge back", () => {
    // Opposite sweep flags are what close the ring segment on itself; two equal flags
    // produce a self-crossing bowtie that still renders, just wrongly.
    const flags = arcFlags(sector(R_OUTER_0, R_OUTER_1, 10, 80));
    expect(flags).toHaveLength(2);
    expect(flags[0].sweep).toBe(1);
    expect(flags[1].sweep).toBe(0);
  });

  it("does not set large-arc below 180°", () => {
    for (const f of arcFlags(sector(R_OUTER_0, R_OUTER_1, 0, 90))) expect(f.large).toBe(0);
  });

  it("sets large-arc above 180° — a single-pillar wheel is a full ring", () => {
    // Without this the one-pillar case draws the COMPLEMENT of the arc: a thin sliver
    // where a whole ring belongs, and no error anywhere.
    for (const f of arcFlags(sector(R_INNER_0, R_INNER_1, 0.6, 359.4))) expect(f.large).toBe(1);
  });

  it("closes the path", () => {
    expect(sector(R_INNER_0, R_INNER_1, 0, 90).trimEnd().endsWith("Z")).toBe(true);
  });

  it("emits finite coordinates for every slice of a four-pillar wheel", () => {
    for (let i = 0; i < 4; i++) {
      const [a, b] = slice(0, 360, i, 4);
      expect(sector(R_OUTER_0, R_OUTER_1, a, b)).not.toMatch(/NaN|Infinity/);
    }
  });
});

describe("slice", () => {
  it("divides a span evenly and leaves no gap between neighbours", () => {
    const spans = [0, 1, 2, 3].map((i) => slice(0, 360, i, 4));
    expect(spans).toEqual([
      [0, 90],
      [90, 180],
      [180, 270],
      [270, 360],
    ]);
  });

  it("tiles a pillar's own span rather than the whole circle", () => {
    const [pStart, pEnd] = slice(0, 360, 1, 4); // second pillar: 90°–180°
    expect(slice(pStart, pEnd - pStart, 0, 2)).toEqual([90, 135]);
    expect(slice(pStart, pEnd - pStart, 1, 2)).toEqual([135, 180]);
  });

  it("treats a count of 0 as one whole slice instead of dividing by zero", () => {
    // A pillar with no dimensions must still draw; NaN in a path `d` blanks it silently.
    expect(slice(0, 90, 0, 0)).toEqual([0, 90]);
  });
});

describe("padSlice", () => {
  it("insets both edges so neighbouring arcs read as separate wedges", () => {
    expect(padSlice(0, 90, ARC_PAD_DEG)).toEqual([0.6, 89.4]);
  });

  it("collapses rather than INVERTS a slice narrower than the padding", () => {
    // An inverted slice (end before start) renders as a garbage path; a hairline is the
    // honest picture of an arc too thin to draw.
    const [a, b] = padSlice(10, 10.5, ARC_PAD_DEG);
    expect(a).toBe(b);
    expect(a).toBe(10.25);
  });

  it("never produces a negative sweep", () => {
    for (let width = 0; width <= 3; width += 0.25) {
      const [a, b] = padSlice(0, width, ARC_PAD_DEG);
      expect(b).toBeGreaterThanOrEqual(a);
    }
  });
});

describe("labelAt", () => {
  it("places a pillar label on the ring's mid-radius", () => {
    const mid = (R_INNER_0 + R_INNER_1) / 2;
    const { x, y } = labelAt(mid, 0);
    expect(x).toBeCloseTo(CX, 6);
    expect(y).toBeCloseTo(CY - mid, 6);
  });

  it("keeps every ring label clear of the centre disc", () => {
    const innerMid = (R_INNER_0 + R_INNER_1) / 2;
    const outerMid = (R_OUTER_0 + R_OUTER_1) / 2;
    expect(innerMid).toBeGreaterThan(R_CENTER);
    expect(outerMid).toBeGreaterThan(R_CENTER);
  });
});

describe("twoLines", () => {
  it("leaves a short label on one line", () => {
    expect(twoLines("Delivery")).toEqual(["Delivery"]);
  });

  it("splits a long label near the middle, dropping the break space", () => {
    expect(twoLines("Delivery Health")).toEqual(["Delivery", "Health"]);
  });

  it("keeps an unbreakable long word whole rather than chopping mid-token", () => {
    expect(twoLines("Maintainability")).toEqual(["Maintainability"]);
  });

  it("never loses characters other than the single break space", () => {
    for (const label of ["Delivery Health", "Team Engagement Score", "Quality"]) {
      const lines = twoLines(label);
      expect(lines.join(" ")).toBe(label);
    }
  });
});

describe("ring radii", () => {
  it("are ordered and non-overlapping, centre outwards", () => {
    expect(R_CENTER).toBeLessThan(R_INNER_0);
    expect(R_INNER_0).toBeLessThan(R_INNER_1);
    expect(R_INNER_1).toBeLessThan(R_OUTER_0);
    expect(R_OUTER_0).toBeLessThan(R_OUTER_1);
  });

  it("fit the viewBox with the wheel centred", () => {
    expect(CX).toBe(VIEWBOX / 2);
    expect(CY).toBe(VIEWBOX / 2);
    expect(R_OUTER_1).toBeLessThanOrEqual(VIEWBOX / 2);
  });
});
