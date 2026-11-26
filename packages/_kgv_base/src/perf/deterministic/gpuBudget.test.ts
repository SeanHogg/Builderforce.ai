import { describe, expect, it } from 'vitest';
import { LENSES } from '../../lenses';
import { edgeBuffers } from '../../scene/buffers';
import { layout3d } from '../../scene/layout3d';
import { makeOverlay, PRESETS } from '../../surface/overlays';
import { buildStations } from '../../surface/stations';
import { surfaceFixture } from '../../testing';
import { sceneBudget, typedBytes } from './gpuBudget';

const graph = surfaceFixture();
const stations = buildStations(graph);
const overlay = makeOverlay(PRESETS.risk, stations.stations);
const files = graph.nodes.filter((n) => n.kind === 'file');
const layout = layout3d('sys', files, graph.edges);
const input = { nodes: files, edges: graph.edges, picked: graph.edges, layout, stations, overlay, findings: graph.findings };

describe('typedBytes', () => {
    it('sums typed arrays through objects, arrays and maps, counting a shared buffer once', () => {
        const a = new Float32Array(4), shared = new Uint8Array(10);
        const view = new Uint8Array(shared.buffer, 0, 5);
        expect(typedBytes({ a, list: [shared, view], m: new Map([['k', new Float64Array(2)]]), n: 5 })).toBe(16 + 10 + 16);
        expect(typedBytes('x')).toBe(0);
    });
});

describe('sceneBudget', () => {
    it('returns positive counts and the same numbers twice', () => {
        const first = sceneBudget(input), second = sceneBudget(input);
        expect(second).toEqual(first);
        expect(first.instances).toBe(files.length);
        expect(first.instanceBytes).toBeGreaterThan(0);
        expect(first.towerBodies).toBe(files.length);
        expect(first.edgeSegments).toBeGreaterThan(0);
        expect(first.edgeBufferBytes).toBe(edgeBuffers(graph.edges, layout).reduce((n, b) => n + b.positions.byteLength, 0));
        expect(first.pipes).toBeGreaterThan(0);
    });

    it('takes the lens when given', () => {
        expect(sceneBudget({ ...input, lens: LENSES.structure })).toEqual(sceneBudget(input));
    });
});
