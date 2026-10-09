import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeoutError, withTimeout } from './withTimeout';

describe('withTimeout', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('answers with the promise when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve('app'), 1_000)).resolves.toBe('app');
    await expect(withTimeout(Promise.reject(new Error('refused')), 1_000)).rejects.toThrow('refused');
  });

  it('rejects with a TimeoutError when the promise never settles', async () => {
    vi.useFakeTimers();
    const waiting = withTimeout(new Promise<never>(() => undefined), 30_000);
    vi.advanceTimersByTime(30_000);
    await expect(waiting).rejects.toBeInstanceOf(TimeoutError);
  });
});
