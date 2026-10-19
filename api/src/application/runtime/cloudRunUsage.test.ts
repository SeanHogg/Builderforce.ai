import { describe, expect, it } from 'vitest';
import { CLOUD_RUN_USAGE_LIMIT, readCloudRunUsage } from './cloudRunUsage';
import type { Db } from '../../infrastructure/database/connection';

/** A drizzle-shaped chain that records the limit and resolves canned ledger rows. */
function fakeDb(rows: Array<Record<string, unknown>>) {
  const seen: { limit?: number } = {};
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async (n: number) => { seen.limit = n; return rows; },
  };
  return { db: chain as unknown as Db, seen };
}

describe('readCloudRunUsage', () => {
  it('projects ledger rows into the usage_snapshots shape the trace consumers render', async () => {
    const createdAt = new Date('2026-10-01T00:00:00Z');
    const { db, seen } = fakeDb([{ id: 9, cloudAgentRef: 'agent-x', promptTokens: 100, completionTokens: 40, createdAt, metadata: { phase: 'verify' } }]);
    const [point] = await readCloudRunUsage(db, 3, 42);
    expect(point).toEqual({
      id: 9, tenantId: 3, agentHostId: null, cloudAgentRef: 'agent-x', executionId: 42, sessionKey: 'exec:42',
      inputTokens: 100, outputTokens: 40, contextTokens: 140, contextWindowMax: 0, compactionCount: 0,
      ts: createdAt, createdAt, phase: 'verify',
    });
    expect(seen.limit).toBe(CLOUD_RUN_USAGE_LIMIT);
  });

  it('maps a gateway-default run (no cloud agent) to a null ref', async () => {
    const { db } = fakeDb([{ id: 1, cloudAgentRef: null, promptTokens: 1, completionTokens: 2, createdAt: new Date() }]);
    expect((await readCloudRunUsage(db, 1, 5))[0]).toMatchObject({ cloudAgentRef: null, contextTokens: 3 });
  });
});
