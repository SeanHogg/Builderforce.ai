// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';

// A WebGL scene has no DOM in jsdom: the Canvas stands in as a div and the scene's own
// hooks are inert — the same approach as the room's 3D tests (`world3d`).
vi.mock('@react-three/fiber', () => ({
    Canvas: ({ children: _children }: { children: ReactNode }) => <div data-testid="r3f-canvas" />,
    useFrame: () => undefined,
    useThree: () => ({ camera: { position: { lerp: () => undefined } } }),
}));
vi.mock('@react-three/drei', () => ({
    Html: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    OrbitControls: () => null,
}));

import GraphScene from './GraphScene';
import { edgeBuffers, nodeInstances } from './buffers';
import { layout3d } from './layout3d';
import { LENSES } from '../lenses';
import { codeFixture } from '../testing';

describe('GraphScene', () => {
    it('mounts the canvas once the idle layout and the theme colours are ready', async () => {
        const g = codeFixture();
        render(
            <GraphScene
                rootId="code" nodes={g.nodes} edges={g.edges} lens={LENSES.structure} selected={null} focus={[]}
                onSelect={() => undefined} planeLabel={(p) => p} label="Knowledge graph"
            />,
        );
        expect(screen.getByRole('img', { name: 'Knowledge graph' })).toBeTruthy();
        expect(await screen.findByTestId('r3f-canvas')).toBeTruthy();
    });
});

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
