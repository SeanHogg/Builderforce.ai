import { describe, expect, it, vi } from 'vitest';

// Once a seat is past 50% of its cap every gateway request reaches the notifier; the
// members⋈users read that dedupes it must run once, not once per request.

const notify = vi.fn(async () => undefined);
vi.mock('../notifications/notify', () => ({ notify: (...a: unknown[]) => notify(...(a as [])) }));

import { maybeEmitSpendNotification } from './memberSpend';
import { utcMonthStart } from '../llm/tokenUsage';

function fakeDb(state: { period: string | null; notified: number | null; name: string }) {
  const counters = { selects: 0, updates: 0 };
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => Object.assign(Promise.resolve([]), { limit: () => { counters.selects += 1; return Promise.resolve([state]); } });
  const db = {
    select: () => chain,
    update: () => ({ set: () => ({ where: () => { counters.updates += 1; return Promise.resolve(); } }) }),
  };
  return { db: db as never, counters };
}

const availability = (percentUsed: number) => ({
  seatControlsEnabled: true, hasBudget: true, capMillicents: 100_000, spentMillicents: percentUsed * 1000, percentUsed,
});
const env = {} as never;
const monthKey = `${utcMonthStart().getUTCFullYear()}-${String(utcMonthStart().getUTCMonth() + 1).padStart(2, '0')}`;

describe('maybeEmitSpendNotification — last-notified level is cached', () => {
  it('reads the dedupe row once, then returns before the SELECT while the level has not risen', async () => {
    const { db, counters } = fakeDb({ period: null, notified: null, name: 'Ada' });
    await maybeEmitSpendNotification(db, env, 1, 'u1', availability(55));
    expect(counters.selects).toBe(1);
    expect(counters.updates).toBe(1);
    await maybeEmitSpendNotification(db, env, 1, 'u1', availability(60));
    await maybeEmitSpendNotification(db, env, 1, 'u1', availability(79));
    expect(counters.selects).toBe(1);
    // A higher threshold is still evaluated.
    await maybeEmitSpendNotification(db, env, 1, 'u1', availability(85));
    expect(counters.selects).toBe(2);
  });

  it('caches an already-notified verdict from the database too', async () => {
    const { db, counters } = fakeDb({ period: monthKey, notified: 80, name: 'Bo' });
    await maybeEmitSpendNotification(db, env, 2, 'u2', availability(81));
    await maybeEmitSpendNotification(db, env, 2, 'u2', availability(82));
    expect(counters.selects).toBe(1);
    expect(counters.updates).toBe(0);
  });
});
