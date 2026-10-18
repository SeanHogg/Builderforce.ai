import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { OP_HANDLERS } from './containerOps';
const snapshot = { version: 1, id: '7568a9b0-2cb0-4a1a-8e42-97c26bf63e19', capturedAt: '2026-10-18T12:00:00.000Z',
  source: { commit: null, branch: 'main', dirty: false }, tools: ['dependency-cruiser', 'jscpd', 'knip'].map((name) => ({ name, version: '1', status: 'complete' })), nodes: ['src/a.ts'], edges: [], issues: [] };
describe('execution-bound analyzer upload', () => {
  it('rejects malformed artifacts before touching the database', async () => {
    const update = vi.fn();
    expect(await OP_HANDLERS.audit_analysis!({ db: { update }, args: { snapshot: {} } } as never)).toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });
  it('binds the write to the authenticated tenant, project, execution and unfinished run', async () => {
    let params: unknown[] = [];
    const db = { update: () => ({ set: () => ({ where: (condition: any) => {
      params = new PgDialect().sqlToQuery(condition).params;
      return { returning: async () => [{ id: 'run' }] };
    } }) }) };
    expect(await OP_HANDLERS.audit_analysis!({ db, args: { snapshot }, tenantId: 7, projectId: 42, executionId: 123 } as never)).toEqual({ status: 200, body: { ok: true } });
    expect(params).toEqual([7, 42, 123, 'completed']);
  });
});
