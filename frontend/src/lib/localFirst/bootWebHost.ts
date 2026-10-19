/**
 * Node-callable web host boot for a denied network.
 *
 * `bootWebPlatformPolicy` no-ops without `window` and only sets policy flags.
 * This boot writes one durable local record into a `LocalFirstStore` the caller
 * keeps, reopens against that same store, and replays one journal batch
 * locally. localStorage is not the durable store: it cannot persist without
 * `window`. The store is
 * `createMemoryLocalFirstStore`, or any `LocalFirstStore` the caller passes
 * into both boots.
 *
 * While `network` is `'denied'`, replay writes a local receipt and does not
 * call platform fetch. The journal row stays, so a later grant can still flush
 * it. This is not `runNetworkDenialScenario` and not a sync coordinator.
 */
import {
  LOCAL_FIRST_POLICY,
  PlatformAccessDenied,
  createGuardedPlatformFetch,
  createMemoryLocalFirstStore,
  createPlatformPolicy,
  newLocalRecord,
  platformSendPermission,
  type LocalFirstStore,
  type PlatformPolicy,
} from '@builderforce/local-first';

export const WEB_REPLAY_KIND = 'web-replay-receipt';

export interface WebDurableRecord {
  id: string;
  title: string;
}

export interface WebReplayResult {
  count: number;
  idempotencyKey: string;
}

export interface BootWebHostOptions {
  network: 'denied';
  /** Same instance across boots. Defaults to a new memory store. */
  store?: LocalFirstStore;
  deviceId?: string;
  now?: () => Date;
  /**
   * Injected platform transport. Never called while the network is denied.
   * The denied path does not read `globalThis.fetch` either.
   */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface WebHostBootStoreOptions extends BootWebHostOptions {
  /** Page policy. Omitted only when the boot is constructed outside the page module. */
  policy?: PlatformPolicy;
}

export interface WebHostBoot {
  readonly store: LocalFirstStore;
  ready(): Promise<void>;
  writeDurable(input: { title: string; id?: string }): Promise<string>;
  readDurable(id: string): Promise<WebDurableRecord | undefined>;
  replayBatch(): Promise<WebReplayResult>;
  stop(): void;
}

function replayRecordId(idempotencyKey: string): string {
  return `replay:${idempotencyKey}`;
}

export function bootWebHostStore(options: WebHostBootStoreOptions): WebHostBoot {
  if (options.network !== 'denied') {
    throw new Error('network_not_denied');
  }
  const store = options.store ?? createMemoryLocalFirstStore();
  const policy = options.policy ?? createPlatformPolicy();
  const send = platformSendPermission(policy);
  const deviceId = options.deviceId ?? 'web-host';
  const now = options.now ?? (() => new Date());
  let stopped = false;
  let denialChecked = false;
  let transportCalls = 0;
  const transport = options.fetch
    ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
  const guarded = createGuardedPlatformFetch({
    policy,
    fetch: async (input, init) => {
      transportCalls += 1;
      return transport(input, init);
    },
  });

  function assertOpen(): void {
    if (stopped) throw new Error('web_host_stopped');
  }

  async function assertDeniedTransport(): Promise<void> {
    if (denialChecked) return;
    denialChecked = true;
    const deniedDefault = policy.snapshot().synchronize === LOCAL_FIRST_POLICY.synchronize && !send.isAllowed();
    if (!deniedDefault) return;
    try {
      await guarded('https://platform.invalid/api/sync/v1/push', { method: 'POST' }, 'synchronize');
      throw new Error('platform_call_performed');
    } catch (error) {
      if (!(error instanceof PlatformAccessDenied)) throw error;
    }
    if (transportCalls !== 0) throw new Error('platform_fetch_ran');
  }

  async function ready(): Promise<void> {
    assertOpen();
    if (options.network !== 'denied') throw new Error('network_not_denied');
    await assertDeniedTransport();
    await store.export();
  }

  async function localReplay(): Promise<WebReplayResult> {
    const pending = await store.read((tx) => tx.pending());
    const first = pending[0];
    if (!first) {
      const prior = await store.read((tx) => tx.list<{ kind?: string; idempotencyKey?: string }>('memory-fact'));
      const receipt = prior.find((row) => row.payload.kind === WEB_REPLAY_KIND && !row.deletedAt);
      return { count: 0, idempotencyKey: receipt?.payload.idempotencyKey ?? '' };
    }
    const idempotencyKey = first.eventId;
    const batch = pending.filter((event) => event.clientEntityId === first.clientEntityId);
    const existing = await store.read((tx) => tx.get<{ kind?: string }>('memory-fact', replayRecordId(idempotencyKey)));
    if (existing && !existing.deletedAt) return { count: 0, idempotencyKey };
    const stamp = now().toISOString();
    const receipt = newLocalRecord({
      id: replayRecordId(idempotencyKey),
      entityType: 'memory-fact',
      payload: {
        kind: WEB_REPLAY_KIND,
        idempotencyKey,
        count: batch.length,
        ids: batch.map((event) => event.eventId),
      },
      deviceId,
      occurredAt: stamp,
    });
    await store.transact(async (tx) => {
      await tx.put(receipt);
    });
    return { count: batch.length, idempotencyKey };
  }

  return {
    store,
    ready,
    async writeDurable(input) {
      await ready();
      const title = input.title.trim();
      if (!title) throw new Error('invalid_title');
      const id = input.id ?? crypto.randomUUID();
      const stamp = now().toISOString();
      const record = newLocalRecord({
        id,
        entityType: 'ticket',
        payload: { title },
        deviceId,
        occurredAt: stamp,
      });
      await store.transact(async (tx) => {
        await tx.put(record);
        await tx.append({
          eventId: `ticket:${id}:v1`,
          clientEntityId: id,
          entityType: 'ticket',
          operation: 'create',
          schemaVersion: record.schemaVersion,
          occurredAt: stamp,
          dependsOn: [],
          destination: record.destination,
          payload: record.payload,
        });
      });
      return id;
    },
    async readDurable(id) {
      await ready();
      const row = await store.read((tx) => tx.get<{ title: string }>('ticket', id));
      if (!row || row.deletedAt) return undefined;
      if (typeof row.payload.title !== 'string' || !row.payload.title.trim()) return undefined;
      return { id: row.id, title: row.payload.title };
    },
    async replayBatch() {
      await ready();
      // Denied network: local receipt only. Do not call `guarded` here — that
      // would be a platform attempt. The denial probe already proved the guard
      // throws before the transport.
      if (options.network === 'denied' || !send.isAllowed() || !policy.allows('synchronize')) {
        if (transportCalls !== 0) throw new Error('platform_fetch_ran');
        return localReplay();
      }
      throw new Error('network_not_denied');
    },
    stop() {
      stopped = true;
    },
  };
}
