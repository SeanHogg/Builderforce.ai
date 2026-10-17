import { beforeEach, describe, expect, it, vi } from 'vitest';

const values = vi.fn(async () => undefined);
const captureException = vi.fn(async () => true);

vi.mock('../database/connection', () => ({
  buildTransactionalDatabase: () => ({
    insert: () => ({ values }),
  }),
}));

vi.mock('@seanhogg/builderforce-quality/server', () => ({
  createServerCapture: () => ({ captureException }),
}));

// Stand-in for the L1+KV read-through cache: a key's loader runs once until cleared.
const cachedKeys = new Set<string>();
vi.mock('../cache/readThroughCache', () => ({
  getOrSetCached: async (_env: unknown, key: string, loader: () => Promise<unknown>) => {
    if (cachedKeys.has(key)) return 1;
    cachedKeys.add(key);
    return loader();
  },
}));

import { persistCaughtError, qualityForwardKey } from './persistCaughtError';

describe('persistCaughtError', () => {
  beforeEach(() => {
    values.mockClear();
    captureException.mockClear();
    cachedKeys.clear();
  });

  it('writes tenant-aware context and forwards the same error to Product Quality', async () => {
    const error = new Error('cache unavailable');
    await persistCaughtError({
      error,
      message: error.message,
      stack: error.stack ?? null,
      source: 'application/cache',
      operation: 'invalidate',
      context: { cacheKey: 'task:42' },
      level: 'warning',
      handled: true,
    }, {
      env: {
        NEON_DATABASE_URL: 'postgres://test',
        BUILDERFORCE_ERROR_API_KEY: 'bfq_test',
        INTERNAL_API_BASE_URL: 'https://api.example.test',
        ENVIRONMENT: 'test',
      },
      tenantId: 7,
      userId: 'user-1',
      method: 'PATCH',
      path: '/api/tasks/42',
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      scopeTenantId: 7,
      source: 'application/cache',
      operation: 'invalidate',
      handled: true,
      context: { cacheKey: 'task:42' },
      message: 'cache unavailable',
    }));
    expect(captureException).toHaveBeenCalledWith(error, expect.objectContaining({
      level: 'warning',
      userKey: 'user-1',
      tags: expect.objectContaining({
        handled: 'true',
        tenantId: '7',
        source: 'application/cache',
        operation: 'invalidate',
      }),
    }));
  });

  it('isolates a failed database sink from Product Quality', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    values.mockRejectedValueOnce(new Error('database offline'));

    await persistCaughtError({
      error: new Error('original'),
      message: 'original',
      stack: null,
      source: 'test',
      operation: 'isolation',
      context: {},
      level: 'error',
      handled: true,
    }, {
      env: {
        NEON_DATABASE_URL: 'postgres://test',
        BUILDERFORCE_ERROR_API_KEY: 'bfq_test',
      },
    });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      '[caught-error:sink-failed]',
      expect.objectContaining({ sink: 'api_error_log' }),
    );
    consoleError.mockRestore();
  });

  const recurring = (message: string, source = 'application/cron') => ({
    error: new Error(message), message, stack: null, source, operation: 'tick',
    context: {}, level: 'error' as const, handled: true,
  });
  const runtime = { env: { NEON_DATABASE_URL: 'postgres://test', BUILDERFORCE_ERROR_API_KEY: 'bfq_test' } };

  it('logs every occurrence but forwards a recurring error to Quality once per window', async () => {
    await persistCaughtError(recurring('task 41 failed after 3012ms'), runtime);
    await persistCaughtError(recurring('task 97 failed after 2ms'), runtime);
    await persistCaughtError(recurring('task 41 failed after 3012ms'), runtime);

    expect(values).toHaveBeenCalledTimes(3);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('forwards a different error in the same window', async () => {
    await persistCaughtError(recurring('connection reset'), runtime);
    await persistCaughtError(recurring('quota exceeded'), runtime);
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it("never forwards the cache module's own faults (gating them on the cache would recurse)", async () => {
    await persistCaughtError(recurring('kv down', 'infrastructure/cache/readThroughCache.ts'), runtime);
    expect(values).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('folds digit runs so ids and timings do not mint a new fingerprint', () => {
    const base = { source: 's', operation: 'o', handled: true };
    expect(qualityForwardKey({ ...base, message: 'row 12 took 40ms' }))
      .toBe(qualityForwardKey({ ...base, message: 'row 9001 took 7ms' }));
    expect(qualityForwardKey({ ...base, message: 'x' })).not.toBe(qualityForwardKey({ ...base, handled: false, message: 'x' }));
  });
});
