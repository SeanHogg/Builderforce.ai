import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  configureCaughtErrorReporter,
  reportCaughtError,
  reportUnhandledError,
  resetCaughtErrorReporterForTests,
  runWithCaughtErrorContext,
  updateCaughtErrorContext,
} from './caughtErrorReporter';

afterEach(() => {
  resetCaughtErrorReporterForTests();
  vi.restoreAllMocks();
});

describe('caughtErrorReporter', () => {
  it('delivers handled errors with request and tenant context through waitUntil', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sink = vi.fn(async () => undefined);
    const pending: Promise<unknown>[] = [];
    configureCaughtErrorReporter(sink);

    runWithCaughtErrorContext({
      env: { test: true },
      method: 'POST',
      path: '/api/tasks',
      waitUntil: (task) => pending.push(task),
    }, () => {
      updateCaughtErrorContext({ tenantId: 42, userId: 'user-1' });
      reportCaughtError(new Error('cache unavailable'), {
        source: 'application/cache',
        operation: 'invalidate',
      });
    });

    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'cache unavailable',
        source: 'application/cache',
        operation: 'invalidate',
        handled: true,
      }),
      expect.objectContaining({
        tenantId: 42,
        userId: 'user-1',
        method: 'POST',
        path: '/api/tasks',
      }),
    );
  });

  it('awaits the same sink for unhandled errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sink = vi.fn(async () => undefined);
    configureCaughtErrorReporter(sink);

    await reportUnhandledError(new Error('boom'), {
      source: 'presentation/errorHandler',
      operation: 'request',
    }, {
      env: { test: true },
      method: 'GET',
      path: '/api/fail',
    });

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom', handled: false }),
      expect.objectContaining({ path: '/api/fail' }),
    );
  });

  it('does not recurse when the reporting sink fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    configureCaughtErrorReporter(async () => {
      throw new Error('sink offline');
    });

    await reportUnhandledError(new Error('original'), {
      source: 'test',
      operation: 'failure',
    }, { env: {} });

    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(consoleError.mock.calls[1]?.[0]).toBe('[caught-error:reporting-failed]');
  });

  it('redacts secrets before context reaches logs or durable sinks', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sink = vi.fn(async () => undefined);
    configureCaughtErrorReporter(sink);

    await reportUnhandledError(new Error('provider failed'), {
      source: 'test',
      operation: 'redaction',
      context: {
        authorization: 'Bearer private',
        nested: { apiKey: 'private-key', provider: 'github' },
      },
    }, { env: {} });

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          authorization: '[REDACTED]',
          nested: { apiKey: '[REDACTED]', provider: 'github' },
        },
      }),
      expect.anything(),
    );
  });
});
