/**
 * The code pane in the stage host (PRD 43 Part C1): docked on the left of a wide box, a Code | Picture switch of the same
 * location in a narrow one (360 px), and a hide control whose Show tab brings it back.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { LENSES } from '../../lenses';
import { surfaceFixture } from '../../testing';
import { CAMERAS } from '../../surface/cameras';
import type { SceneProps } from '../../surface/registry';
import { useSurface } from '../../surface/useSurface';
import { createNoopStage } from '../renderer';
import { StageFactoryContext } from './StageFactoryContext';
import StageHost, { type StageCodeProps } from './StageHost';

const box = vi.hoisted(() => ({ width: 960 }));
vi.mock('../../environment', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../environment')>();
    return { ...actual, useContainerSize: () => ({ width: box.width, height: 600 }) };
});

const graph = surfaceFixture();
const LIST = CAMERAS.find((c) => c.fallback)!.component!;

function mount(width: number, extra: StageCodeProps = {}) {
    box.width = width;
    function Harness() {
        const surface = useSurface(graph, null);
        const p: SceneProps = {
            mode: 'transit', graph, drawn: { nodes: graph.nodes, edges: graph.edges }, lens: LENSES.structure, labels: L, rootTitle: 'sys', selected: null, focus: [],
            reducedMotion: true, surface, onSelect: vi.fn(), onShow: vi.fn(),
        };
        return <StageHost camera="map" fallback={LIST} {...p} {...extra} />;
    }
    return render(
        <StageFactoryContext.Provider value={() => createNoopStage()}>
            <Harness />
        </StageFactoryContext.Provider>,
    );
}
const sc = L.surface.code;

describe('the code pane in the host', () => {
    it('is docked on the left of a wide box with the outline of the level, and no switch', async () => {
        const { container } = mount(1000);
        expect(await screen.findByRole('complementary', { name: sc.dockAria })).toBeTruthy();
        expect(container.querySelector('[data-code-split] [data-level-outline]')).not.toBeNull();
        expect(container.querySelector('[data-pane-switch]')).toBeNull();
    });

    it('in a 360 px box shows ONE of the two under a Code | Picture switch', async () => {
        const { container } = mount(360);
        const sw = await screen.findByRole('radiogroup', { name: sc.paneSwitchAria });
        expect(container.querySelector('[data-code-split]')).toBeNull();
        // The picture first: the pane is not drawn.
        expect(container.querySelector('[data-code-narrow]')).toBeNull();
        expect(sw.querySelector('[aria-checked="true"]')?.textContent).toBe(sc.panePicture);
        fireEvent.click(screen.getByRole('radio', { name: sc.paneCode }));
        expect(container.querySelector('[data-code-narrow] [data-level-outline]')).not.toBeNull();
        expect((container.querySelector('[data-map-pane]') as HTMLElement).style.visibility).toBe('hidden');
        fireEvent.click(screen.getByRole('radio', { name: sc.panePicture }));
        expect(container.querySelector('[data-code-narrow]')).toBeNull();
        expect((container.querySelector('[data-map-pane]') as HTMLElement).style.visibility).toBe('');
    });

    it('hidden, it leaves a Show tab and no pane or switch; the tab and the pane\'s own Hide both go through onToggleCode', async () => {
        const onToggleCode = vi.fn();
        const hidden = mount(1000, { codeShown: false, onToggleCode });
        expect(hidden.container.querySelector('[data-code-split], [data-pane-switch]')).toBeNull();
        fireEvent.click(await screen.findByRole('button', { name: sc.dockShow }));
        expect(onToggleCode).toHaveBeenCalledTimes(1);
        hidden.unmount();

        const shown = mount(1000, { onToggleCode });
        fireEvent.click(await screen.findByRole('button', { name: sc.dockHide }));
        expect(onToggleCode).toHaveBeenCalledTimes(2);
        shown.unmount();
    });
});
