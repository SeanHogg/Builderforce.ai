import { describe, expect, it, vi } from 'vitest';
import { buildMlHeadDelta } from '@seanhogg/builderforce-memory-engine';
import { mlHeadDoorFor, type MlHeadEvalRow } from '../../application/llm/evermindMlHeads';
import { EvermindMlHeadStore, type MlHeadStorage } from './evermindMlHeadStore';

/**
 * The coordinator's federated-head store. Load-bearing:
 *  - admission answers in the delta door's shapes (400 wrong target / malformed,
 *    423 frozen, 409 + headVersion stale) and queues only what it admits;
 *  - queued contributions merge as ONE batch on the alarm, through the eval gate;
 *  - an accepted round bumps the read's cache version, a refused one keeps the head and
 *    records why on `lastRound`.
 */

const TARGET = 'ml:run.local-success';
const door = mlHeadDoorFor(TARGET)!;
const failing: MlHeadEvalRow[] = Array.from({ length: 4 }, (_, i) => ({ x: [0.1 * i, 0.2, 0.05, 0, 0, 0, 0, 0.5, 0], y: 0 }));
const head = (fails: number, succeeds: number): number[] => [...Array<number>(18).fill(0), fails, succeeds];

function fakeStorage(): MlHeadStorage & { alarm: number | null } {
  const map = new Map<string, unknown>();
  const s = {
    alarm: null as number | null,
    async get<T>(key: string) {
      return structuredClone(map.get(key)) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      map.set(key, structuredClone(value));
    },
    async getAlarm() {
      return s.alarm;
    },
    async setAlarm(at: number) {
      s.alarm = at;
    },
  };
  return s;
}

function store(mode = 'connected') {
  const storage = fakeStorage();
  const onMerged = vi.fn(async () => undefined);
  const heads = new EvermindMlHeadStore(storage, { debounceMs: 15_000, mode: async () => mode, onMerged, now: () => 1_000 });
  return { storage, onMerged, heads };
}

const body = (trained: number[], baseVersion = 0, version = 0) => ({
  tenantId: 3,
  projectId: 9,
  ...buildMlHeadDelta({ ...door.initial(), version }, trained, 10),
  baseVersion,
  holdout: failing,
});

describe('EvermindMlHeadStore', () => {
  it('queues an admitted contribution, arms the debounce, and merges the batch on drain', async () => {
    const { storage, onMerged, heads } = store();
    const queued = await heads.learn(body(head(1, -1)));
    expect(queued).toMatchObject({ status: 200, body: { ok: true, target: TARGET, queued: 1, baseVersion: 0 } });
    expect(storage.alarm).toBe(16_000);
    expect((await heads.read(TARGET)).body).toMatchObject({ version: 0, params: null, pending: 1 });

    expect(await heads.drain()).toEqual([TARGET]);
    const read = await heads.read(TARGET);
    expect(read.body).toMatchObject({ target: TARGET, version: 1, params: head(1, -1), pending: 0, lastRound: { accepted: true, merged: 1 } });
    expect(read.body.evalLoss as number).toBeLessThan(Math.LN2);
    expect(onMerged).toHaveBeenCalledWith({ tenantId: 3, projectId: 9 }, TARGET);
  });

  it('refuses a stale base with the head version to rebase on, and queues nothing', async () => {
    const { heads } = store();
    await heads.learn(body(head(1, -1)));
    await heads.drain();
    const stale = await heads.learn(body(head(2, -2)));
    expect(stale).toMatchObject({ status: 409, body: { ok: false, headVersion: 1 } });
    expect((await heads.read(TARGET)).body).toMatchObject({ pending: 0 });
  });

  it('a regressing batch is refused: the head stays, the refusal is kept on lastRound, nothing is announced', async () => {
    const { onMerged, heads } = store();
    await heads.learn(body(head(-1, 1)));
    expect(await heads.drain()).toEqual([]);
    const read = await heads.read(TARGET);
    expect(read.body).toMatchObject({ version: 0, params: null, pending: 0, lastRound: { accepted: false, refusal: { ok: false } } });
    expect(onMerged).not.toHaveBeenCalled();
  });

  it('refuses a frozen project, a wrong target and a body with no project, without queueing', async () => {
    expect(await store('offline-frozen').heads.learn(body(head(1, -1)))).toMatchObject({ status: 423 });
    const { heads } = store();
    expect(await heads.learn({ ...body(head(1, -1)), target: 'ml:experience.quality' })).toMatchObject({ status: 400 });
    const { tenantId: _t, ...noTenant } = body(head(1, -1));
    expect(await heads.learn(noTenant)).toMatchObject({ status: 400 });
    expect(await heads.read('ml:experience.quality')).toMatchObject({ status: 400 });
    expect((await heads.read(TARGET)).body).toMatchObject({ pending: 0 });
  });
});
