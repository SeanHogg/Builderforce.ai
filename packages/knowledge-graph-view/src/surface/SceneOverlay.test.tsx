// @vitest-environment jsdom
/** The scene overlay: the toolbar row (views, 3D | Flat, questions), the compare bar slot, the scale note and the sync banner. Out is the header's; zoom and Fit live on the stage nav. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { CAMERAS } from './cameras';
import { counted } from './plural';
import { SCENE_TOP_VAR, SceneOverlay, type SceneOverlayProps } from './SceneOverlay';
import { syncGap } from './drawers/syncModel';
import { lenses, model } from './testFixtures';

function overlayProps(over: Partial<SceneOverlayProps> = {}): SceneOverlayProps {
    return {
        labels: L, cameras: CAMERAS, mode: 'transit', onMode: vi.fn(), stations: model.stations, question: 'where', onQuestion: vi.fn(),
        lenses, lens: 'structure', onLens: vi.fn(), stats: { nodes: 452, edges: 67, sources: 3 }, truncated: true, compact: false, showAll: false,
        drawn: 100, total: 452, onShowAll: vi.fn(), ...over,
    };
}

describe('SceneOverlay', () => {
    it('is a View group of the cameras (Flow and Sequence included), and picking one calls onMode', () => {
        const p = overlayProps();
        render(<SceneOverlay {...p} />);
        const view = within(screen.getByRole('group', { name: L.viewModesLabel }));
        expect(view.getAllByRole('button').map((r) => r.textContent)).toEqual([L.viewTransit, L.viewSystem, L.viewGraph, L.viewMap, L.view3d, L.viewHeat, L.viewStyle, L.viewFeatures, L.viewFlow, L.viewSequence, L.viewList]);
        fireEvent.click(view.getByRole('button', { name: L.viewHeat }));
        expect(p.onMode).toHaveBeenCalledWith('heat');
    });

    it('does not put zoom, Fit or the shape key in the top bar — those live on the stage', () => {
        render(<SceneOverlay {...overlayProps()} />);
        const bar = screen.getByTestId('kg-camera-row');
        for (const name of [L.zoomIn, L.zoomOut, L.zoomReset, L.legend.keyButton ?? L.legendLabel]) {
            expect(within(bar).queryByRole('button', { name })).toBeNull();
        }
        expect(screen.queryByTestId('kg-shape-legend')).toBeNull();
        expect(screen.queryByRole('button', { name: L.zoomIn })).toBeNull();
        expect(screen.queryByRole('button', { name: L.zoomOut })).toBeNull();
        expect(screen.queryByRole('button', { name: L.zoomReset })).toBeNull();
    });

    it('has no Out button (the header owns it) and shows the compare bar only when given one', () => {
        const { rerender } = render(<SceneOverlay {...overlayProps()} />);
        expect(screen.queryByText(/Out to/)).toBeNull();
        expect(screen.queryByTestId('kg-bar-slot')).toBeNull();
        rerender(<SceneOverlay {...overlayProps({ time: <div data-testid="kg-bar-slot" /> })} />);
        expect(within(screen.getByTestId('kg-scene-controls')).getByTestId('kg-bar-slot')).toBeTruthy();
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
        expect(within(controls).getByRole('group', { name: L.viewModesLabel })).toBeTruthy();
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

    it('is ONE wrapping row on the panel background, the questions segment after the views', () => {
        render(<SceneOverlay {...overlayProps()} />);
        const row = screen.getByTestId('kg-camera-row');
        expect(row.style.flexWrap).toBe('wrap');
        const views = within(row).getByRole('group', { name: L.viewModesLabel });
        const questions = within(row).getByRole('group', { name: L.surface.questionsLabel });
        expect(views.compareDocumentPosition(questions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
