// @vitest-environment jsdom
/** The scene overlay: the View group, the zoom buttons, "Out to", the scale note and the sync banner. */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { CAMERAS } from './cameras';
import { SceneOverlay, type SceneOverlayProps } from './SceneOverlay';
import { missingFilesOf } from './drawers/syncModel';
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
        expect(view.getAllByRole('radio').map((r) => r.textContent)).toEqual([L.viewTransit, L.viewSystem, L.viewGraph, L.viewMap, L.view3d, L.viewHeat, L.viewList]);
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
        render(<SceneOverlay {...overlayProps({ compact: true, onShowAll })} />);
        const note = within(screen.getByTestId('kg-scale-note'));
        expect(note.getByText(new RegExp(fillTemplate(L.statsLine, { nodes: 452, edges: 67, sources: 3 })))).toBeTruthy();
        fireEvent.click(note.getByRole('button', { name: L.showAll }));
        expect(onShowAll).toHaveBeenCalled();
    });

    it('says the map shows only part of the files when the station model was capped', () => {
        render(<SceneOverlay {...overlayProps({ capped: { shown: 3000, total: 16000 } })} />);
        expect(screen.getByTestId('kg-map-capped').textContent).toBe(fillTemplate(L.surface.mapShows, { shown: 3000, total: 16000 }));
    });

    it('draws the sync error banner with Diagnose only when files are missing', () => {
        const onDiagnose = vi.fn();
        const { rerender } = render(<SceneOverlay {...overlayProps({ missingFiles: 0 })} />);
        expect(screen.queryByTestId('kg-sync-banner')).toBeNull();
        rerender(<SceneOverlay {...overlayProps({ missingFiles: 23, onDiagnose })} />);
        expect(within(screen.getByTestId('kg-sync-banner')).getByText(fillTemplate(L.surface.overlay.missingFiles, { count: 23 }))).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: L.surface.overlay.diagnose }));
        expect(onDiagnose).toHaveBeenCalled();
    });

    it('names the files too large to store with the real count, ahead of the missing files', () => {
        render(<SceneOverlay {...overlayProps({ missingFiles: 23, tooLarge: 2 })} />);
        const banner = screen.getByTestId('kg-sync-banner');
        expect(within(banner).getByText(fillTemplate(L.surface.overlay.tooLarge, { count: 2 }))).toBeTruthy();
        expect(banner.textContent).toContain(fillTemplate(L.surface.overlay.missingFiles, { count: 23 }));
    });

    it('stacks in flow on a phone', () => {
        render(<SceneOverlay {...overlayProps({ narrow: true })} />);
        expect(screen.getByTestId('kg-scene-overlay').style.position).not.toBe('absolute');
    });
});

describe('missingFilesOf', () => {
    const base = { local: { files: 10, docs: 0 }, sources: [] };
    it('counts the skipped list, else the gap to the server, else nothing', () => {
        expect(missingFilesOf(null)).toBe(0);
        expect(missingFilesOf({ ...base, server: { files: 8, docs: 0 } })).toBe(2);
        expect(missingFilesOf({ ...base, server: { files: 8, docs: 0 }, skipped: [{ path: 'a', reason: 'x' }] })).toBe(1);
        expect(missingFilesOf({ ...base, skipped: [] })).toBe(0);
        // A folder the walk never reads shares the list but is not a missing file.
        expect(missingFilesOf({ ...base, server: { files: 10, docs: 0 }, skipped: [{ path: 'v', reason: 'nested-checkout' }] })).toBe(0);
    });
});
