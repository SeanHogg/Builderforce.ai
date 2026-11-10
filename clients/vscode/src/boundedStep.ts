/**
 * A setup step that may not outlast a deadline. The first of: the step's value, a failure
 * (propagated as the step threw it, or handed to `onFail`), or the deadline (reported to `onTimeout`
 * with the elapsed ms, and the `fallback` returned). A step that settles after its deadline is dropped
 * and, if it rejects, that rejection is swallowed (never an unhandled rejection).
 */

const TIMED_OUT = Symbol("timed-out");

export interface BoundedStepOptions<T> {
  /** Value to continue with when the deadline passes (or the step fails and `onFail` is set). */
  fallback: T;
  /** Called with the elapsed ms when the deadline passes. */
  onTimeout?: (elapsedMs: number) => void;
  /** When set, a failure is handed here and the fallback returned; otherwise a failure rejects as thrown. */
  onFail?: (error: unknown, elapsedMs: number) => void;
}

/**
 * A setup step that yields to an abort signal: the step's value, or the signal's reason the moment it aborts (an aborted
 * signal rejects at once). The step itself runs on; its late rejection is swallowed.
 */
export function untilAborted<T>(step: Promise<T>, signal: AbortSignal): Promise<T> {
  step.catch(() => undefined);
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    step.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

export async function boundedStep<T>(work: () => Promise<T>, ms: number, options: BoundedStepOptions<T>): Promise<T> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); timer.unref?.(); });
  const running = Promise.resolve().then(work);
  // Attached up front so a rejection after the deadline is handled.
  running.catch(() => undefined);
  try {
    const result = await Promise.race([running, deadline]);
    if (result === TIMED_OUT) {
      options.onTimeout?.(Date.now() - started);
      return options.fallback;
    }
    return result;
  } catch (error) {
    if (!options.onFail) throw error;
    options.onFail(error, Date.now() - started);
    return options.fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
