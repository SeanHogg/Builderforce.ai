import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { cleanCanvasLayout } from './CanvasCommands';

describe('cleanCanvasLayout', () => {
  it('spaces unconnected nodes into a non-overlapping grid', () => {
    const nodes: Node[] = Array.from({ length: 4 }, (_, index) => ({
      id: String(index),
      position: { x: 0, y: 0 },
      data: {},
      style: { width: 300, height: 200 },
    }));

    const arranged = cleanCanvasLayout(nodes, []);
    expect(new Set(arranged.map((node) => `${node.position.x}:${node.position.y}`))).toHaveLength(4);
    expect(arranged[1].position.x).toBeGreaterThanOrEqual(388);
    expect(arranged[2].position.y).toBeGreaterThanOrEqual(264);
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
