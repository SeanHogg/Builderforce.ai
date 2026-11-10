// @vitest-environment jsdom
/** The scene overlay: the View group, the zoom buttons, "Out to", the scale note and the sync banner. */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { CAMERAS } from './cameras';
import { counted } from './plural';
import { SCENE_TOP_VAR, SceneOverlay, type SceneOverlayProps } from './SceneOverlay';
import { syncGap } from './drawers/syncModel';
import { lenses, model } from './testFixtures';
import { useZoomHost, ZoomProvider, type ZoomApi } from './zoom';

function overlayProps(over: Partial<SceneOverlayProps> = {}): SceneOverlayProps {
    return {
        labels: L, cameras: CAMERAS, mode: 'transit', onMode: vi.fn(), zoom: null, stations: model.stations, question: 'where', onQuestion: vi.fn(),
        lenses, lens: 'structure', onLens: vi.fn(), stats: { nodes: 452, edges: 67, sources: 3 }, truncated: true, compact: false, showAll: false,
        drawn: 100, total: 452, onShowAll: vi.fn(), ...over,
    };
}

describe('SceneOverlay', () => {
    it('is a View group of the cameras WITHOUT Sequence, and picking one calls onMode', () => {
        const p = overlayProps();
        render(<SceneOverlay {...p} />);
        const view = within(screen.getByRole('radiogroup', { name: L.viewModesLabel }));
        expect(view.getAllByRole('radio').map((r) => r.textContent)).toEqual([L.viewTransit, L.viewSystem, L.viewGraph, L.viewMap, L.view3d, L.viewHeat, L.viewFourPlusOne, L.viewStyle, L.viewFeatures, L.viewList]);
        fireEvent.click(view.getByRole('radio', { name: L.viewHeat }));
        expect(p.onMode).toHaveBeenCalledWith('heat');
    });

    it('offers "Back to map" only on the Sequence camera, which has no button of its own', () => {
        const p = overlayProps({ mode: 'sequence' });
        render(<SceneOverlay {...p} />);
        fireEvent.click(screen.getByRole('button', { name: L.surface.sequence.backToMap }));
        expect(p.onMode).toHaveBeenCalledWith('transit');
    });

    it('has no "Back to map" on the other cameras', () => {
        render(<SceneOverlay {...overlayProps()} />);
        expect(screen.queryByRole('button', { name: L.surface.sequence.backToMap })).toBeNull();
    });

    it('drives the active camera\'s zoom with +, − and Fit, and disables them when none is registered', () => {
        const zoom: ZoomApi = { zoomIn: vi.fn(), zoomOut: vi.fn(), fit: vi.fn() };
        const { rerender } = render(<SceneOverlay {...overlayProps({ zoom })} />);
        fireEvent.click(screen.getByRole('button', { name: L.zoomIn }));
        fireEvent.click(screen.getByRole('button', { name: L.zoomOut }));
        fireEvent.click(screen.getByRole('button', { name: L.zoomReset }));
        expect([zoom.zoomIn, zoom.zoomOut, zoom.fit].map((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1, 1]);
        rerender(<SceneOverlay {...overlayProps({ zoom: null })} />);
        for (const name of [L.zoomIn, L.zoomOut, L.zoomReset]) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('works against a real registry: a registered camera enables the buttons', () => {
        function Host() {
            const host = useZoomHost();
            const [calls, setCalls] = useState(0);
            return (
                <>
                    <ZoomProvider host={host}>
                        <button type="button" onClick={() => host.register({ zoomIn: () => setCalls((n) => n + 1), zoomOut: () => undefined, fit: () => undefined })}>reg</button>
                    </ZoomProvider>
                    <SceneOverlay {...overlayProps({ zoom: host.api })} />
                    <span data-testid="calls">{calls}</span>
                </>
            );
        }
        render(<Host />);
        expect((screen.getByRole('button', { name: L.zoomIn }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByText('reg'));
        fireEvent.click(screen.getByRole('button', { name: L.zoomIn }));
        expect(screen.getByTestId('calls').textContent).toBe('1');
    });

    it('shows "Out to" only while there is a level above, and calls onOut', () => {
        const onOut = vi.fn();
        const { rerender } = render(<SceneOverlay {...overlayProps()} />);
        expect(screen.queryByText(/Out to/)).toBeNull();
        rerender(<SceneOverlay {...overlayProps({ outTo: 'Web line', onOut })} />);
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(L.surface.overlay.outTo, { name: 'Web line' }) }));
        expect(onOut).toHaveBeenCalled();
    });

    it('draws the scale note, with Show all on a compact screen', () => {
        const onShowAll = vi.fn();
        render(<SceneOverlay {...overlayProps({ compact: true, onShowAll, truncated: false })} />);
        const note = within(screen.getByTestId('kg-scale-note'));
        expect(note.getByText(new RegExp(fillTemplate(L.statsLine, { nodes: 452, edges: 67, sources: 3 })))).toBeTruthy();
        fireEvent.click(note.getByRole('button', { name: L.showAll }));
        expect(onShowAll).toHaveBeenCalled();
    });

    it('says how many stations stand for how many files when the station model was capped', () => {
        render(<SceneOverlay {...overlayProps({ capped: { shown: 3000, total: 16000 } })} />);
        expect(screen.getByTestId('kg-map-capped').textContent).toBe(fillTemplate(L.surface.scaleSummary, { stations: counted(L, 'station', model.stations.length, { count: model.stations.length.toLocaleString() }), files: '16,000 files', nodes: '100' }));
    });

    it('draws no sync banner: the files not stored and the upload queue live in the Reviews panel', () => {
        render(<SceneOverlay {...overlayProps()} />);
        expect(screen.queryByTestId('kg-sync-banner')).toBeNull();
        expect(screen.queryByRole('button', { name: L.surface.overlay.diagnose })).toBeNull();
    });

    it('stacks in flow on a phone', () => {
        render(<SceneOverlay {...overlayProps({ narrow: true })} />);
        expect(screen.getByTestId('kg-scene-overlay').style.position).not.toBe('absolute');
    });
});

describe('the scene top', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
    const stubHeight = (height: number) => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height, top: 0, left: 0, right: 800, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);

    it('publishes the measured controls height as --kg-scene-top on the scene box, and follows it as it changes', () => {
        stubHeight(96);
        let resize: () => void = () => undefined;
        vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { resize = cb; } observe() {} disconnect() {} });
        const { container } = render(<SceneOverlay {...overlayProps()} />);
        const host = container; // the overlay's parent: the scene's box
        expect(host.style.getPropertyValue(SCENE_TOP_VAR)).toBe('96px');
        stubHeight(131.4); // a bar was added
        resize();
        expect(host.style.getPropertyValue(SCENE_TOP_VAR)).toBe('132px');
    });

    it('measures the block holding the bars, not the whole overlay', () => {
        stubHeight(40);
        render(<SceneOverlay {...overlayProps()} />);
        const controls = screen.getByTestId('kg-scene-controls');
        expect(within(controls).getByRole('radiogroup', { name: L.viewModesLabel })).toBeTruthy();
        expect(within(controls).queryByTestId('kg-scale-note')).toBeNull(); // the scale note floats at the bottom, over the scene
    });

    it('publishes nothing on a phone, where the controls stack in flow', () => {
        stubHeight(96);
        const { container } = render(<SceneOverlay {...overlayProps({ narrow: true })} />);
        expect(container.style.getPropertyValue(SCENE_TOP_VAR)).toBe('');
    });

    it('removes the variable when it unmounts', () => {
        stubHeight(96);
        const { container, unmount } = render(<SceneOverlay {...overlayProps()} />);
        expect(container.style.getPropertyValue(SCENE_TOP_VAR)).toBe('96px');
        unmount();
        expect(container.style.getPropertyValue(SCENE_TOP_VAR)).toBe('');
    });

    it('keeps the question bar on one line, its pills scrolling sideways', () => {
        render(<SceneOverlay {...overlayProps()} />);
        const pills = screen.getByRole('group', { name: L.surface.questionsLabel });
        expect(pills.parentElement!.style.flexWrap).toBe('nowrap');
        expect(pills.style.overflowX).toBe('auto');
    });
});

describe('syncGap (the files the server lacks)', () => {
    const base = { local: { files: 10, docs: 0 }, sources: [] };
    it('counts the skipped list, else the gap to the server, else nothing', () => {
        expect(syncGap(null).missing).toBe(0);
        expect(syncGap({ ...base, server: { files: 8, docs: 0 } }).missing).toBe(2);
        expect(syncGap({ ...base, server: { files: 8, docs: 0 }, skipped: [{ path: 'a', reason: 'x' }] }).missing).toBe(1);
        expect(syncGap({ ...base, skipped: [] }).missing).toBe(0);
        // A folder the walk never reads shares the list but is not a missing file.
        expect(syncGap({ ...base, server: { files: 10, docs: 0 }, skipped: [{ path: 'v', reason: 'nested-checkout' }] }).missing).toBe(0);
    });
});
