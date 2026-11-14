/**
 * How long the extension host's event loop was blocked during a review run: sampled with
 * `perf_hooks.monitorEventLoopDelay` (a seam, so tests inject a fake and run no real timers). A run whose steps
 * waited 33 s on a 10 s deadline had a blocked loop; this record says so with numbers.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
const NS_PER_MS = 1e6;
const SAMPLE_RESOLUTION_MS = 20;
export function startHostLag(sampler = monitorEventLoopDelay) {
    let histogram;
    try {
        histogram = sampler({ resolution: SAMPLE_RESOLUTION_MS });
        histogram.enable();
    }
    catch {
        histogram = undefined;
    }
    const ms = (ns) => (Number.isFinite(ns) ? Math.round(ns / NS_PER_MS) : 0);
    const reset = () => { try {
        histogram?.reset?.();
    }
    catch { /* sampling is best effort */ } };
    return {
        read: () => (histogram ? { maxMs: ms(histogram.max), p99Ms: ms(histogram.percentile(99)), meanMs: ms(histogram.mean) } : undefined),
        reset,
        stop: () => { try {
            histogram?.disable();
        }
        catch { /* sampling is best effort */ } },
    };
}
//# sourceMappingURL=reviewHostLag.js.map