import { describe, expect, it } from 'vitest';

import { ingestFileChanges, toolAuditRows, usageSnapshotRows } from './hostTelemetryIngest';
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

describe('host telemetry rows', () => {
  it('tool audit: stamps the host tenant, drops nameless events', () => {
    const rows = toolAuditRows(host, [{ toolName: 'a', executionId: '9', args: { x: 1 } }, { toolName: null }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: 3, agentHostId: 11, executionId: 9, toolName: 'a', args: '{"x":1}' });
  });

  it('usage snapshot: counters default to 0', () => {
    expect(usageSnapshotRows(host, [{}])[0]).toMatchObject({ sessionKey: 'default', inputTokens: 0, compactionCount: 0 });
  });

  it('file changes: one multi-row insert; an execution that is not this host's, or is another task's, is refused', async () => {
    const { db, inserts } = fakeDb([{ id: 100, taskId: 7 }]);
    const { inserted, rejected } = await ingestFileChanges(db, host, [
      { taskId: 7, executionId: 100, path: 'a.ts', change: 'created' },
      { taskId: 7, executionId: 100, path: 'b.ts' },
      { taskId: 8, executionId: 100, path: 'c.ts' },
      { taskId: 7, executionId: 200, path: 'd.ts' },
      { taskId: 7, executionId: 100 },
    ]);
    expect(inserted).toBe(2);
    expect(rejected).toEqual([null, null, 'execution', 'execution', 'invalid']);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual([
      { tenantId: 3, taskId: 7, executionId: 100, path: 'a.ts', change: 'created', agent: 'agent' },
      { tenantId: 3, taskId: 7, executionId: 100, path: 'b.ts', change: 'modified', agent: 'agent' },
    ]);
  });
});
