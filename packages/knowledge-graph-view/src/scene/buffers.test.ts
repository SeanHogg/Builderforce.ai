/** The scene buffers the worker builds (`edgeBuffers` task, the Tower channels): moved unchanged from the retired `GraphScene.test.tsx`. */
import { describe, expect, it } from 'vitest';
import { edgeBuffers, nodeInstances } from './buffers';
import { layout3d } from './layout3d';
import { LENSES } from '../lenses';
import { codeFixture } from '../testing';

describe('scene buffers', () => {
    const g = codeFixture();
    const layout = layout3d('code', g.nodes, g.edges);

    it('instances every placed node once, sized by importance', () => {
        const inst = nodeInstances(g.nodes, layout, LENSES.structure);
        expect(inst.refs).toHaveLength(g.nodes.length);
        const invoice = inst.refs.indexOf('src:code::domain/invoice.ts');
        const legacy = inst.refs.indexOf('src:code::infrastructure/legacy.ts');
        expect(inst.scales[invoice]!).toBeGreaterThan(inst.scales[legacy]!);
    });

    it('builds one line buffer per edge kind, with violations and cycles apart', () => {
        const buckets = edgeBuffers(g.edges, layout).map((b) => [b.bucket, b.count]);
        expect(buckets).toEqual([['cycle', 1], ['duplicate', 1], ['references', 3], ['violation', 2]]);
    });

    it('dims what the lens is not about', () => {
        const inst = nodeInstances(g.nodes, layout, LENSES.unused);
        const legacy = inst.refs.indexOf('src:code::infrastructure/legacy.ts');
        expect(inst.dim[legacy]).toBe(false);
        expect(inst.dim.filter(Boolean)).toHaveLength(g.nodes.length - 1);
    });
});
