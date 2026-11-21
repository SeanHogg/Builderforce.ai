// @vitest-environment jsdom
/** Collapse leaves a 28px rail; re-expand restores the panel. */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { DOCK_RAIL, DockEdge } from './PanelDock';

function Harness() {
    const [shown, setShown] = useState(true);
    return (
        <DockEdge slot="right" shown={shown} onToggle={() => setShown((v) => !v)} labels={L}>
            <div data-testid="dock-body">panel</div>
        </DockEdge>
    );
}

describe('DockEdge', () => {
    it('collapse leaves a 28px rail and re-expand restores the panel', () => {
        const { container } = render(<Harness />);
        expect(screen.getByTestId('dock-body')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: L.surface.panelToggles.hideRight }));
        const rail = container.querySelector('[data-panel-dock="right"]') as HTMLElement;
        expect(rail.getAttribute('data-collapsed')).toBe('true');
        expect(rail.style.width).toBe(`${DOCK_RAIL}px`);
        expect(screen.queryByTestId('dock-body')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: L.surface.panelToggles.showRight }));
        expect(screen.getByTestId('dock-body')).toBeTruthy();
        expect(rail.getAttribute('data-collapsed')).toBe('false');
    });
});
