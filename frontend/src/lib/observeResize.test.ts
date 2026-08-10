import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeResizeOnAnimationFrame } from './observeResize';

describe('observeResizeOnAnimationFrame', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('coalesces observer bursts into one animation-frame callback and cleans up', () => {
    let notify: ResizeObserverCallback = () => undefined;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { notify = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    let scheduled: FrameRequestCallback | null = null;
    const request = vi.fn((callback: FrameRequestCallback) => { scheduled = callback; return 41; });
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const callback = vi.fn();
    const target = {} as Element;

    const cleanup = observeResizeOnAnimationFrame(target, callback);
    notify([{ contentRect: { width: 10 } } as ResizeObserverEntry], {} as ResizeObserver);
    notify([{ contentRect: { width: 20 } } as ResizeObserverEntry], {} as ResizeObserver);

    expect(request).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();
    expect(scheduled).not.toBeNull();
    (scheduled as unknown as FrameRequestCallback)(0);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0][0].contentRect.width).toBe(20);

    notify([], {} as ResizeObserver);
    cleanup();
    expect(cancel).toHaveBeenCalledWith(41);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(observe).toHaveBeenCalledWith(target);
  });
});
