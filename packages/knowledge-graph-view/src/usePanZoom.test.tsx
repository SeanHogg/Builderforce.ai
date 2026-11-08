// @vitest-environment jsdom
/** Wheel zoom writes the viewBox attribute directly and commits React state once, after the gesture settles. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { usePanZoom, type PanZoom, type ViewBox } from './usePanZoom';

const BASE: ViewBox = { x: 0, y: 0, w: 100, h: 100 };
let renders = 0;
let pan: PanZoom;

function Harness() {
    pan = usePanZoom(BASE, 'k');
    renders += 1;
    return <svg data-testid="svg" ref={pan.svgRef} viewBox={pan.viewBox} />;
}

beforeEach(() => {
    renders = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
});
afterEach(() => { vi.useRealTimers(); });

describe('usePanZoom wheel zoom', () => {
    it('updates the viewBox attribute per frame and commits state once after settle', () => {
        const { getByTestId } = render(<Harness />);
        const svg = getByTestId('svg');
        const before = renders;
        const initial = svg.getAttribute('viewBox');

        for (let i = 0; i < 10; i += 1) fireEvent.wheel(svg, { deltaY: -100 });
        expect(renders).toBe(before); // no re-render while the wheel is turning

        act(() => { vi.advanceTimersByTime(20); }); // a frame passes
        expect(svg.getAttribute('viewBox')).not.toBe(initial);
        expect(renders).toBe(before);

        act(() => { vi.advanceTimersByTime(200); }); // settle
        expect(renders).toBe(before + 1);
        expect(pan.view!.w).toBeLessThan(BASE.w);
        expect(svg.getAttribute('viewBox')).toBe(pan.viewBox);
    });

    it('keeps button zoom immediate', () => {
        render(<Harness />);
        const before = renders;
        act(() => { pan.zoomBy(2); });
        expect(renders).toBe(before + 1);
        expect(pan.view!.w).toBe(50);
    });

    it('cancels the pending frame and settle timer on unmount', () => {
        const { getByTestId, unmount } = render(<Harness />);
        fireEvent.wheel(getByTestId('svg'), { deltaY: -100 });
        const before = renders;
        unmount();
        act(() => { vi.advanceTimersByTime(500); });
        expect(renders).toBe(before);
        expect(vi.getTimerCount()).toBe(0);
    });
});
