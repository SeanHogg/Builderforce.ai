// @vitest-environment jsdom
/** When a review that started elsewhere shows itself, and what closing the Reviews panel does to a plan. */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraphSource } from '../../types';
import type { KnowledgeGraphState } from '../../useKnowledgeGraph';
import type { ReviewState } from '../../useReviewRun';
import type { SurfaceModel } from '../useSurface';
import { useReviewsPanel } from './useReviewsPanel';

const source = { review: () => (async function* () { /* never started here */ })(), runs: { subscribe: () => () => undefined, list: async () => [], get: async () => null, stop: async () => undefined } } as unknown as KnowledgeGraphSource;

function mount(initial: { status: ReviewState['status']; panel: string | null }, openReview = false) {
    const openPanel = vi.fn();
    const answer = vi.fn();
    const kgOf = (status: ReviewState['status']) => ({ rootId: 'docs', review: { state: { status } as ReviewState, answer, available: true } }) as unknown as KnowledgeGraphState;
    const surfaceOf = (panel: string | null) => ({ panel, openPanel }) as unknown as SurfaceModel;
    const view = renderHook(
        ({ status, panel }) => useReviewsPanel({ kg: kgOf(status), surface: surfaceOf(panel), source, keepsBaseline: false, refreshSync: () => undefined, openReview }),
        { initialProps: initial },
    );
    return { ...view, openPanel, answer };
}

describe('a review that started elsewhere', () => {
    it('opens the Reviews panel at once, while the files are still being counted, when no drawer is open', () => {
        const { rerender, openPanel } = mount({ status: 'idle', panel: null });
        rerender({ status: 'planning', panel: null });
        expect(openPanel).toHaveBeenCalledTimes(1);
        expect(openPanel).toHaveBeenLastCalledWith('run');
        // Now open: the plan and the run find it there and do not open it again.
        rerender({ status: 'confirm', panel: 'run' });
        rerender({ status: 'running', panel: 'run' });
        expect(openPanel).toHaveBeenCalledTimes(1);
    });

    it('closed during the counting, an auto-confirmed run (planning straight to running) does not reopen it', () => {
        const { result, rerender, openPanel } = mount({ status: 'idle', panel: null });
        rerender({ status: 'planning', panel: null });
        rerender({ status: 'planning', panel: 'run' });
        result.current.setPanel(null);
        rerender({ status: 'planning', panel: null });
        rerender({ status: 'running', panel: null });
        expect(openPanel.mock.calls.filter(([id]) => id === 'run')).toHaveLength(1);
    });

    it('opens the panel for its plan and its run when the review skipped the counting', () => {
        const { rerender, openPanel } = mount({ status: 'idle', panel: null });
        rerender({ status: 'confirm', panel: null });
        expect(openPanel).toHaveBeenLastCalledWith('run');
        rerender({ status: 'running', panel: null });
        expect(openPanel).toHaveBeenCalledTimes(2);
    });

    it('closed during the counting, it stays closed when the plan lands, and the plan is answered no', () => {
        const { result, rerender, openPanel, answer } = mount({ status: 'idle', panel: null });
        rerender({ status: 'planning', panel: null });
        expect(openPanel).toHaveBeenCalledTimes(1);
        rerender({ status: 'planning', panel: 'run' });
        result.current.setPanel(null);
        rerender({ status: 'planning', panel: null });
        rerender({ status: 'confirm', panel: null });
        expect(answer).toHaveBeenCalledWith(false);
        expect(openPanel.mock.calls.filter(([id]) => id === 'run')).toHaveLength(1);
    });

    it('never takes the screen from a drawer the person is reading, nor re-opens a panel that is already open', () => {
        const other = mount({ status: 'idle', panel: 'coverage' });
        other.rerender({ status: 'confirm', panel: 'coverage' });
        other.rerender({ status: 'running', panel: 'coverage' });
        expect(other.openPanel).not.toHaveBeenCalled();

        const open = mount({ status: 'idle', panel: 'run' });
        open.rerender({ status: 'confirm', panel: 'run' });
        expect(open.openPanel).not.toHaveBeenCalled();
    });

    it('arrives on the panel for a host\'s "choose a folder to review" chip', () => {
        const { openPanel } = mount({ status: 'idle', panel: null }, true);
        expect(openPanel).toHaveBeenCalledWith('run');
    });
});

describe('closing the Reviews panel', () => {
    it('on a plan awaiting its answer cancels it (nothing is written)', () => {
        const { result, answer, openPanel } = mount({ status: 'confirm', panel: 'run' });
        result.current.setPanel(null);
        expect(answer).toHaveBeenCalledWith(false);
        expect(openPanel).toHaveBeenCalledWith(null);
    });

    it('while the files are still being counted discards the plan the moment it lands, and does not pop the panel back open', () => {
        const { result, rerender, answer, openPanel } = mount({ status: 'planning', panel: 'run' });
        result.current.setPanel(null);
        expect(answer).not.toHaveBeenCalled();
        rerender({ status: 'confirm', panel: null });
        expect(answer).toHaveBeenCalledWith(false);
        expect(answer).toHaveBeenCalledTimes(1);
        expect(openPanel).not.toHaveBeenCalledWith('run');
    });

    it('leaves a running review alone', () => {
        const { result, answer } = mount({ status: 'running', panel: 'run' });
        result.current.setPanel(null);
        expect(answer).not.toHaveBeenCalled();
    });
});
