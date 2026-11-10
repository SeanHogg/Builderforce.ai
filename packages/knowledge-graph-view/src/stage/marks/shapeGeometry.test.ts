/** The marks' 3D shapes: each geometry its 2D outline extruded (PRD 43 B1a rule 2), and a code graph's MarkSet types them apart. */
import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { MARK_TYPE_ORDER, NODE_SHAPES, TYPE_SHAPE } from '../../shapes';
import { codeFixture } from '../../testing';
import { buildStageModel } from '../../compute/tasks/stageModel';
import { shapeGeometry } from './shapeGeometry';

describe('shapeGeometry', () => {
    it('extrudes every outline to a unit-height prism centred on the origin, shared per shape', () => {
        for (const shape of NODE_SHAPES) {
            const g = shapeGeometry(shape);
            expect(shapeGeometry(shape), shape).toBe(g);
            const size = new Box3().setFromBufferAttribute(g.getAttribute('position') as never).getSize(new Vector3());
            expect(size.y, shape).toBeCloseTo(1, 5);
            expect(size.x, shape).toBeGreaterThan(1);
            expect(size.z, shape).toBeGreaterThan(1);
        }
    });

    it('gives distinct shapes distinct geometry', () => {
        const counts = new Set(NODE_SHAPES.map((s) => `${shapeGeometry(s).getAttribute('position').count}`));
        expect(counts.size).toBeGreaterThan(4);
        expect(new Set(NODE_SHAPES.map(shapeGeometry)).size).toBe(NODE_SHAPES.length);
    });
});

describe('a code graph\'s marks', () => {
    it('regression: are more than one shape (files no longer all one cylinder): tests, docs and data each keep theirs', () => {
        const g = codeFixture();
        const extra = ['app/page.test.tsx', 'docs/guide.md', 'db/schema.sql'].map((p) => ({ ...g.nodes[0]!, ref: `src:code::${p}` as never, label: p }));
        const graph = { ...g, nodes: [...g.nodes, ...extra] };
        const { marks, nodeSlot } = buildStageModel(graph, []);
        const shapeOf = (ref: string) => TYPE_SHAPE[MARK_TYPE_ORDER[marks.type[nodeSlot.get(ref)!]!]!];
        const shapes = new Set(extra.map((n) => shapeOf(n.ref)));
        expect(shapes.size).toBe(3);
        expect(new Set(graph.nodes.map((n) => shapeOf(n.ref))).size).toBeGreaterThan(3);
    });
});
