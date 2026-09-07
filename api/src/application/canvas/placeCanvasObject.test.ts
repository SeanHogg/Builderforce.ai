import { describe, it, expect } from 'vitest';
import { containerCardPosition } from './placeCanvasObject';

/**
 * The placement rule, which is the only part of `placeCanvasObject` that is a
 * DECISION rather than a database write. The write path's own guards — the
 * resource idempotency check and the lost-revision race — are asserted through
 * `convertSessionToApp`'s callers; this pins the geometry both placements share.
 */
describe('containerCardPosition', () => {
  it('drops the card left of everything, level with the top-most object', () => {
    // Container → thing: the edge a caller draws next has to read that way, and
    // it cannot if the container lands inside the cluster it contains.
    expect(containerCardPosition([
      { canvasData: { x: 900, y: 400 } },
      { canvasData: { x: 500, y: 240 } },
      { canvasData: { x: 700, y: 980 } },
    ])).toEqual({ x: 120, y: 240 });
  });

  it('uses the empty-board origin when nothing is placed yet', () => {
    expect(containerCardPosition([])).toEqual({ x: 160, y: 120 });
  });

  it('ignores objects with no usable coordinates rather than reading them as 0', () => {
    // A single unpositioned object used to drag the whole placement to x: -380,
    // which is off-screen on a board whose real content sits at 600.
    expect(containerCardPosition([
      { canvasData: {} },
      { canvasData: { x: 'nope', y: null } },
      { canvasData: { x: 600, y: 300 } },
    ])).toEqual({ x: 220, y: 300 });
  });

  it('falls back to the origin when NO object carries coordinates', () => {
    expect(containerCardPosition([{ canvasData: {} }, {}])).toEqual({ x: 160, y: 120 });
  });
});
