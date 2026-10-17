import { describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/database/tenantScope', () => ({
  // Task 7 belongs to the host's tenant; anything else does not.
  taskInTenant: vi.fn(async (_db: unknown, taskId: number) => taskId === 7),
}));

import { eventsOf, ingestFileChanges, toolAuditRows, usageSnapshotRows } from './hostTelemetryIngest';
import { FileChangeIngestBody, ToolAuditIngestBody } from '../../presentation/routes/agentHostRoutes.schemas';
import type { Db } from '../../infrastructure/database/connection';

const host = { tenantId: 3, agentHostId: 11 };

function fakeDb(ownedExecutions: Array<{ id: number; taskId: number }>) {
  const inserts: unknown[][] = [];
  const db = {
    select: () => ({ from: () => ({ where: async () => ownedExecutions }) }),
    insert: () => ({ values: async (rows: unknown[]) => { inserts.push(rows); } }),
  };
  return { db: db as unknown as Db, inserts };
}

describe('host telemetry wire shapes', () => {
  it('accepts the single-event body every host in the field sends', () => {
    const body = ToolAuditIngestBody.parse({ toolName: 'read_file', executionId: '42', type: 'tool.audit' });
    expect(eventsOf(body)).toEqual({ events: [{ toolName: 'read_file', executionId: '42' }], single: true });
  });

  it('accepts a batch and drops only its malformed events', () => {
    const body = ToolAuditIngestBody.parse({ events: [{ toolName: 'a' }, { toolName: 5 }, { toolName: 'b' }] });
    expect(eventsOf(body)).toEqual({ events: [{ toolName: 'a' }, { toolName: 'b' }], single: false });
  });

  it('an empty file-change body is still one (invalid) event', () => {
    expect(eventsOf(FileChangeIngestBody.parse({})).single).toBe(true);
  });
});

describe('host telemetry rows', () => {
  it('tool audit: stamps the host tenant, drops nameless events', () => {
    const rows = toolAuditRows(host, [{ toolName: 'a', executionId: '9', args: { x: 1 } }, { toolName: null }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: 3, agentHostId: 11, executionId: 9, toolName: 'a', args: '{"x":1}' });
  });

  it('usage snapshot: counters default to 0', () => {
    expect(usageSnapshotRows(host, [{}])[0]).toMatchObject({ sessionKey: 'default', inputTokens: 0, compactionCount: 0 });
  });

  it('file changes: one multi-row insert; foreign task / execution events are refused', async () => {
    const { db, inserts } = fakeDb([{ id: 100, taskId: 7 }]);
    const { inserted, rejected } = await ingestFileChanges(db, host, [
      { taskId: 7, executionId: 100, path: 'a.ts', change: 'created' },
      { taskId: 7, executionId: 100, path: 'b.ts' },
      { taskId: 8, executionId: 100, path: 'c.ts' },
      { taskId: 7, executionId: 200, path: 'd.ts' },
      { taskId: 7, executionId: 100 },
    ]);
    expect(inserted).toBe(2);
    expect(rejected).toEqual([null, null, 'task', 'execution', 'invalid']);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual([
      { tenantId: 3, taskId: 7, executionId: 100, path: 'a.ts', change: 'created', agent: 'agent' },
      { tenantId: 3, taskId: 7, executionId: 100, path: 'b.ts', change: 'modified', agent: 'agent' },
    ]);
  });
});
