import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

vi.mock('./metricEvaluators', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./metricEvaluators')>()),
  evaluateMetric: vi.fn(async (_db: unknown, _env: unknown, args: { windowDays: number }) => ({ value: args.windowDays === 7 ? null : 99 })),
}));

const { runAlertSweep } = await import('./runAlertSweep');

const rule = (id: number, windowDays = 30) => ({
  id, tenantId: 1, name: `r${id}`, metric: 'dora_lead_time_hours', comparator: 'gt', threshold: 10,
  scopeKind: 'tenant', projectId: null, teamId: null, windowDays, cooldownHours: 24,
  lastTriggeredAt: null, notifySlack: false, notifyEmail: false, enabled: true,
});

/** Counts statements: the sweep used to issue 2-3 writes per rule. */
function makeDb(rules: ReturnType<typeof rule>[]) {
  const writes: Array<{ op: string; payload: unknown }> = [];
  const db = {
    select: () => ({ from: () => ({ where: async () => rules }) }),
    update: () => ({ set: (s: unknown) => ({ where: async () => { writes.push({ op: 'update', payload: s }); } }) }),
    insert: () => ({ values: async (v: unknown) => { writes.push({ op: 'insert', payload: v }); } }),
  } as unknown as Db;
  return { db, writes };
}

describe('runAlertSweep write batching', () => {
  it('stamps every evaluated rule, records every event and stamps every trigger in three statements total', async () => {
    const { db, writes } = makeDb([rule(1), rule(2), rule(3, 7)]);
    await runAlertSweep({} as Env, db);

    // rule 3 is uncomputable (null) → evaluated but never fires.
    expect(writes.map((w) => w.op)).toEqual(['update', 'insert', 'update']);
    expect(writes[1]!.payload).toHaveLength(2);
  });

  it('writes nothing when there are no rules', async () => {
    const { db, writes } = makeDb([]);
    await runAlertSweep({} as Env, db);
    expect(writes).toHaveLength(0);
  });
});
