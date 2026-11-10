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
import { LINK_FAMILY_STYLE } from './links/families';
import { FLAG_GLSL, PULSE_PERIOD_MS } from './marks/shader';
import { createWebGLStage, MOTION_FRAME_MS } from './renderer';
import { FLAG, LINK_FAMILIES, type MarkPaint, type Placement } from './types';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph, []);
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
        const route = meshes(stage.object!, 'links:route')[0]!;
        expect(route.count).toBeGreaterThan(0);
        expect(route.count).toBeLessThanOrEqual(LINK_FAMILY_STYLE.route.capacity);
        expect(uniform(route, 'uWorldWidth').value).toBe(1);
        expect(uniform(route, 'uCasing').value).toBeGreaterThan(0);
        expect(meshes(stage.object!, 'planes')[0]!.count).toBe(map.planes.length);
        // The map's names went to the label pass (a font is available, the fixture's names are latin).
        expect(text.created()).toBeGreaterThan(0);
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
        for (const u of ['uTime', 'uMotion', 'uDepth', 'uViolationTone', 'uChangedTone', 'uTextTone']) expect(uniform(mesh!, u)).toBeDefined();
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
