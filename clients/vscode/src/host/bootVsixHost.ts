/**
 * Denied-network VSIX host boot.
 *
 * A scenario calls this without a live extension host, a platform session, or
 * `vscode.ExtensionContext`. The durable store is the SAME journal-backed store
 * activation uses (`createDurableLocalFirstStore`) over `directory` (global
 * storage in the extension). A second boot against the same directory reads the
 * journal back through a new store; a corrupt snapshot cache is moved aside and
 * the open continues from the journal instead of failing activation.
 *
 * The boot itself is the shared `bootDeniedHost` primitive: the deny probe, the
 * stopped flag, and a replay that seals one local batch into a receipt. Replay
 * does not acknowledge the journal and does not call platform fetch, so a later
 * granted sync can still send the same events.
 *
 * Live activation still belongs to `extension.ts`. This module does not import
 * it, and it does not import `vscode`.
 */

import {
  LOCAL_FIRST_POLICY,
  bootDeniedHost,
  createPlatformPolicy,
  localFirstStoreReplayPorts,
  readLocalTicket,
  recordLocalTicket,
  type DeniedReplayResult,
  type LocalFirstStore,
  type LocalTicket,
} from "@builderforce/local-first";
import { createDurableLocalFirstStore, SNAPSHOT_FILE } from "./durableLocalFirstStore";

export const VSIX_LOCAL_SNAPSHOT_FILE = SNAPSHOT_FILE;

/** Receipt rows this boot writes. Local only; a receipt carries no journal event. */
export const VSIX_REPLAY_KIND = "vsix-replay-receipt";

const DEVICE_ID = "vsix-denied-host";

export interface BootVsixHostOptions {
  /** Directory that outlives this process. The next boot must be given the same path. */
  directory: string;
  /** Denied: writes and replays stay on disk. Platform fetch is not called. */
  network: "denied";
}

export type VsixDurableRecord = LocalTicket;
export type VsixReplayBatch = DeniedReplayResult;

export interface VsixHostBoot {
  ready(): Promise<void>;
  /** Write one local record; resolves once it is a journal frame and the cache caught up. Does not fetch. */
  writeDurable(input: { title: string; id?: string }): Promise<string>;
  /** Read a record back from the store this boot opened. */
  readRecord(id: string): Promise<VsixDurableRecord | undefined>;
  /** Replay one pending batch into a local receipt. Does not fetch. */
  replayBatch(): Promise<VsixReplayBatch>;
  /** The store this boot opened. A second boot opens a different store over the same directory. */
  store(): LocalFirstStore;
  stop(): void;
}

export function bootVsixHost(options: BootVsixHostOptions): VsixHostBoot {
  const store = createDurableLocalFirstStore(options.directory);
  const host = bootDeniedHost({
    network: options.network,
    policy: createPlatformPolicy(LOCAL_FIRST_POLICY),
    open: async () => {
      await store.export();
    },
    ...localFirstStoreReplayPorts(store, { kind: VSIX_REPLAY_KIND, deviceId: DEVICE_ID }),
    errors: { notDenied: "vsix_boot_requires_denied_network", stopped: "vsix_boot_stopped" },
  });

  return {
    ready: host.ready,
    async writeDurable(input) {
      host.assertOpen();
      const id = await recordLocalTicket(store, input, { deviceId: DEVICE_ID, idempotencyKeyFor: (ticket) => `event:${ticket}` });
      await store.flush();
      return id;
    },
    async readRecord(id) {
      host.assertOpen();
      return readLocalTicket(store, id);
    },
    replayBatch: host.replayBatch,
    store: () => store,
    stop: host.stop,
  };
}
