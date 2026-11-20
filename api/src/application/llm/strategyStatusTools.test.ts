/**
 * The roadmap / portfolio / initiative write tools take `status` from ONE vocabulary per
 * kind (agent-loop `TICKET_STATUS_VALUES`, the same lists `TICKET_CLOSED_STATES` picks its
 * closed words from). A free-form status (an initiative set to "done") never reads as
 * closed, so its ring would sit at the claimed-complete rung forever and `openOnly` would
 * list it forever — the tools reject it, naming the allowed values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../infrastructure/auth/segmentResolver', () => ({
  resolveSegment: vi.fn().mockResolvedValue('seg_default'),
}));
const webhooks = vi.hoisted(() => ({ emitWebhookEvent: vi.fn(async (..._a: unknown[]) => 1) }));
vi.mock('../seams/webhookService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../seams/webhookService')>()),
  emitWebhookEvent: webhooks.emitWebhookEvent,
}));
const cache = vi.hoisted(() => ({ invalidated: [] as string[] }));
vi.mock('../../infrastructure/cache/readThroughCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/cache/readThroughCache')>()),
  invalidateCached: vi.fn(async (_env: unknown, key: string) => { cache.invalidated.push(key); }),
  bumpCacheVersion: vi.fn(async () => undefined),
  bumpTicketSearchVersion: vi.fn(async () => undefined),
}));

import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { TICKET_STATUS_VALUES } from '@builderforce/agent-loop';
import { callBuiltinTool, listBuiltinTools } from './builtinMcpService';

/** Every row a write sent to the database. */
let written: Array<Record<string, unknown>> = [];
/** The row an update tool's before-image read returns (null = none stored). */
let stored: Record<string, unknown> | null = null;
/** The WHERE condition of every read, rendered (sql + params) so a scope filter can be asserted. */
let reads: Array<{ sql: string; params: unknown[] }> = [];
const dialect = new PgDialect();

function makeDb() {
  const chain = (row: Record<string, unknown>) => {
    const b: Record<string, unknown> = {};
    for (const m of ['where', 'onConflictDoNothing']) b[m] = () => b;
    b.returning = async () => [{ id: 'row-1', ...(stored ?? {}), ...row }];
    return b;
  };
  return {
    // objectives.create's same-title dedupe read (nothing to dedupe against) and an update
    // tool's before-image read (`stored`).
    select: () => ({ from: () => ({ where: (cond: SQL) => {
      reads.push(dialect.sqlToQuery(cond));
      const p: any = Promise.resolve([]);
      p.limit = async () => (stored ? [stored] : []);
      return p;
    } }) }),
    insert: () => ({ values: (row: Record<string, unknown>) => { written.push(row); return chain(row); } }),
    update: () => ({ set: (row: Record<string, unknown>) => { written.push(row); return chain(row); } }),
    delete: () => ({ where: () => ({ returning: async () => (stored ? [stored] : []) }) }),
  } as never;
}

const call = (tool: string, args: Record<string, unknown>) =>
  callBuiltinTool(makeDb(), { tenantId: 7, tool, arguments: args });

const DATES = { startDate: '2026-01-01', targetDate: '2026-03-31' };
const OBJ_DATES = { startDate: '2026-01-01', endDate: '2026-03-31' };

beforeEach(() => { written = []; stored = null; reads = []; cache.invalidated = []; webhooks.emitWebhookEvent.mockClear(); });

describe('status vocabulary on the strategy / roadmap write tools', () => {
  it('advertises the status enum from the shared vocabulary', () => {
    const schemaOf = (tool: string) =>
      (listBuiltinTools().find((t) => t.tool === tool)!.parameters as { properties: { status: { enum?: string[] } } }).properties.status;
    for (const [tool, kind] of [
      ['roadmap.create', 'roadmap'], ['roadmap.update', 'roadmap'],
      ['portfolios.create', 'portfolio'], ['portfolios.update', 'portfolio'],
      ['initiatives.create', 'initiative'], ['initiatives.update', 'initiative'],
      ['objectives.create', 'objective'], ['objectives.update', 'objective'],
    ] as const) {
      expect(schemaOf(tool).enum, tool).toEqual([...TICKET_STATUS_VALUES[kind]]);
    }
  });

  it('regression: rejects an unknown status, naming the allowed values, and writes nothing', async () => {
    await expect(call('initiatives.update', { id: 'i1', status: 'done' }))
      .rejects.toThrow('initiative status must be one of: proposed, active, completed, archived, cancelled');
    await expect(call('initiatives.create', { name: 'Platform', status: 'finished', ...DATES })).rejects.toThrow(/initiative status must be one of/);
    await expect(call('portfolios.create', { name: 'Growth', status: 'done' })).rejects.toThrow('portfolio status must be one of: active, archived, cancelled');
    await expect(call('portfolios.update', { id: 'p1', status: 'closed' })).rejects.toThrow(/portfolio status must be one of/);
    await expect(call('roadmap.create', { title: 'Billing', status: 'delivered' })).rejects.toThrow(/roadmap status must be one of: planned, in_progress, shipped, cancelled/);
    await expect(call('roadmap.update', { id: 'r1', status: 'wip' })).rejects.toThrow(/roadmap status must be one of/);
    await expect(call('objectives.create', { title: 'Revenue', status: 'done', ...OBJ_DATES }))
      .rejects.toThrow('objective status must be one of: active, achieved, missed, archived, cancelled');
    await expect(call('objectives.update', { id: 'o1', status: 'complete' })).rejects.toThrow(/objective status must be one of/);
    expect(written).toEqual([]);
  });

  it('accepts a known status (lower-cased) and writes it', async () => {
    await call('initiatives.update', { id: 'i1', status: 'Completed' });
    await call('initiatives.create', { name: 'Platform', status: 'active', ...DATES });
    await call('portfolios.create', { name: 'Growth', status: 'archived' });
    await call('portfolios.update', { id: 'p1', status: 'active' });
    await call('roadmap.create', { title: 'Billing', status: 'shipped' });
    await call('roadmap.update', { id: 'r1', status: 'released' }); // legacy delivered spelling: accepted, stored as shipped
    await call('objectives.create', { title: 'Revenue', status: 'Achieved', ...OBJ_DATES });
    await call('objectives.update', { id: 'o1', status: 'missed' });
    expect(written.map((w) => w.status)).toEqual(['completed', 'active', 'archived', 'active', 'shipped', 'shipped', 'achieved', 'missed']);
  });

  it('leaves the status untouched when none is passed', async () => {
    await call('portfolios.update', { id: 'p1', name: 'Renamed' });
    expect(written[0]).not.toHaveProperty('status');
  });

  it('regression: an update that keeps an off-vocabulary stored status passes it through untouched', async () => {
    stored = { id: 'row-1', status: 'in progress' };
    for (const tool of ['roadmap.update', 'portfolios.update', 'initiatives.update', 'objectives.update']) {
      await call(tool, { id: 'row-1', status: 'In Progress' });
    }
    expect(written.map((w) => w.status)).toEqual(['in progress', 'in progress', 'in progress', 'in progress']);
    // A CHANGE is still held to the vocabulary.
    await expect(call('initiatives.update', { id: 'row-1', status: 'wip' })).rejects.toThrow(/initiative status must be one of/);
  });

  it('a null status is refused with a clear message', async () => {
    await expect(call('portfolios.update', { id: 'p1', status: null })).rejects.toThrow('portfolio status cannot be null');
    await expect(call('roadmap.create', { title: 'Billing', status: null })).rejects.toThrow('roadmap status cannot be null');
  });

  it('can cancel a portfolio, an initiative and an objective', async () => {
    await call('portfolios.update', { id: 'p1', status: 'cancelled' });
    await call('initiatives.update', { id: 'i1', status: 'cancelled' });
    await call('objectives.update', { id: 'o1', status: 'cancelled' });
    expect(written.map((w) => w.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });
});

describe('roadmap tools publish like the REST tracker (afterRoadmapWrite)', () => {
  it('regression: roadmap.update into shipped (via a legacy "released") stores shipped and fires roadmap.published', async () => {
    stored = { id: 'row-1', status: 'in_progress' };
    await call('roadmap.update', { id: 'row-1', status: 'released' });
    expect(written[0]!.status).toBe('shipped');
    expect(webhooks.emitWebhookEvent).toHaveBeenCalledTimes(1);
    expect(webhooks.emitWebhookEvent.mock.calls[0]![1]).toMatchObject({ eventType: 'roadmap.published', tenantId: 7, segmentId: 'seg_default' });
  });

  it('roadmap.create straight into shipped publishes it', async () => {
    await call('roadmap.create', { title: 'Billing', status: 'shipped' });
    expect(webhooks.emitWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it('regression: a save of an already-shipped item does not re-announce it', async () => {
    stored = { id: 'row-1', status: 'shipped' };
    await call('roadmap.update', { id: 'row-1', title: 'Renamed', status: 'shipped' });
    await call('roadmap.update', { id: 'row-1', notes: 'more' });
    expect(webhooks.emitWebhookEvent).not.toHaveBeenCalled();
  });

  it('regression: an item delivered under a legacy word (any case) is not re-announced when saved as shipped', async () => {
    for (const legacy of ['released', 'Done', 'Shipped']) {
      stored = { id: 'row-1', status: legacy };
      await call('roadmap.update', { id: 'row-1', status: 'shipped' });
    }
    expect(webhooks.emitWebhookEvent).not.toHaveBeenCalled();
  });

  /** A call with a Worker env, so the post-write step has a cache to clear. */
  const callWithEnv = (tool: string, args: Record<string, unknown>) =>
    callBuiltinTool(makeDb(), { tenantId: 7, tool, arguments: args, env: {} as never });
  const key = (p: number | 'all') => `tracker:roadmap:t:7:s:seg_default:p:${p}`;

  it('regression: roadmap.update moving an item between projects clears BOTH project cache keys', async () => {
    stored = { id: 'row-1', status: 'planned', projectId: 3 };
    await callWithEnv('roadmap.update', { id: 'row-1', projectId: 9 });
    expect(cache.invalidated).toEqual(expect.arrayContaining([key('all'), key(3), key(9)]));
  });

  it('regression: roadmap.delete clears the cache (after = null) and announces nothing', async () => {
    stored = { id: 'row-1', status: 'shipped', projectId: 3 };
    await callWithEnv('roadmap.delete', { id: 'row-1' });
    expect(cache.invalidated).toEqual(expect.arrayContaining([key('all'), key(3)]));
    expect(webhooks.emitWebhookEvent).not.toHaveBeenCalled();
  });
});

describe('roadmap.get', () => {
  it('regression: is scoped to the caller\'s segment, not just the tenant', async () => {
    await call('roadmap.get', { id: 'row-1' });
    expect(reads).toHaveLength(1);
    expect(reads[0]!.sql).toContain('"segment_id"');
    expect(reads[0]!.params).toEqual(expect.arrayContaining(['row-1', 7, 'seg_default']));
  });
});
