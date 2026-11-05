import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../testing';
import { makeOverlay, PRESETS } from '../surface/overlays';
import { buildStations } from '../surface/stations';
import { nodeInstances } from './buffers';
import { MAX_PIPES, nodeChannels, pipeRadius, pipes, pipeWidthOf, towerBodies, UNTESTED_BELOW } from './channels';
import { layout3d, towerHeight } from './layout3d';
import { LENSES } from '../lenses';

const graph = surfaceFixture();
const model = buildStations(graph);
const overlay = makeOverlay(PRESETS.risk, model.stations);
const files = graph.nodes.filter((n) => n.kind === 'file');
const ref = (path: string) => `src:sys::${path}`;

describe('towerHeight', () => {
    it('grows with the level, stays under a plane gap, and is neutral without one', () => {
        expect(towerHeight(1)).toBeLessThan(towerHeight(5));
        expect(towerHeight(5)).toBeLessThan(6);
        expect(towerHeight(undefined)).toBe(1.2);
    });
});

describe('nodeChannels', () => {
    const channels = nodeChannels(files, model, overlay);

    it('height is the size channel: a more complex station stands taller', () => {
        const high = channels.get(ref('api/routes.ts'))!, low = channels.get(ref('db/repo.ts'))!;
        expect(high.height).toBeGreaterThan(low.height);
    });

    it('the fill band is the ring channel, only where coverage exists', () => {
        expect(channels.get(ref('api/useCase.ts'))!.fill).toBeCloseTo(0.8);
        expect(channels.get(ref('web/page.tsx'))!.fill).toBeUndefined();
    });

    it('an untested file is a wireframe shell, a tested or unmeasured one is not', () => {
        expect(channels.get(ref('db/repo.ts'))!.shell).toBe(true);
        expect(channels.get(ref('api/useCase.ts'))!.shell).toBe(false);
        expect(channels.get(ref('web/page.tsx'))!.shell).toBe(false);
        expect(UNTESTED_BELOW).toBe(0.5);
    });
});

describe('towerBodies and pipes', () => {
    const layout = layout3d('sys', files, graph.edges);
    const channels = nodeChannels(files, model, overlay);
    const bodies = towerBodies(nodeInstances(files, layout, LENSES.structure), channels);

    it('stands each tower on its plane: the centre is half its height above', () => {
        const b = bodies.find((x) => x.ref === ref('api/routes.ts'))!;
        expect(b.y).toBeCloseTo(layout.positions.get(b.ref)![1] + b.height / 2);
    });

    it('makes a pipe per edge between towers, wider for busier stations', () => {
        const radius = pipeWidthOf(model, overlay)!;
        const out = pipes(graph.edges, bodies, radius);
        expect(out).toHaveLength(graph.edges.length);
        for (const p of out) expect(Math.hypot(...p.dir)).toBeCloseTo(1);
        expect(pipeRadius(12)).toBeGreaterThan(pipeRadius(5));
    });

    it('has no pipe width when the width channel is off, and caps the pipes', () => {
        const off = makeOverlay({ ...PRESETS.risk, width: 'none' }, model.stations);
        expect(pipeWidthOf(model, off)).toBeUndefined();
        const many = Array.from({ length: MAX_PIPES + 50 }, () => graph.edges[0]!);
        expect(pipes(many, bodies, () => 0.05)).toHaveLength(MAX_PIPES);
    });
});
