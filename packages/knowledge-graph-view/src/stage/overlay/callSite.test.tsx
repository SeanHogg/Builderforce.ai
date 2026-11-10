import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { CallSite } from '@seanhogg/builderforce-memory/knowledge';
import { buildStageModel } from '../../compute/tasks/stageModel';
import { linkBatch } from '../../compute/tasks/placement/links';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import type { SceneProps } from '../../surface/registry';
import { surfaceFixture } from '../../testing';
import { stageBus } from '../anchor/stageBus';
import { frameProjector, PickIndex } from '../pick';
import { createNoopStage } from '../renderer';
import { FLAG, type Placement } from '../types';
import { callSiteLeft, callSiteTop } from './CallSiteCard';
import { useStageWiring } from './useStageWiring';

const site: CallSite = { path: 'api/routes.ts', line: 42, column: 4, order: 0 };

describe('picking a Sequence message reveals its call site', () => {
    it('a link pick on a batch with callSites carries the polyline\'s site', () => {
        const arrow = { ...linkBatch('arrow', [{ pts: [{ x: 0, y: 100 }, { x: 400, y: 100 }], tone: 1, width: 2, dash: 0, flags: FLAG.SELECTABLE }], 0), callSites: [site] };
        const marks = { position: Float32Array.from([-500, 0, -500]), scale: Float32Array.from([1]) };
        const index = PickIndex.build(marks, frameProjector({ zoom: 1, cx: 200, cz: 100, width: 400, height: 200 }), { links: [arrow] });
        expect(index.pick(200, 103)).toMatchObject({ kind: 'link', group: 0, site });
    });

    it('opens a path:line card whose "Open at line" goes through the host\'s open port, and fits a 360 px stage', () => {
        const graph = surfaceFixture();
        const model = buildStageModel(graph, []);
        const onOpenSource = vi.fn();
        const drill = { stack: [], view: null, canOut: false, parent: null, selected: null, select: vi.fn(), canEnter: vi.fn(), enter: vi.fn(), out: vi.fn(), loading: false, notice: null, symbols: [] };
        const p = { graph, labels: L, onSelect: vi.fn(), onOpenSource, surface: { stations: model.stations, drill, line: null, selectLine: vi.fn(), selectStation: vi.fn(), setQuestion: vi.fn(), openPanel: vi.fn() } } as unknown as SceneProps;
        const renderer = createNoopStage();
        const { result } = renderHook(() => useStageWiring(p, renderer, null, 360));
        act(() => stageBus(renderer).options.onLink?.({ kind: 'link', batch: 0, segment: 0, group: 0, slot: -1, line: null, site }, { x: 340, y: 60 }));
        render(<div style={{ position: 'relative', width: 360 }}>{result.current.card}</div>);

        const card = screen.getByRole('dialog', { name: `${L.surface.map.card.callSite} api/routes.ts:42` });
        expect(card.querySelector('[data-call-site-where]')!.textContent).toBe('api/routes.ts:42');
        // Inside a 360 px stage: left edge ≥ 8 px and right edge ≤ 352 px.
        const left = parseFloat(card.style.left), width = parseFloat(card.style.width);
        expect(left).toBeGreaterThanOrEqual(8);
        expect(left + width).toBeLessThanOrEqual(352);
        expect(callSiteLeft(340, 360)).toBe(left);

        fireEvent.click(screen.getByRole('button', { name: 'Open at line 42' }));
        expect(onOpenSource).toHaveBeenCalledWith({ path: 'api/routes.ts', startLine: 42, endLine: 42 });
    });

    it('stays inside the box vertically: below the pick when it fits, flipped above when the box ends first', () => {
        expect(callSiteTop(40, 100, 400)).toBe(48);                // fits below
        expect(callSiteTop(380, 100, 400)).toBe(272);              // flipped above: 380 − 8 − 100
        expect(callSiteTop(60, 300, 320)).toBe(8);                 // taller than the room either side: pinned to the top
        expect(callSiteTop(500, 100, 0)).toBe(508);                // an unmeasured box: below
    });

    it('closes when another placement comes on show (camera, band, drill, generation) and when a mark is selected', () => {
        const graph = surfaceFixture();
        const model = buildStageModel(graph, []);
        const drill = { stack: [], view: null, canOut: false, parent: null, selected: null, select: vi.fn(), canEnter: vi.fn(), enter: vi.fn(), out: vi.fn(), loading: false, notice: null, symbols: [] };
        const p = { graph, labels: L, onSelect: vi.fn(), surface: { stations: model.stations, drill, line: null, selectLine: vi.fn(), selectStation: vi.fn(), setQuestion: vi.fn(), openPanel: vi.fn() } } as unknown as SceneProps;
        const renderer = createNoopStage();
        const bus = stageBus(renderer);
        const { result } = renderHook(() => useStageWiring(p, renderer, null, 800));
        const pick = () => act(() => bus.options.onLink?.({ kind: 'link', batch: 0, segment: 0, group: 0, slot: -1, line: null, site }, { x: 10, y: 10 }));
        const open = () => { const { container, unmount } = render(<div>{result.current.card}</div>); const on = !!container.querySelector('[data-call-site]'); unmount(); return on; };

        pick();
        expect(open()).toBe(true);
        act(() => bus.setPlacement({ ...emptyPlacement(), cacheKey: 'another' }, model.marks.keys));   // a camera switch / band / drill
        expect(open()).toBe(false);

        pick();
        expect(open()).toBe(true);
        act(() => result.current.onSelect(model.marks.keys[0]!));                                          // a mark selected
        expect(open()).toBe(false);
    });
});

function emptyPlacement(): Placement {
    return {
        generation: 1, cacheKey: '', anchor: 'station', position: new Float32Array(0), scale: new Float32Array(0), extrude: new Float32Array(0),
        links: [], planes: [], labels: [], captions: [], a11y: [], caption: { shown: 0, total: 0, capped: false }, bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        rig: { projection: 'orthographic', frame: 'fill', home: { position: [0, 1, 0], target: [0, 0, 0], up: [0, 0, -1] }, depth: { tilt: [0, 0], orbit: false } },
    };
}
