import { beforeEach, describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import { platformUsageReport, projectSpend, tenantUsageSummary } from './usageReports';
import type { Db } from '../../infrastructure/database/connection';

const asDb = (db: unknown) => db as Db;

/** The public usage shapes stay stable while their figures come from ONE use case. */
describe('usageReports', () => {
  beforeEach(() => __clearL1CacheForTests());

  it('/llm/v1/usage keeps its snake_case contract and names api-key credentials', async () => {
    const db = fakeDb([
      [{ requests: 5, totalTokens: '100', promptTokens: '60', completionTokens: '40' }], // totals
      [{ requests: 2, totalTokens: '30', promptTokens: '20', completionTokens: '10' }],  // mine
      [{ llmProduct: 'builderforceLLM', model: 'm1', requests: 5, totalTokens: '100', promptTokens: '60', completionTokens: '40', retries: 1 }],
      [{ day: '2026-10-16', requests: 5, totalTokens: '100' }],
      [{ userId: null, requests: 5, totalTokens: '100' }],
      [{ kind: 'cloud', requests: 5, totalTokens: '100', promptTokens: '60', completionTokens: '40' }],
      [{ type: 'api_key', id: 'key-1', requests: 5, totalTokens: '100', modelCount: 1 }],
      [{ id: 'key-1', name: 'CI key' }], // core tenant_api_keys names
    ]);
    const out = await tenantUsageSummary(undefined, asDb(db), 7, 'u1', 30);
    expect(out.totals).toEqual({ requests: 5, totalTokens: 100, promptTokens: 60, completionTokens: 40 });
    expect(out.mine).toEqual({ userId: 'u1', requests: 2, totalTokens: 30, promptTokens: 20, completionTokens: 10 });
    expect(out.byModel[0]).toEqual({ llmProduct: 'builderforceLLM', model: 'm1', requests: 5, prompt_tokens: 60, completion_tokens: 40, total_tokens: 100, retries: 1 });
    expect(out.byDay[0]).toEqual({ day: '2026-10-16', requests: 5, total_tokens: 100 });
    expect(out.byUser[0]).toEqual({ user_id: 'agentHost-runtime', requests: 5, total_tokens: 100 });
    expect(out.bySource[0]).toEqual({ source: 'cloud', requests: 5, prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 });
    expect(out.byCredential[0]).toEqual({ type: 'api_key', id: 'key-1', name: 'CI key', requests: 5, modelCount: 1, tokens: 100 });
  });

  it('/api/admin/llm-usage reports the orphaned bucket and vendor-enriched rows', async () => {
    const db = fakeDb([
      [{ requests: 10, totalTokens: '500', promptTokens: '300', completionTokens: '200', modelCount: 2 }],
      [{ requests: 1, totalTokens: '20', costMc: '99' }],
      [{ model: 'claude-x', requests: 10, totalTokens: '500', promptTokens: '300', completionTokens: '200', retries: 0, streamedRequests: 4 }],
      [{ day: '2026-10-16', requests: 10, totalTokens: '500' }],
      { rows: [{ model: 'claude-x', errorCode: 429, count: 2 }] } as unknown as unknown[],
    ]);
    const out = await platformUsageReport(undefined, asDb(db), 30);
    expect(out.totals.modelCount).toBe(2);
    expect(out.orphaned).toEqual({ requests: 1, totalTokens: 20, costMillicents: 99 });
    expect(out.byModel[0]).toMatchObject({ model: 'claude-x', streamed_requests: 4, total_tokens: 500 });
    expect(out.byModel[0]).toHaveProperty('vendor');
    expect(out.failovers[0]).toMatchObject({ model: 'claude-x', errorCode: 429, count: 2 });
  });

  it('project spend separates BYO tokens and converts cost to USD', async () => {
    const db = fakeDb([
      [{ requests: 3, totalTokens: '900', costMc: '250000', byoTokens: '400' }],
      [{ model: 'm1', totalTokens: '900', costMc: '250000' }],
    ]);
    const out = await projectSpend(undefined, asDb(db), 7, 12, new Date('2026-10-01T00:00:00Z'));
    expect(out).toEqual({ totalTokens: 900, byoTokens: 400, requests: 3, costUsd: 2.5, topModels: [{ model: 'm1', totalTokens: 900, costUsd: 2.5 }] });
  });
});
