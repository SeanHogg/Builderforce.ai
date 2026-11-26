/** The stepped wheel: one call per gesture past WHEEL_STEP_PX, a rest of WHEEL_LOCK_MS after it, and no continuous zoom. */
import { describe, expect, it, vi } from 'vitest';
import { bindGestures, WHEEL_LOCK_MS, WHEEL_STEP_PX } from './gestures';
import type { RigController } from './rig';

function setup(withStep: boolean) {
    const el = document.createElement('div');
    const rig = { zoomBy: vi.fn(), slideBy: vi.fn(), panBy: vi.fn() } as unknown as RigController;
    const go = vi.fn();
    const off = bindGestures(el, rig, () => 'fill', () => {}, withStep ? () => go : undefined);
    const wheel = (deltaY: number, timeStamp: number) => {
        const e = new WheelEvent('wheel', { deltaY, cancelable: true });
        Object.defineProperty(e, 'timeStamp', { value: timeStamp });
        el.dispatchEvent(e);
        return e;
    };
    return { rig, go, wheel, off };
}

describe('stepped wheel', () => {
    it('adds the travel up and steps once past the threshold, in the wheel direction', () => {
        const { go, rig, wheel, off } = setup(true);
        wheel(-(WHEEL_STEP_PX / 2), 1000);
        expect(go).not.toHaveBeenCalled();
        const e = wheel(-(WHEEL_STEP_PX / 2) - 1, 1010);
        expect(go).toHaveBeenCalledWith(1);
        expect(e.defaultPrevented).toBe(true);
        expect(rig.zoomBy).not.toHaveBeenCalled();
        off();
    });

    it('rests for the lock after a step, then steps again (out for a wheel down)', () => {
        const { go, wheel, off } = setup(true);
        wheel(WHEEL_STEP_PX + 1, 1000);
        wheel(WHEEL_STEP_PX + 1, 1000 + WHEEL_LOCK_MS - 1);
        expect(go).toHaveBeenCalledTimes(1);
        wheel(WHEEL_STEP_PX + 1, 1000 + WHEEL_LOCK_MS);
        expect(go).toHaveBeenCalledTimes(2);
        expect(go).toHaveBeenLastCalledWith(-1);
        off();
    });

    it('zooms continuously when no step handler is given', () => {
        const { rig, wheel, off } = setup(false);
        wheel(-100, 1000);
        expect(rig.zoomBy).toHaveBeenCalledTimes(1);
        off();
    });
});
