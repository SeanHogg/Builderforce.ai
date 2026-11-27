import { describe, expect, it } from 'vitest';
import { InstancedMesh, ShaderMaterial, Vector3, type Object3D } from 'three';
import { buildStageModel } from '../compute/tasks/stageModel';
import { PLACEMENTS } from '../compute/tasks/placement';
import { surfaceFixture } from '../testing';
import { withSymbols } from '../surface/transit/testFixtures';
import { FIXED_TONES, fixedColourUniforms, resolveFixedColours, type FixedColourName } from './fixedColours';
import { createWebGLStage } from './renderer';
import { PALETTE_SIZE, toneIndex } from './tones';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph);

const shaderMeshes = (root: Object3D): InstancedMesh[] => {
    const out: InstancedMesh[] = [];
    root.traverse((o) => { if (o instanceof InstancedMesh && o.material instanceof ShaderMaterial) out.push(o); });
    return out;
};

describe('fixed theme colours (a fragment shader never indexes the palette)', () => {
    it('no stage FRAGMENT shader declares uPalette (ANGLE D3D11 overflowed compiling a fragment-stage lookup)', () => {
        const stage = createWebGLStage();
        stage.setMarks(model.marks);
        const t = PLACEMENTS.map(graph, model, { graph: 1, generation: model.marks.generation, camera: 'map', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
        while (!t.step());
        stage.setPlacement(t.result(), 0, 0);
        const meshes = shaderMeshes(stage.object!);
        expect(meshes.length).toBeGreaterThan(0);
        for (const m of meshes) expect((m.material as ShaderMaterial).fragmentShader, m.name).not.toMatch(/\buPalette\b/);
    });

    it('resolveFixedColours fills every fixed uniform from its tone in a light and a dark palette', () => {
        for (const base of [0.9, 0.1]) {
            const palette = Array.from({ length: PALETTE_SIZE }, (_, i) => new Vector3(base, i / PALETTE_SIZE, 1 - i / PALETTE_SIZE));
            const into = fixedColourUniforms();
            resolveFixedColours(palette, into);
            for (const name of Object.keys(FIXED_TONES) as FixedColourName[]) {
                const want = palette[toneIndex(FIXED_TONES[name])]!;
                expect(into[name].value.toArray(), name).toEqual(want.toArray());
            }
        }
    });
});
