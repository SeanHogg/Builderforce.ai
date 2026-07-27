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

import { persistCaughtError } from './persistCaughtError';

describe('persistCaughtError', () => {
  beforeEach(() => {
    values.mockClear();
    captureException.mockClear();
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
      tenantId: 7,
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
});
