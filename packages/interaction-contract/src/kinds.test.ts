import { describe, expect, it } from 'vitest';
import { GRID_PX, isInteractionKind, isMarkKind, toGridCell } from './kinds';

describe('kinds', () => {
  it('recognises interaction and mark kinds', () => {
    expect(isInteractionKind('click')).toBe(true);
    expect(isInteractionKind('nope')).toBe(false);
    expect(isMarkKind('rage')).toBe(true);
    expect(isMarkKind('click')).toBe(false);
  });

  it('snaps points to the 50px grid', () => {
    expect(GRID_PX).toBe(50);
    expect(toGridCell(0, 0)).toEqual({ gx: 0, gy: 0 });
    expect(toGridCell(49, 51)).toEqual({ gx: 0, gy: 1 });
    expect(toGridCell(100, 250)).toEqual({ gx: 2, gy: 5 });
  });
});
