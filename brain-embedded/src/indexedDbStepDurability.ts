/**
 * Durable Brain run steps over IndexedDB — the ONE installer for every host that has
 * IndexedDB: a browser tab (the web app) and an MV3 service worker / extension page
 * (the Chrome extension, Rovr).
 *
 * A run's step rows go through the step outbox (`stepOutbox.ts`); installed with this,
 * each chat's queue is kept in ONE IndexedDB database, one partition per queue, so rows
 * a run could not save — the host went offline, the API redeployed, the worker was put
 * to sleep — survive a reload. Every stored queue is drained on install and again each
 * time the host comes back online, straight to its chat's messages endpoint (no run in
 * that chat needed), under the event keys the rows were first sent with (no duplicates).
 *
 * Rows are SCOPED to the identity they were written under (`scope()`): a queue written in
 * one workspace is parked, never replayed into another. `sendRows` re-checks the scope at
 * send time, which closes the window where the identity switches mid-send.
 *
 * Host-neutral: the IndexedDB factory, the connectivity signal, the identity and the
 * sender are injected; nothing here reads `window`, `self` or `chrome`.
 */

import {
  createIndexedDbOutboxStore,
  listIndexedDbOutboxPartitions,
  type OutboxOnlineSignal,
} from '@builderforce/write-outbox';
import { installStepDurability, type StepOutgoingMessage } from './stepOutbox';

export interface IndexedDbStepDurabilityOptions {
  /** `indexedDB` in a tab, `self.indexedDB` in a service worker. */
  indexedDB: IDBFactory;
  /** One database per host, e.g. `builderforce-outbox:brain-steps`. */
  dbName: string;
  /** The host's connectivity — rows wait while offline and replay on reconnect. */
  online: OutboxOnlineSignal;
  /** The identity rows are sent as right now (e.g. `tenant:7`); null = nobody yet. */
  scope(): string | null;
  /** POST rows to a chat's messages endpoint. Throws on failure, with the HTTP `status`
   *  when there was one (a 4xx is dropped, anything else is retried). */
  sendRows(chatId: number, rows: StepOutgoingMessage[]): Promise<unknown>;
}

/** Install IndexedDB-backed step durability for this host and drain what is stored. */
export function installIndexedDbStepDurability(opts: IndexedDbStepDurabilityOptions): void {
  const { indexedDB: factory, dbName } = opts;
  installStepDurability({
    storeFor: (key) => createIndexedDbOutboxStore({ indexedDB: factory, dbName, partition: key }),
    storedKeys: () => listIndexedDbOutboxPartitions({ indexedDB: factory, dbName }),
    sendRows: async (chatId, rows, scope) => {
      if (scope !== undefined && scope !== opts.scope()) {
        throw new Error('step rows parked: not the current identity');
      }
      await opts.sendRows(chatId, rows);
    },
    online: opts.online,
    scope: opts.scope,
  });
}
