import { describe, expect, it } from 'vitest';
import { startStallMonitor, STALL_THRESHOLD_MS } from './stallMonitor';
import type { LagHistogram } from './knowledge/review/reviewHostLag';

/**
 * The extension host IS the webview bridge: a multi-second block there makes webview
 * requests time out with no hint why. `startStallMonitor` samples the event loop
 * (reusing `reviewHostLag`) and writes ONE line per new worst-stall over the threshold
 * to the output channel. These tests drive a fake lag sampler, so no real timers or
 * loop-blocking runs.
 */
describe('extension-host stall monitor', () => {
  /** A fake histogram whose max/p99/mean the test moves by hand. */
  const fakeLag = (values: { max: number; p99: number; mean: number }) => {
    let current = values;
    const sampler = (_opts: { resolution: number }): LagHistogram => ({
      enable: () => true,
      disable: () => true,
      reset: () => undefined,
      get max() { return current.max; },
      get mean() { return current.mean; },
      percentile: (p: number) => (p === 99 ? current.p99 : current.mean),
    });
    return { sampler, set: (v: { max: number; p99: number; mean: number }) => { current = v; } };
  };

  it('logs once per new worst-stall over the threshold, in whole ms', () => {
    const lag = fakeLag({ max: 0, p99: 0, mean: 0 });
    const lines: string[] = [];
    const monitor = startStallMonitor({ log: (l) => lines.push(l), lagSampler: lag.sampler, thresholdMs: 100 });

    // No stall yet.
    monitor.sample();
    expect(lines).toEqual([]);

    // A stall crosses the threshold → one line.
    lag.set({ max: 150 * 1e6, p99: 120 * 1e6, mean: 40 * 1e6 }); // ns → 150/120/40 ms
    monitor.sample();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/extension host stalled: 150ms block/);

    // The same worst-stall again → NOT logged twice.
    monitor.sample();
    expect(lines).toHaveLength(1);

    // A new, worse stall → one more line.
    lag.set({ max: 400 * 1e6, p99: 200 * 1e6, mean: 60 * 1e6 });
    monitor.sample();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/400ms block/);

    monitor.dispose();
  });

  it('resets after the loop drops back below the threshold, so a later stall logs again', () => {
    const lag = fakeLag({ max: 0, p99: 0, mean: 0 });
    const lines: string[] = [];
    const monitor = startStallMonitor({ log: (l) => lines.push(l), lagSampler: lag.sampler, thresholdMs: 100 });

    lag.set({ max: 200 * 1e6, p99: 150 * 1e6, mean: 30 * 1e6 });
    monitor.sample();
    expect(lines).toHaveLength(1);

    // Loop recovers: max back under the threshold → the monitor arms again.
    lag.set({ max: 5 * 1e6, p99: 4 * 1e6, mean: 1 * 1e6 });
    monitor.sample();
    expect(lines).toHaveLength(1);

    // A later stall (even a smaller one than the first) logs once more.
    lag.set({ max: 120 * 1e6, p99: 110 * 1e6, mean: 20 * 1e6 });
    monitor.sample();
    expect(lines).toHaveLength(2);

    monitor.dispose();
  });

  it('never logs below the threshold', () => {
    const lag = fakeLag({ max: 50 * 1e6, p99: 40 * 1e6, mean: 10 * 1e6 }); // 50 ms < 1000 default
    const lines: string[] = [];
    const monitor = startStallMonitor({ log: (l) => lines.push(l), lagSampler: lag.sampler });
    monitor.sample();
    monitor.sample();
    expect(lines).toEqual([]);
    monitor.dispose();
  });

  it('exposes the default threshold at ~1 second', () => {
    expect(STALL_THRESHOLD_MS).toBe(1000);
  });
});
