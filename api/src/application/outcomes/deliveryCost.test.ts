import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

vi.mock('../llm/usageLedger', () => ({ usageDatabaseOf: (db: unknown) => db }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { deliveryCostFromAggregate, readDeliveryCostMillicents } from './deliveryCost';

/** A db whose select chain resolves each successive query to the next canned aggregate row. */
function stubDb(results: Array<{ rows: number; cost: number } | Error>) {
  const where = vi.fn();
  for (const r of results) {
    if (r instanceof Error) where.mockImplementationOnce(() => Promise.reject(r));
    else where.mockImplementationOnce(() => Promise.resolve([r]));
  }
  where.mockImplementation(() => Promise.resolve([{ rows: 0, cost: 0 }]));
  const select = vi.fn(() => ({ from: () => ({ where }) }));
  return { db: { select } as unknown as Db, select, where };
}

describe('deliveryCostFromAggregate', () => {
  it('is undefined — never 0 — when no usage rows were recorded', () => {
    expect(deliveryCostFromAggregate(0, 0)).toBeUndefined();
    expect(deliveryCostFromAggregate(null, null)).toBeUndefined();
    expect(deliveryCostFromAggregate('nope', 5)).toBeUndefined();
  });

  it('reports a measured total, including a measured zero (all-BYO) run', () => {
    expect(deliveryCostFromAggregate(3, '12500')).toBe(12_500);
    expect(deliveryCostFromAggregate(2, 0)).toBe(0);
  });

  it('refuses a negative or non-finite total', () => {
    expect(deliveryCostFromAggregate(1, -4)).toBeUndefined();
    expect(deliveryCostFromAggregate(1, Number.NaN)).toBeUndefined();
  });
});

describe('readDeliveryCostMillicents', () => {
  it('queries nothing without a handle or a valid tenant', async () => {
    const { db, select } = stubDb([]);
    expect(await readDeliveryCostMillicents(db, { tenantId: 1 })).toBeUndefined();
    expect(await readDeliveryCostMillicents(db, { tenantId: 0, executionId: 5 })).toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it('returns the execution cost when the run has usage rows', async () => {
    const { db, select } = stubDb([{ rows: 4, cost: 8_000 }]);
    expect(await readDeliveryCostMillicents(db, { tenantId: 7, executionId: '42' })).toBe(8_000);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('falls through to a coarser handle only when the finer one has no rows', async () => {
    const { db, select } = stubDb([{ rows: 0, cost: 0 }, { rows: 2, cost: 300 }]);
    const cost = await readDeliveryCostMillicents(db, { tenantId: 7, executionId: 42, projectId: 9 });
    expect(cost).toBe(300);
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('stays undefined when no handle has usage rows (cost remains Not measured)', async () => {
    const { db } = stubDb([{ rows: 0, cost: 0 }, { rows: 0, cost: 0 }]);
    expect(await readDeliveryCostMillicents(db, { tenantId: 7, executionId: 42, correlationId: 'build:r1' })).toBeUndefined();
  });

  it('never lets a failed lookup fail the delivery it describes', async () => {
    const { db } = stubDb([new Error('usage db down')]);
    expect(await readDeliveryCostMillicents(db, { tenantId: 7, executionId: 42 })).toBeUndefined();
  });
});
