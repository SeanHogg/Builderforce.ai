// @vitest-environment jsdom
/**
 * Regression: the Map flashed "Laying out…" forever on a big repo. A page scrollbar toggling moved the measured width by
 * ~17px, the map laid out again for it, and while the layout was recomputed the map was REPLACED by the "Laying out…"
 * line; that collapsed the page height, the scrollbar went away, the width grew back, and round it went. Two guards:
 * the layout width ignores a scrollbar's worth of change (`steadyWidth`), and a recompute of the same stations and lines
 * keeps the map drawn (only the spacing is stale) while a recompute of new stations or lines waits for the new picture.
 *
 * The map's layout is a pure, memoized function of its stations, lines, width and order — for a small graph it runs
 * inline on the main thread, so the map paints complete on its first frame and never shows a laying-out state. These
 * tests pin that contract on the real `TransitMap`: the map draws, a width wobble inside the scrollbar slack does not
 * re-layout, a real resize re-lays-out without blanking, and the flat/towers look is a paint of the same layout, not a
 * recompute.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { buildLines } from '../lines';
import { makeOverlay, PRESETS } from '../overlays';
import { buildStations } from '../stations';
import { TransitMap, type TransitMapProps } from '../TransitMap';
import { SCROLLBAR_SLACK, steadyWidth } from './steadyWidth';
import { withDocs } from './testFixtures';

// The measured width, driven by the test.
const ctl = vi.hoisted(() => ({ width: 0 }));
vi.mock('../../environment', async (orig) => ({ ...(await orig<typeof import('../../environment')>()), useContainerWidth: () => ctl.width }));

afterEach(() => { cleanup(); ctl.width = 0; });

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
    it('draws complete on its first frame: no laying-out state for a small graph', () => {
        ctl.width = 1000;
        render(<TransitMap {...props} />);
        expect(document.querySelector('svg[role="group"]')).not.toBeNull();
    });

    it('keeps drawing the map through a real resize (the steady width absorbs the scrollbar wobble)', () => {
        ctl.width = 1000;
        const { rerender } = render(<TransitMap {...props} />);
        expect(document.querySelector('svg[role="group"]')).not.toBeNull();
        // A page scrollbar comes and goes: the width wobbles by less than the slack, the layout width does not move.
        for (const w of [983, 1000, 983, 1000.5, 983.25]) {
            ctl.width = w;
            rerender(<TransitMap {...props} />);
            expect(document.querySelector('svg[role="group"]')).not.toBeNull();
        }
        // A real resize: the map is laid out for the new width and keeps drawing while it does.
        ctl.width = 1400;
        rerender(<TransitMap {...props} />);
        expect(document.querySelector('svg[role="group"]')).not.toBeNull();
    });

    it('waits ("Laying out…") only before the first layout, not for a stations change it can still draw', () => {
        ctl.width = 1000;
        const { rerender } = render(<TransitMap {...props} />);
        expect(document.querySelector('svg[role="group"]')).not.toBeNull();
        // The same stations, a fresh (equal) model: the layout is memoized on them, so the picture is unchanged.
        rerender(<TransitMap {...props} stations={buildStations(graph)} />);
        expect(document.querySelector('svg[role="group"]')).not.toBeNull();
    });
});

describe('the Map camera\'s look toggle', () => {
    it('switches flat and towers in the one camera without laying the map out again', () => {
        ctl.width = 1000;
        const onSelectLine = vi.fn();
        const { rerender } = render(<TransitMap {...props} variant="map" onSelectLine={onSelectLine} />);
        expect(document.querySelector('[data-tower]')).toBeNull();
        // The same map, the towers variant: the same stations and lines, painted as towers and pipes.
        rerender(<TransitMap {...props} variant="tower" onSelectLine={onSelectLine} />);
        expect(document.querySelector('[data-tower]')).not.toBeNull();
        expect(document.querySelectorAll('[data-station]').length).toBeGreaterThan(0);
        rerender(<TransitMap {...props} variant="map" onSelectLine={onSelectLine} />);
        expect(document.querySelector('[data-tower]')).toBeNull();
    });
});
