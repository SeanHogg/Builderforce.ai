/**
 * The web app's durable local-first store — IndexedDB, through the shared
 * `@builderforce/local-first` adapter the other browser hosts use, so a record
 * committed here carries the same identity, journal and ownership semantics as
 * one committed in Rovr or the editor (review G04/G10/G14/G26).
 *
 * Three rules this module exists to keep honest:
 *
 *   - DURABLE OR VISIBLE, NEVER FAKE. Where IndexedDB is missing (private mode,
 *     a sandboxed frame, a server render), is full, or holds a snapshot that no
 *     longer parses, `openWebLocalFirstStore` says so in its `storage` status and
 *     hands back NO store. It never substitutes an in-memory map that would let
 *     the UI claim work was saved when a reload would lose it.
 *   - OWNED. Every transaction runs under the adapter's IndexedDB lease, so two
 *     tabs of this app cannot interleave a record and its journal event; a
     * contending tab waits its turn rather than fork the history.
 *   - PARTITIONED BY DESTINATION. The store's partition is the destination key of
 *     the account the work belongs to — `unbound` for never-connected work — so
 *     signing into a different account cannot adopt records that are not its own.
 *
 * The device id is this browser profile's stable identity for journal
 * provenance, created once and kept in localStorage (UI-preference scale, the
 * right tool — the records themselves are in IndexedDB).
 */

import {
  UNBOUND_DESTINATION,
  destinationKey,
  type EntityDestination,
} from '@builderforce/local-first';
import {
  createIndexedDbLocalFirstStore,
  createIndexedDbSyncLease,
  type IndexedDbLocalFirstStore,
} from '@builderforce/local-first/indexed-db';
import type { SyncLease } from '@builderforce/local-first';
import { readLocal, writeLocal } from '../storage';

export const WEB_LOCAL_FIRST_DB_NAME = 'builderforce-local-first';

const DEVICE_ID_KEY = 'bf_local_first_device_id';

/** This browser profile's stable device identity for journal provenance. */
export function webLocalFirstDeviceId(newId: () => string = () => crypto.randomUUID()): string {
  const existing = readLocal(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = newId();
  writeLocal(DEVICE_ID_KEY, id);
  return id;
}

/**
 * How durable this browser's storage really is. Every state but `durable` is a
 * setup problem the UI must show — a fake "saved" is the one outcome the
 * local-first contract forbids.
 */
export type WebLocalFirstStorageState = 'durable' | 'unavailable' | 'quota-exceeded' | 'corrupt';

export interface WebLocalFirstStorageStatus {
  state: WebLocalFirstStorageState;
  /** Whether the browser promised to keep the data (navigator.storage.persisted). */
  persisted: boolean;
  detail?: string;
}

/** Classify a storage failure into a visible state. */
export function storageStatusForError(error: unknown): WebLocalFirstStorageState {
  const name = error instanceof DOMException ? error.name : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return 'quota-exceeded';
  if (/local_first_snapshot_corrupt/.test(message)) return 'corrupt';
  return 'unavailable';
}

export interface WebLocalFirstStoreOptions {
  /** The account/tenant/project binding this partition belongs to; unbound by default. */
  destination?: EntityDestination;
  /** Injectable for tests; the page's own IndexedDB by default. */
  indexedDB?: IDBFactory;
  dbName?: string;
  deviceId?: string;
  newId?: () => string;
}

export interface WebLocalFirstStoreHandle {
  /** The durable store, or undefined when `storage.state` is not `durable`. */
  store?: IndexedDbLocalFirstStore;
  /** The cross-tab ownership lease for sync, backed by the same database. */
  lease?: SyncLease;
  storage: WebLocalFirstStorageStatus;
  deviceId: string;
  destination: EntityDestination;
  partition: string;
}

async function persistedGranted(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return false;
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

/**
 * Open the durable store for one destination partition, probing it before any
 * caller can write: the snapshot is READ once, so a corrupt or blocked database
 * reports its real state instead of failing the first save minutes later.
 */
export async function openWebLocalFirstStore(options: WebLocalFirstStoreOptions = {}): Promise<WebLocalFirstStoreHandle> {
  const destination = options.destination ?? UNBOUND_DESTINATION;
  const partition = destinationKey(destination);
  const deviceId = options.deviceId ?? webLocalFirstDeviceId(options.newId);
  const indexedDB = options.indexedDB ?? (typeof globalThis.indexedDB !== 'undefined' ? globalThis.indexedDB : undefined);
  const persisted = await persistedGranted();

  if (!indexedDB) {
    return {
      storage: { state: 'unavailable', persisted, detail: 'indexeddb_missing' },
      deviceId,
      destination,
      partition,
    };
  }

  const storeOptions = {
    indexedDB,
    dbName: options.dbName ?? WEB_LOCAL_FIRST_DB_NAME,
    partition,
    ownerId: deviceId,
  };
  const store = createIndexedDbLocalFirstStore(storeOptions);
  try {
    // The probe: forces the database open and the snapshot read NOW, so every
    // later mutation starts from a store known to load.
    await store.export();
  } catch (error) {
    store.close();
    return {
      storage: { state: storageStatusForError(error), persisted, detail: error instanceof Error ? error.message : String(error) },
      deviceId,
      destination,
      partition,
    };
  }

  return {
    store,
    lease: createIndexedDbSyncLease(storeOptions),
    storage: { state: 'durable', persisted },
    deviceId,
    destination,
    partition,
  };
}
