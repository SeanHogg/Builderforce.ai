import { describe, expect, it, vi } from 'vitest';
import { createShaCache } from './shaCache.js';

describe('the per-sha cache', () => {
    it('runs once per key and shares a run between concurrent askers', async () => {
        const cache = createShaCache<number>();
        const work = vi.fn(async () => 7);
        const [a, b] = await Promise.all([cache.getOrRun('sha1', work), cache.getOrRun('sha1', work)]);
        expect([a, b]).toEqual([7, 7]);
        await cache.getOrRun('sha1', work);
        expect(work).toHaveBeenCalledTimes(1);
        await cache.getOrRun('sha2', work);
        expect(work).toHaveBeenCalledTimes(2);
    });

    it('never caches an unidentifiable tree (null key)', async () => {
        const cache = createShaCache<number>();
        const work = vi.fn(async () => 1);
        await cache.getOrRun(null, work);
        await cache.getOrRun(null, work);
        expect(work).toHaveBeenCalledTimes(2);
        expect(cache.size).toBe(0);
    });

    it('drops a result it is told not to keep, and a failed run, so the next ask retries', async () => {
        const cache = createShaCache<number>({ keep: (v) => v > 0 });
        const work = vi.fn(async () => 0);
        await cache.getOrRun('k', work);
        await cache.getOrRun('k', work);
        expect(work).toHaveBeenCalledTimes(2);

        const failing = vi.fn(async (): Promise<number> => { throw new Error('boom'); });
        await expect(cache.getOrRun('f', failing)).rejects.toThrow('boom');
        await expect(cache.getOrRun('f', failing)).rejects.toThrow('boom');
        expect(failing).toHaveBeenCalledTimes(2);
    });

    it('evicts the oldest entry past its bound', async () => {
        const cache = createShaCache<number>({ max: 2 });
        const work = vi.fn(async () => 1);
        for (const k of ['a', 'b', 'c']) await cache.getOrRun(k, work);
        expect(cache.size).toBe(2);
        await cache.getOrRun('a', work);
        expect(work).toHaveBeenCalledTimes(4);
    });
});
