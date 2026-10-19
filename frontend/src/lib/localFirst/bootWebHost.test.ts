/**
 * Denied-network web boot a node scenario can call. No jsdom: `writeLocal`
 * returns false without `window`, so the durable store is the memory store
 * passed into both boots, not localStorage.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryLocalFirstStore } from '@builderforce/local-first';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeLocal } from '../storage';
import { WEB_REPLAY_KIND } from './bootWebHost';
import { bootWebHost, resetWebPlatformPolicyForTests } from './platformPolicy';

const here = dirname(fileURLToPath(import.meta.url));

describe('bootWebHost', () => {
  beforeEach(() => {
    resetWebPlatformPolicyForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('writes one durable row, reopens the same store, and replays one batch without a platform fetch', async () => {
    expect(typeof globalThis.window).toBe('undefined');
    expect(writeLocal('bf_platform_policy_v1', '{}')).toBe(false);

    const fetchSpy = vi.fn(() => Promise.reject(new Error('platform fetch must not be called')));
    vi.stubGlobal('fetch', fetchSpy);

    const store = createMemoryLocalFirstStore();
    const first = bootWebHost({ network: 'denied', store, fetch: fetchSpy });
    const id = await first.writeDurable({ title: 'Offline web note' });
    first.stop();

    const restarted = bootWebHost({ network: 'denied', store, fetch: fetchSpy });
    expect(await restarted.readDurable(id)).toEqual({ id, title: 'Offline web note' });
    const replayed = await restarted.replayBatch();
    expect(replayed).toEqual({ count: 1, idempotencyKey: `ticket:${id}:v1` });
    expect(fetchSpy).not.toHaveBeenCalled();
    restarted.stop();

    const again = bootWebHost({ network: 'denied', store, fetch: fetchSpy });
    await expect(again.replayBatch()).resolves.toEqual({ count: 0, idempotencyKey: replayed.idempotencyKey });
    expect(await again.readDurable(id)).toEqual({ id, title: 'Offline web note' });
    expect(await store.read((tx) => tx.pending())).toHaveLength(1);
    const snapshot = await store.export();
    expect(snapshot.records.filter((row) => row.entityType === 'ticket')).toHaveLength(1);
    expect(snapshot.records.some((row) => {
      const payload = row.payload as { kind?: string };
      return row.entityType === 'memory-fact' && payload.kind === WEB_REPLAY_KIND;
    })).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();

    const reopened = createMemoryLocalFirstStore(await store.export());
    const fromSnapshot = bootWebHost({ network: 'denied', store: reopened, fetch: fetchSpy });
    expect(await fromSnapshot.readDurable(id)).toEqual({ id, title: 'Offline web note' });
    await expect(fromSnapshot.replayBatch()).resolves.toEqual({ count: 0, idempotencyKey: replayed.idempotencyKey });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('exports the boot from the web policy module and does not use localStorage or the scenario stub', () => {
    const policy = readFileSync(resolve(here, 'platformPolicy.ts'), 'utf8');
    const boot = readFileSync(resolve(here, 'bootWebHost.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(policy).toContain('export function bootWebHost');
    expect(boot).not.toContain('writeLocal');
    expect(boot).not.toContain('runNetworkDenialScenario');
    expect(boot).not.toContain('createSyncCoordinator');
    expect(boot).toContain('createMemoryLocalFirstStore');
    expect(boot).toContain('createGuardedPlatformFetch');
  });
});
