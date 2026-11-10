import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { buildStageModel } from '../../compute/tasks/stageModel';
import { PLACEMENTS } from '../../compute/tasks/placement';
import { surfaceFixture } from '../../testing';
import { stageBus } from '../anchor/stageBus';
import { createNoopStage } from '../renderer';
import { Stage } from '../Stage';
import type { SceneProps } from '../../surface/registry';
import { useStageWiring } from './useStageWiring';

const graph = surfaceFixture();
const model = buildStageModel(graph, []);
const t = PLACEMENTS.map(graph, model, { graph: 1, generation: model.marks.generation, camera: 'map', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
while (!t.step());
const map = t.result();
const route = map.links.find((b) => b.family === 'route')!;

describe('route → line (a route pick selects its line, as the SVG map\'s hop does)', () => {
    it('the Map placement names the line of every route polyline', () => {
        const groups = route.group.length ? route.group[route.group.length - 1]! + 1 : 0;
        expect(groups).toBeGreaterThan(0);
        expect(route.lineIds).toHaveLength(groups);
        const lineIds = new Set(model.lines.lines.map((l) => l.id));
        for (const id of route.lineIds!) expect(lineIds.has(id)).toBe(true);
    });

    it('a click on a route (away from any station) hands bus.options.onLink that polyline\'s line id', async () => {
        const renderer = createNoopStage();
        render(<Stage renderer={renderer} marks={model.marks} paint={null} placement={map} colors={null} width={800} height={500} reducedMotion selected={null} onSelect={() => {}} depthLabel="Depth" />);
        await screen.findAllByRole('button', { name: map.a11y[0]!.label });
        const bus = stageBus(renderer);
        const onLink = vi.fn();
        act(() => bus.setOptions({ ...bus.options, onLink }));
        // The midpoint of a route segment that no station is within the pick target of.
        const index = bus.pickIndex!;
        const proj = bus.projector!, out = new Float64Array(2), p = route.points;
        let hit: { x: number; y: number; group: number } | null = null;
        let seg = 0;
        for (let q = 1; q < p.length / 3 && !hit; q++) {
            if (Number.isNaN(p[q * 3]!) || Number.isNaN(p[(q - 1) * 3]!)) continue;
            proj.project((p[q * 3]! + p[(q - 1) * 3]!) / 2, 0, (p[q * 3 + 2]! + p[(q - 1) * 3 + 2]!) / 2, out);
            if (index.pickMark(out[0]!, out[1]!) < 0 && out[0]! > 0 && out[1]! > 0) hit = { x: out[0]!, y: out[1]!, group: route.group[seg]! };
            seg++;
        }
        expect(hit).not.toBeNull();
        const box = document.querySelector<HTMLElement>('[data-stage]')!;
        fireEvent.pointerDown(box, { clientX: hit!.x, clientY: hit!.y });
        fireEvent.pointerUp(box, { clientX: hit!.x, clientY: hit!.y });
        expect(onLink).toHaveBeenCalledTimes(1);
        expect(onLink.mock.calls[0]![0]).toMatchObject({ kind: 'link', group: hit!.group, line: route.lineIds![hit!.group] });
    });

    it('the stage wiring turns a route pick into the surface\'s line selection on the world map (not inside a drilled level)', () => {
        const selectLine = vi.fn();
        const drill = { stack: [], view: null, canOut: false, parent: null, selected: null, select: vi.fn(), canEnter: vi.fn(), enter: vi.fn(), out: vi.fn(), loading: false, notice: null, symbols: [] };
        const p = { graph, labels: {}, onSelect: vi.fn(), surface: { stations: model.stations, drill, line: null, selectLine, selectStation: vi.fn(), setQuestion: vi.fn(), openPanel: vi.fn() } } as unknown as SceneProps;
        const renderer = createNoopStage();
        const { rerender } = renderHook((props: SceneProps) => useStageWiring(props, renderer, null, 800), { initialProps: p });
        const bus = stageBus(renderer);
        const line = model.lines.lines[0]!.id;
        act(() => bus.options.onLink?.({ kind: 'link', batch: 0, segment: 0, group: 0, slot: -1, line, site: null }, { x: 0, y: 0 }));
        expect(selectLine).toHaveBeenCalledWith(line);
        // Inside a level the map's lines are the level's own: a route pick selects nothing on the surface.
        selectLine.mockClear();
        rerender({ ...p, surface: { ...p.surface, drill: { ...drill, view: { stations: model.stations, leaves: new Set() } } } } as unknown as SceneProps);
        act(() => bus.options.onLink?.({ kind: 'link', batch: 0, segment: 0, group: 0, slot: -1, line, site: null }, { x: 0, y: 0 }));
        expect(selectLine).not.toHaveBeenCalled();
    });
});
