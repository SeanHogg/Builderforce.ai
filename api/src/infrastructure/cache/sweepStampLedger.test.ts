import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
const writes: Array<{ key: string; value: unknown }> = [];
vi.mock('./readThroughCache', () => ({
  peekCached: async (_env: unknown, key: string) => store.get(key) ?? null,
  setCached: async (_env: unknown, key: string, value: unknown) => {
    writes.push({ key, value });
    store.set(key, value);
  },
}));

import { loadSweepStamps } from './sweepStampLedger';

const MIN = 60_000;

beforeEach(() => {
  store.clear();
  writes.length = 0;
});

describe('sweep stamp ledger', () => {
  it('writes nothing when nothing was stamped', async () => {
    const ledger = await loadSweepStamps(undefined, 'k');
    await ledger.save();
    expect(writes).toHaveLength(0);
  });

  it('persists stamps as ONE entry and reads them back', async () => {
    const ledger = await loadSweepStamps(undefined, 'k');
    ledger.stamp('a', Date.now());
    ledger.stamp('b', Date.now());
    await ledger.save();
    expect(writes).toHaveLength(1);
    const again = await loadSweepStamps(undefined, 'k');
    expect(again.at('a')).not.toBeNull();
    expect(again.at('missing')).toBeNull();
  });

  it('takes the newer of the KV stamp and the DB fallback', async () => {
    const now = Date.now();
    store.set('k', { a: now - 10 * MIN });
    const ledger = await loadSweepStamps(undefined, 'k');
    expect(ledger.lastChecked('a', new Date(now - 40 * MIN))).toBe(now - 10 * MIN);
    expect(ledger.lastChecked('a', new Date(now - 1 * MIN))).toBe(now - 1 * MIN);
    expect(ledger.lastChecked('b', null)).toBeNull();
  });

  it('selects due rows never-checked first, then oldest first, capped', async () => {
    const now = Date.now();
    store.set('k', { fresh: now - 5 * MIN, old: now - 90 * MIN, older: now - 120 * MIN });
    const ledger = await loadSweepStamps(undefined, 'k');
    const rows = [{ id: 'fresh' }, { id: 'old' }, { id: 'never' }, { id: 'older' }];
    const due = ledger.due(rows, { id: (r) => r.id, intervalMs: 30 * MIN, limit: 2, now });
    expect(due.map((r) => r.id)).toEqual(['never', 'older']);
  });

  it('prunes stamps past retention on save', async () => {
    store.set('k', { stale: Date.now() - 10 * 86_400_000 });
    const ledger = await loadSweepStamps(undefined, 'k');
    ledger.stamp('new');
    await ledger.save();
    expect(Object.keys(writes[0]!.value as object)).toEqual(['new']);
  });
});
