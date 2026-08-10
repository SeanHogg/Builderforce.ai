import { describe, expect, it } from 'vitest';
import type { CreationFlowNode } from './CreationNode';
import { alignCanvasNodesLeft, arrangeCanvasNodes, canvasArrangementTargets, canvasNodeDimensions, freeCanvasSlot, nextCanvasObjectPosition } from './creationCanvasLayout';

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

  it('targets the whole visible canvas when no explicit ids were requested', () => {
    const all = [node('brain', 0, 0, 280, 300), node('task-1', 20, 20, 300, 400), node('task-2', 30, 30, 300, 200)];
    const selectedScope = [all[0]!];

    expect(selectedScope).toHaveLength(1);
    expect(canvasArrangementTargets(all).map((item) => item.id)).toEqual(['brain', 'task-1', 'task-2']);
    expect(canvasArrangementTargets(all, new Set(['task-1', 'task-2'])).map((item) => item.id)).toEqual(['task-1', 'task-2']);
  });

  it('stacks new mobile output below existing objects while preserving desktop defaults', () => {
    const existing = [node('brain', 80, 40, 280, 300), node('lesson', 80, 388, 320, 220)];

    expect(nextCanvasObjectPosition(existing, {}, true)).toEqual({ x: 80, y: 656 });
    expect(nextCanvasObjectPosition(existing, {}, false)).toEqual({ x: 520, y: 280 });
    expect(nextCanvasObjectPosition(existing, { x: 900, y: 120 }, true)).toEqual({ x: 900, y: 120 });
  });

  it('never drops an authored object on top of one that is already there', () => {
    const existing = [node('agent', 520, 280, 285, 210)];

    // Same default point that every unplaced object used to land on.
    expect(nextCanvasObjectPosition(existing, {}, false)).toEqual({ x: 520, y: 530 });
    // An explicit column is kept; only the depth moves.
    expect(nextCanvasObjectPosition(existing, { x: 560, y: 300 }, false)).toEqual({ x: 560, y: 530 });
    // Somewhere clear stays exactly where it was asked for.
    expect(nextCanvasObjectPosition(existing, { x: 1400, y: 300 }, false)).toEqual({ x: 1400, y: 300 });
  });

  it('walks past a whole column of objects to find a clear slot', () => {
    const existing = [node('a', 500, 100, 300, 200), node('b', 500, 340, 300, 200), node('c', 500, 580, 300, 200)];
    const slot = freeCanvasSlot(existing, { x: 520, y: 120 }, { width: 260, height: 180 });
    expect(slot).toEqual({ x: 520, y: 820 });
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
