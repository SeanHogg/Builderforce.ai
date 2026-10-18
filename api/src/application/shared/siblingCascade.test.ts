import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { executionClaims, toolAuditEvents } from '../../infrastructure/database/schema';
import { cascadeAgentHostDelete, cascadeSegmentDelete, cascadeTenantDelete } from './siblingCascade';

function sqlOf(item: unknown): string {
  if (!item || typeof item !== 'object') return String(item);
  const o = item as { toSQL?: () => { sql: string }; queryChunks?: unknown[]; q?: unknown; value?: unknown };
  if (typeof o.toSQL === 'function') {
    try {
      const r = o.toSQL();
      if (r && typeof r.sql === 'string') return r.sql;
    } catch { /* sql`` fragments throw; fall through to chunks */ }
  }
  if (o.q !== undefined) return sqlOf(o.q);
  if (Array.isArray(o.queryChunks)) {
    return o.queryChunks.map((c) => (typeof c === 'string' ? c : sqlOf(c))).join('');
  }
  if (o.value !== undefined) return String(o.value);
  return String(item);
}

function fakeDb() {
  const batches: unknown[][] = [];
  const db = {
    execute: (q: unknown) => ({ kind: 'execute', q }),
    delete: (table: unknown) => ({
      where: (w: unknown) => ({ kind: 'delete', table, w }),
    }),
    update: (table: unknown) => ({
      set: (v: unknown) => ({
        where: (w: unknown) => ({ kind: 'update', table, v, w }),
      }),
    }),
    batch: async (items: unknown[]) => {
      batches.push(items);
    },
  };
  return { db: db as unknown as Db, batches };
}

describe('siblingCascade retention gate', () => {
  it('SET LOCALs then deletes claims (unblocking the trail) on tenant erasure', async () => {
    const { db, batches } = fakeDb();
    await cascadeTenantDelete(db, 7);
    expect(batches).toHaveLength(1);
    expect(sqlOf(batches[0]![0])).toMatch(/SET LOCAL app\.retention = 'on'/);
    expect(batches[0]!.some((item) => (item as { table?: unknown }).table === executionClaims)).toBe(true);
    expect(batches[0]!.some((item) => (item as { table?: unknown }).table === toolAuditEvents)).toBe(true);
  });

  it('SET LOCALs on host teardown but still skips cited events', async () => {
    const { db, batches } = fakeDb();
    await cascadeAgentHostDelete(db, 7, 3);
    expect(batches).toHaveLength(1);
    expect(sqlOf(batches[0]![0])).toMatch(/SET LOCAL app\.retention = 'on'/);
    expect(batches[0]!.some((item) => (item as { table?: unknown }).table === executionClaims)).toBe(false);
  });

  it('SET LOCALs on segment erasure but still skips cited events', async () => {
    const { db, batches } = fakeDb();
    await cascadeSegmentDelete(db, { tenantId: 7, segmentId: 'seg', executionIds: [1], agentHostIds: [2] });
    expect(batches).toHaveLength(1);
    expect(sqlOf(batches[0]![0])).toMatch(/SET LOCAL app\.retention = 'on'/);
    expect(batches[0]!.some((item) => (item as { table?: unknown }).table === executionClaims)).toBe(false);
  });
});
