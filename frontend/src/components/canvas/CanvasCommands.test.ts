import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { cleanCanvasLayout } from './CanvasCommands';

describe('cleanCanvasLayout', () => {
  const grid = (count: number) => Array.from({ length: count }, (_, index) => ({
    id: String(index),
    position: { x: 0, y: 0 },
    data: {},
    style: { width: 300, height: 200 },
  })) as Node[];

  it('spaces unconnected nodes into a non-overlapping grid', () => {
    const arranged = cleanCanvasLayout(grid(4), [], 'horizontal', 900);
    expect(new Set(arranged.map((node) => `${node.position.x}:${node.position.y}`))).toHaveLength(4);
    expect(arranged[1].position.x).toBeGreaterThanOrEqual(388);
    expect(arranged[2].position.y).toBeGreaterThanOrEqual(264);
  });

  it('spends the width it is given instead of a square root of the object count', () => {
    // Six 300px cards: two columns in 900px of board, all six in a row on an
    // ultrawide. `ceil(sqrt(6))` answered 3 for both, which is how "arrange" used
    // to hand back a tall block with most of a wide screen empty beside it.
    const rowsIn = (width: number) => new Set(cleanCanvasLayout(grid(6), [], 'horizontal', width).map((node) => node.position.y)).size;

    expect(rowsIn(900)).toBe(3);
    expect(rowsIn(3_440)).toBe(1);
  });

  it('still narrows on a tall board, where width is not the axis to spend', () => {
    const rows = new Set(cleanCanvasLayout(grid(6), [], 'vertical', 3_440).map((node) => node.position.y)).size;
    expect(rows).toBeGreaterThan(1);
  });

  it('places connected nodes in dependency order', () => {
    const nodes: Node[] = ['start', 'middle', 'finish'].map((id) => ({ id, position: { x: 0, y: 0 }, data: {} }));
    const edges: Edge[] = [
      { id: 'one', source: 'start', target: 'middle' },
      { id: 'two', source: 'middle', target: 'finish' },
    ];

    const arranged = cleanCanvasLayout(nodes, edges);
    const x = Object.fromEntries(arranged.map((node) => [node.id, node.position.x]));
    expect(x.start).toBeLessThan(x.middle);
    expect(x.middle).toBeLessThan(x.finish);
  });
});
