import { describe, expect, it } from 'vitest';
import { InstancedMesh, type BufferAttribute, type Object3D, type ShaderMaterial } from 'three';
import { buildStageModel } from '../compute/tasks/stageModel';
import { paintMarks } from '../compute/tasks/markPaint';
import { PLACEMENTS, type PlacementReq } from '../compute/tasks/placement';
import { PRESETS } from '../surface/overlays';
import { surfaceFixture } from '../testing';
import { withSymbols } from '../surface/transit/testFixtures';
import { fixedFontPort } from './fonts';
import type { LabelText, TextPort } from './labels/LabelLayer';
import { HALL_STYLE } from './links/families';
import { FLAG_GLSL, PULSE_PERIOD_MS } from './marks/shader';
import { createWebGLStage, MOTION_FRAME_MS } from './renderer';
import { spanOf } from './tween';
import { FLAG, LINK_FAMILIES, type MarkPaint, type Placement } from './types';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph);
const place = (camera: PlacementReq['camera'], depth = 0): Placement => {
    const t = PLACEMENTS[camera](graph, model, { graph: 1, generation: model.marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, depth });
    while (!t.step());
    return t.result();
};
const paint = (): MarkPaint => paintMarks(graph, model, { lensId: 'structure', overlay: PRESETS.risk, lit: null, roles: null });

function textPort(): { port: () => TextPort; created: () => number } {
    let created = 0;
    return {
        created: () => created,
        port: () => ({
            object: null,
            create: () => { created++; return { text: '', font: null, fontSize: 0, anchorX: 0, color: null, outlineWidth: 0, outlineColor: 0, fillOpacity: 1, outlineOpacity: 1, position: { set() {} }, dispose() {} } as LabelText; },
            add() {}, remove() {}, dispose() {},
        }),
    };
}

const meshes = (root: Object3D, prefix: string): InstancedMesh[] => {
    const out: InstancedMesh[] = [];
    root.traverse((o) => { if (o instanceof InstancedMesh && o.name.startsWith(prefix)) out.push(o); });
    return out;
};
const uniform = (m: InstancedMesh, name: string) => (m.material as ShaderMaterial).uniforms[name]!;

describe('the stage layers (PRD 43 B3)', () => {
    it('preallocates every link family and the plane batch at mount: the first placement creates 0 meshes', () => {
        const text = textPort();
        const stage = createWebGLStage({ text: text.port, fonts: fixedFontPort({ 500: 'https://host/jbm.woff2' }) });
        // Every family once in the stage's link layer (+ the overlay's own `edge` lines).
        expect([...new Set(meshes(stage.object!, 'links:').map((m) => m.name.slice(6)))].sort()).toEqual([...LINK_FAMILIES].sort());
        expect(meshes(stage.object!, 'links:')).toHaveLength(LINK_FAMILIES.length + 1);
        expect(meshes(stage.object!, 'planes')).toHaveLength(1);
        stage.setMarks(model.marks);
        const created = stage.stats.meshesCreated;
        const map = place('map');
        stage.setPlacement(map, 0, 0);
        expect(stage.stats.meshesCreated).toBe(created);
        // The Map's routes are HALLS (raised 3D bars), and its level stands on ONE floor plate (a lit room slab).
        const halls = meshes(stage.object!, 'halls').find((m) => m.name === 'halls')!;
        expect(halls.count).toBeGreaterThan(0);
        expect(halls.count).toBeLessThanOrEqual(HALL_STYLE.capacity);
        expect(uniform(halls, 'uThick').value).toBe(HALL_STYLE.thickness);
        expect(meshes(stage.object!, 'links:route')[0]!.count).toBe(0);
        expect(map.planes.filter((p) => p.kind === 'room')).toHaveLength(1);
        expect(meshes(stage.object!, 'rooms')[0]!.count).toBe(1);
        expect(meshes(stage.object!, 'planes')[0]!.count).toBe(map.planes.filter((p) => p.kind !== 'room').length);
        // The map's names are DOM chips (map.ts sets `chip` on every run, 1958de654), so they never reach the SDF text pass.
        expect(stage.chips.length).toBeGreaterThan(0);
        expect(text.created()).toBe(0);
        // A switch away and back still creates no mesh, links included.
        const graph = place('graph');
        stage.setPlacement(graph, 0, 400); while (stage.tick(10_000));
        stage.setPlacement(map, 20_000, 400); while (stage.tick(30_000));
        expect(stage.stats.meshesCreated).toBe(created);
        // The Graph's own names (P3) are typeset on its first visit; a second round trip creates no text object either.
        const labels = text.created();
        stage.setPlacement(graph, 40_000, 400); while (stage.tick(50_000));
        stage.setPlacement(map, 60_000, 400); while (stage.tick(70_000));
        expect(stage.stats.meshesCreated).toBe(created);
        expect(text.created()).toBe(labels);
    });

    it('hides links and planes while the marks tween; they land with the target placement', () => {
        const stage = createWebGLStage({ text: textPort().port, fonts: fixedFontPort({}) });
        stage.setMarks(model.marks);
        stage.setPlacement(place('map'), 0, 0);
        const links = meshes(stage.object!, 'links:route')[0]!.parent!, planes = meshes(stage.object!, 'planes')[0]!.parent!;
        stage.setPlacement(place('graph'), 0, 400);
        expect(links.visible).toBe(false);
        expect(planes.visible).toBe(false);
        stage.tick(200);
        expect(links.visible).toBe(false);
        stage.tick(400);
        expect(links.visible).toBe(false); // each mark starts 45 ms after the one before it: the tween spans the stagger too
        stage.tick(spanOf(400));
        expect(links.visible).toBe(true);
        expect(planes.visible).toBe(true);
        expect(meshes(stage.object!, 'links:route')[0]!.count).toBe(0); // Graph brings no routes
    });

    it('carries the paint flags to the shader: the bits in the paint attribute, the same bits as GLSL constants', () => {
        for (const [name, bit] of Object.entries(FLAG)) expect(FLAG_GLSL).toContain(`const float F_${name} = ${bit.toFixed(1)};`);
        const stage = createWebGLStage({ text: textPort().port, fonts: fixedFontPort({}) });
        stage.setMarks(model.marks);
        const p = paint();
        stage.setPaint(p);
        const [mesh] = meshes(stage.object!, 'marks:');
        const attr = mesh!.geometry.getAttribute('paint') as BufferAttribute;
        const slot = model.marks.batches[0]!.slots[0]!;
        expect(attr.getW(0)).toBe(p.flags[slot]);
        expect(attr.getX(0)).toBe(p.tone[slot]);
        const frag = (mesh!.material as ShaderMaterial).fragmentShader;
        for (const name of ['F_DIM', 'F_SHELL', 'F_DOC', 'F_INTERCHANGE', 'F_OUTLINE', 'F_PULSE']) expect(frag).toContain(`bit(vFlags, ${name})`);
        for (const u of ['uTime', 'uMotion', 'uDepth', 'uViolation', 'uChanged', 'uText']) expect(uniform(mesh!, u)).toBeDefined();
        for (const candidate of [mesh!, ...meshes(stage.object!, 'links:'), ...meshes(stage.object!, 'halls')]) {
            expect((candidate.material as ShaderMaterial).fragmentShader).not.toMatch(/\b(?:uPalette|uDash)\s*\[/);
        }
    });

    it('fades every mark outside the lit set with the DIM flag on top of its own, and puts the paint back with null; a restore keeps it', () => {
        const stage = createWebGLStage({ text: textPort().port, fonts: fixedFontPort({}) });
        stage.setMarks(model.marks);
        const p = paint();
        stage.setPaint(p);
        const [mesh] = meshes(stage.object!, 'marks:');
        const attr = mesh!.geometry.getAttribute('paint') as BufferAttribute;
        const slots = model.marks.batches[0]!.slots;
        const lit = slots[0]!;
        stage.setFade(new Set([lit]));
        expect(attr.getW(0)).toBe(p.flags[lit]);
        if (slots.length > 1) expect(attr.getW(1)).toBe(p.flags[slots[1]!]! | FLAG.DIM);
        stage.restore(10);
        const again = meshes(stage.object!, 'marks:')[0]!.geometry.getAttribute('paint') as BufferAttribute;
        if (slots.length > 1) expect(again.getW(1)).toBe(p.flags[slots[1]!]! | FLAG.DIM);
        stage.setFade(null);
        expect((meshes(stage.object!, 'marks:')[0]!.geometry.getAttribute('paint') as BufferAttribute).getW(0)).toBe(p.flags[lit]);
        if (slots.length > 1) expect((meshes(stage.object!, 'marks:')[0]!.geometry.getAttribute('paint') as BufferAttribute).getW(1)).toBe(p.flags[slots[1]!]);
    });

    it('runs the pulse at ≤ 30 fps only while a PULSE mark is visible and motion is allowed', () => {
        const stage = createWebGLStage({ text: textPort().port, fonts: fixedFontPort({}) });
        stage.setMarks(model.marks);
        stage.setPlacement(place('map'), 0, 0);
        const p = paint();
        stage.setPaint({ ...p, flags: p.flags.map((f) => f & ~FLAG.PULSE) });
        expect(stage.motionDelay(0)).toBeNull();
        const pulsing = p.flags.slice(); pulsing[0] = pulsing[0]! | FLAG.PULSE;
        stage.setPaint({ ...p, flags: pulsing });
        stage.tick(1000);
        const mesh = meshes(stage.object!, 'marks:')[0]!;
        expect(uniform(mesh, 'uTime').value).toBe(1000);
        expect(stage.motionDelay(1010)).toBeCloseTo(MOTION_FRAME_MS - 10);
        stage.tick(1010);
        expect(uniform(mesh, 'uTime').value).toBe(1000); // capped: no new frame of motion yet
        stage.setMotion({ visible: false, reduced: false });
        expect(stage.motionDelay(2000)).toBeNull();
        stage.setMotion({ visible: true, reduced: true });
        expect(stage.motionDelay(2000)).toBeNull();
        expect(uniform(mesh, 'uMotion').value).toBe(0);
        expect(PULSE_PERIOD_MS).toBe(2000);
    });

    it('a theme flip uploads no attribute; the depth control is a uniform', () => {
        const stage = createWebGLStage({ text: textPort().port, fonts: fixedFontPort({}) });
        stage.setMarks(model.marks);
        stage.setPaint(paint());
        stage.setPlacement(place('map', 1), 0, 0);
        const uploads = stage.stats.uploads;
        stage.setPalette({ bg: '#000000', text: '#ffffff' } as never);
        stage.setDepth(0.5);
        expect(stage.stats.uploads).toBe(uploads);
        expect(uniform(meshes(stage.object!, 'marks:')[0]!, 'uDepth').value).toBe(0.5);
    });

    it('restores from the last inputs after a lost context: same placement, landed, no tween', () => {
        const stage = createWebGLStage({ text: textPort().port, fonts: fixedFontPort({}) });
        stage.setMarks(model.marks);
        stage.setPaint(paint());
        const map = place('map'), g = place('graph');
        stage.setPlacement(map, 0, 0);
        stage.setPlacement(g, 0, 400); // mid-tween when the context is lost
        stage.restore(100);
        expect(stage.placement).toBe(g);
        expect(stage.tick(101)).toBe(false);
        const mesh = meshes(stage.object!, 'marks:')[0]!;
        expect(uniform(mesh, 'uT').value).toBe(1);
        const place0 = (mesh.geometry.getAttribute('placeB') as BufferAttribute).getX(0);
        const slot = model.marks.batches[0]!.slots[0]!;
        expect(place0).toBeCloseTo(g.position[slot * 3]!);
        expect(meshes(stage.object!, 'marks:')).toHaveLength(model.marks.batches.length);
    });
});
