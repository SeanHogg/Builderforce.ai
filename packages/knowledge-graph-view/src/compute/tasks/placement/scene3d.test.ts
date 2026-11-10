import { describe, expect, it } from 'vitest';
import { InstancedMesh, type BufferAttribute, type Object3D } from 'three';
import { focusGraph } from '../../../graphModel';
import { layout3d } from '../../../scene/layout3d';
import { surfaceFixture } from '../../../testing';
import { withSymbols } from '../../../surface/transit/testFixtures';
import { createWebGLStage } from '../../../stage/renderer';
import { SLOT_NODE, type Placement } from '../../../stage/types';
import { buildStageModel } from '../stageModel';
import { PLACEMENTS, VIEWPORT_BANDS, type PlacementReq } from './index';
import { frameOf, SCENE3D_EDGE_CAP, worldOf } from './scene3d';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph, []);
const { marks } = model;
const req = (camera: PlacementReq['camera']): PlacementReq => ({ graph: 1, generation: marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
const place = (camera: PlacementReq['camera']): Placement => { const t = PLACEMENTS[camera](graph, model, req(camera)); while (!t.step()); return t.result(); };
const at = (p: Placement, s: number) => [p.position[s * 3]!, p.position[s * 3 + 1]!, p.position[s * 3 + 2]!];

const shown = focusGraph(graph, 2000, []);
const today = layout3d(graph.scope.rootId, shown.nodes, shown.edges);
const p3 = place('3d');

describe('3D placement (PRD 43 P4: the 3D camera is a placement)', () => {
    it('layout parity: every node stands where today\'s layout3d stands it, on the same tier and plane', () => {
        expect(today.positions.size).toBeGreaterThan(0);
        const f = frameOf(today, VIEWPORT_BANDS[2]!);
        for (const [ref, pos] of today.positions) {
            const slot = model.nodeSlot.get(ref)!;
            const want = worldOf(f, pos);
            at(p3, slot).forEach((v, k) => expect(v).toBeCloseTo(want[k]!, 3));
        }
        // One plane per tier, in the layout's order (top first), each below its own tier's nodes.
        expect(p3.planes.map((p) => p.kind)).toEqual(today.planes.map(() => 'partition'));
        const planeY = p3.planes.map((p) => p.min[1]);
        today.planes.forEach((tier, i) => {
            expect(planeY[i]).toBeLessThan(tier.y * f.k);
            if (i > 0) expect(planeY[i]).toBeLessThan(planeY[i - 1]!);
        });
        // Nodes on one layout tier share a world height; different tiers never do.
        const tierOf = new Map(today.planes.map((t) => [t.y, t.partition] as const));
        const heights = new Map<string, number>();
        for (const [ref, [, y]] of today.positions) {
            const tier = tierOf.get(y)!, h = at(p3, model.nodeSlot.get(ref)!)[1]!;
            if (heights.has(tier)) expect(h).toBeCloseTo(heights.get(tier)!, 6);
            else heights.set(tier, h);
        }
        expect(new Set([...heights.values()].map((h) => h.toFixed(4))).size).toBe(heights.size);
        // Every plane is captioned with its placement's (localized) name.
        expect(p3.captions).toHaveLength(p3.planes.length);
        p3.captions.forEach((c) => expect(c.role).toBe('plane'));
    });

    it('covers every slot: finite position, scale and extrude; shown nodes are extruded towers', () => {
        expect(p3.position.length).toBe(marks.keys.length * 3);
        expect(p3.scale.length).toBe(marks.keys.length);
        expect(p3.extrude.length).toBe(marks.keys.length);
        p3.position.forEach((v) => expect(Number.isFinite(v)).toBe(true));
        const visible = new Set(p3.a11y.map((a) => a.slot));
        expect(visible.size).toBe(today.positions.size);
        for (const s of visible) {
            expect(marks.slotKind[s]).toBe(SLOT_NODE);
            expect(p3.scale[s]).toBeGreaterThan(0);
            expect(p3.extrude[s]).toBeGreaterThan(0);
        }
        for (let s = 0; s < marks.keys.length; s++) if (!visible.has(s)) { expect(p3.scale[s]).toBe(0); expect(p3.extrude[s]).toBe(0); }
        expect(p3.bounds.max[1]).toBeGreaterThan(0);
        expect(p3.rig.projection).toBe('perspective');
        expect(p3.rig.depth.orbit).toBe(true);
        expect(p3.rig.view).toBeDefined();
    });

    it('draws the edges as one `edge` batch of 3D segments between the placed nodes, within the family capacity', () => {
        expect(p3.links).toHaveLength(1);
        const b = p3.links[0]!;
        expect(b.family).toBe('edge');
        expect(b.widthUnit).toBe('px');
        const segments = b.tone.length;
        expect(segments).toBeGreaterThan(0);
        expect(segments).toBeLessThanOrEqual(SCENE3D_EDGE_CAP);
        expect(b.points.length).toBe(segments * 9);
        for (let i = 0; i < segments; i++) expect(Number.isNaN(b.points[i * 9 + 6])).toBe(true);
        expect(p3.caption.shown).toBeLessThanOrEqual(p3.caption.total);
    });

    it('hides every aggregate at scale 0 at the centroid of its shown members', () => {
        const visible = p3.a11y.map((a) => a.slot);
        for (let s = 0; s < marks.keys.length; s++) {
            if (marks.slotKind[s] === SLOT_NODE) continue;
            expect(p3.scale[s]).toBe(0);
            const members = visible.filter((i) => marks.parentStation[i] === s);
            if (members.length === 0 || visible.some((i) => marks.parentFolder[i] === s)) continue;
            const mean = [0, 1, 2].map((k) => members.reduce((sum, i) => sum + p3.position[i * 3 + k]!, 0) / members.length);
            at(p3, s).forEach((v, k) => expect(v).toBeCloseTo(mean[k]!, 3));
        }
    });

    it('a Map ↔ 3D switch creates 0 InstancedMesh and makes ≤ 3 attribute uploads per batch', () => {
        const stage = createWebGLStage();
        stage.setMarks(marks);
        const map = place('map');
        stage.setPlacement(map, 0, 0);
        const meshes: InstancedMesh[] = [];
        stage.object!.traverse((o: Object3D) => { if (o instanceof InstancedMesh && o.name.startsWith('marks:')) meshes.push(o); });
        const versions = () => meshes.map((m) => Object.values(m.geometry.attributes).reduce((n, a) => n + (a as BufferAttribute).version, 0));
        let now = 0;
        for (const next of [p3, map, p3]) {
            const created = stage.stats.meshesCreated;
            const before = [...stage.stats.uploadsByBatch];
            const v0 = versions();
            now += 1_000;
            stage.setPlacement(next, now, 400);
            while (stage.tick(now + 1_000));
            expect(stage.stats.meshesCreated).toBe(created);
            stage.stats.uploadsByBatch.forEach((n, b) => expect(n - (before[b] ?? 0)).toBeLessThanOrEqual(3));
            versions().forEach((v, b) => expect(v - v0[b]!).toBeLessThanOrEqual(3));
        }
    });
});
