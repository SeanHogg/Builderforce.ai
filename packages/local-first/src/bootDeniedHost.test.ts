import { describe, expect, it, vi } from 'vitest';
import {
  bootDeniedHost,
  localFirstStoreReplayPorts,
  readLocalTicket,
  replayDeniedBatch,
  recordLocalTicket,
  type DeniedReplayReceipt,
} from './bootDeniedHost.js';
import { createPlatformPolicy } from './policy.js';
import { createMemoryLocalFirstStore, isJournalEventId } from './store.js';

describe('bootDeniedHost', () => {
  it('probes the denial without calling the transport, replays locally once, and keeps the pending rows', async () => {
    const transport = vi.fn(async () => new Response('{}'));
    const store = createMemoryLocalFirstStore();
    const ports = localFirstStoreReplayPorts(store, { kind: 'test-replay', deviceId: 'd' });
    const host = bootDeniedHost({ network: 'denied', policy: createPlatformPolicy(), transport, ...ports });

    await host.ready();
    const id = await recordLocalTicket(store, { title: '  Offline  ' }, { deviceId: 'd', idempotencyKeyFor: (ticket) => `event:${ticket}` });
    expect(await readLocalTicket(store, id)).toEqual({ id, title: 'Offline' });
    const [written] = await store.read((tx) => tx.pending());
    // The store mints the wire id; the caller's composite is the idempotency key.
    expect(isJournalEventId(written?.eventId)).toBe(true);
    expect(written?.idempotencyKey).toBe(`event:${id}`);

    await expect(host.replayBatch()).resolves.toEqual({ count: 1, idempotencyKey: `event:${id}` });
    await expect(host.replayBatch()).resolves.toEqual({ count: 0, idempotencyKey: `event:${id}` });
    expect(await store.read((tx) => tx.pending())).toHaveLength(1);
    expect(transport).not.toHaveBeenCalled();
    expect(host.transportCalls()).toBe(0);
  });

  it('refuses a non-denied network and a stopped host with the host vocabulary', async () => {
    const ports = { pending: async () => [], receipts: async () => [], putReceipt: async () => undefined };
    expect(() => bootDeniedHost({ network: 'open' as 'denied', policy: createPlatformPolicy(), ...ports, errors: { notDenied: 'vsix_boot_requires_denied_network' } }))
      .toThrow('vsix_boot_requires_denied_network');
    const onStop = vi.fn();
    const host = bootDeniedHost({ network: 'denied', policy: createPlatformPolicy(), ...ports, errors: { stopped: 'web_host_stopped' }, onStop });
    host.stop();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(() => host.assertOpen()).toThrow('web_host_stopped');
    await expect(host.ready()).rejects.toThrow('web_host_stopped');
  });

  it('seals one group per replay, keyed by the group head, and reports the latest receipt when done', async () => {
    const receipts: DeniedReplayReceipt[] = [];
    const ports = {
      pending: async () => [
        { id: 'a1', group: 'a', idempotencyKey: 'batch-a' },
        { id: 'b1', group: 'b' },
        { id: 'a2', group: 'a' },
      ],
      receipts: async () => receipts,
      putReceipt: async (receipt: DeniedReplayReceipt) => { receipts.push(receipt); },
    };
    await expect(replayDeniedBatch(ports)).resolves.toEqual({ count: 2, idempotencyKey: 'batch-a' });
    await expect(replayDeniedBatch(ports)).resolves.toEqual({ count: 1, idempotencyKey: 'b1' });
    await expect(replayDeniedBatch(ports)).resolves.toEqual({ count: 0, idempotencyKey: 'b1' });
    expect(receipts.map((receipt) => receipt.ids)).toEqual([['a1', 'a2'], ['b1']]);
  });
});
