import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrSetClientCached, invalidateClientCache, readClientCached } from './readThrough';

describe('client read-through cache', () => {
  beforeEach(() => invalidateClientCache('test:'));

  it('coalesces concurrent reads and retains the resolved value', async () => {
    const load = vi.fn(async () => ({ value: 7 }));
    const [a, b] = await Promise.all([
      getOrSetClientCached('test:item', load),
      getOrSetClientCached('test:item', load),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(readClientCached('test:item')).toBe(a);
  });

  it('expires values according to each caller TTL', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => load.mock.calls.length);
    expect(await getOrSetClientCached('test:ttl', load, { ttlMs: 30_000 })).toBe(1);
    vi.advanceTimersByTime(30_001);
    expect(await getOrSetClientCached('test:ttl', load, { ttlMs: 30_000 })).toBe(2);
    vi.useRealTimers();
  });

  it('invalidates namespaces and retries failed loads', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('ok');
    await expect(getOrSetClientCached('test:group:a', load)).rejects.toThrow('offline');
    expect(await getOrSetClientCached('test:group:a', load)).toBe('ok');
    invalidateClientCache('test:group:');
    expect(readClientCached('test:group:a')).toBeUndefined();
  });
});
