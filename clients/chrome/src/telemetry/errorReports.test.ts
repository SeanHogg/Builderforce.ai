import { describe, expect, it } from 'vitest';
import { createMemoryOutboxStore, createOnlineSignal } from '@builderforce/write-outbox';
import { createErrorReports, REPORT_LANE } from './errorReports';
import type { ClientErrorEvent } from './errorEvents';

const event = (): ClientErrorEvent => ({
  type: 'Error',
  message: 'boom',
  stack: null,
  level: 'error',
  operation: 'test',
  timestamp: '2026-01-01T00:00:00.000Z',
  context: {},
});

describe('error-reports telemetry stamp', () => {
  it('drops a transient 500 instead of retaining it or dead-lettering it', async () => {
    const reports = createErrorReports({
      api: {
        request: async () => {
          throw Object.assign(new Error('HTTP 500'), { status: 500 });
        },
        raw: async () => ({ status: 500, body: null }),
      },
      store: createMemoryOutboxStore(),
      online: createOnlineSignal(true),
      scope: () => 'tenant:1',
    });
    reports.enqueue(REPORT_LANE, event());
    await reports.flush();
    expect(reports.size()).toBe(0);
    expect(reports.exportDeadLetters()).toEqual([]);
    expect(reports.stats().dropped).toBeGreaterThan(0);
    expect(reports.stats().deadLetters).toBe(0);
    reports.close();
  });
});
