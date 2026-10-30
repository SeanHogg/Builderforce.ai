/**
 * admitToolAuditRows - a host's batch is filtered, never failed: the cloud's own `run.outcome` row and rows naming an execution outside
 * the host's tenant are dropped; duplicates of a (legitimate) host event pass through (the unique index is scoped to cloud rows).
 */
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { admitToolAuditRows, toolAuditRows } from './hostTelemetryIngest';

const host = { tenantId: 4, agentHostId: 7 };
/** A db whose execution lookup answers with the ids this tenant owns. */
const dbOwning = (ids: number[]) => ({ select: () => ({ from: () => ({ where: async () => ids.map((id) => ({ id })) }) }) }) as never;

describe('admitToolAuditRows', () => {
  it('drops a forged run.outcome and a foreign executionId, keeps the rest - the batch never fails', async () => {
    const rows = toolAuditRows(host, [
      { toolName: 'read_file', executionId: 10 },
      { toolName: 'read_file', executionId: 99 }, // another tenant's execution
      { toolName: 'run.outcome', executionId: 10 }, // the cloud's row
      { toolName: 'list_files' }, // no execution
    ]);
    const admitted = await admitToolAuditRows(dbOwning([10]), host, rows);
    expect(admitted.map((r) => [r.toolName, r.executionId])).toEqual([['read_file', 10], ['list_files', null]]);
  });

  it('duplicate host events in one batch both pass (only the cloud row is unique)', async () => {
    const rows = toolAuditRows(host, [{ toolName: 'read_file', executionId: 10 }, { toolName: 'read_file', executionId: 10 }]);
    expect(await admitToolAuditRows(dbOwning([10]), host, rows)).toHaveLength(2);
  });

  it('needs no lookup when no row names an execution', async () => {
    const noLookup = { select: () => { throw new Error('should not query'); } } as never;
    expect(await admitToolAuditRows(noLookup, host, toolAuditRows(host, [{ toolName: 'list_files' }]))).toHaveLength(1);
  });

  it("admits only THIS host's runs: the ownership lookup is tenant AND agent host, so a cloud run (no host) cannot take a forged run.finished", async () => {
    let where: SQL | undefined;
    const db = { select: () => ({ from: () => ({ where: async (w: SQL) => { where = w; return [{ id: 10 }]; } }) }) } as never;
    const rows = toolAuditRows(host, [{ toolName: 'run.finished', executionId: 10 }, { toolName: 'run.finished', executionId: 11 }]);
    const admitted = await admitToolAuditRows(db, host, rows);
    expect(admitted.map((r) => r.executionId)).toEqual([10]); // 11 is not the host's run (a cloud run, or another host's)
    const { sql: rendered, params } = new PgDialect().sqlToQuery(where!);
    expect(rendered).toContain('"tenant_id"');
    expect(rendered).toContain('"agent_host_id"');
    expect(params).toContain(7);
  });
});
