/**
 * knowledge/yieldLoop.ts — cooperative yielding for the long synchronous loops of the code pack's conversion
 * (`repoGraphToExtracted`, `analysisToExtracted`: one hash per file node, tens of thousands of files).
 *
 * The code pack runs in a worker where the host has one (the VS Code extension's L3 worker); where it does not (a web host,
 * the in-thread fallback), a loop that never yields holds the thread for seconds. {@link mapYielding} hands the event loop a
 * macrotask every {@link YIELD_EVERY} items and looks at the caller's signal at each one.
 *
 * Pure of host APIs (`setTimeout` exists on every surface). Worker-safe.
 */

/** Items between two yields. */
export const YIELD_EVERY = 500;

/** One macrotask: timers, I/O and input get a turn. */
export const yieldToEventLoop = (): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

/**
 * `items.map(fn)`, yielding every {@link YIELD_EVERY} items. Resolves null when `signal` aborted at a yield (the work is
 * abandoned, nothing partial is returned). The result is identical to a plain map for a signal that never aborts.
 */
export async function mapYielding<T, U>(items: readonly T[], fn: (item: T, index: number) => U, signal?: AbortSignal): Promise<U[] | null> {
    const out: U[] = [];
    for (let i = 0; i < items.length; i++) {
        if (i > 0 && i % YIELD_EVERY === 0) {
            await yieldToEventLoop();
            if (signal?.aborted) return null;
        }
        out.push(fn(items[i]!, i));
    }
    return signal?.aborted ? null : out;
}
