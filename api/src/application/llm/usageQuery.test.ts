import { beforeEach, describe, expect, it } from 'vitest';
import { fakeDb, whereColumns } from '../../../test/fakeDb';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import {
  executionUsageCost,
  namedWindowStart,
  readUsageBreakdown,
  readUsageRows,
  readUsageTotals,
  rollingWindowStart,
  taskUsageCost,
  tenantScope,
  usageFilterKey,
  usageWhere,
} from './usageQuery';
import type { Db } from '../../infrastructure/database/connection';

const asDb = (db: unknown) => db as Db;
const SINCE = new Date('2026-10-01T00:00:00Z');

/** THE usage query use case — every llm_usage_log read goes through these. */
describe('usageQuery', () => {
  beforeEach(() => __clearL1CacheForTests());

  describe('usageWhere', () => {
    it('tenant scope filters on tenant_id plus every attribution narrowed', () => {
      const cols = whereColumns(usageWhere({
        scope: tenantScope(7), since: SINCE, projectId: 3, agentHostId: 4, tenantApiKeyId: 'k', taskId: 5, executionId: 6, model: 'm', userId: 'u',
      }));
      for (const c of ['tenant_id', 'created_at', 'project_id', 'agent_host_id', 'tenant_api_key_id', 'task_id', 'execution_id', 'model', 'user_id']) {
        expect(cols).toContain(c);
      }
    });

    it('platform scope carries no tenant predicate; orphaned scope selects tenant_id IS NULL', () => {
      expect(whereColumns(usageWhere({ scope: { kind: 'platform' }, since: SINCE }))).not.toContain('tenant_id');
      expect(whereColumns(usageWhere({ scope: { kind: 'orphaned' }, since: SINCE }))).toContain('tenant_id');
    });
  });

  describe('windows', () => {
    const now = new Date('2026-10-17T15:42:10Z');
    it('names today / week / month in UTC and treats anything else as today', () => {
      expect(namedWindowStart('today', now).toISOString()).toBe('2026-10-17T00:00:00.000Z');
      expect(namedWindowStart('week', now).toISOString()).toBe('2026-10-11T00:00:00.000Z');
      expect(namedWindowStart('month', now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(namedWindowStart('bogus', now).toISOString()).toBe('2026-10-17T00:00:00.000Z');
    });

    it('floors a rolling window to the minute so it can be a cache key', () => {
      const a = rollingWindowStart(30, now.getTime());
      const b = rollingWindowStart(30, now.getTime() + 20_000);
      expect(a.toISOString()).toBe(b.toISOString());
      expect(a.toISOString()).toBe('2026-09-17T15:42:00.000Z');
    });

    it('keys distinct filters distinctly', () => {
      const base = { scope: tenantScope(1), since: SINCE };
      expect(usageFilterKey(base)).not.toBe(usageFilterKey({ ...base, projectId: 2 }));
      expect(usageFilterKey(base)).not.toBe(usageFilterKey({ ...base, scope: tenantScope(2) }));
    });
  });

  it('readUsageTotals normalises bigint strings to numbers in ONE statement', async () => {
    const db = fakeDb([[{ requests: 4, totalTokens: '9876', promptTokens: '6000', completionTokens: '3876', costMc: '123456', byoTokens: '10', retries: 1, streamedRequests: 2, modelCount: 3 }]]);
    const t = await readUsageTotals(asDb(db), { scope: tenantScope(7), since: SINCE });
    expect(t).toEqual({ requests: 4, totalTokens: 9876, promptTokens: 6000, completionTokens: 3876, costMc: 123456, byoTokens: 10, retries: 1, streamedRequests: 2, modelCount: 3 });
    expect(db.calls).toHaveLength(1);
  });

  it('readUsageBreakdown groups by the dimension and restricts to rows that have it', async () => {
    const db = fakeDb([[{ agentHostId: 9, requests: 2, totalTokens: '50', costMc: '7' }]]);
    const rows = await readUsageBreakdown(asDb(db), { scope: tenantScope(7), since: SINCE }, 'agentHost', { limit: 50 });
    expect(rows[0]).toMatchObject({ agentHostId: 9, requests: 2, totalTokens: 50, costMc: 7, promptTokens: 0 });
    expect(db.calls[0]?.chain).toEqual(['from', 'where', 'groupBy', 'orderBy', 'limit']);
    expect(whereColumns(db.calls[0]?.where)).toEqual(expect.arrayContaining(['tenant_id', 'agent_host_id']));
  });

  it('readUsageRows pages rows and counts rows (not calls) for the page total', async () => {
    const createdAt = new Date('2026-10-02T00:00:00Z');
    const db = fakeDb([
      [{ id: 1, createdAt, userId: null, llmProduct: 'p', model: 'm', promptTokens: 1, completionTokens: 2, totalTokens: 3, retries: 0, streamed: false, useCase: null, metadata: '{"a":1}', idempotencyKey: null }],
      [{ total: 11 }],
    ]);
    const out = await readUsageRows(asDb(db), { scope: tenantScope(7), since: SINCE, tenantApiKeyId: 'k' }, { limit: 10, page: 2 });
    expect(out.total).toBe(11);
    expect(out.rows[0]?.createdAt).toBe('2026-10-02T00:00:00.000Z');
    expect(out.rows[0]?.metadata).toEqual({ a: 1 });
    expect(db.calls[0]?.chain).toContain('offset');
  });

  it("sums an execution's rows, tenant-scoped, and converts millicents to USD", async () => {
    const db = fakeDb([[{ costMc: '123456', totalTokens: '9876', requests: 4 }]]);
    const out = await executionUsageCost(undefined, asDb(db), 7, 42);
    expect(out).toEqual({ estimatedCostUsd: 1.23456, totalTokens: 9876, requests: 4 });
    const cols = whereColumns(db.calls[0]?.where);
    expect(cols).toContain('tenant_id');
    expect(cols).toContain('execution_id');
  });

  it('keys the ticket total on task_id and answers zero for a degenerate id without a query', async () => {
    const db = fakeDb([[{ costMc: '0', totalTokens: '0', requests: 0 }]]);
    await taskUsageCost(undefined, asDb(db), 7, 5);
    expect(whereColumns(db.calls[0]?.where)).toContain('task_id');
    const untouched = fakeDb([]);
    expect(await executionUsageCost(undefined, asDb(untouched), 7, Number.NaN)).toEqual({ estimatedCostUsd: 0, totalTokens: 0, requests: 0 });
    expect(untouched.calls).toHaveLength(0);
  });
});
