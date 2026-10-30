/**
 * Cloud-turn metering carries the provider's cache + reasoning tiers (defect 1) and the
 * A1 per-turn telemetry onto the ledger row.
 *
 * Before the fix `recordCloudLlmTurn` forwarded only prompt/completion tokens, so every
 * cloud turn was written — and PRICED — as fully uncached.
 */
import { describe, expect, it, vi } from 'vitest';

const { PRICE } = vi.hoisted(() => ({ PRICE: { input: 0.000001, output: 0.000002 } }));
vi.mock('../../llm/catalogView', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../llm/catalogView')>()),
  loadPriceBook: async () => ({ priceOf: (m: string) => (m === 'priced/model' ? PRICE : undefined) }),
}));

import { recordCloudLlmTurn, recordCloudUsage } from './cloudLlmTurn';
import { computeCostMillicents } from '../../llm/usageLedger';
import { llmUsageLog, toolAuditEvents } from '../../../infrastructure/database/schema';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';

function fakeDb() {
  const rows: Array<{ table: unknown; row: Record<string, unknown> }> = [];
  const db = {
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        rows.push({ table, row });
        const r = Promise.resolve([{ id: rows.length }]);
        return Object.assign(r, { returning: () => r });
      },
    }),
  } as unknown as Db;
  return {
    db,
    usageRows: () => rows.filter((r) => r.table === llmUsageLog).map((r) => r.row),
    auditRows: () => rows.filter((r) => r.table === toolAuditEvents).map((r) => r.row),
  };
}

const env = {} as Env;
const pricing = { prompt: PRICE.input, completion: PRICE.output };
const usage = { promptTokens: 10_000, completionTokens: 1_000, totalTokens: 11_000, cacheReadTokens: 8_000, cacheCreationTokens: 1_000 };

describe('recordCloudUsage — cache tiers', () => {
  it('persists and PRICES the cache tiers instead of billing them as full input', async () => {
    const { db, usageRows } = fakeDb();
    await recordCloudUsage(env, db, {
      tenantId: 1, executionId: 5, taskId: 2, model: 'priced/model',
      inputTokens: usage.promptTokens, outputTokens: usage.completionTokens,
      cacheReadTokens: usage.cacheReadTokens, cacheCreationTokens: usage.cacheCreationTokens,
      reasoningTokens: 300, turnIndex: 4, toolSchemaTokens: 1_200,
    });
    const [row] = usageRows();
    expect(row).toMatchObject({ cacheReadTokens: 8_000, cacheCreationTokens: 1_000, reasoningTokens: 300, turnIndex: 4, toolSchemaTokens: 1_200 });
    expect(row!.costUsdMillicents).toBe(computeCostMillicents(pricing, usage));
    const uncached = computeCostMillicents(pricing, { promptTokens: 10_000, completionTokens: 1_000, totalTokens: 11_000 });
    expect(row!.costUsdMillicents).toBeLessThan(uncached);
  });

  it('records an unreported reasoning split and unmeasured telemetry as NULL, not 0', async () => {
    const { db, usageRows } = fakeDb();
    await recordCloudUsage(env, db, { tenantId: 1, executionId: 5, taskId: 2, model: 'priced/model', inputTokens: 10, outputTokens: 5 });
    expect(usageRows()[0]).toMatchObject({ cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: null, turnIndex: null, toolSchemaTokens: null });
  });
});

describe('recordCloudLlmTurn — forwards the turn result usage', () => {
  it('passes cache + reasoning tiers, the 1-based turn and the estimated context split', async () => {
    const { db, usageRows } = fakeDb();
    const tools = [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];
    const result = {
      response: new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), { status: 200 }),
      usage: { ...usage, reasoningTokens: 120 },
      resolvedModel: 'priced/model',
      resolvedVendor: 'openrouter',
    } as unknown as Parameters<typeof recordCloudLlmTurn>[0];
    const turn = await recordCloudLlmTurn(result, {
      env, db, tenantId: 1, executionId: 9, taskId: 3,
      turnInput: { messages: [{ role: 'system', content: 'x'.repeat(40) }, { role: 'tool', content: 'y'.repeat(80) }], tools },
    }, { tGen0: Date.now(), step: 2, notify: false });
    expect(turn.ok).toBe(true);
    const [row] = usageRows();
    expect(row).toMatchObject({ cacheReadTokens: 8_000, cacheCreationTokens: 1_000, reasoningTokens: 120, turnIndex: 3 });
    expect(row!.toolSchemaTokens).toBeGreaterThan(0);
    expect(row!.costUsdMillicents).toBe(computeCostMillicents(pricing, usage));
    const meta = row!.metadata as Record<string, unknown>;
    expect(meta.context).toMatchObject({ system: 10, toolOutputs: 20, tools: row!.toolSchemaTokens, estimated: true });
    expect(meta.costLevers).toMatchObject({ on: expect.any(Array), off: expect.any(Array) });
  });
});

describe('recordCloudLlmTurn — records whether THIS turn was served by a weaker model than it asked for', () => {
  const turnFor = (requestedModel: string | undefined, resolvedModel: string) => ({
    result: {
      response: new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), { status: 200 }),
      resolvedModel,
    } as unknown as Parameters<typeof recordCloudLlmTurn>[0],
    rc: { env, db: undefined as never, tenantId: 1, executionId: 9, taskId: 3, ...(requestedModel ? { requestedModel } : {}) },
  });
  const completeDetail = async (requestedModel: string | undefined, resolvedModel: string) => {
    const { db, auditRows } = fakeDb();
    const { result, rc } = turnFor(requestedModel, resolvedModel);
    await recordCloudLlmTurn(result, { ...rc, db }, { tGen0: Date.now(), step: 0, notify: false });
    const row = auditRows().find((r) => r.toolName === 'llm.complete');
    return JSON.parse(String(row?.args)) as Record<string, unknown>;
  };

  it('ULTRA coder asked, STANDARD curated coder served: weaker (degraded) — with the requested model on the event', async () => {
    const detail = await completeDetail('anthropic/claude-opus-4.5', 'anthropic/claude-haiku-4.5');
    expect(detail).toMatchObject({ requestedModel: 'anthropic/claude-opus-4.5', model: 'anthropic/claude-haiku-4.5', weaker: true });
  });

  it('the same model, a stronger one, or no intended model: not weaker', async () => {
    expect(await completeDetail('anthropic/claude-haiku-4.5', 'anthropic/claude-haiku-4.5')).toMatchObject({ weaker: false });
    expect(await completeDetail('anthropic/claude-haiku-4.5', 'anthropic/claude-opus-4.5')).toMatchObject({ weaker: false });
    expect(await completeDetail(undefined, 'anthropic/claude-haiku-4.5')).toMatchObject({ weaker: false, requestedModel: null });
  });
});
