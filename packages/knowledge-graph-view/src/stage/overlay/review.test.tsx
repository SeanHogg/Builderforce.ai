import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { buildStageModel } from '../../compute/tasks/stageModel';
import { PLACEMENTS } from '../../compute/tasks/placement';
import { placeDrill } from '../../compute/tasks/placement/drill';
import { drillKeyOf, type PlacementReq } from '../../compute/tasks/placement/request';
import { nodeIndex } from '../../graphModel';
import { nearestHit } from '../../hitTest';
import { buildDrillView } from '../../surface/transit/drillView';
import { withSymbolRecords } from '../../surface/transit/symbols';
import { USE_CASE } from '../../surface/transit/testFixtures';
import type { DrillModel } from '../../surface/transit/useDrill';
import { surfaceFixture } from '../../testing';
import type { SymbolRecord } from '../../types';
import { stageBus } from '../anchor/stageBus';
import { useStageMap } from '../drill/useStageMap';
import { frameOf, frameProjector, PickIndex } from '../pick';
import { createNoopStage } from '../renderer';
import { Stage } from '../Stage';
import type { Placement } from '../types';

// A files-only graph (the stored graph): a class level's symbols are APPENDED slots.
const graph = surfaceFixture();
const model = buildStageModel(graph, []);
const { marks } = model;
const base = marks.keys.length;
const CLS = `${USE_CASE}#UseCase`;
const records: SymbolRecord[] = [
    { ref: CLS, name: 'UseCase', kind: 'class', parent: USE_CASE, line: 3, exported: true },
    { ref: `${CLS}.run`, name: 'run', kind: 'method', parent: CLS, line: 5, exported: false },
];
const req = (drill: string | null, symbols?: readonly SymbolRecord[]): PlacementReq => ({
    graph: 1, generation: marks.generation, camera: 'map', drill, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, ...(symbols ? { symbols } : {}),
});
const worldOf = (): Placement => { const t = PLACEMENTS.map(graph, model, req(null)); while (!t.step()); return t.result(); };
const world = worldOf();
const api = model.stations.stations.find((s) => s.name === 'API')!;
const classLevel = placeDrill(graph, model, req(drillKeyOf({ level: 'class', ref: USE_CASE }), records));
const packageLevel = placeDrill(graph, model, req(drillKeyOf({ level: 'package', ref: api.id })));

const props = (renderer: ReturnType<typeof createNoopStage>, placement: Placement, over: Partial<Parameters<typeof Stage>[0]> = {}) => ({
    renderer, marks, paint: null, placement, colors: null, width: 800, height: 500, reducedMotion: true, selected: null, onSelect: () => {}, depthLabel: 'Depth', ...over,
});

describe('appended symbols are selectable (review 1: the stage indexes by the LIVE keys)', () => {
    it('on a files-only graph, a class level\'s appended symbol is a proxy; a click on it and proxy Enter both select its key, and its card opens', async () => {
        const renderer = createNoopStage();
        const onSelect = vi.fn();
        render(<Stage {...props(renderer, classLevel, { onSelect })} />);
        const key = `node:${CLS}`;
        const proxy = await waitFor(() => { const el = document.querySelector<HTMLElement>(`[data-id="${key}"]`); expect(el).not.toBeNull(); return el!; });
        expect(Number(proxy.dataset.slot)).toBeGreaterThanOrEqual(base);   // an appended slot
        expect(renderer.keys()[Number(proxy.dataset.slot)]).toBe(key);

        // A click on the canvas over it picks it through the grid (live keys), as a pointer would.
        const box = document.querySelector<HTMLElement>('[data-stage]')!;
        const x = parseFloat(proxy.style.left) + 20, y = parseFloat(proxy.style.top) + 20;
        fireEvent.pointerDown(box, { clientX: x, clientY: y });
        fireEvent.pointerUp(box, { clientX: x, clientY: y });
        expect(onSelect).toHaveBeenLastCalledWith(key);
        // Proxy Enter selects it too.
        onSelect.mockClear();
        fireEvent.keyDown(proxy, { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(key);

        // Its card opens: the stage wiring opens a card for a key that is a station of the level on show.
        const full = withSymbolRecords(graph, records);
        const view = buildDrillView(full, model.stations, { level: 'class', ref: USE_CASE, name: '' });
        const drill = { stack: [{ level: 'class', ref: USE_CASE, name: '' }], view, symbols: records } as unknown as DrillModel;
        const { result } = renderHook(() => useStageMap(model.stations, drill, nodeIndex(full), (k) => stageBus(renderer).slotOf(k)));
        expect(result.current.stationOfKey(key)?.refs).toEqual([CLS]);
    });
});

describe('focus follows a drill (review 7: never left on the page)', () => {
    it('after Go inside focus lands on the level\'s first stop; after Out on the station drilled out of — never <body>', async () => {
        const renderer = createNoopStage();
        const bus = stageBus(renderer);
        const view = render(<Stage {...props(renderer, world)} reducedMotion={false} />);
        const station = `st:${api.id}`;
        const proxy = await waitFor(() => { const el = document.querySelector<HTMLElement>(`[data-id="${station}"]`); expect(el).not.toBeNull(); return el!; });
        act(() => proxy.focus());

        // Go inside (tweened): focus stays on a proxy during the tween, then moves to the level's first stop.
        act(() => bus.requestFocus({ first: true }));
        view.rerender(<Stage {...props(renderer, packageLevel)} reducedMotion={false} />);
        expect(document.activeElement).not.toBe(document.body);
        expect(document.querySelector('[data-stage-proxies]')!.getAttribute('aria-hidden')).toBe('true');
        const first = packageLevel.a11y[0]!.slot;
        await waitFor(() => expect(document.activeElement?.getAttribute('data-slot')).toBe(String(first)), { timeout: 3000 });

        // Out (tweened): back on the station it drilled out of.
        act(() => bus.requestFocus({ key: station }));
        view.rerender(<Stage {...props(renderer, world)} reducedMotion={false} />);
        expect(document.activeElement).not.toBe(document.body);
        await waitFor(() => expect(document.activeElement?.getAttribute('data-id')).toBe(station), { timeout: 3000 });
        expect(bus.focusRequest).toBeNull();
    });
});

describe('a settle during a drill\'s worker trip does not spend the focus request', () => {
    it('a pan settles while Go inside is still on its way: focus stays put; it moves only once the new level is on show', async () => {
        const renderer = createNoopStage();
        const bus = stageBus(renderer);
        const view = render(<Stage {...props(renderer, world)} />);
        const station = `st:${api.id}`;
        const proxy = await waitFor(() => { const el = document.querySelector<HTMLElement>(`[data-id="${station}"]`); expect(el).not.toBeNull(); return el!; });
        act(() => proxy.focus());
        act(() => bus.requestFocus({ first: true }));
        // The worker has not answered yet; the person pans: a new projection, a settle, the same placement.
        const f = frameOf(world, 800, 500);
        act(() => { bus.frame(frameProjector({ ...f, cx: f.cx + 30 })); bus.settle(); });
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(bus.focusRequest).not.toBeNull();
        expect(document.activeElement).toBe(proxy);
        // The level arrives: focus moves to its first stop.
        view.rerender(<Stage {...props(renderer, packageLevel)} />);
        await waitFor(() => expect(document.activeElement?.getAttribute('data-slot')).toBe(String(packageLevel.a11y[0]!.slot)), { timeout: 3000 });
        expect(bus.focusRequest).toBeNull();
    });
});

describe('the pick tie-break is the MarkSet\'s importance (review 18: the reading nearestHit uses)', () => {
    it('two marks on one spot: the more important wins before any incident index exists, exactly as nearestHit ranks them', () => {
        // Two node slots of different importance, placed on the same spot.
        const [a, b] = [0, 1].map((i) => i);
        expect(marks.importance[a!]).not.toBe(marks.importance[b!]);
        const position = new Float32Array(world.position), scale = new Float32Array(world.scale);
        for (const s of [a!, b!]) { position[s * 3] = 100; position[s * 3 + 2] = 100; scale[s] = 1; }
        // b is the bigger mark, so a scale tie-break would pick it whatever the importance.
        scale[b!] = 9;
        const frame = frameOf(world, 800, 500), projector = frameProjector(frame);
        const index = PickIndex.build({ position, scale }, projector, { keys: marks.keys, importance: marks.importance });
        const out = new Float64Array(2);
        projector.project(100, 0, 100, out);
        const want = nearestHit([a!, b!].map((s) => ({ id: marks.keys[s]!, x: out[0]!, y: out[1]!, importance: graph.nodes[s]!.importance })), out[0]!, out[1]!, 40);
        expect(marks.keys[index.pickMark(out[0]!, out[1]!)]).toBe(want);

        // The bus reads the MarkSet's importance from the renderer (no incident index needed).
        const renderer = createNoopStage();
        renderer.setMarks(marks);
        const bus = stageBus(renderer);
        bus.source = renderer;
        bus.setPlacement({ ...world, position, scale }, marks.keys);
        bus.frame(projector);
        bus.settle();
        expect(bus.pick(out[0]!, out[1]!)).toEqual({ kind: 'mark', slot: marks.keys.indexOf(want!) });
    });
});

describe('screen.getAllByRole still finds the proxies by role', () => {
    it('keeps the a11y group discoverable', async () => {
        render(<Stage {...props(createNoopStage(), world)} />);
        expect(await screen.findAllByRole('button', { name: world.a11y[0]!.label })).not.toHaveLength(0);
    });
});
