import { describe, it, expect } from 'vitest';
import type { Env } from '../../env';
import { armBackoffMs, backedOffConnections, clearArmBackoff, recordArmFailure } from './armBackoff';

function envWithKv() {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  } as unknown as KVNamespace;
  return { env: { AUTH_CACHE_KV: kv } as Env, store };
}

describe('armBackoffMs', () => {
  it('doubles from five minutes and caps at six hours', () => {
    expect(armBackoffMs(1)).toBe(5 * 60_000);
    expect(armBackoffMs(2)).toBe(10 * 60_000);
    expect(armBackoffMs(3)).toBe(20 * 60_000);
    expect(armBackoffMs(50)).toBe(6 * 60 * 60_000);
  });
});

describe('arm backoff state', () => {
  it('holds a failed connection out until its window passes, and grows on repeats', async () => {
    const { env } = envWithKv();
    await recordArmFailure(env, 7, 1_000);
    expect([...(await backedOffConnections(env, [7, 8], 2_000))]).toEqual([7]);
    expect((await backedOffConnections(env, [7], 1_000 + armBackoffMs(1) + 1)).size).toBe(0);
    await recordArmFailure(env, 7, 1_000);
    expect((await backedOffConnections(env, [7], 1_000 + armBackoffMs(1) + 1)).size).toBe(1);
  });

  it('a successful arm clears the state', async () => {
    const { env } = envWithKv();
    await recordArmFailure(env, 7, 1_000);
    await clearArmBackoff(env, 7);
    expect((await backedOffConnections(env, [7], 2_000)).size).toBe(0);
  });

  it('without KV nothing is ever backed off', async () => {
    expect((await backedOffConnections({} as Env, [7], 1)).size).toBe(0);
  });
});
