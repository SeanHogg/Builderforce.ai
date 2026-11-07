import { describe, expect, it } from 'vitest';
import { runPreemptingJudge } from './reviewRunLock.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('the review lock around the judge pass (PRD 41 A10)', () => {
    it('hands the lock back before judging, and a new review of the root stops that pass and waits for it to end', async () => {
        const log: string[] = [];
        let stopped = false;
        const first = runPreemptingJudge('root', async (h) => {
            log.push('map');
            h.release();
            h.judging(() => { stopped = true; });
            // The judge pass: runs until it is stopped, then ends (its unjudged files stay owed).
            while (!stopped) await tick();
            log.push('judge stopped');
            return 'first';
        });
        await tick();
        const second = runPreemptingJudge('root', async (h) => {
            log.push('second map');
            h.release();
            return 'second';
        });
        expect(await second).toBe('second');
        expect(await first).toBe('first');
        // The new review started only after the old run (judge pass and all) had ended.
        expect(log).toEqual(['map', 'judge stopped', 'second map']);
    });

    it('serializes two reviews that never reach a judge pass, and a failure does not hold the lock', async () => {
        const order: string[] = [];
        const a = runPreemptingJudge('r2', async () => { order.push('a1'); await tick(); order.push('a2'); throw new Error('boom'); });
        const b = runPreemptingJudge('r2', async () => { order.push('b'); return 'ok'; });
        await expect(a).rejects.toThrow('boom');
        expect(await b).toBe('ok');
        expect(order).toEqual(['a1', 'a2', 'b']);
    });

    it('reviews of different roots do not wait for each other', async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const slow = runPreemptingJudge('x', async () => { await gate; return 1; });
        expect(await runPreemptingJudge('y', async () => 2)).toBe(2);
        release();
        expect(await slow).toBe(1);
    });
});
