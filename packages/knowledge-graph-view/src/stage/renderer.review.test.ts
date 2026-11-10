import { describe, expect, it, vi } from 'vitest';
import { InstancedMesh, type InstancedBufferAttribute, type Object3D } from 'three';
import { buildStageModel } from '../compute/tasks/stageModel';
import { paintMarks } from '../compute/tasks/markPaint';
import { PLACEMENTS, type PlacementReq } from '../compute/tasks/placement';
import { placeDrill } from '../compute/tasks/placement/drill';
import { drillKeyOf } from '../compute/tasks/placement/request';
import { PRESETS } from '../surface/overlays';
import { USE_CASE } from '../surface/transit/testFixtures';
import { surfaceFixture } from '../testing';
import type { SymbolRecord } from '../types';
import { bindContextLoss } from './contextLoss';
import { uploadRange } from './stats';
import type { LabelText, TextPort } from './labels/LabelLayer';
import { createNoopStage, createWebGLStage, type StageRenderer } from './renderer';
import type { Placement } from './types';

const graph = surfaceFixture();
const model = buildStageModel(graph, []);
const { marks } = model;
const CLS = `${USE_CASE}#UseCase`;
const req = (camera: PlacementReq['camera'], drill: string | null = null, symbols?: readonly SymbolRecord[]): PlacementReq => ({
    graph: 1, generation: marks.generation, camera, drill, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, depth: 1, ...(symbols ? { symbols } : {}),
});
const place = (camera: PlacementReq['camera']): Placement => { const t = PLACEMENTS[camera](graph, model, req(camera)); while (!t.step()); return t.result(); };
const records = (n: number): SymbolRecord[] => [
    { ref: CLS, name: 'UseCase', kind: 'class', parent: USE_CASE, line: 1, exported: true },
    ...Array.from({ length: n }, (_, i) => ({ ref: `${CLS}.m${i}`, name: `m${i}`, kind: 'method', parent: CLS, line: i + 2, exported: false })),
];
const drill = (n: number): Placement => placeDrill(graph, model, req('map', drillKeyOf({ level: 'class', ref: USE_CASE }), records(n)));
const textPort = (): TextPort => ({
    object: null,
    create: () => ({ text: '', font: null, fontSize: 0, anchorX: 0, color: null, outlineWidth: 0, outlineColor: 0, fillOpacity: 1, outlineOpacity: 1, position: { set() {} }, dispose() {} } as LabelText),
    add() {}, remove() {}, dispose() {},
});
const markMeshes = (root: Object3D): InstancedMesh[] => {
    const out: InstancedMesh[] = [];
    root.traverse((o) => { if (o instanceof InstancedMesh && o.name.startsWith('marks:')) out.push(o); });
    return out;
};
const attr = (root: Object3D, name: string, batch = 0) => markMeshes(root)[batch]!.geometry.getAttribute(name) as InstancedBufferAttribute;

describe('the live keys (StageRenderer.keys / onKeys)', () => {
    for (const make of [() => createWebGLStage({ text: textPort }), () => createNoopStage()] as Array<() => StageRenderer>) {
        it(`${make().kind}: MarkSet keys plus the appended, told on change, kept through an overflow rebuild`, () => {
            const stage = make();
            const heard = vi.fn();
            stage.onKeys(heard);
            stage.setMarks(marks);
            expect(stage.keys()).toBe(marks.keys);
            expect(heard).toHaveBeenCalledTimes(1);
            stage.setPlacement(place('map'), 0, 0);
            const d = drill(3);
            stage.setPlacement(d, 0, 0);
            expect(stage.keys()).toEqual([...marks.keys, ...d.append!.keys]);
            expect(heard).toHaveBeenCalledTimes(2);
            // A re-sent drill placement appends nothing new and tells no one.
            stage.setPlacement(d, 0, 0);
            expect(heard).toHaveBeenCalledTimes(2);
            // An overflow (more symbols than the headroom) rebuilds the meshes; the live keys carry on.
            const big = drill(2000);
            stage.setPlacement(big, 0, 0);
            expect(stage.keys().slice(0, marks.keys.length)).toEqual(marks.keys);
            expect(stage.keys()).toHaveLength(big.append!.base + big.append!.keys.length);
            // A new MarkSet resets them.
            stage.setMarks(marks);
            expect(stage.keys()).toBe(marks.keys);
        });
    }

    it('survives a context restore: the rebuilt meshes hold every appended slot, the keys are unchanged', () => {
        const stage = createWebGLStage({ text: textPort });
        stage.setMarks(marks);
        stage.setPlacement(place('map'), 0, 0);
        stage.setPlacement(drill(3), 0, 0);
        const keys = stage.keys();
        stage.restore(10);
        expect(stage.keys()).toBe(keys);
        expect(markMeshes(stage.object!).reduce((n, m) => n + m.count, 0)).toBe(keys.length);
    });
});

describe('ranged uploads', () => {
    it('a repaint and a drill append in one commit both reach the GPU (ranges accumulate, never clear each other)', () => {
        const stage = createWebGLStage({ text: textPort });
        stage.setMarks(marks);
        stage.setPlacement(place('map'), 0, 0);
        const paintOf = (m: InstancedMesh) => m.geometry.getAttribute('paint') as InstancedBufferAttribute;
        for (const m of markMeshes(stage.object!)) paintOf(m).clearUpdateRanges(); // as three does after an upload
        stage.setPaint(paintMarks(graph, model, { lensId: 'structure', overlay: PRESETS.risk, lit: null, roles: null }));
        const painted = markMeshes(stage.object!).map((m) => paintOf(m).updateRanges.length);
        stage.setPlacement(drill(3), 0, 400);
        // The append added its range, and no repainted batch lost the repaint's (the old clear-then-add dropped it).
        const after = markMeshes(stage.object!).map((m) => paintOf(m).updateRanges.length);
        expect(after.some((n, b) => n > painted[b]!)).toBe(true);
        expect(after.every((n, b) => n >= painted[b]!)).toBe(true);
        // Two writes to ONE attribute in one commit: both ranges stay queued.
        const one = paintOf(markMeshes(stage.object!).find((m) => paintOf(m).updateRanges.length > 0)!);
        const n = one.updateRanges.length;
        uploadRange(stage.stats, one, 1, 1);
        expect(one.updateRanges).toHaveLength(n + 1);
    });
});

describe('mid-tween replacement', () => {
    it('bakes where the marks ARE into the stale set, so the next tween continues from there', () => {
        const stage = createWebGLStage({ text: textPort });
        stage.setMarks(marks);
        const map = place('map'), g = place('graph');
        stage.setPlacement(map, 0, 0);
        stage.setPlacement(g, 0, 400);
        stage.tick(200);
        const root = stage.object!;
        const b = model.marks.batches.findIndex((x) => x.slots.length > 0);
        const mesh = markMeshes(root)[b]!;
        const u = (mesh.material as unknown as { uniforms: Record<string, { value: number }> }).uniforms;
        const t = u.uT!.value, flip = u.uFlip!.value;
        expect(t).toBeGreaterThan(0); expect(t).toBeLessThan(1);
        // On screen now: mix(from, to, t), with from/to picked by uFlip (0: A → B).
        const [fromSet, toSet] = flip === 0 ? ['placeA', 'placeB'] : ['placeB', 'placeA'];
        const at = (set: string) => [0, 1, 2, 3].map((c) => (attr(root, set, b).array as Float32Array)[c]!);
        const from = at(fromSet), to = at(toSet);
        const onScreen = from.map((v, c) => v + (to[c]! - v) * t);
        stage.setPlacement(map, 200, 400);
        const u2 = u.uFlip!.value;
        const [stale, target] = u2 === 0 ? ['placeA', 'placeB'] : ['placeB', 'placeA'];
        at(stale).forEach((v, c) => expect(v).toBeCloseTo(onScreen[c]!, 4));
        const slot = model.marks.batches[b]!.slots[0]!;
        expect(at(target)[0]).toBeCloseTo(map.position[slot * 3]!);
        expect(u.uT!.value).toBe(0);
    });
});

describe('context loss wiring (Stage binds it on its canvas)', () => {
    it('keeps the context restorable and restores from the last inputs when it comes back', () => {
        const stage = createWebGLStage({ text: textPort });
        stage.setMarks(marks);
        const map = place('map');
        stage.setPlacement(map, 0, 0);
        const restore = vi.spyOn(stage, 'restore');
        const invalidate = vi.fn();
        const canvas = document.createElement('canvas');
        const unbind = bindContextLoss(canvas, stage, invalidate);
        const lost = new Event('webglcontextlost', { cancelable: true });
        canvas.dispatchEvent(lost);
        expect(lost.defaultPrevented).toBe(true);
        const created = stage.stats.meshesCreated;
        canvas.dispatchEvent(new Event('webglcontextrestored'));
        expect(restore).toHaveBeenCalledTimes(1);
        expect(invalidate).toHaveBeenCalledTimes(1);
        expect(stage.placement?.cacheKey).toBe(map.cacheKey);
        expect(stage.stats.meshesCreated).toBeGreaterThan(created); // the marks were rebuilt
        unbind();
        canvas.dispatchEvent(new Event('webglcontextrestored'));
        expect(restore).toHaveBeenCalledTimes(1);
    });
});
