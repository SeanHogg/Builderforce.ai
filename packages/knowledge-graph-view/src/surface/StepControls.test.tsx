// @vitest-environment jsdom
/** The shared step controls: Reset, ◀ Step, Step ▶, Run to end. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { StepControls } from './StepControls';

describe('StepControls', () => {
    it('steps either way, resets and runs to the end, disabled at the ends', () => {
        const onStep = vi.fn();
        const { rerender } = render(<StepControls at={1} last={3} labels={L} onStep={onStep} />);
        fireEvent.click(screen.getByRole('button', { name: L.surface.pathNext }));
        expect(onStep).toHaveBeenLastCalledWith(2);
        fireEvent.click(screen.getByRole('button', { name: L.surface.pathBack }));
        expect(onStep).toHaveBeenLastCalledWith(0);
        fireEvent.click(screen.getByRole('button', { name: L.surface.path.runToEnd }));
        expect(onStep).toHaveBeenLastCalledWith(3);
        fireEvent.click(screen.getByRole('button', { name: L.surface.path.reset }));
        expect(onStep).toHaveBeenLastCalledWith(0);
        rerender(<StepControls at={3} last={3} labels={L} onStep={onStep} />);
        expect((screen.getByRole('button', { name: L.surface.pathNext }) as HTMLButtonElement).disabled).toBe(true);
    });
});
