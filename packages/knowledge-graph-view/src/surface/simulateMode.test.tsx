/**
 * Simulate as a mode: the toolbar toggle is an icon whose accessible name is the "Simulate {name}" sentence, and the
 * rail panel moves the journey step to the stop each shown hop leaves from.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { surfaceFixture } from '../testing';
import type { PathModel } from './path';
import { SceneTools } from './SceneTools';
import { SimulatePanel } from './SimulatePanel';
import { useSurface } from './useSurface';

const graph = surfaceFixture();
const env = { webgl: false, reducedMotion: true, hasLines: true, compact: false };
const path: PathModel = {
    stops: [{ id: 'a', name: 'Login' }, { id: 'b', name: 'Check' }, { id: 'c', name: 'Save' }],
    hops: [{ kind: 'calls', count: 1 }, { kind: 'calls', count: 1 }],
};

describe('SimulatePanel as a mode', () => {
    it('moves the journey step to the stop each hop leaves from', () => {
        const onStep = vi.fn();
        render(<SimulatePanel graph={graph} from={null} path={path} labels={L} onStep={onStep} onClose={vi.fn()} />);
        expect(onStep).toHaveBeenLastCalledWith(0);
        fireEvent.click(screen.getByRole('button', { name: L.surface.simulate.modeNext }));
        expect(onStep).toHaveBeenLastCalledWith(1);
    });

    it('opens on the stop it is asked to start from; a stop not on the path starts at the first', () => {
        const onStep = vi.fn();
        const { rerender } = render(<SimulatePanel graph={graph} from={null} path={path} startAt="b" labels={L} onStep={onStep} onClose={vi.fn()} />);
        expect(onStep).toHaveBeenLastCalledWith(1);
        rerender(<SimulatePanel graph={graph} from={null} path={path} startAt="zzz" labels={L} onStep={onStep} onClose={vi.fn()} />);
        expect(onStep).toHaveBeenLastCalledWith(0);
    });

    it('never steps with no journey and nothing selected', () => {
        const onStep = vi.fn();
        render(<SimulatePanel graph={graph} from={null} path={{ stops: [], hops: [] }} labels={L} onStep={onStep} onClose={vi.fn()} />);
        expect(onStep).not.toHaveBeenCalled();
        expect(screen.getByText(L.surface.simulate.modeEmpty)).toBeTruthy();
    });
});

describe('the Simulate toggle', () => {
    it('is an icon named by its aria-label, with the mode name as the tooltip', () => {
        const ariaLabel = fillTemplate(L.surface.simulate.modeOpenAria, { name: 'Login' });
        function Harness() {
            const surface = useSurface(graph, null);
            return (
                <SceneTools
                    graph={graph} env={env} labels={L} surface={surface} panel={null} onPanel={vi.fn()} panelsMenu={false} narrow={false}
                    simulate={{ pressed: false, ariaLabel, onToggle: vi.fn() }}
                />
            );
        }
        const { container } = render(<Harness />);
        const toggle = container.querySelector('[data-simulate-toggle]') as HTMLElement;
        expect(toggle.getAttribute('aria-label')).toBe(ariaLabel);
        expect(toggle.getAttribute('title')).toBe(L.surface.simulate.modeOpen);
        expect(toggle.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
        expect(screen.getByRole('button', { name: ariaLabel })).toBe(toggle);
    });
});
