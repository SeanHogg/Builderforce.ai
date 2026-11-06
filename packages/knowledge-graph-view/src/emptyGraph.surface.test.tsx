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
import { PanelDrawer, PanelToggle } from './surface/PanelDock';
import { PANELS } from './surface/panels';
import { useSurface } from './surface/useSurface';
import type { KnowledgeGraphSource } from './types';

vi.mock('./scene/GraphScene', () => ({ default: () => null }));

const pending = (): KnowledgeGraphSource => ({ scopes: () => new Promise(() => undefined), load: () => new Promise(() => undefined) });

describe('the surface over no graph', () => {
    it('cycles every camera the frame offers without crashing', () => {
        render(<div style={{ height: 600 }}><KnowledgeGraphView source={pending()} /></div>);
        const group = screen.getByRole('radiogroup', { name: L.viewModesLabel });
        const buttons = within(group).getAllByRole('radio');
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
    });

    it('opens every panel of the dock over an empty graph', () => {
        function Harness() {
            const surface = useSurface(EMPTY_GRAPH, null);
            const env = { webgl: false, reducedMotion: true, hasLines: true, compact: false, hasSync: true };
            const panels = PANELS.map((p) => ({ ...p, available: () => true }));
            return (
                <>
                    <PanelToggle graph={EMPTY_GRAPH} env={env} labels={L} panel={surface.panel} onPanel={surface.openPanel} panels={panels} ids={PANELS.map((p) => p.id)} />
                    <PanelDrawer graph={EMPTY_GRAPH} env={env} labels={L} surface={surface} panel={surface.panel} onPanel={surface.openPanel} panels={panels} onShow={vi.fn()} source={pending()} />
                </>
            );
        }
        render(<Harness />);
        const group = screen.getByRole('group', { name: L.surface.panelsLabel });
        for (const b of within(group).getAllByRole('button')) {
            fireEvent.click(b);
            fireEvent.click(b);
        }
        expect(within(group).getAllByRole('button')).toHaveLength(PANELS.length);
    });
});
