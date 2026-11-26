// @vitest-environment jsdom
/** The surface composed over `EMPTY_GRAPH` (no graph yet, or a reviewed folder with nothing in it): nothing crashes. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { EMPTY_GRAPH } from './emptyGraph';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { LENSES } from './lenses';
import { ViewSurface } from './ViewSurface';
import { CAMERAS } from './surface/cameras';
import { Drawer } from './surface/Drawer';
import { useDrawer } from './surface/useDrawer';
import { PANELS } from './surface/panels';
import { useSurface } from './surface/useSurface';
import type { KnowledgeGraphSource } from './types';


const pending = (): KnowledgeGraphSource => ({ scopes: () => new Promise(() => undefined), load: () => new Promise(() => undefined) });

describe('the surface over no graph', () => {
    it('cycles every camera the frame offers without crashing', () => {
        render(<div style={{ height: 600 }}><KnowledgeGraphView source={pending()} /></div>);
        const group = screen.getByRole('group', { name: L.viewModesLabel });
        const buttons = within(group).getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
        for (const b of buttons) fireEvent.click(b);
        expect(screen.getByRole('region', { name: L.regionLabel })).toBeTruthy();
    });

    it.each(CAMERAS.map((c) => [c.id] as const))('the %s camera draws an empty graph', (id) => {
        function Harness() {
            const surface = useSurface(EMPTY_GRAPH, null);
            return (
                <ViewSurface
                    mode={id} graph={EMPTY_GRAPH} drawn={{ nodes: [], edges: [] }} lens={LENSES.structure} labels={L} rootTitle="" selected={null}
                    focus={[]} reducedMotion surface={surface} onSelect={vi.fn()} onShow={vi.fn()}
                />
            );
        }
        expect(() => render(<Harness />)).not.toThrow();
        // The cameras sit inside an error boundary: a crash shows it instead of throwing, so assert it did not.
        expect(screen.queryByTestId('kg-camera-error')).toBeNull();
    });

    it('opens every tab of the drawer over an empty graph', () => {
        function Harness() {
            const surface = useSurface(EMPTY_GRAPH, null);
            const drawer = useDrawer(surface.panel, surface.openPanel);
            const env = { webgl: false, reducedMotion: true, hasLines: true, compact: false, hasRun: true };
            const panels = PANELS.map((p) => ({ ...p, available: () => true }));
            return (
                <>
                    <button type="button" onClick={drawer.toggle}>toggle</button>
                    <Drawer drawer={drawer} sheet={false} act={<p>act</p>} graph={EMPTY_GRAPH} env={env} labels={L} surface={surface} panels={panels} onShow={vi.fn()} source={pending()} />
                </>
            );
        }
        render(<Harness />);
        fireEvent.click(screen.getByText('toggle'));
        const tabs = screen.getAllByRole('tab');
        for (const t of tabs) fireEvent.click(screen.getAllByRole('tab').find((x) => x.getAttribute('aria-label') === t.getAttribute('aria-label'))!);
        expect(tabs).toHaveLength(PANELS.length + 1);
    });
});
