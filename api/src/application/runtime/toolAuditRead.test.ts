import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ id: number; toolName: string }>,
  synthesize: vi.fn(),
  orderBy: vi.fn(),
}));

vi.mock('../shared/runTelemetryDatabase', () => ({
  runTelemetryDatabase: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: (o: unknown) => { mocks.orderBy(o); return { limit: async () => [...mocks.rows] }; },
        }),
      }),
    }),
  }),
}));
vi.mock('./toolAuditReadRepair', () => ({ synthesizeRunFailedEvent: mocks.synthesize }));

import { readToolAuditEvents } from './toolAuditRead';

const FAILED = { id: -1, toolName: 'run.failed' };

beforeEach(() => {
  mocks.rows = [{ id: 1, toolName: 'read_file' }, { id: 2, toolName: 'write_file' }];
  mocks.synthesize.mockReset();
  mocks.orderBy.mockReset();
});

describe('readToolAuditEvents — one read for cloud and host tool-audit', () => {
  it('puts a synthesized terminal failure LAST on an oldest-first (host) read', async () => {
    mocks.synthesize.mockResolvedValue(FAILED);
    const events = await readToolAuditEvents({} as never, 1, { kind: 'agentHost', agentHostId: 4 }, { limit: 10, order: 'oldest', executionId: 9 });
    expect(events.at(-1)).toBe(FAILED);
  });

  it('puts it FIRST on a newest-first (cloud) read', async () => {
    mocks.synthesize.mockResolvedValue(FAILED);
    const events = await readToolAuditEvents({} as never, 1, { kind: 'cloudAgent', ref: 'a1' }, { limit: 10, order: 'newest', executionId: 9 });
    expect(events[0]).toBe(FAILED);
  });

  it('skips the repair when the read is not scoped to one execution', async () => {
    const events = await readToolAuditEvents({} as never, 1, { kind: 'cloudAgent', ref: 'a1' }, { limit: 10, order: 'newest' });
    expect(mocks.synthesize).not.toHaveBeenCalled();
    expect(events).toHaveLength(2);
  });
});
