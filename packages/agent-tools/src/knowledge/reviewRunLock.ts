/**
 * knowledge/reviewRunLock.ts — one review of a root at a time, with the background judge pass kept OFF the lock (PRD 41 A10).
 *
 * Reviews of one root run one at a time (a later run waits for the earlier one): a run's provisional-card cleanup and graph upsert
 * would otherwise drop the cards of another run still in flight on the same root's index. But pass 2 (judging) is background work
 * after the map is complete, and a person who presses Re-review must not wait behind up to hundreds of model calls. So:
 *
 *   - a run hands the lock back (`release`) as soon as its map is complete, before it judges;
 *   - it registers its judge pass (`judging`), which a NEW review of the same root stops first — the files that pass left unjudged stay
 *     owed — and waits for the old run to finish completely (its cleanup included) before the new one takes the lock.
 */

import { serialisedByKey } from './serialisedByKey.js';

/** What a run does with the lock around its judge pass. */
export interface RunHandoff {
    /** The map is complete: give the root’s lock to the next review. */
    release(): void;
    /** Registers the judge pass that is about to run, with the way to stop it. */
    judging(stop: () => void): void;
}

const passes = new Map<string, { stop: () => void; done: Promise<void> }>();

/** Runs `start` under the root’s lock after stopping (and waiting out) the root’s running judge pass. */
export async function runPreemptingJudge<T>(rootId: string, start: (handoff: RunHandoff) => Promise<T>): Promise<T> {
    const running = passes.get(rootId);
    if (running) {
        running.stop();
        await running.done;
    }
    let result!: Promise<T>;
    const lock = serialisedByKey(rootId, () => new Promise<void>((release) => {
        // `done` settles when the whole run has ended; it exists before the run starts, so a run may register its judge pass at once.
        let finish!: () => void;
        const done = new Promise<void>((r) => { finish = r; });
        const handoff: RunHandoff = {
            release,
            judging: (stop) => { passes.set(rootId, { stop, done }); },
        };
        result = start(handoff);
        // A run that ends (or fails) without a judge pass releases the lock when it ends.
        const ended = (): void => { release(); finish(); if (passes.get(rootId)?.done === done) passes.delete(rootId); };
        result.then(ended, ended);
    }));
    await lock;
    return result;
}
