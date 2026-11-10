// @vitest-environment jsdom
/** The 3D marks: one instanced mesh per mark type, each geometry its 2D outline extruded (PRD 43 B1a rule 2). */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-three/fiber', () => ({ useThree: () => () => undefined }));

import { Box3, Vector3 } from 'three';
import { NODE_SHAPES } from '../shapes';
import { nodeInstances } from './buffers';
import { layout3d } from './layout3d';
import { LENSES } from '../lenses';
import { codeFixture } from '../testing';
import { shapeBuckets, shapeGeometry, type Item } from './shapeMeshes';

const item = (ref: string): Item => ({ pos: [0, 0, 0], scale: [1, 1, 1], tone: 'accent', ref });

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

describe('shapeBuckets', () => {
    it('buckets items per shape (one instanced mesh each), keeping the picking refs aligned', () => {
        const buckets = shapeBuckets([item('a'), item('b'), item('c')], ['square', 'drum', 'square']);
        expect(buckets.map(([s, b]) => [s, b.refs])).toEqual([['square', ['a', 'c']], ['drum', ['b']]]);
    });

    it('regression: the 3D scene of a code graph draws more than one shape (files no longer all one cylinder)', () => {
        const g = codeFixture();
        const extra = ['app/page.test.tsx', 'docs/guide.md', 'db/schema.sql'].map((p) => ({ ...g.nodes[0]!, ref: `src:code::${p}` as never, label: p }));
        const nodes = [...g.nodes, ...extra];
        const inst = nodeInstances(nodes, layout3d('code', nodes, g.edges), LENSES.structure);
        expect([...new Set(inst.shapes)].sort()).toEqual(['diamond', 'drum', 'tile', 'window']);
    });
});
