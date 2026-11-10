// @vitest-environment jsdom
/** The cameras' error boundary, and the transit map drawing a layout that was laid out for other lines (the crash it caught). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { buildLines, type LinesModel } from './lines';
import { makeOverlay, PRESETS } from './overlays';
import { buildStations } from './stations';
import { SurfaceErrorBoundary } from './SurfaceErrorBoundary';
import { TransitMap } from './TransitMap';
import { withDocs } from './transit/testFixtures';

// The layout the map draws is the one the worker laid out for `stale` (when set): the render a drill lands in, before the
// worker has answered for the level, pairs the world's routes with the level's lines.
const stale = vi.hoisted(() => ({ lines: null as LinesModel | null }));
vi.mock('./transit/useTransitModel', async (importOriginal) => {
    const real = await importOriginal<typeof import('./transit/useTransitModel')>();
    return {
        ...real,
        useTransitModel: (input: Parameters<typeof real.useTransitModel>[0]) => {
            const laidOut = real.useTransitModel({ ...input, lines: stale.lines ?? input.lines });
            return { ...laidOut, layoutPending: false };
        },
    };
});

afterEach(() => { stale.lines = null; vi.restoreAllMocks(); });

function Boom({ when }: { when: boolean }): null {
    if (when) throw new Error('station lookup failed');
    return null;
}

describe('SurfaceErrorBoundary', () => {
    it('shows the localized line, the message and Try again, and logs the error', () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<SurfaceErrorBoundary labels={L} resetKey="transit"><Boom when /></SurfaceErrorBoundary>);
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain(L.surface.scene.errorTitle);
        expect(alert.textContent).toContain('station lookup failed');
        expect(screen.getByRole('button', { name: L.surface.scene.errorRetry })).toBeTruthy();
        expect(log.mock.calls.some((c) => String(c[0]).includes('knowledge-graph-view'))).toBe(true);
    });

    it('inside a drilled level offers Back, which leaves the level and draws again', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onBack = vi.fn();
        let crash = true;
        function Child() { return <Boom when={crash} />; }
        render(<SurfaceErrorBoundary labels={L} resetKey="transit" onBack={() => { crash = false; onBack(); }}><Child /></SurfaceErrorBoundary>);
        fireEvent.click(screen.getByRole('button', { name: L.surface.scene.errorBack }));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('resets when the camera, root or level changes', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { rerender } = render(<SurfaceErrorBoundary labels={L} resetKey="a"><Boom when /></SurfaceErrorBoundary>);
        expect(screen.getByRole('alert')).toBeTruthy();
        rerender(<SurfaceErrorBoundary labels={L} resetKey="b"><Boom when={false} /></SurfaceErrorBoundary>);
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('the transit map over a layout laid out for other lines', () => {
    it('regression: draws (skipping the routes of lines it no longer has) instead of throwing', () => {
        const graph = withDocs();
        const model = buildStations(graph);
        const world = buildLines(graph, model);
        expect(world.lines.length).toBeGreaterThan(0);
        stale.lines = world;
        // The drilled level's own lines: none of the world's line ids.
        const level: LinesModel = { ...world, lines: [], interchanges: new Map() };
        const overlay = makeOverlay(PRESETS.risk, model.stations);
        expect(() => render(
            <TransitMap
                stations={model} lines={level} overlay={overlay} labels={L} lit={null} lineId={null} selectedStation={null} pins={[]}
                reducedMotion onSelectStation={vi.fn()} onSelectLine={vi.fn()} label="map" graph={graph}
            />,
        )).not.toThrow();
        expect(screen.getByTestId('kg-transit').querySelector('svg')).toBeTruthy();
    });
});
