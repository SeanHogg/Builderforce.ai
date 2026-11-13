/**
 * How long the extension host's event loop was blocked during a review run: sampled with
 * `perf_hooks.monitorEventLoopDelay` (a seam, so tests inject a fake and run no real timers). A run whose steps
 * waited 33 s on a 10 s deadline had a blocked loop; this record says so with numbers.
 */

import { monitorEventLoopDelay } from "node:perf_hooks";
import type { KnowledgeHostLag } from "../knowledgeProtocol";

/** The slice of `IntervalHistogram` this reads (nanoseconds). */
export interface LagHistogram {
  enable(): boolean;
  disable(): boolean;
  readonly max: number;
  readonly mean: number;
  percentile(p: number): number;
  /** Restart the sampling window (clear the cumulative counters). Optional — present on node's `IntervalHistogram`. */
  reset?(): void;
}
export type LagSampler = (opts: { resolution: number }) => LagHistogram;

const NS_PER_MS = 1e6;
const SAMPLE_RESOLUTION_MS = 20;

export interface HostLagMonitor {
  /** The stall so far, in whole ms; undefined when nothing was sampled. */
  read(): KnowledgeHostLag | undefined;
  /** Restart the sampling window, so the next `read` is not polluted by earlier stalls. */
  reset(): void;
  stop(): void;
}

export function startHostLag(sampler: LagSampler = monitorEventLoopDelay as LagSampler): HostLagMonitor {
  let histogram: LagHistogram | undefined;
  try {
    histogram = sampler({ resolution: SAMPLE_RESOLUTION_MS });
    histogram.enable();
  } catch {
    histogram = undefined;
  }
  const ms = (ns: number): number => (Number.isFinite(ns) ? Math.round(ns / NS_PER_MS) : 0);
  const reset = (): void => { try { histogram?.reset?.(); } catch { /* sampling is best effort */ } };
  return {
    read: () => (histogram ? { maxMs: ms(histogram.max), p99Ms: ms(histogram.percentile(99)), meanMs: ms(histogram.mean) } : undefined),
    reset,
    stop: () => { try { histogram?.disable(); } catch { /* sampling is best effort */ } },
  };
}
