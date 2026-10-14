import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeVitals } from './vitals';

type Callback = (list: { getEntries(): PerformanceEntry[] }) => void;

const observers = new Map<string, Callback>();

class FakeObserver {
  private readonly cb: Callback;
  constructor(cb: Callback) {
    this.cb = cb;
  }
  observe(opts: { type: string }) {
    observers.set(opts.type, this.cb);
  }
  disconnect() {}
}

function emit(type: string, entries: Array<Record<string, unknown>>): void {
  observers.get(type)?.({ getEntries: () => entries as unknown as PerformanceEntry[] });
}

afterEach(() => {
  observers.clear();
  vi.unstubAllGlobals();
});

describe('observeVitals', () => {
  it('reports LCP, CLS ×1000 and INP once per value', () => {
    vi.stubGlobal('PerformanceObserver', FakeObserver);
    const vitals = observeVitals();
    emit('largest-contentful-paint', [{ startTime: 900 }, { startTime: 1800.4 }]);
    emit('layout-shift', [
      { startTime: 100, value: 0.05, hadRecentInput: false },
      { startTime: 400, value: 0.07, hadRecentInput: false },
      { startTime: 500, value: 0.5, hadRecentInput: true },
    ]);
    emit('event', [
      { startTime: 2000, duration: 120, interactionId: 7 },
      { startTime: 2100, duration: 900, interactionId: 0 },
      { startTime: 2200, duration: 260, interactionId: 8 },
    ]);
    expect(vitals.take(5000)).toEqual([
      { kind: 'vital', key: 'LCP', atMs: 5000, value: 1800 },
      { kind: 'vital', key: 'CLS', atMs: 5000, value: 120 },
      { kind: 'vital', key: 'INP', atMs: 5000, value: 260 },
    ]);
    // A second pagehide (bfcache) does not repeat unchanged metrics.
    expect(vitals.take(6000)).toEqual([]);
    vitals.stop();
  });

  it('is a no-op without PerformanceObserver', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    const vitals = observeVitals();
    expect(vitals.take(1)).toEqual([]);
  });
});
