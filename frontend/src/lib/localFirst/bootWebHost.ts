/**
 * Node-callable web host boot for a denied network.
 *
 * `bootWebPlatformPolicy` no-ops without `window` and only sets policy flags.
 * This boot writes one durable local record into a `LocalFirstStore` the caller
 * keeps, reopens against that same store, and replays one journal batch
 * locally. localStorage is not the durable store: it cannot persist without
 * `window`. The store is `createMemoryLocalFirstStore`, or any
 * `LocalFirstStore` the caller passes into both boots.
 *
 * The boot is the shared `bootDeniedHost` primitive (the same one the VSIX and
 * Rovr hosts use): a deny probe through `createGuardedPlatformFetch`, and a
 * replay that writes a local receipt instead of calling platform fetch. The
 * journal row stays, so a later grant can still flush it. This is not
 * `runNetworkDenialScenario` and not a sync coordinator.
 */
import {
  bootDeniedHost,
  createMemoryLocalFirstStore,
  createPlatformPolicy,
  localFirstStoreReplayPorts,
  readLocalTicket,
  recordLocalTicket,
  type DeniedReplayResult,
  type LocalFirstStore,
  type LocalTicket,
  type PlatformPolicy,
} from '@builderforce/local-first';

export const WEB_REPLAY_KIND = 'web-replay-receipt';

export type WebDurableRecord = LocalTicket;
export type WebReplayResult = DeniedReplayResult;

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

/** A transport that refuses, for a boot given none: the denied path must never reach `globalThis.fetch`. */
const refusingTransport = async (): Promise<Response> => {
  throw new Error('platform_fetch_ran');
};

export function bootWebHostStore(options: WebHostBootStoreOptions): WebHostBoot {
  const store = options.store ?? createMemoryLocalFirstStore();
  const deviceId = options.deviceId ?? 'web-host';
  const now = options.now ?? (() => new Date());
  const host = bootDeniedHost({
    network: options.network,
    policy: options.policy ?? createPlatformPolicy(),
    transport: options.fetch ?? refusingTransport,
    open: async () => {
      await store.export();
    },
    ...localFirstStoreReplayPorts(store, { kind: WEB_REPLAY_KIND, deviceId, now }),
    errors: { notDenied: 'network_not_denied', stopped: 'web_host_stopped' },
  });

  return {
    store,
    ready: host.ready,
    async writeDurable(input) {
      await host.ready();
      return recordLocalTicket(store, input, {
        deviceId,
        now,
        idempotencyKeyFor: (id) => `ticket:${id}:v1`,
        invalidTitle: 'invalid_title',
      });
    },
    async readDurable(id) {
      await host.ready();
      return readLocalTicket(store, id);
    },
    replayBatch: host.replayBatch,
    stop: host.stop,
  };
}
