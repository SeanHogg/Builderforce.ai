/**
 * A rebuild of a routing scope from the durable table must not re-admit a row recorded as
 * NOT a routing signal (a Creation Canvas run): every `run_model_outcomes` query of the
 * reconcile — the per-action grain and the per-role grain, at project, tenant and global
 * scope — carries `routing_signal = true`.
 */
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const wheres: SQL[] = [];

vi.mock('../shared/runTelemetryDatabase', () => ({
  runTelemetryDatabase: () => ({
    select: () => ({ from: () => ({ where: (w: SQL) => { wheres.push(w); return { groupBy: async () => [] }; } }) }),
  }),
}));
vi.mock('../../infrastructure/cache/readThroughCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/cache/readThroughCache')>()),
  setCached: async () => undefined,
}));

const { reconcileRoutingTable } = await import('./routingReconcile');

/** The ratings read (a different table) resolves empty and tolerates `.catch`. */
const coreDb = { select: () => ({ from: () => ({ where: () => ({ groupBy: () => Promise.resolve([]) }) }) }) };

describe('reconcileRoutingTable — routing_signal', () => {
  for (const scope of [{ kind: 'project', id: 5 }, { kind: 'tenant', id: 7 }, { kind: 'global' }] as const) {
    it(`excludes non-signal rows from both outcome grains at ${scope.kind} scope`, async () => {
      wheres.length = 0;

      await reconcileRoutingTable({} as never, coreDb as never, scope);

      // The per-action grain and the per-role grain.
      expect(wheres).toHaveLength(2);
      for (const w of wheres) {
        const { sql, params } = new PgDialect().sqlToQuery(w);
        expect(sql).toContain('"routing_signal" = $');
        // …bound to TRUE: the rebuild admits only rows that teach.
        expect(params).toContain(true);
        // …and not a run the person stopped or the tenant's quota ended (the live fold's own exclusions).
        expect(sql).toContain('"terminal_status" <> $');
        expect(params).toContain('cancelled');
        expect(sql).toContain('"quota_exhausted" = $');
        expect(params).toContain(false);
      }
    });
  }
});
