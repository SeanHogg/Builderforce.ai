/** The toast: it shows a message, replaces it on the next, and clears itself after TOAST_MS. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { StageToast, TOAST_MS, useStageToast } from './StageToast';

describe('useStageToast', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('clears after TOAST_MS, and a new message restarts the timer', () => {
        const { result } = renderHook(() => useStageToast());
        act(() => result.current.show('one'));
        expect(result.current.message).toBe('one');
        act(() => { vi.advanceTimersByTime(TOAST_MS - 100); });
        act(() => result.current.show('two'));
        act(() => { vi.advanceTimersByTime(TOAST_MS - 100); });
        expect(result.current.message).toBe('two');
        act(() => { vi.advanceTimersByTime(100); });
        expect(result.current.message).toBeNull();
    });

    it('leaves no timer behind when unmounted', () => {
        const { result, unmount } = renderHook(() => useStageToast());
        act(() => result.current.show('one'));
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('StageToast', () => {
    it('is a polite status with the message, and nothing without one', () => {
        const { rerender } = render(<StageToast message="Follow on" />);
        const el = document.querySelector('[data-stage-toast]')!;
        expect(el.getAttribute('role')).toBe('status');
        expect(el.getAttribute('aria-live')).toBe('polite');
        expect(el.textContent).toBe('Follow on');
        rerender(<StageToast message={null} />);
        expect(document.querySelector('[data-stage-toast]')).toBeNull();
    });
});
