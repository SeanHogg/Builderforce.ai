/**
 * The retired WebGL `GraphScene`'s facts, as 3D placement / paint facts (PRD 43 B8, P4): every shown node is placed
 * once, sized by importance; the edges are one batch toned per edge kind, with violations and cycles apart; the lens
 * dims what it is not about. (The canvas-mounts fact is the stage host's: `stage/host/StageHost.test.tsx`.)
 */
import { describe, expect, it } from 'vitest';
import { codeFixture } from '../../../testing';
import { edgeBucket } from '../../../scene/buffers';
import { FLAG, SLOT_NODE, type Placement } from '../../../stage/types';
import { toneIndex } from '../../../stage/tones';
import { paintMarks } from '../markPaint';
import { buildStageModel } from '../stageModel';
import { PLACEMENTS, type PlacementReq } from './index';
import { channelBindings } from './request';

const graph = codeFixture();
const model = buildStageModel(graph, []);
const { marks } = model;
const req: PlacementReq = { graph: 1, generation: marks.generation, camera: '3d', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, depth: 1 };
const p3: Placement = (() => { const t = PLACEMENTS['3d'](graph, model, req); while (!t.step()); return t.result(); })();
const slotOf = (ref: string) => model.nodeSlot.get(ref)!;

describe('the 3D camera as a placement (was GraphScene)', () => {
    it('places every node once, sized by importance', () => {
        for (const n of graph.nodes) expect(p3.scale[slotOf(n.ref)]!, n.ref).toBeGreaterThan(0);
        expect(new Set(p3.a11y.map((a) => a.slot)).size).toBe(graph.nodes.length);
        expect(p3.scale[slotOf('src:code::domain/invoice.ts')]!).toBeGreaterThan(p3.scale[slotOf('src:code::infrastructure/legacy.ts')]!);
    });

    it('draws the edges as ONE batch toned per edge kind, violations and cycles apart from plain references', () => {
        expect(p3.links).toHaveLength(1);
        const tones = new Set(p3.links[0]!.tone);
        const want = new Set(graph.edges.map((e) => toneIndex(edgeBucket(e).tone)));
        expect(tones).toEqual(want);
        const violation = graph.edges.find((e) => e.verdict === 'upward' || e.verdict === 'skips')!;
        const cycle = graph.edges.find((e) => e.cycle)!;
        const plain = graph.edges.find((e) => e.kind === 'references' && !e.cycle && e.verdict === 'allowed')!;
        expect(new Set([edgeBucket(violation).tone, edgeBucket(cycle).tone, edgeBucket(plain).tone]).size).toBe(3);
    });

    it('dims what the lens is not about', () => {
        const paint = paintMarks(graph, model, { lensId: 'unused', overlay: channelBindings(), lit: null, roles: null });
        const nodes = [...marks.keys.keys()].filter((i) => marks.slotKind[i] === SLOT_NODE);
        const lit = nodes.filter((i) => !(paint.flags[i]! & FLAG.DIM));
        expect(lit).toEqual([slotOf('src:code::infrastructure/legacy.ts')]);
        expect(nodes.length - lit.length).toBe(graph.nodes.length - 1);
    });
});
