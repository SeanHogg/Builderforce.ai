import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { resolveLabels } from '../labels';
import { elapsedText, LoadingStatus } from './LoadingStatus';

const L = resolveLabels();

describe('LoadingStatus', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('says loading, then how long it has run and the host phase, and offers Copy diagnostics once slow', () => {
        render(<LoadingStatus labels={L} progress={{ phase: 'build', diagnostics: () => 'diag' }} />);
        expect(screen.getByRole('status').textContent).toBe(L.loading);
        expect(screen.getByTestId('kg-loading-phase').textContent).toBe('Now: building the graph');
        expect(screen.queryByText(L.copyDiagnostics)).toBeNull();
        act(() => { vi.advanceTimersByTime(3_000); });
        expect(screen.getByTestId('kg-loading-elapsed').textContent).toBe('Loading the knowledge graph… 3 s');
        act(() => { vi.advanceTimersByTime(69_000); });
        expect(screen.getByTestId('kg-loading-elapsed').textContent).toBe('Loading the knowledge graph… 1 min 12 s');
        expect(screen.getByText(L.copyDiagnostics)).toBeTruthy();
        expect(screen.getByText(L.loadingSlow)).toBeTruthy();
    });

    it('keeps the seconds counter out of every live region: the status says only the static words', () => {
        render(<LoadingStatus labels={L} progress={{ phase: 'build' }} />);
        act(() => { vi.advanceTimersByTime(5_000); });
        const status = screen.getByRole('status');
        expect(status.textContent).toBe(L.loading);
        const counter = screen.getByTestId('kg-loading-elapsed');
        expect(counter.getAttribute('aria-hidden')).toBe('true');
        expect(counter.closest('[role="status"], [aria-live]')).toBeNull();
        expect(screen.getByTestId('kg-loading-phase').closest('[aria-live]')).not.toBeNull();
    });

    it('shows an unknown phase by its id, and no phase line without one', () => {
        const { rerender } = render(<LoadingStatus labels={L} progress={{ phase: 'mystery' }} />);
        expect(screen.getByTestId('kg-loading-phase').textContent).toBe('Now: mystery');
        rerender(<LoadingStatus labels={L} />);
        expect(screen.queryByTestId('kg-loading-phase')).toBeNull();
    });

    it('formats spans in the reader’s units', () => {
        expect(elapsedText(L, 500)).toBe('0 s');
        expect(elapsedText(L, 59_999)).toBe('59 s');
        expect(elapsedText(L, 3_725_000)).toBe('1 h 2 min');
    });
});
