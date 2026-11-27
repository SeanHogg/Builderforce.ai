/**
 * The Graph camera on the stage (PRD 43 P3, B8): the behaviour the retired SVG `Graph2D` was tested for, asked of the
 * Graph placement and the stage with the no-op renderer (jsdom). The layout, edge, bundle and caption parity with the 2D
 * graph's own modules is `compute/tasks/placement/graphParity.test.ts`; this file holds the rest:
 *
 * - "a band per partition" → one `partition` plane and one band caption per partition;
 * - "names each node and selects on click and on Enter" → a proxy per shown node, with a filename for files, selecting `node:<ref>`;
 * - "walks nodes in importance order" → the a11y reading order;
 * - "rings the selected node" → the selected proxy is pressed, no other is; none without a selection;
 * - "dims nodes the lens does not highlight" → `markPaint`'s DIM flag;
 * - "registers its zoom with the scene overlay" → the rig's api moves the stage (the caption layer's ONE transform), Fit restores it;
 * - "laying out" → nothing interactive until the placement for this MarkSet lands.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { buildStageModel } from '../compute/tasks/stageModel';
import { paintMarks } from '../compute/tasks/markPaint';
import { PLACEMENTS, type PlacementReq } from '../compute/tasks/placement';
import { PLACEMENT_WORD_KEYS } from '../compute/tasks/placement/graph';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { codeFixture } from '../testing';
import { ZoomProvider, type ZoomApi } from '../surface/zoom';
import { PRESETS } from '../surface/overlays';
import { createNoopStage } from './renderer';
import { Stage } from './Stage';
import { FLAG, SLOT_NODE, type Placement } from './types';
import type { SymbolRecord } from '../types';

const g = codeFixture();
const strings = Object.fromEntries(PLACEMENT_WORD_KEYS.map((k) => [k, L[k]]));
const model = buildStageModel(g, strings);
const { marks } = model;
const req: PlacementReq = { graph: 1, generation: marks.generation, camera: 'graph', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 };
const t = PLACEMENTS.graph(g, model, req);
while (!t.step());
const graph: Placement = t.result();

const mount = (over: Partial<Parameters<typeof Stage>[0]> = {}) => {
    const onSelect = vi.fn();
    const utils = render(
        <Stage renderer={createNoopStage()} marks={marks} paint={null} placement={graph} colors={null} width={800} height={500} reducedMotion selected={null} onSelect={onSelect} {...over} />,
    );
    return { onSelect, ...utils };
};

describe('the Graph camera on the stage (was Graph2D)', () => {
    it('shows the selected class, its methods and its indexed neighbors on the same stage slots', () => {
        const file = g.nodes[0]!.ref, neighbor = g.nodes[3]!.ref;
        const owner = `${file}#Controller@10`, method = `${file}#Controller.run@12`;
        const records: SymbolRecord[] = [
            { ref: owner, parent: file, name: 'Controller', kind: 'class', exported: true, line: 10 },
            { ref: method, parent: owner, name: 'run', kind: 'method', exported: false, line: 12,
                relations: [{ kind: 'calls', to: neighbor }] },
        ];
        const scoped = PLACEMENTS.graph(g, model, { ...req, pathId: `node:${owner}`, symbols: records });
        while (!scoped.step());
        const result = scoped.result();
        expect(result.a11y.map(({ label }) => label)).toEqual(expect.arrayContaining(['Controller', 'run']));
        expect(result.a11y).toHaveLength(3);
        expect(result.append?.keys).toEqual(expect.arrayContaining([`node:${owner}`, `node:${method}`]));
        expect(result.links[0]?.group.length).toBeGreaterThanOrEqual(2);
    });
    it('lays every partition out as a band: one partition plane and one band caption each', () => {
        const partitions = new Set(g.nodes.map((n) => n.partition ?? ''));
        expect(graph.planes.filter((p) => p.kind === 'partition')).toHaveLength(partitions.size);
        expect(graph.captions).toHaveLength(partitions.size);
    });

    it('selects the full source ref from a proxy with a short filename', async () => {
        const shown = graph.a11y.map((a) => a.slot);
        expect(shown).toHaveLength(g.nodes.length);
        for (const s of shown) { expect(marks.slotKind[s]).toBe(SLOT_NODE); expect(graph.scale[s]).toBeGreaterThan(0); }
        const { onSelect } = mount();
        const first = g.nodes[0]!;
        const proxy = await screen.findByRole('button', { name: 'page.tsx' });
        expect(marks.tooltip[0]).toBe('app/page.tsx');
        fireEvent.click(proxy);
        expect(onSelect).toHaveBeenLastCalledWith(`node:${first.ref}`);
        fireEvent.keyDown(proxy, { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledTimes(2);
        expect(onSelect).toHaveBeenLastCalledWith(`node:${first.ref}`);
    });

    it('reads the nodes in importance order', () => {
        const importance = graph.a11y.map((a) => g.nodes[a.slot]!.importance);
        expect(importance).toEqual([...importance].sort((a, b) => b - a));
    });

    it('presses the selected node\'s proxy and no other; none without a selection', async () => {
        const node = g.nodes[3]!;
        const { unmount } = mount({ selected: `node:${node.ref}` });
        await screen.findByRole('button', { name: 'invoice.ts' });
        const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
        expect(pressed.map((b) => b.getAttribute('data-id'))).toEqual([`node:${node.ref}`]);
        unmount();
        mount();
        await screen.findByRole('button', { name: 'page.tsx' });
        expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(0);
    });

    it('dims the nodes the lens is not about, and only those', () => {
        const paint = paintMarks(g, model, { lensId: 'duplication', overlay: PRESETS.risk, lit: null, roles: null });
        const dim = g.nodes.map((_, i) => (paint.flags[i]! & FLAG.DIM) !== 0);
        expect(dim).toContain(true);
        expect(dim).toContain(false);
    });

    it('registers its zoom with the scene overlay (no buttons of its own): in moves the view, Fit restores it', () => {
        let api: ZoomApi | null = null;
        const host = { register: (a: ZoomApi) => { api = a; }, unregister: (a: ZoomApi) => { if (api === a) api = null; } };
        const { container } = render(
            <ZoomProvider host={host}>
                <Stage renderer={createNoopStage()} marks={marks} paint={null} placement={graph} colors={null} width={800} height={500} reducedMotion selected={null} onSelect={() => {}} />
            </ZoomProvider>,
        );
        expect(screen.queryByRole('button', { name: L.zoomIn })).toBeNull();
        expect(api).not.toBeNull();
        const layer = container.querySelector<HTMLElement>('[data-stage-captions]')!;
        const fitted = layer.style.transform;
        act(() => api!.zoomIn());
        expect(layer.style.transform).not.toBe(fitted);
        act(() => api!.fit());
        expect(layer.style.transform).toBe(fitted);
    });

    it('is not ready (no proxies) until the placement for this MarkSet lands', () => {
        const { container } = mount({ placement: null });
        expect(container.querySelector('[data-stage-ready="false"]')).not.toBeNull();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });
});
