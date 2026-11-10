import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../../../testing';
import { SLOT_FOLDER, SLOT_NODE, type Placement } from '../../../stage/types';
import { buildStageModel } from '../stageModel';
import { PLACEMENTS, type PlacementReq } from './index';
import { CONE_STEP, mindFocusOf } from './mindmap';

const graph = surfaceFixture();
const model = buildStageModel(graph, [], { mapMore: '+{count} more', 'mind.moreFoldersOne': '+{count} folder', 'mind.moreFoldersOther': '+{count} folders' });
const { marks } = model;
const req = (over: Partial<PlacementReq> = {}): PlacementReq =>
    ({ graph: 1, generation: marks.generation, camera: 'mind', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, ...over });
const run = (r: PlacementReq): Placement => { const t = PLACEMENTS.mind(graph, model, r); while (!t.step()); return t.result(); };
const at = (p: Placement, s: number) => [p.position[s * 3], p.position[s * 3 + 1], p.position[s * 3 + 2]];

describe('the Mind map placement (PRD 43 B1a rule 8)', () => {
    it('covers every slot; shows the root and folders; tree edges as one edge batch', () => {
        const p = run(req());
        expect(p.position.length).toBe(marks.keys.length * 3);
        expect(p.scale.length).toBe(marks.keys.length);
        const shown = p.a11y.map((a) => a.slot);
        expect(shown).toContain(marks.keys.indexOf('dir:'));
        for (const s of shown) { expect(marks.slotKind[s]).toBe(SLOT_FOLDER); expect(p.scale[s]).toBeGreaterThan(0); }
        expect(p.links).toHaveLength(1);
        expect(p.links[0]!.family).toBe('edge');
        expect(p.anchor).toBe('folder');
    });

    it('anchors every hidden node at its folder (scale 0)', () => {
        const p = run(req());
        for (let i = 0; i < graph.nodes.length; i++) {
            expect(p.scale[i]).toBe(0);
            const f = marks.parentFolder[i]!;
            if (f >= 0 && p.scale[f]! > 0) expect(at(p, i)).toEqual(at(p, f));
        }
    });

    it('a focused folder shows its files; depth sinks each ring into a cone', () => {
        const file = graph.nodes.find((n) => n.kind === 'file' && n.ref.startsWith('src:sys::api/'))!;
        expect(mindFocusOf(`node:${file.ref}`)).toBe('api');
        const p = run(req({ unfolded: 'dir:api' }));
        const fileSlot = model.nodeSlot.get(file.ref)!;
        expect(marks.slotKind[fileSlot]).toBe(SLOT_NODE);
        expect(p.scale[fileSlot]).toBeGreaterThan(0);
        const deep = run(req({ unfolded: 'dir:api', depth: 1 }));
        expect(deep.position[fileSlot * 3 + 1]).toBe(-2 * CONE_STEP);
        expect(deep.cacheKey).not.toBe(p.cacheKey);
    });
});
