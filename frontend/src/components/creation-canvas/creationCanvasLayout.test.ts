import { describe, expect, it } from 'vitest';
import type { CreationFlowNode } from './CreationNode';
import { arrangeCanvasNodes, canvasArrangementTargets, canvasNodeDimensions, nextCanvasObjectPosition } from './creationCanvasLayout';

function node(id: string, x: number, y: number, width: number, height: number): CreationFlowNode {
  return { id, type: 'creation', position: { x, y }, measured: { width, height }, data: { kind: 'task', title: id } };
}

describe('creation canvas layout', () => {
  it('uses React Flow measured dimensions ahead of stale configured dimensions', () => {
    const item = { ...node('a', 0, 0, 420, 310), width: 240, height: 130 };
    expect(canvasNodeDimensions(item)).toEqual({ width: 420, height: 310 });
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
});
