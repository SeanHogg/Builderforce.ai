/**
 * ONE extension-host event-loop stall monitor, installed at activation.
 *
 * The webview → extension-host bridge answers on the host's event loop. When a heavy
 * synchronous task (a local-first bind, a knowledge load, a big JSON parse) blocks that
 * loop for seconds, the host cannot answer the webview's request, and the webview only
 * sees it as a `Request "<type>" timed out` — a symptom that named nothing. This monitor
 * samples the loop (reusing the same `perf_hooks.monitorEventLoopDelay` seam the review
 * lag probe uses, `reviewHostLag.ts`) and writes ONE line to the BuilderForce output
 * channel each time a stall crosses {@link STALL_THRESHOLD_MS}, so a slow host is visible
 * on the channel it can actually reach — the output channel, not the blocked webview.
 *
 * Pure apart from the lag sampler (a seam): no `vscode` here.
 */

import { startHostLag, type HostLagMonitor, type LagSampler } from "./knowledge/review/reviewHostLag";

/** A block longer than this is logged (whole ms). */
export const STALL_THRESHOLD_MS = 1_000;

export interface StallLogOptions {
  now?: () => number;
  /** One line per stall (the caller's `logLine`). */
  log: (line: string) => void;
  /** The event-loop sampler (default: node's); a seam for tests. */
  lagSampler?: LagSampler;
  /** The threshold in ms; tests may shorten it. Defaults to {@link STALL_THRESHOLD_MS}. */
  thresholdMs?: number;
}

export interface StallMonitor {
  /** The latest reading (whole ms), or undefined when nothing was sampled. */
  read(): { maxMs: number; p99Ms: number; meanMs: number } | undefined;
  /** Sample NOW and log if a new worst-stall crossed the threshold (the interval does this on its own; a test calls it directly). */
  sample(): void;
  dispose(): void;
}

/**
 * Starts ONE loop monitor. While it runs, every block of the event loop longer than
 * `thresholdMs` is logged as one `extension host stalled …` line, with the worst block
 * so far. Returns the monitor; `dispose()` stops sampling.
 */
export function startStallMonitor(opts: StallLogOptions): StallMonitor {
  const thresholdMs = opts.thresholdMs ?? STALL_THRESHOLD_MS;
  const lag: HostLagMonitor = startHostLag(opts.lagSampler);
  let lastLoggedMax = 0;

  const tick = (): void => {
    const read = lag.read();
    if (read && read.maxMs >= thresholdMs && read.maxMs > lastLoggedMax) {
      // Log once per stall, not every sample, so a sustained block does not spam the
      // channel. node:perf_hooks' histogram is cumulative since enable(), so without a
      // reset the monitor would only ever log strictly-larger worst-stalls; restart the
      // window to arm the next, even smaller, stall.
      lastLoggedMax = read.maxMs;
      opts.log(
        `extension host stalled: ${read.maxMs}ms block (p99 ${read.p99Ms}ms) — the webview may see "Request timed out" while the host is busy`,
      );
      lag.reset();
    }
    if (read && read.maxMs < thresholdMs) lastLoggedMax = 0;
  };

  // Sample on an interval that itself rides the loop: a blocked loop delays the sample,
  // so the histogram's `max` grows past the threshold only when a real stall happened.
  const timer = setInterval(tick, Math.max(250, Math.floor(thresholdMs / 2)));

  return {
    read: () => lag.read(),
    sample: tick,
    dispose: () => {
      clearInterval(timer);
      lag.stop();
    },
  };
}
