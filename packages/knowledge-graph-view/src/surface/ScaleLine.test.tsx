// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { ScaleLine, type ScaleLineProps } from './ScaleLine';

const props = (over: Partial<ScaleLineProps> = {}): ScaleLineProps => ({
    labels: L, stats: { nodes: 452, edges: 67, sources: 3 }, truncated: false, compact: false, showAll: false, drawn: 60, total: 452, onShowAll: vi.fn(), ...over,
});
const draw = (over?: Partial<ScaleLineProps>) => render(<p><ScaleLine {...props(over)} /></p>);

describe('ScaleLine', () => {
    it('is the size sentence, and nothing else for a whole graph', () => {
        const { container } = draw();
        expect(container.textContent).toBe(fillTemplate(L.statsLine, { nodes: 452, edges: 67, sources: 3 }));
    });

    it('says a large graph shows its most important part; on a compact screen it names the focus and offers Show all', () => {
        const onShowAll = vi.fn();
        const { container, rerender } = draw({ truncated: true });
        expect(container.textContent).toContain(L.truncatedNote);
        rerender(<p><ScaleLine {...props({ truncated: true, compact: true, onShowAll })} /></p>);
        expect(container.textContent).toContain(fillTemplate(L.focusedNote, { count: 60 }));
        fireEvent.click(screen.getByRole('button', { name: L.showAll }));
        expect(onShowAll).toHaveBeenCalled();
    });

    it('offers no Show all once everything is shown', () => {
        draw({ compact: true, showAll: true });
        expect(screen.queryByRole('button', { name: L.showAll })).toBeNull();
    });

    it('notes how much of the files the map shows when the station model was capped', () => {
        draw({ capped: { shown: 3000, total: 16000 } });
        expect(screen.getByTestId('kg-map-capped').textContent).toBe('Map shows 3000 of 16000 files');
    });

    it('has no map note without a cap', () => {
        draw();
        expect(screen.queryByTestId('kg-map-capped')).toBeNull();
    });
});
