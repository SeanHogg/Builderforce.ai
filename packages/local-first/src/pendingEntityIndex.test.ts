import { describe, expect, it } from 'vitest';
import {
  createMemoryLocalFirstStore,
  isRecordPayloadFence,
  newLocalRecord,
  queueImport,
  scanPendingOfRow,
  selectPendingOf,
  type EntityDestination,
  type JournalEvent,
  type LocalFirstTransaction,
} from './index.js';

const BOUND: EntityDestination = { kind: 'bound', platformInstance: 'https://example.test', tenantId: '1' };
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const appendFor = (tx: LocalFirstTransaction, row: string, key: string) => tx.append({
  idempotencyKey: key, clientEntityId: row, entityType: 'message', operation: 'create', schemaVersion: 1,
  occurredAt: '2026-01-01T00:00:00.000Z', dependsOn: [], destination: { kind: 'unbound' }, payload: null,
});

const idsOf = async (tx: LocalFirstTransaction, row: string): Promise<string[]> => {
  const out: string[] = [];
  await scanPendingOfRow(tx, row, (event) => { out.push(event.idempotencyKey!); });
  return out.sort();
};

describe('the per-row pending index', () => {
  it('sees committed events, this draft\'s appends, minus what it acknowledged — and survives a reset', async () => {
    const store = createMemoryLocalFirstStore();
    await store.transact(async (tx) => {
      await appendFor(tx, id(1), 'a');
      await appendFor(tx, id(2), 'b');
    });
    await store.transact(async (tx) => {
      const [first] = await selectPendingOf(tx, 'message', id(1));
      await tx.acknowledge([first!.eventId]);
      await appendFor(tx, id(1), 'c');
      await tx.hold((await appendFor(tx, id(1), 'd')).eventId, { holdAttempts: 1, heldSince: 'x', nextAttemptAt: 'y' });
      expect(await idsOf(tx, id(1))).toEqual(['c', 'd']);
      expect(await idsOf(tx, id(2))).toEqual(['b']);
    });
    expect(await store.read((tx) => idsOf(tx, id(1)))).toEqual(['c', 'd']);
    store.applyDelta({ reset: true, ...store.view() });
    expect(await store.read((tx) => idsOf(tx, id(1)))).toEqual(['c', 'd']);
    expect(await store.read((tx) => idsOf(tx, id(3)))).toEqual([]);
  });

  it('agrees with a filtered full scan (the fallback a hand-rolled transaction takes)', async () => {
    const store = createMemoryLocalFirstStore();
    await store.transact(async (tx) => {
      for (let n = 0; n < 20; n += 1) await appendFor(tx, id(n % 4), `k${n}`);
    });
    await store.read(async (tx) => {
      const { scanPendingOf: _indexed, ...rest } = tx as LocalFirstTransaction & Record<string, unknown>;
      const plain = Object.assign(Object.create(Object.getPrototypeOf(tx)), rest, { scanPendingOf: undefined }) as LocalFirstTransaction;
      for (let n = 0; n < 4; n += 1) {
        const viaIndex = (await selectPendingOf(tx, 'message', id(n))).map((event) => event.eventId);
        const viaScan = (await selectPendingOf(plain, 'message', id(n))).map((event) => event.eventId);
        expect(viaIndex).toEqual(viaScan);
      }
    });
  });

  // regression: the sync pass's bind called `dropPending` once per row, and `dropPending` walked
  // EVERY pending event — 75k rows × 92k events, an hour inside one transaction — so a long-offline
  // history was never bound, never sent, and no event was ever acknowledged.
  it('regression: binding a row reads only that row\'s events, never the whole journal', async () => {
    const store = createMemoryLocalFirstStore();
    const rows = Array.from({ length: 50 }, (_, n) => newLocalRecord({ id: id(n), entityType: 'message', payload: { n }, deviceId: 'd' }));
    await store.transact(async (tx) => {
      for (const row of rows) {
        await tx.put(row);
        await appendFor(tx, row.id, `message:${row.id}`);
      }
    });
    let fullScans = 0;
    await store.transact(async (tx) => {
      const counted = new Proxy(tx, {
        get(target, key, receiver) {
          if (key === 'scanPending') fullScans += 1;
          const value = Reflect.get(target, key, receiver) as unknown;
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      for (const row of rows) {
        const moved = { ...row, destination: BOUND };
        await counted.put(moved);
        await queueImport(counted, moved);
      }
    });
    expect(fullScans).toBe(0);
    const events = (store.view().events as JournalEvent[]).filter((event) => !isRecordPayloadFence(event));
    // Each row's unbound marker was dropped and replaced by ONE import.
    expect(events).toHaveLength(rows.length);
    expect(events.every((event) => event.operation === 'import' && event.destination.kind === 'bound')).toBe(true);
  });
});
