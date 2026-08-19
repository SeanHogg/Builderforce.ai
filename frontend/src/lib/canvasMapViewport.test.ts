/**
 * The map's viewport maths, away from React.
 *
 * A map that can be dragged into empty ocean, or that silently changes its own
 * zoom while panning, looks broken in ways a component test would not catch —
 * so the clamping is asserted here, on the pure functions the card calls.
 */
import { describe, it, expect } from 'vitest';
import {
  MAP_ZOOM_RANGE, boundsCenter, mapViewportBounds, panCenter, sanitizeMapCenter, sanitizeMapZoom,
  type GeoBounds,
} from './canvasGeo';

/** Michigan-ish: 6° of latitude, 8° of longitude. */
const BASE: GeoBounds = [42, 48, -90, -82];

describe('sanitizeMapZoom', () => {
  it('floors at the fitted extent and caps at the maximum', () => {
    expect(sanitizeMapZoom(undefined)).toBe(MAP_ZOOM_RANGE.min);
    expect(sanitizeMapZoom('nonsense')).toBe(MAP_ZOOM_RANGE.min);
    expect(sanitizeMapZoom(0.2)).toBe(MAP_ZOOM_RANGE.min);
    expect(sanitizeMapZoom(1000)).toBe(MAP_ZOOM_RANGE.max);
    expect(sanitizeMapZoom(4)).toBe(4);
  });
});

describe('sanitizeMapCenter', () => {
  it('accepts a real coordinate and refuses anything else', () => {
    expect(sanitizeMapCenter([45, -86])).toEqual([45, -86]);
    expect(sanitizeMapCenter(['45', '-86'])).toEqual([45, -86]);
    expect(sanitizeMapCenter([91, 0])).toBeNull();
    expect(sanitizeMapCenter([0, 181])).toBeNull();
    expect(sanitizeMapCenter([45])).toBeNull();
    expect(sanitizeMapCenter(null)).toBeNull();
  });
});

describe('mapViewportBounds', () => {
  it('is the base extent at rest, so nothing changes for a map nobody touched', () => {
    expect(mapViewportBounds(BASE, 1, null)).toEqual(BASE);
    expect(mapViewportBounds(BASE, undefined, undefined)).toEqual(BASE);
  });

  it('halves each span at 2x and keeps the requested centre', () => {
    const [south, north, west, east] = mapViewportBounds(BASE, 2, [45, -86]);
    expect(north - south).toBeCloseTo(3);
    expect(east - west).toBeCloseTo(4);
    expect((south + north) / 2).toBeCloseTo(45);
    expect((west + east) / 2).toBeCloseTo(-86);
  });

  it('clamps the CENTRE rather than the edges, so a pan to the corner keeps the zoom', () => {
    const view = mapViewportBounds(BASE, 4, [89, 179]);
    const [south, north, west, east] = view;
    // The window is still exactly a quarter of each span…
    expect(north - south).toBeCloseTo(1.5);
    expect(east - west).toBeCloseTo(2);
    // …and it is still inside the extent.
    expect(south).toBeGreaterThanOrEqual(BASE[0] - 1e-9);
    expect(north).toBeLessThanOrEqual(BASE[1] + 1e-9);
    expect(west).toBeGreaterThanOrEqual(BASE[2] - 1e-9);
    expect(east).toBeLessThanOrEqual(BASE[3] + 1e-9);
  });

  it('survives a degenerate extent (one point) without producing NaN', () => {
    const view = mapViewportBounds([10, 10, 20, 20], 3, [10, 20]);
    for (const value of view) expect(Number.isFinite(value)).toBe(true);
  });
});

describe('panCenter', () => {
  it('moves the map WITH the pointer: dragging right shows what was to the left', () => {
    const view = mapViewportBounds(BASE, 2, [45, -86]);
    const moved = panCenter(view, boundsCenter(view), 100, 0, { width: 200, height: 100 });
    // Half the frame's width dragged right → the centre moves a quarter-span west.
    expect(moved[1]).toBeLessThan(-86);
    expect(moved[0]).toBeCloseTo(45);
  });

  it('moves down-screen as latitude decreasing, not increasing', () => {
    const view = mapViewportBounds(BASE, 2, [45, -86]);
    const moved = panCenter(view, boundsCenter(view), 0, -50, { width: 200, height: 100 });
    expect(moved[0]).toBeLessThan(45);
  });

  it('does not divide by zero on an unmeasured surface', () => {
    const moved = panCenter(BASE, [45, -86], 10, 10, { width: 0, height: 0 });
    for (const value of moved) expect(Number.isFinite(value)).toBe(true);
  });
});
