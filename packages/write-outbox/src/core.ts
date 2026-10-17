/**
 * The outbox without the browser stores (`./stores.ts` types against `IDBFactory`), for
 * hosts that compile with no DOM lib — the API Worker and its Durable Objects, and the
 * Node agent runtime. Browser hosts import the package root, which re-exports this.
 */
export { createOutbox } from "./outbox.js";
export {
  isPermanentHttpFailure,
  OUTBOX_MAX_ENTRIES,
  OUTBOX_MAX_ITEMS,
  OUTBOX_MAX_WAIT_MS,
  OUTBOX_RETRY_BASE_MS,
  OUTBOX_RETRY_MAX_MS,
} from "./policy.js";
export type {
  Outbox,
  OutboxDrainContext,
  OutboxDrop,
  OutboxEntry,
  OutboxOnlineSignal,
  OutboxOptions,
  OutboxRetryPolicy,
  OutboxSendContext,
  OutboxStats,
  OutboxStore,
} from "./types.js";
