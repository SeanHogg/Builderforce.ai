import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  configureCaughtErrorReporter,
  reportCaughtError,
  reportUnhandledError,
  resetCaughtErrorReporterForTests,
} from './caughtErrorReporter';
import { runInRequestScope, updateRequestScope } from '../shared/requestScope';

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

    runInRequestScope({
      env: { test: true },
      method: 'POST',
      path: '/api/tasks',
      waitUntil: (task) => pending.push(task),
    }, () => {
      updateRequestScope({ tenantId: 42, userId: 'user-1' });
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

  it('never lets the raw error, its stack or its cause reach the log or the sink unredacted', async () => {
    const logged: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args); });
    const sink = vi.fn(async (_record: unknown) => undefined);
    configureCaughtErrorReporter(sink);
    const ghp = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
    const error = Object.assign(new Error(`clone failed with GITHUB_TOKEN=${ghp}`, { cause: new Error(`inner ${ghp}`) }), { code: 'E_CLONE' });

    await reportUnhandledError(error, { source: 'test', operation: 'raw-error' }, { env: {} });
    reportCaughtError(error, { source: 'test', operation: 'raw-error' });

    const record = sink.mock.calls[0]![0] as { error: Error & { code?: string }; message: string; stack: string | null };
    expect(record.error).not.toBe(error);
    expect(record.error.code).toBe('E_CLONE');
    expect(record.error.name).toBe('Error');
    const everything = JSON.stringify([logged, record.message, record.stack, record.error.message, record.error.stack, String(record.error.cause instanceof Error ? record.error.cause.message : record.error.cause)]);
    expect(everything).not.toContain(ghp);
    // The original is untouched for the caller that rethrows it.
    expect(error.message).toContain(ghp);
  });
});
