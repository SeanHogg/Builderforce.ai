import { beforeEach, describe, expect, it, vi } from 'vitest';

const { notifyAlert } = vi.hoisted(() => ({ notifyAlert: vi.fn(async () => ({ slack: true, email: false })) }));
vi.mock('./runAlertSweep', () => ({ notifyAlert }));

import { raiseSystemAlert, SYSTEM_ALERT_METRICS } from './systemAlert';
import { notifyContainmentStop, containmentStopMessage } from './containmentAlert';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

function fakeDb(prior: unknown[] = []) {
  const inserted: Array<Record<string, unknown>> = [];
  const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => prior };
  const db = {
    select: () => chain,
    insert: () => ({ values: async (row: Record<string, unknown>) => { inserted.push(row); } }),
  } as unknown as Db;
  return { db, inserted };
}

const env = {} as Env;
const alert = { tenantId: 3, metric: SYSTEM_ALERT_METRICS.spendSpike, message: 'spend spiked', cooldownHours: 20 };

describe('raiseSystemAlert', () => {
  beforeEach(() => notifyAlert.mockClear());

  it('notifies and records an event row when nothing fired inside the cooldown', async () => {
    const { db, inserted } = fakeDb([]);
    expect(await raiseSystemAlert(env, db, alert)).toBe('raised');
    expect(notifyAlert).toHaveBeenCalledOnce();
    expect(inserted[0]).toMatchObject({ tenantId: 3, metric: 'cost_daily_spend_spike', message: 'spend spiked', notifiedSlack: true, notifiedEmail: false });
  });

  it('stays quiet inside the cooldown', async () => {
    const { db, inserted } = fakeDb([{ id: 'prior' }]);
    expect(await raiseSystemAlert(env, db, alert)).toBe('cooldown');
    expect(notifyAlert).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('never throws — a failed read reports and returns failed', async () => {
    const db = { select: () => { throw new Error('db down'); } } as unknown as Db;
    expect(await raiseSystemAlert(env, db, alert)).toBe('failed');
  });
});

describe('notifyContainmentStop', () => {
  beforeEach(() => notifyAlert.mockClear());

  it('raises a high-severity alert about the run, once per execution', async () => {
    const { db, inserted } = fakeDb([]);
    expect(await notifyContainmentStop(env, db, { tenantId: 3, executionId: 77, taskId: 5, reason: 'spend limit $2.00 reached', spendMillicents: 210_000 })).toBe('raised');
    expect(inserted[0]).toMatchObject({
      metric: 'containment_stop', subjectKind: 'object', subjectRef: 'execution:77', severity: 'high', observedValue: 2.1,
      message: containmentStopMessage(77, 'spend limit $2.00 reached', 5),
    });
  });
});
