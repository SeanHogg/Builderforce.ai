import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  configureCaughtErrorReporter,
  resetCaughtErrorReporterForTests,
  type CaughtErrorSink,
} from './caughtErrorReporter';
import { createDurableErrorReporter } from './durableErrorReporter';

afterEach(() => {
  resetCaughtErrorReporterForTests();
  vi.restoreAllMocks();
});

describe('createDurableErrorReporter', () => {
  it('delivers through the DO host waitUntil, which a bare report inside a DO cannot', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sink = vi.fn<CaughtErrorSink>(async () => undefined);
    configureCaughtErrorReporter(sink);

    const pending: Promise<unknown>[] = [];
    const env = { DATABASE_URL: 'postgres://test' };
    const report = createDurableErrorReporter(
      'infrastructure/relay/ExampleDO.ts',
      env,
      { waitUntil: (task) => { pending.push(task); } },
    );

    report(new Error('alarm handler failed'), { operation: 'alarm', context: { executionId: 7 } });

    // The whole point of the factory: the report is attached to the DO's lifetime
    // rather than dropped after its console line.
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'alarm handler failed',
        source: 'infrastructure/relay/ExampleDO.ts',
        operation: 'alarm',
        context: { executionId: 7 },
        handled: true,
      }),
      expect.objectContaining({ env }),
    );
  });

  it('stamps the bound source on every call site', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sink = vi.fn<CaughtErrorSink>(async () => undefined);
    configureCaughtErrorReporter(sink);

    const pending: Promise<unknown>[] = [];
    const report = createDurableErrorReporter('infrastructure/relay/OtherDO.ts', {}, {
      waitUntil: (task) => { pending.push(task); },
    });

    report(new Error('one'), { operation: 'fetch' });
    report(new Error('two'), { operation: 'cleanup', level: 'warning' });
    await Promise.all(pending);

    expect(sink.mock.calls.map(([record]) => record.source))
      .toEqual(['infrastructure/relay/OtherDO.ts', 'infrastructure/relay/OtherDO.ts']);
    expect(sink.mock.calls[1]?.[0].level).toBe('warning');
  });
});
