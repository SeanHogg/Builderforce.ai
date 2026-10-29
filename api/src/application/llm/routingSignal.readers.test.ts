/**
 * The readers that feed routing seeds and promotion decisions read only outcomes that TEACH
 * (`routing_signal = true`): a telemetry-only report (a Creation Canvas run) seeds no recall
 * and is no sample in a variant comparison.
 */
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const wheres: SQL[] = [];

vi.mock('../shared/runTelemetryDatabase', () => ({
  runTelemetryDatabase: () => ({
    select: () => ({
      from: () => ({
        where: (w: SQL) => {
          wheres.push(w);
          const rows = Promise.resolve([]);
          return Object.assign(rows, { orderBy: () => ({ limit: async () => [] }) });
        },
      }),
    }),
  }),
}));
vi.mock('../../infrastructure/cache/readThroughCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/cache/readThroughCache')>()),
  getOrSetCached: async (_env: unknown, _key: string, load: () => Promise<unknown>) => load(),
  getCacheVersion: async () => 'v',
}));

const { getRecallSeed } = await import('./recallSeed');
const { evaluateVariant } = await import('../eval/variantEval');

const teaches = (w: SQL) => {
  const { sql, params } = new PgDialect().sqlToQuery(w);
  return sql.includes('"routing_signal" = $') && params.includes(true);
};

describe('routing_signal on the readers', () => {
  it('the recall seed reads only outcomes that teach', async () => {
    wheres.length = 0;
    await getRecallSeed({} as never, {} as never, 7, 10);
    expect(wheres.length).toBeGreaterThan(0);
    expect(wheres.every(teaches)).toBe(true);
  });

  it('a variant comparison samples only outcomes that teach', async () => {
    wheres.length = 0;
    await evaluateVariant({} as never, {} as never, { tenantId: 7, baseModel: 'a', candidateModel: 'b' });
    expect(wheres).toHaveLength(2);
    expect(wheres.every(teaches)).toBe(true);
  });
});
