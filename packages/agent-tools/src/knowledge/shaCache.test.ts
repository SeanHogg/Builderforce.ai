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

    it('expires an entry after its lifetime, whether the cache or the verdict set it', async () => {
        let t = 0;
        const cache = createShaCache<number>({ ttlMs: 100, now: () => t, keep: (v) => (v === 2 ? 10 : true) });
        const work = vi.fn(async () => 1);
        await cache.getOrRun('k', work);
        t = 99;
        await cache.getOrRun('k', work);
        expect(work).toHaveBeenCalledTimes(1);
        t = 101;
        await cache.getOrRun('k', work);
        expect(work).toHaveBeenCalledTimes(2);

        const short = vi.fn(async () => 2);
        await cache.getOrRun('s', short);
        t = 120;
        await cache.getOrRun('s', short);
        expect(short).toHaveBeenCalledTimes(1);
        t = 135;
        await cache.getOrRun('s', short);
        expect(short).toHaveBeenCalledTimes(2);
    });

    it('stops a shared run only when EVERY asker has stopped', async () => {
        const cache = createShaCache<number>();
        let seen: AbortSignal | undefined;
        let release!: (v: number) => void;
        const work = vi.fn((signal?: AbortSignal) => { seen = signal; return new Promise<number>((r) => { release = r; }); });
        const a = new AbortController(), b = new AbortController();
        const first = cache.getOrRun('k', work, a.signal);
        const second = cache.getOrRun('k', work, b.signal);
        expect(work).toHaveBeenCalledTimes(1);
        a.abort();
        expect(seen?.aborted).toBe(false);
        b.abort();
        expect(seen?.aborted).toBe(true);
        release(5);
        expect(await Promise.all([first, second])).toEqual([5, 5]);
    });

    it('an asker without a signal keeps the shared run alive', async () => {
        const cache = createShaCache<number>();
        let seen: AbortSignal | undefined;
        let release!: (v: number) => void;
        const work = (signal?: AbortSignal) => { seen = signal; return new Promise<number>((r) => { release = r; }); };
        const a = new AbortController();
        const first = cache.getOrRun('k', work, a.signal);
        const second = cache.getOrRun('k', work);
        a.abort();
        expect(seen?.aborted).toBe(false);
        release(1);
        await Promise.all([first, second]);
    });
});
