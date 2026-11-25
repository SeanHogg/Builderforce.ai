/**
 * THE BLOB STORE — the bytes of a board's media, in a database of their own.
 *
 * The journal database holds records and events; a 200 MB video must never ride its snapshots (or
 * its `local_first_snapshot_corrupt` handling). So the bytes live in `builderforce-canvas-blobs`
 * (object store `blob`, key = media id), and a board's `canvas-media` record is only the manifest.
 * Where the browser has the Origin Private File System (`navigator.storage.getDirectory`), large
 * files and video go there instead and the row keeps only their metadata; the `BlobStore` interface
 * is the same either way.
 *
 * CAPS (decided 2026-11-24): 25 MB per file, 200 MB per video, 500 MB per device partition — the
 * partition cap checked against what the browser says is left (`navigator.storage.estimate()`).
 * Over a cap `put` REFUSES with a `BlobQuotaError` carrying the `quota-exceeded` state the web store
 * already uses (`WebLocalFirstStorageState`); it never stores a smaller copy or an inline data URL.
 *
 * Eviction (a blob whose upload and URL rewrite synced, after a 7-day grace) is the upload queue's
 * decision (`mediaUploadQueue.ts`); this module only stores, reads, deletes and measures.
 */

export const BLOB_DB_NAME = 'builderforce-canvas-blobs';
const BLOB_STORE = 'blob';
const MB = 1024 * 1024;

export const BLOB_CAPS = Object.freeze({
  fileBytes: 25 * MB,
  videoBytes: 200 * MB,
  partitionBytes: 500 * MB,
});

/** At or above this size a blob goes to OPFS, where there is one. */
export const OPFS_THRESHOLD_BYTES = 8 * MB;

export type BlobRefusal = 'file-too-large' | 'video-too-large' | 'partition-full' | 'storage-full';

/** Same vocabulary as `WebLocalFirstStorageState`: the person is told, the add is refused. */
export class BlobQuotaError extends Error {
  readonly state = 'quota-exceeded' as const;
  constructor(readonly reason: BlobRefusal) {
    super(`quota-exceeded: ${reason}`);
    this.name = 'BlobQuotaError';
  }
}

export interface StorageEstimate { quota?: number; usage?: number }

/** Whether a blob of `bytes` may be added, given what this partition already holds. Pure. */
export function admitBlob(
  input: { bytes: number; mimeType: string },
  usageBytes: number,
  estimate?: StorageEstimate,
  caps: typeof BLOB_CAPS = BLOB_CAPS,
): BlobRefusal | undefined {
  const video = input.mimeType.startsWith('video/');
  if (video && input.bytes > caps.videoBytes) return 'video-too-large';
  if (!video && input.bytes > caps.fileBytes) return 'file-too-large';
  if (usageBytes + input.bytes > caps.partitionBytes) return 'partition-full';
  if (estimate?.quota !== undefined && estimate.usage !== undefined && input.bytes > estimate.quota - estimate.usage) return 'storage-full';
  return undefined;
}

export interface StoredBlob {
  id: string;
  bytes: number;
  sha256: string;
  mimeType: string;
}

export interface BlobStore {
  /** Store `blob` under `id` (replacing one); refuses over a cap with `BlobQuotaError`. */
  put(id: string, blob: Blob): Promise<StoredBlob>;
  get(id: string): Promise<Blob | undefined>;
  delete(id: string): Promise<void>;
  /** Bytes held in this partition. */
  usage(): Promise<number>;
  close(): void;
}

/** The slice of OPFS the store uses (a directory handle). */
export interface OpfsDirectory {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
    getFile(): Promise<Blob>;
  }>;
  removeEntry(name: string): Promise<void>;
}

export interface BlobStoreOptions {
  indexedDB: IDBFactory;
  dbName?: string;
  /** `undefined`: the browser's OPFS when it has one. `null`: never use OPFS. */
  opfs?: OpfsDirectory | null;
  estimate?: () => Promise<StorageEstimate | undefined>;
  caps?: typeof BLOB_CAPS;
  opfsThresholdBytes?: number;
  /** SHA-256 hex of the bytes; `crypto.subtle` by default. */
  hash?: (data: ArrayBuffer) => Promise<string>;
}

interface BlobRow {
  id: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  location: 'idb' | 'opfs';
  /**
   * The bytes of an IndexedDB-held blob, as an ArrayBuffer rather than a `Blob`: an ArrayBuffer
   * structured-clones the same everywhere (a `Blob` does not cross realms, which a test host is),
   * and the OPFS path is where large files go.
   */
  data?: ArrayBuffer;
  storedAt: string;
}

const settle = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('blob_store_request_failed'));
  });

const completed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('blob_store_transaction_failed'));
    tx.onabort = () => reject(tx.error ?? new Error('blob_store_transaction_aborted'));
  });

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function browserOpfs(): Promise<OpfsDirectory | undefined> {
  const storage = (globalThis as { navigator?: { storage?: { getDirectory?: () => Promise<OpfsDirectory> } } }).navigator?.storage;
  try {
    return storage?.getDirectory ? await storage.getDirectory() : undefined;
  } catch {
    // OPFS present but refused (a sandboxed frame): the IndexedDB path is the fallback, and nothing is lost.
    return undefined;
  }
}

async function browserEstimate(): Promise<StorageEstimate | undefined> {
  const storage = (globalThis as { navigator?: { storage?: { estimate?: () => Promise<StorageEstimate> } } }).navigator?.storage;
  return storage?.estimate ? storage.estimate() : undefined;
}

export function createBlobStore(options: BlobStoreOptions): BlobStore {
  const caps = options.caps ?? BLOB_CAPS;
  const threshold = options.opfsThresholdBytes ?? OPFS_THRESHOLD_BYTES;
  let opened: Promise<IDBDatabase> | undefined;

  const database = (): Promise<IDBDatabase> => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = options.indexedDB.open(options.dbName ?? BLOB_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(BLOB_STORE)) request.result.createObjectStore(BLOB_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('blob_store_open_failed'));
      request.onblocked = () => reject(new Error('blob_store_open_blocked'));
    }).catch((error: unknown) => {
      opened = undefined;
      throw error;
    });
    return opened;
  };

  const directory = async (): Promise<OpfsDirectory | undefined> => (options.opfs === undefined ? browserOpfs() : options.opfs ?? undefined);

  const row = async (id: string): Promise<BlobRow | undefined> => {
    const tx = (await database()).transaction(BLOB_STORE, 'readonly');
    return settle(tx.objectStore(BLOB_STORE).get(id) as IDBRequest<BlobRow | undefined>);
  };

  const usage = async (): Promise<number> => {
    const tx = (await database()).transaction(BLOB_STORE, 'readonly');
    let total = 0;
    await new Promise<void>((resolve, reject) => {
      const cursor = tx.objectStore(BLOB_STORE).openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) return resolve();
        total += (at.value as BlobRow).bytes;
        at.continue();
      };
      cursor.onerror = () => reject(cursor.error ?? new Error('blob_store_cursor_failed'));
    });
    return total;
  };

  const remove = async (id: string): Promise<void> => {
    const existing = await row(id);
    if (existing?.location === 'opfs') {
      try {
        await (await directory())?.removeEntry(id);
      } catch (error) {
        // An entry already gone is the outcome asked for; anything else is a real failure.
        if (!(error instanceof Error && error.name === 'NotFoundError')) throw error;
      }
    }
    const tx = (await database()).transaction(BLOB_STORE, 'readwrite');
    tx.objectStore(BLOB_STORE).delete(id);
    await completed(tx);
  };

  return {
    async put(id, blob) {
      const mimeType = blob.type || 'application/octet-stream';
      const held = await row(id);
      const refusal = admitBlob({ bytes: blob.size, mimeType }, (await usage()) - (held?.bytes ?? 0), await (options.estimate ?? browserEstimate)(), caps);
      if (refusal) throw new BlobQuotaError(refusal);
      const data = await blob.arrayBuffer();
      const sha256 = await (options.hash ?? sha256Hex)(data);
      const opfs = blob.size >= threshold ? await directory() : undefined;
      if (opfs) {
        const writable = await (await opfs.getFileHandle(id, { create: true })).createWritable();
        await writable.write(blob);
        await writable.close();
      }
      const stored: BlobRow = { id, mimeType, bytes: blob.size, sha256, location: opfs ? 'opfs' : 'idb', ...(opfs ? {} : { data }), storedAt: new Date().toISOString() };
      const tx = (await database()).transaction(BLOB_STORE, 'readwrite');
      tx.objectStore(BLOB_STORE).put(stored);
      await completed(tx);
      return { id, bytes: blob.size, sha256, mimeType };
    },
    async get(id) {
      const found = await row(id);
      if (!found) return undefined;
      if (found.location === 'idb') return found.data ? new Blob([found.data], { type: found.mimeType }) : undefined;
      const handle = await (await directory())?.getFileHandle(id);
      return handle ? handle.getFile() : undefined;
    },
    delete: remove,
    usage,
    close() {
      const pending = opened;
      opened = undefined;
      // A database that never opened has nothing to close; its open failure already reached whoever asked.
      void pending?.then((db) => db.close(), () => undefined);
    },
  };
}
