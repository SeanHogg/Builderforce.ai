import { describe, expect, it } from 'vitest';
import { FRUSTRATION_MARK_KINDS, GRID, MARK_KINDS, isMarkKind, toGridCell } from './kinds';

describe('MARK_KINDS', () => {
  it('is exactly the §3.4 vocabulary', () => {
    expect([...MARK_KINDS]).toEqual([
      'page', 'click', 'event', 'rage', 'dead', 'quickback', 'excessive_scroll', 'error', 'vital', 'scroll',
    ]);
  });

  it('recognises mark kinds', () => {
    expect(isMarkKind('vital')).toBe(true);
    expect(isMarkKind('scroll')).toBe(true);
    expect(isMarkKind('pageview')).toBe(false);
    expect(isMarkKind(3)).toBe(false);
  });

  it('frustration kinds are a subset of the mark kinds', () => {
    for (const kind of FRUSTRATION_MARK_KINDS) expect(isMarkKind(kind)).toBe(true);
  });
});

describe('toGridCell', () => {
  it('uses a 50-cell lattice over the document', () => {
    expect(GRID).toBe(50);
    expect(toGridCell(0, 0, 1000, 2000)).toEqual({ gx: 0, gy: 0 });
    expect(toGridCell(500, 1000, 1000, 2000)).toEqual({ gx: 25, gy: 25 });
    expect(toGridCell(19, 39, 1000, 2000)).toEqual({ gx: 0, gy: 0 });
    expect(toGridCell(20, 40, 1000, 2000)).toEqual({ gx: 1, gy: 1 });
  });

  it('clamps to 0..49', () => {
    expect(toGridCell(1000, 2000, 1000, 2000)).toEqual({ gx: 49, gy: 49 });
    expect(toGridCell(5000, -10, 1000, 2000)).toEqual({ gx: 49, gy: 0 });
  });

  it('is 0 for a degenerate document size', () => {
    expect(toGridCell(10, 10, 0, 0)).toEqual({ gx: 0, gy: 0 });
    expect(toGridCell(Number.NaN, 10, 100, 100)).toEqual({ gx: 0, gy: 5 });
  });
});
