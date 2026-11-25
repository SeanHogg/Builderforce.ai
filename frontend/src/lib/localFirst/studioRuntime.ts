/**
 * THE STUDIO RUNTIME — the one composition root that puts the Studio on the local-first store.
 *
 * Studio boards are records in the durable IndexedDB store (`openWebLocalFirstStore`); bytes are in
 * the `BlobStore`; the journal leaves the device through the ONE web sync driver
 * (`webSyncDriver.ts`, the same driver work management adopts); local blobs go up through the media
 * upload queue. This module builds those once per page and hands the same instances to everyone, so
 * no surface opens a second store, a second driver or a second queue.
 *
 * Boot order (design §6): open the store, THEN import the legacy `builderforce:create:local-*`
 * boards, THEN start the driver — so the first board open already sees every imported board.
 *
 * ONE partition. The store is opened in the unbound partition for every visitor; a record carries its
 * own destination (unbound for a guest, the workspace's once bound), and the driver pushes only the
 * destination `studioDestination()` names, so a different account never sends or adopts a record that
 * is not its own.
 *
 * DURABLE OR VISIBLE, NEVER FAKE: where IndexedDB cannot hold the records this resolves to
 * `undefined` and `studioStorageStatus()` says why — no in-memory stand-in that would let the UI
 * claim a save a reload would lose.
 */

import { createBlobStore, type BlobStore } from '@/domains/canvas/infrastructure/localFirst/blobStore';
import type { BoardWriteContext } from '@/domains/canvas/infrastructure/localFirst/boardCommit';
import { importLegacyBoards } from '@/domains/canvas/infrastructure/localFirst/legacyBoardImport';
import { createMediaUploadQueue, type MediaUploadQueue } from '@/domains/canvas/infrastructure/localFirst/mediaUploadQueue';
import { reportLocalFirstFailure } from './reportLocalFirstFailure';
import { studioDestination } from '@/lib/pendingWork';
import { openWebLocalFirstStore, type WebLocalFirstStorageStatus } from './store';
import { createWebSyncDriver, type WebSyncDriver } from './webSyncDriver';

export interface StudioRuntime {
  store: NonNullable<Awaited<ReturnType<typeof openWebLocalFirstStore>>['store']>;
  deviceId: string;
  /** What every board write takes: the store and this device's identity. */
  ctx: BoardWriteContext;
  blobs: BlobStore;
  driver: WebSyncDriver;
  queue: MediaUploadQueue;
}

export { studioDestination };

const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

/** The workspace uploads may go to now: the bound Studio destination's tenant, while online. */
function activeTenantId(): string | undefined {
  const destination = studioDestination();
  return destination.kind === 'bound' && isOnline() ? destination.tenantId : undefined;
}

let booting: Promise<StudioRuntime | undefined> | undefined;
let storage: WebLocalFirstStorageStatus | undefined;

async function boot(): Promise<StudioRuntime | undefined> {
  if (typeof window === 'undefined') return undefined;
  const handle = await openWebLocalFirstStore();
  storage = handle.storage;
  const { store } = handle;
  if (!store) {
    reportLocalFirstFailure('studioRuntime.storage', new Error(handle.storage.detail ?? handle.storage.state));
    return undefined;
  }
  const blobs = createBlobStore({ indexedDB: globalThis.indexedDB });
  const ctx: BoardWriteContext = { store, deviceId: handle.deviceId };
  try {
    // Reports each failed board itself and leaves its legacy key in place; only a total failure lands here.
    await importLegacyBoards({ store, blobs, deviceId: handle.deviceId, destination: studioDestination() });
  } catch (error) {
    reportLocalFirstFailure('studioRuntime.legacyImport', error);
  }

  const driver = createWebSyncDriver({ store, deviceId: handle.deviceId, destination: studioDestination, ...(handle.lease ? { lease: handle.lease } : {}) });
  const queue = createMediaUploadQueue({ ctx, blobs, activeTenantId });
  const drain = (): void => { void queue.drain().catch((error: unknown) => reportLocalFirstFailure('studioRuntime.mediaDrain', error)); };
  // A finished round is when new bytes can go up (a bind just made them uploadable).
  driver.subscribe((status) => { if (status.state === 'idle') drain(); });
  driver.start();
  drain();
  void queue.evictUploaded().catch((error: unknown) => reportLocalFirstFailure('studioRuntime.blobEviction', error));
  return { store, deviceId: handle.deviceId, ctx, blobs, driver, queue };
}

/** The page's Studio runtime, booted once; `undefined` where the browser cannot hold it durably. */
export function getStudioRuntime(): Promise<StudioRuntime | undefined> {
  booting ??= boot();
  return booting;
}

/** Why there is no runtime, when there is none (undefined before the first boot settles). */
export function studioStorageStatus(): WebLocalFirstStorageStatus | undefined {
  return storage;
}

/** Test seam: forget the booted runtime so the next call boots a fresh one. */
export async function resetStudioRuntime(): Promise<void> {
  const runtime = await booting?.catch(() => undefined);
  runtime?.driver.stop();
  runtime?.store.close();
  runtime?.blobs.close();
  booting = undefined;
  storage = undefined;
}
