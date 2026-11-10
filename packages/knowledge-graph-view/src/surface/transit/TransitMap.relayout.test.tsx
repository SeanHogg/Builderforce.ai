// @vitest-environment jsdom
/**
 * Regression: the Map flashed "Laying out…" forever on a big repo. A page scrollbar toggling moved the measured width by
 * ~17px, the map laid out again for it, and while the worker answered the map was REPLACED by the "Laying out…" line;
 * that collapsed the page height, the scrollbar went away, the width grew back, and round it went. Two guards: the layout
 * width ignores a scrollbar's worth of change, and a recompute of the same stations and lines keeps the map drawn.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { LENSES } from '../../lenses';
import { surfaceFixture } from '../../testing';
import { getComputeClient } from '../../compute/sharedClient';
import { CAMERAS } from '../cameras';
import { buildLines } from '../lines';
import { makeOverlay, PRESETS } from '../overlays';
import { buildStations } from '../stations';
import { TransitMap, type TransitMapProps } from '../TransitMap';
import { useSurface } from '../useSurface';
import { SCROLLBAR_SLACK, steadyWidth } from './steadyWidth';
import { withDocs } from './testFixtures';

// The measured width and the worker's state, driven by the test: the layout itself is the real one, run inline.
const ctl = vi.hoisted(() => ({ width: 0, pending: false, widths: [] as number[], last: null as unknown }));
vi.mock('../../environment', async (orig) => ({ ...(await orig<typeof import('../../environment')>()), useContainerWidth: () => ctl.width }));
vi.mock('../../compute/useComputed', async (orig) => {
    const actual = await orig<typeof import('../../compute/useComputed')>();
    return {
        ...actual,
        useComputed: ((kind, input, deps, initial, opts) => {
            const real = actual.useComputed(kind, input, deps, initial, opts);
            if (kind !== 'transitLayout') return real;
            ctl.widths.push((input as { width: number }).width);
            // In flight, the worker's previous answer is what the hook still returns (`useComputed` keeps it).
            if (ctl.pending) return { value: ctl.last as typeof real.value, pending: true };
            ctl.last = real.value;
            return real;
        }) as typeof actual.useComputed,
    };
});

afterEach(() => { cleanup(); ctl.width = 0; ctl.pending = false; ctl.widths = []; ctl.last = null; });

const graph = withDocs();
const model = buildStations(graph);
const lines = buildLines(graph, model);
const overlay = makeOverlay(PRESETS.risk, model.stations);
const props: TransitMapProps = {
    stations: model, lines, overlay, labels: L, lit: null, lineId: lines.lines[0]!.id, selectedStation: null, pins: [], reducedMotion: true,
    onSelectStation: vi.fn(), onSelectLine: vi.fn(), label: 'map', graph,
};

describe('steadyWidth', () => {
    it('takes the first measurement (floored), then ignores a scrollbar\'s worth of change and follows a real resize', () => {
        expect(steadyWidth(0, 1000.6)).toBe(1000);
        expect(steadyWidth(1000, 983)).toBe(1000);
        expect(steadyWidth(1000, 1000 + SCROLLBAR_SLACK)).toBe(1000);
        expect(steadyWidth(1000, 700)).toBe(700);
        expect(steadyWidth(1000, 0)).toBe(1000);
    });
});

describe('the transit map while a layout is recomputed', () => {
    it('keeps drawing the map (with a quiet note) when the same stations and lines are laid out again', () => {
        ctl.width = 1000;
        const { rerender } = render(<TransitMap {...props} />);
        expect(document.querySelector('svg[role="group"]')).not.toBeNull();
        // A real resize: a new layout is on its way for the same picture.
        ctl.width = 700;
        ctl.pending = true;
        rerender(<TransitMap {...props} />);
        expect(document.querySelector('svg[role="group"]')).not.toBeNull();
        expect(screen.queryByTestId('kg-laying-out')).toBeNull();
        expect(screen.getByTestId('kg-relaying-out').textContent).toBe(L.surface.scene.layingOut);
        ctl.pending = false;
        rerender(<TransitMap {...props} />);
        expect(screen.queryByTestId('kg-relaying-out')).toBeNull();
    });

    it('waits ("Laying out…") when the stations or lines change: the old layout is another picture', () => {
        ctl.width = 1000;
        const { rerender } = render(<TransitMap {...props} />);
        ctl.pending = true;
        rerender(<TransitMap {...props} stations={buildStations(graph)} />);
        expect(screen.getByTestId('kg-laying-out')).toBeTruthy();
        expect(document.querySelector('svg[role="group"]')).toBeNull();
    });

    it('does not lay out again when a page scrollbar comes and goes', () => {
        ctl.width = 1000;
        const { rerender } = render(<TransitMap {...props} />);
        for (const w of [983, 1000, 983, 1000.5, 983.25]) {
            ctl.width = w;
            rerender(<TransitMap {...props} />);
        }
        expect(new Set(ctl.widths)).toEqual(new Set([1000]));
        ctl.width = 1400;
        rerender(<TransitMap {...props} />);
        expect(ctl.widths.at(-1)).toBe(1400);
    });
});

describe('the Map camera\'s look toggle', () => {
    it('switches flat ⇄ towers in the one camera without laying the map out again', () => {
        const g = surfaceFixture();
        const MapCamera = CAMERAS.find((c) => c.id === 'transit')!.component;
        function Harness() {
            const surface = useSurface(g, null);
            return (
                <MapCamera
                    mode="transit" graph={g} drawn={{ nodes: g.nodes, edges: g.edges }} lens={LENSES.structure} labels={L} rootTitle="sys" selected={null}
                    focus={[]} reducedMotion surface={surface} onSelect={vi.fn()} onShow={vi.fn()}
                />
            );
        }
        const runSync = vi.spyOn(getComputeClient(), 'runSync');
        render(<Harness />);
        const layouts = () => runSync.mock.calls.filter(([kind]) => kind === 'transitLayout').length;
        const before = layouts();
        expect(before).toBeGreaterThan(0);
        expect(document.querySelector('[data-tower]')).toBeNull();
        const look = screen.getByRole('radiogroup', { name: L.surface.map.look.label });
        fireEvent.click(screen.getByRole('radio', { name: L.surface.map.look.towers }));
        expect(look.querySelector('[aria-checked="true"]')?.textContent).toBe(L.surface.map.look.towers);
        expect(document.querySelector('[data-tower]')).not.toBeNull();
        fireEvent.click(screen.getByRole('radio', { name: L.surface.map.look.flat }));
        expect(document.querySelector('[data-tower]')).toBeNull();
        expect(layouts()).toBe(before);
        runSync.mockRestore();
    });
});
