// @vitest-environment jsdom
/** The depth trail: system › module › class › method, each earlier crumb climbing back. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { DepthTrail, depthCrumbs, type DepthFrame } from './DepthTrail';
import { PathStrip } from './PathStrip';
import type { PathModel } from './path';

const stack: DepthFrame[] = [
    { level: 'package', name: 'Billing' },
    { level: 'class', name: 'Invoice' },
    { level: 'function', name: 'charge' },
];

const journey: PathModel = {
    stops: [{ id: 'a', name: 'Login' }, { id: 'b', name: 'Accounts' }],
    hops: [{ kind: 'references', count: 2 }],
};

describe('depthCrumbs', () => {
    it('reads the drill stack as system › module › class › method', () => {
        const crumbs = depthCrumbs(stack, 'App', L.surface.depth);
        expect(crumbs.map((c) => c.level)).toEqual(['system', 'module', 'class', 'method']);
        expect(crumbs.map((c) => c.name)).toEqual(['App', 'Billing', 'Invoice', 'charge']);
        expect(crumbs.map((c) => c.depth)).toEqual([0, 1, 2, 3]);
    });

    it('uses the System word when the root has no name', () => {
        expect(depthCrumbs([], '  ', L.surface.depth)[0]).toEqual({ depth: 0, level: 'system', name: 'System' });
    });
});

describe('DepthTrail', () => {
    it('draws nothing on the system map', () => {
        const { container } = render(<DepthTrail stack={[]} systemName="App" labels={L} onClimb={vi.fn()} />);
        expect(container.firstChild).toBeNull();
    });

    it('climbs when an earlier crumb is clicked, and the crumb you are on is not a button', () => {
        const onClimb = vi.fn();
        render(<DepthTrail stack={stack} systemName="App" labels={L} onClimb={onClimb} />);
        expect(screen.getByRole('navigation', { name: L.surface.depth.aria })).toBeTruthy();
        expect(screen.getAllByText('›')).toHaveLength(3);
        fireEvent.click(screen.getByRole('button', { name: 'Back to Billing' }));
        expect(onClimb).toHaveBeenCalledWith(1);
        fireEvent.click(screen.getByRole('button', { name: 'Back to App' }));
        expect(onClimb).toHaveBeenCalledWith(0);
        fireEvent.click(screen.getByRole('button', { name: 'Back to Invoice' }));
        expect(onClimb).toHaveBeenCalledWith(2);
        expect(screen.queryByRole('button', { name: /charge/ })).toBeNull();
        expect(screen.getByText('charge').getAttribute('aria-current')).toBe('location');
    });
});

describe('PathStrip depth trail and walkthrough', () => {
    it('shows the trail above the journey and narrates the current step', () => {
        const onClimb = vi.fn();
        render(<PathStrip path={journey} step={1} labels={L} onStep={vi.fn()} trail={stack.slice(0, 1)} systemName="App" onClimb={onClimb} />);
        expect(screen.getByTestId('kg-depth-trail')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to App' }));
        expect(onClimb).toHaveBeenCalledWith(0);
        expect(screen.getByTestId('kg-step-narration').textContent)
            .toBe('Walk the hallway from Login to Accounts (2 calls). Leave through the door Accounts.');
    });
});
