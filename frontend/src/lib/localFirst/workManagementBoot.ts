/**
 * Web composer for local projects and tickets (review G05).
 *
 * `createLocalWorkManagement` is the use-case library. This module is the
 * composition root that constructs it over the durable IndexedDB store — the
 * same database name, destination partition and device id the web store uses,
 * so a project filed here is the same record a later account bind will see.
 * Nothing here imports a platform client. Where IndexedDB cannot hold the
 * records, boot returns no work API and does not substitute an in-memory map
 * that would claim a save a reload would lose.
 */

import {
  UNBOUND_DESTINATION,
  destinationKey,
  type EntityDestination,
} from '@builderforce/local-first';
import {
  createIndexedDbLocalFirstStore,
  type IndexedDbLocalFirstStore,
} from '@builderforce/local-first/indexed-db';
import { readLocal, writeLocal } from '../storage';
import { createLocalWorkManagement, type LocalWorkManagement } from './workManagement';

/** Same database the web local-first store opens, so the two do not fork. */
export const WEB_LOCAL_WORK_DB_NAME = 'builderforce-local-first';

/** Same key `webLocalFirstDeviceId` writes, so one browser is one device. */
const DEVICE_ID_KEY = 'bf_local_first_device_id';

export type LocalWorkStorageState = 'durable' | 'unavailable' | 'quota-exceeded' | 'corrupt';

export interface LocalWorkBootOptions {
  /** Account/tenant/project binding; unbound until an explicit bind. */
  destination?: EntityDestination;
  /** Injectable for tests; the page's IndexedDB by default. */
  indexedDB?: IDBFactory;
  dbName?: string;
  deviceId?: string;
  newId?: () => string;
}

export interface LocalWorkManagementBoot {
  /** Present only when `storage` is `durable`. */
  work?: LocalWorkManagement;
  store?: IndexedDbLocalFirstStore;
  deviceId: string;
  destination: EntityDestination;
  storage: LocalWorkStorageState;
  close(): void;
}

function deviceIdOf(explicit: string | undefined, newId: () => string): string {
  if (explicit) return explicit;
  const existing = readLocal(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = newId();
  writeLocal(DEVICE_ID_KEY, created);
  return created;
}

function storageState(error: unknown): LocalWorkStorageState {
  const name = error instanceof DOMException ? error.name : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return 'quota-exceeded';
  if (/local_first_snapshot_corrupt/.test(message)) return 'corrupt';
  return 'unavailable';
}

function closed(deviceId: string, destination: EntityDestination, storage: LocalWorkStorageState): LocalWorkManagementBoot {
  return { deviceId, destination, storage, close() {} };
}

/**
 * Open the durable store and hand it to `createLocalWorkManagement`.
 * A missing IndexedDB is a visible unavailable state, not a fake save.
 */
export async function bootLocalWorkManagement(options: LocalWorkBootOptions = {}): Promise<LocalWorkManagementBoot> {
  const destination = options.destination ?? UNBOUND_DESTINATION;
  const deviceId = deviceIdOf(options.deviceId, options.newId ?? (() => crypto.randomUUID()));
  const indexedDB = options.indexedDB ?? (typeof globalThis.indexedDB !== 'undefined' ? globalThis.indexedDB : undefined);
  if (!indexedDB) return closed(deviceId, destination, 'unavailable');

  const store = createIndexedDbLocalFirstStore({
    indexedDB,
    dbName: options.dbName ?? WEB_LOCAL_WORK_DB_NAME,
    partition: destinationKey(destination),
    ownerId: deviceId,
  });
  try {
    await store.export();
  } catch (error) {
    store.close();
    return closed(deviceId, destination, storageState(error));
  }

  return {
    work: createLocalWorkManagement({
      store,
      deviceId,
      destination,
      newId: options.newId,
    }),
    store,
    deviceId,
    destination,
    storage: 'durable',
    close() {
      store.close();
    },
  };
}
