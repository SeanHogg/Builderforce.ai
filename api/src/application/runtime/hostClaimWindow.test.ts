import { describe, expect, it, vi } from 'vitest';
import { deliverWithinClaimWindow, HOST_CLAIM_WINDOW_MS } from './hostClaimWindow';

describe('deliverWithinClaimWindow', () => {
  it('has a bounded default claim window', () => {
    expect(HOST_CLAIM_WINDOW_MS).toBeGreaterThan(0);
    expect(HOST_CLAIM_WINDOW_MS).toBeLessThanOrEqual(30_000);
  });

  it('returns true when the host acks inside the window and does not withdraw', async () => {
    const onTimeout = vi.fn(async () => undefined);
    const ok = await deliverWithinClaimWindow(async () => true, { windowMs: 50, onTimeout });
    expect(ok).toBe(true);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('returns false when the host reports offline, without withdrawing', async () => {
    const onTimeout = vi.fn(async () => undefined);
    expect(await deliverWithinClaimWindow(async () => false, { windowMs: 50, onTimeout })).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('returns false when delivery throws', async () => {
    expect(await deliverWithinClaimWindow(async () => { throw new Error('relay down'); }, { windowMs: 50 })).toBe(false);
  });

  it('falls through (false) and withdraws the run when the host never acks', async () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn(async () => undefined);
      const pending = deliverWithinClaimWindow(() => new Promise<boolean>(() => undefined), { windowMs: 5_000, onTimeout });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toBe(false);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('regression: a withdraw that hangs forever does not hang the dispatch (bounded when there is no waitUntil)', async () => {
    vi.useFakeTimers();
    try {
      const pending = deliverWithinClaimWindow(() => new Promise<boolean>(() => undefined), {
        windowMs: 1_000,
        withdrawTimeoutMs: 2_000,
        onTimeout: () => new Promise<unknown>(() => undefined),
      });
      await vi.advanceTimersByTimeAsync(1_000 + 2_000);
      expect(await pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('regression: with a waitUntil the withdraw is backgrounded and never awaited', async () => {
    vi.useFakeTimers();
    try {
      const handed: Promise<unknown>[] = [];
      const pending = deliverWithinClaimWindow(() => new Promise<boolean>(() => undefined), {
        windowMs: 1_000,
        waitUntil: (p) => { handed.push(p); },
        onTimeout: () => new Promise<unknown>(() => undefined),
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toBe(false);
      expect(handed).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failing withdraw does not turn a timeout into an error', async () => {
    vi.useFakeTimers();
    try {
      const pending = deliverWithinClaimWindow(() => new Promise<boolean>(() => undefined), {
        windowMs: 1_000,
        onTimeout: async () => { throw new Error('cancel failed'); },
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
