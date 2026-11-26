/**
 * For work that comes in steps: `start()` returns a task whose `step()` does one small unit
 * and returns true when finished. Steps run on idle callbacks (else `setTimeout(0)`), at most `SLICE_MS` of them per
 * callback, so a long computation (the 3D layout's relaxation passes) never blocks the UI thread for longer than
 * about one slice. Null until the task is done.
 *
 * A change of `deps` (or an unmount) cancels the running task: its pending callback is cancelled, its remaining steps
 * never run and its result is never applied. The old value is cleared when `deps` change, unless a `fallback` is given:
 * then the old value stays until the new one lands, and a task that throws (in `start()` or a step) settles on `fallback`
 * (logged with `console.error`) instead of staying null forever. `enabled = false` schedules nothing and yields null.
 */

import { useEffect, useState } from 'react';
import { scheduleIdle } from './idle';

/** The longest the UI thread is held per callback. */
export const SLICE_MS = 30;

export interface IdleTask<T> {
    step(): boolean;
    result(): T;
}

/**
 * Runs a task on idle callbacks, `SLICE_MS` of steps per callback: the ONE idle-step runner (the hook below, and the
 * compute client's in-process fallback). `onDone` gets the result; `onError` gets whatever `start`, a step or `onDone`
 * threw. Neither is called after the returned function (cancel) has been.
 */
export function runIdleTask<T>(start: () => IdleTask<T>, onDone: (value: T) => void, onError: (error: unknown) => void): () => void {
    let live = true;
    let cancel = (): void => undefined;
    let task: IdleTask<T> | null = null;
    const run = (): void => {
        if (!live) return;
        try {
            task ??= start();
            const t0 = Date.now();
            let done = false;
            do done = task.step(); while (!done && live && Date.now() - t0 < SLICE_MS);
            if (done) { if (live) onDone(task.result()); } else cancel = scheduleIdle(run);
        } catch (error) {
            if (live) onError(error);
        }
    };
    cancel = scheduleIdle(run);
    return () => { live = false; cancel(); };
}

export function useIdleSteps<T>(start: () => IdleTask<T>, deps: readonly unknown[], fallback?: T, enabled = true): T | null {
    const [value, setValue] = useState<T | null>(null);
    useEffect(() => {
        if (fallback === undefined || !enabled) setValue(null);
        if (!enabled) return undefined;
        return runIdleTask(start, setValue, (error) => {
            console.error('useIdleSteps: the task failed', error);
            if (fallback !== undefined) setValue(fallback);
        });
        // `start` closes over `deps`; callers list exactly what it reads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, enabled]);
    return value;
}
