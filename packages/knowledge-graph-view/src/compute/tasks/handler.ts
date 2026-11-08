/**
 * What a task handler is: given the store and the request, an {@link IdleTask} that yields the raw answer. A handler that
 * can be sliced (the layouts, the ranking) steps; the rest are {@link once}. The worker drives a task to the end and yields
 * between steps (so a cancel gets in); the in-process fallback hands it to the idle scheduler.
 */

import type { IdleTask } from '../../useIdleSteps';
import type { ComputeStore } from '../store';
import type { TaskKind, TaskTable } from '../protocol';

export type Handler<K extends TaskKind> = (store: ComputeStore, req: TaskTable[K]['req']) => IdleTask<TaskTable[K]['raw']>;

/** A task of one step. The work happens in `step()`, so scheduling it is what pays for it. */
export function once<T>(compute: () => T): IdleTask<T> {
    let value: T | undefined;
    let done = false;
    return {
        step() { value = compute(); done = true; return true; },
        result() {
            if (!done) throw new Error('once: result() read before step() returned true');
            return value as T;
        },
    };
}
