/** The marks' 3D shapes: each geometry its 2D outline extruded (PRD 43 B1a rule 2), and a code graph's MarkSet types them apart. */
import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { MARK_TYPE_ORDER, NODE_SHAPES, TYPE_SHAPE } from '../../shapes';
import { codeFixture } from '../../testing';
import { buildStageModel } from '../../compute/tasks/stageModel';
import { CAP_BAND, DRUM_LID, IFACE_ALPHA, outlineShape, TYPE_FORM } from './forms';
import { shapeGeometry } from './shapeGeometry';

describe('shapeGeometry', () => {
    it('extrudes every outline to a unit-height prism centred on the origin, shared per shape', () => {
        // Footprints wider than 1 on both ground axes: only shapes whose OUTLINE radius exceeds 1 on both axes. The
        // capsule is a deliberately low rounded-rect (outline y ±0.45, the units row), so its x-footprint is 0.9.
        const WIDE: ReadonlySet<string> = new Set(['window', 'diamond', 'tile', 'triangle', 'funnel', 'banner', 'pentagon', 'smallStar', 'cross', 'hexagon']);
        for (const shape of NODE_SHAPES) {
            const g = shapeGeometry(shape);
            expect(shapeGeometry(shape), shape).toBe(g);
            const size = new Box3().setFromBufferAttribute(g.getAttribute('position') as never).getSize(new Vector3());
            expect(size.y, shape).toBeCloseTo(1, 5);
            expect(size.x, shape).toBeGreaterThan(0);
            expect(size.z, shape).toBeGreaterThan(0);
            if (WIDE.has(shape)) { expect(size.x, shape).toBeGreaterThan(1); expect(size.z, shape).toBeGreaterThan(1); }
        }
    });

    it('gives distinct shapes distinct geometry', () => {
        const counts = new Set(NODE_SHAPES.map((s) => `${shapeGeometry(s).getAttribute('position').count}`));
        expect(counts.size).toBeGreaterThan(4);
        expect(new Set(NODE_SHAPES.map(shapeGeometry)).size).toBe(NODE_SHAPES.length);
    });
});

describe('forms stand on the design\'s footprints', () => {
    it('a box, a slab and an interface are plain rectangles (the square outline, `Placement.aspect` gives the depth); round forms are circles', () => {
        for (const type of MARK_TYPE_ORDER) {
            const form = TYPE_FORM[type];
            if (form === 'box' || form === 'slab' || form === 'iface') expect(outlineShape(type), type).toBe('square');
            if (form === 'drum' || form === 'puck') expect(outlineShape(type), type).toBe('circle');
        }
        expect(TYPE_FORM.system).toBe('slab');
        expect(TYPE_FORM.data).toBe('drum');
    });

    it('the design\'s proportions: a box\'s cap band is 16 %, a drum\'s lid 12 %, an interface 16 % opaque', () => {
        expect(CAP_BAND).toBe(0.16);
        expect(DRUM_LID).toBe(0.12);
        expect(IFACE_ALPHA).toBe(0.16);
    });
});

describe('a code graph\'s marks', () => {
    it('regression: are more than one shape (files no longer all one cylinder): tests, docs and data each keep theirs', () => {
        const g = codeFixture();
        const extra = ['app/page.test.tsx', 'docs/guide.md', 'db/schema.sql'].map((p) => ({ ...g.nodes[0]!, ref: `src:code::${p}` as never, label: p }));
        const graph = { ...g, nodes: [...g.nodes, ...extra] };
        const { marks, nodeSlot } = buildStageModel(graph);
        const shapeOf = (ref: string) => TYPE_SHAPE[MARK_TYPE_ORDER[marks.type[nodeSlot.get(ref)!]!]!];
        const shapes = new Set(extra.map((n) => shapeOf(n.ref)));
        expect(shapes.size).toBe(3);
        expect(new Set(graph.nodes.map((n) => shapeOf(n.ref))).size).toBeGreaterThan(3);
    });
});
