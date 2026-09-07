import { describe, expect, it } from 'vitest';
import type { CreationFlowNode } from './CreationNode';
import { alignCanvasNodesLeft, arrangeCanvasNodes, canvasArrangementTargets, canvasNodeDimensions, freeCanvasSlot, nextCanvasObjectPosition, placeAppendedCanvasNodes } from './creationCanvasLayout';

/** A desktop board and a phone, as the layout measures them. */
const WIDE = { width: 1_600, narrow: false } as const;
const PHONE = { width: 380, narrow: true } as const;

function node(id: string, x: number, y: number, width: number, height: number): CreationFlowNode {
  return { id, type: 'creation', position: { x, y }, measured: { width, height }, data: { kind: 'task', title: id } };
}

function overlappingPairs(rects: { x: number; y: number; width: number; height: number }[]): number {
  let count = 0;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]!; const b = rects[j]!;
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) count += 1;
    }
  }
  return count;
}

describe('creation canvas layout', () => {
  it('uses React Flow measured dimensions ahead of stale configured dimensions', () => {
    const item = { ...node('a', 0, 0, 420, 310), width: 240, height: 130 };
    expect(canvasNodeDimensions(item)).toEqual({ width: 420, height: 310 });
  });

  it('falls back to the kind footprint so an unmeasured wide card is not treated as a small one', () => {
    const evaluation: CreationFlowNode = { id: 'e', type: 'creation', position: { x: 0, y: 0 }, data: { kind: 'evaluation', title: 'e' } };
    expect(canvasNodeDimensions(evaluation)).toEqual({ width: 650, height: 180 });
  });

  it('spaces a mixed-height grid without overlapping rows or columns', () => {
    const positions = arrangeCanvasNodes([
      node('a', 100, 50, 300, 400),
      node('b', 110, 60, 500, 180),
      node('c', 120, 70, 260, 240),
      node('d', 130, 80, 320, 300),
    ], 'grid', 40, 2);

    expect(positions.get('a')).toEqual({ x: 100, y: 50 });
    expect(positions.get('b')).toEqual({ x: 440, y: 50 });
    expect(positions.get('c')).toEqual({ x: 100, y: 490 });
    expect(positions.get('d')).toEqual({ x: 440, y: 490 });
  });

  it('fits the grid to the board rather than to the object count', () => {
    const nine = Array.from({ length: 9 }, (_, index) => node(`n${index}`, index, index, 260, 180));
    const columnsIn = (width: number) => new Set([...arrangeCanvasNodes(nine, 'grid', 48, undefined, width).values()].map((placement) => placement.x)).size;

    // `ceil(sqrt(9))` was 3 columns on every screen there has ever been.
    expect(columnsIn(3_440)).toBeGreaterThan(3);
    expect(columnsIn(900)).toBeLessThan(4);
    // An explicit request still wins over the fit.
    expect(new Set([...arrangeCanvasNodes(nine, 'grid', 48, 3, 3_440).values()].map((placement) => placement.x)).size).toBe(3);
  });

  it('targets the whole visible canvas when no explicit ids were requested', () => {
    const all = [node('brain', 0, 0, 280, 300), node('task-1', 20, 20, 300, 400), node('task-2', 30, 30, 300, 200)];
    const selectedScope = [all[0]!];

    expect(selectedScope).toHaveLength(1);
    expect(canvasArrangementTargets(all).map((item) => item.id)).toEqual(['brain', 'task-1', 'task-2']);
    expect(canvasArrangementTargets(all, new Set(['task-1', 'task-2'])).map((item) => item.id)).toEqual(['task-1', 'task-2']);
  });

  it('stacks new mobile output below existing objects while preserving desktop defaults', () => {
    const existing = [node('brain', 80, 40, 280, 300), node('lesson', 80, 388, 320, 220)];

    expect(nextCanvasObjectPosition(existing, {}, PHONE)).toEqual({ x: 80, y: 656 });
    expect(nextCanvasObjectPosition(existing, {}, WIDE)).toEqual({ x: 520, y: 280 });
    expect(nextCanvasObjectPosition(existing, { x: 900, y: 120 }, PHONE)).toEqual({ x: 900, y: 120 });
  });

  it('never drops an authored object on top of one that is already there', () => {
    const existing = [node('agent', 520, 280, 285, 210)];

    // The default point is taken, so the next card goes BESIDE it: a wide board has
    // room across, and spending it is the whole reason the viewport is measured.
    expect(nextCanvasObjectPosition(existing, {}, WIDE)).toEqual({ x: 845, y: 280 });
    expect(nextCanvasObjectPosition(existing, { x: 560, y: 300 }, WIDE)).toEqual({ x: 845, y: 300 });
    // Somewhere clear stays exactly where it was asked for.
    expect(nextCanvasObjectPosition(existing, { x: 1400, y: 300 }, WIDE)).toEqual({ x: 1400, y: 300 });
  });

  it('fills the width of a wide board before it grows downward', () => {
    // The failure this replaced: nine objects authored in one turn with no
    // coordinates, every one placed below the last — one ribbon of cards running
    // off the bottom of a 3440px screen with two thirds of the board empty.
    const board = { width: 2_000, narrow: false } as const;
    let placed: CreationFlowNode[] = [];
    for (let index = 0; index < 6; index += 1) {
      const at = nextCanvasObjectPosition(placed, {}, board, 'task');
      placed = [...placed, node(`n${index}`, at.x, at.y, 260, 180)];
    }

    expect(placed.filter((item) => item.position.y === 280)).toHaveLength(6);
    expect(overlappingPairs(placed.map((item) => ({ ...item.position, ...canvasNodeDimensions(item) })))).toBe(0);
  });

  it('keeps stacking on a phone, where there is no width to fill', () => {
    let placed: CreationFlowNode[] = [];
    for (let index = 0; index < 4; index += 1) {
      const at = nextCanvasObjectPosition(placed, {}, PHONE, 'task');
      placed = [...placed, node(`n${index}`, at.x, at.y, 260, 180)];
    }

    expect(new Set(placed.map((item) => item.position.x)).size).toBe(1);
    expect(new Set(placed.map((item) => item.position.y)).size).toBe(4);
  });

  it('walks along the row and then past it to find a clear slot', () => {
    const existing = [node('a', 500, 100, 300, 200), node('b', 500, 340, 300, 200), node('c', 500, 580, 300, 200)];

    // No room across: it walks down, exactly as it always did.
    expect(freeCanvasSlot(existing, { x: 520, y: 120 }, { width: 260, height: 180 })).toEqual({ x: 520, y: 820 });
    // Given room, it steps beside the object it hit instead.
    expect(freeCanvasSlot(existing, { x: 520, y: 120 }, { width: 260, height: 180 }, { wrapWidth: 900 })).toEqual({ x: 840, y: 120 });
  });

  it('places a batch against itself, so six objects added in one tick are not one card', () => {
    // Six @-mentioned agents seated in one turn: every call site computed the same
    // viewport centre, and appending straight onto `current` put all six on it. A
    // real session's diagnostics showed exactly this, at { x: 312.57, y: 182.01 }.
    const batch = Array.from({ length: 6 }, (_, index) => node(`agent-${index}`, 312, 182, 285, 212));
    const placed = placeAppendedCanvasNodes([], batch, WIDE);

    expect(placed).toHaveLength(6);
    expect(overlappingPairs(placed.map((item) => ({ ...item.position, ...canvasNodeDimensions(item) })))).toBe(0);
    // The first asked for a clear point and keeps it — identity included, so an
    // untouched addition does not churn React Flow.
    expect(placed[0]).toBe(batch[0]);
  });

  it('leaves an authored layout exactly where it authored itself', () => {
    const laidOut = [node('step-1', 0, 0, 260, 180), node('step-2', 340, 0, 260, 180), node('step-3', 680, 0, 260, 180)];
    expect(placeAppendedCanvasNodes([], laidOut, WIDE)).toEqual(laidOut);
  });

  it('aligns a selected row into a readable column instead of a pile', () => {
    const row = [node('sarah', 365, 455, 245, 150), node('jordan', 635, 455, 245, 130), node('agent', 930, 455, 285, 210)];
    const placements = alignCanvasNodesLeft(row, new Set(['sarah', 'jordan', 'agent']));

    expect([...placements.values()].map((placement) => placement.x)).toEqual([365, 365, 365]);
    const rects = row.map((item) => ({ ...placements.get(item.id)!, ...canvasNodeDimensions(item) }));
    expect(overlappingPairs(rects)).toBe(0);
    expect(placements.get('jordan')).toEqual({ x: 365, y: 645 });
  });

  it('leaves a locked object where it is while still using it to set the column', () => {
    const nodes = [
      { ...node('locked', 100, 100, 260, 180), data: { kind: 'task' as const, title: 'locked', placementLocked: true } },
      node('a', 400, 200, 260, 180),
      node('b', 700, 210, 260, 180),
    ];
    const placements = alignCanvasNodesLeft(nodes, new Set(['locked', 'a', 'b']));

    expect(placements.has('locked')).toBe(false);
    expect(placements.get('a')).toEqual({ x: 100, y: 200 });
    expect(placements.get('b')).toEqual({ x: 100, y: 420 });
  });

  it('does nothing when fewer than two of the selected objects can move', () => {
    const nodes = [
      { ...node('locked', 100, 100, 260, 180), data: { kind: 'task' as const, title: 'locked', placementLocked: true } },
      node('a', 400, 200, 260, 180),
    ];
    expect(alignCanvasNodesLeft(nodes, new Set(['locked', 'a'])).size).toBe(0);
  });
});
