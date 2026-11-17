import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { WEIGHT_DB, createWeightStore } from './weight-store';

/**
 * The weight store must keep serving the multi-GB weights users already have
 * cached. The previous private IDB code wrote RAW ArrayBuffers into
 * `builderforce-studio-weights` v1 / `weights`, keyed by cache key — this
 * pre-populates exactly that and reads it back through the new store.
 */

function seedLegacyDb(factory: IDBFactory, key: string, value: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = factory.open(WEIGHT_DB.dbName, WEIGHT_DB.dbVersion);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(WEIGHT_DB.storeName);
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(WEIGHT_DB.storeName, 'readwrite');
      tx.objectStore(WEIGHT_DB.storeName).put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

describe('weight store (builderforce-studio-weights v1)', () => {
  it('reads a legacy raw-ArrayBuffer value written by the previous cache', async () => {
    const factory = new IDBFactory();
    const legacy = Uint8Array.from([1, 2, 3, 4, 5]).buffer;
    await seedLegacyDb(factory, 'lcm-tiny-sd/unet/model.onnx', legacy);

    const store = createWeightStore(factory);
    const bytes = await store.read('lcm-tiny-sd/unet/model.onnx');

    expect(bytes).not.toBeNull();
    expect(Array.from(new Uint8Array(bytes!))).toEqual([1, 2, 3, 4, 5]);
  });

  it('misses cleanly on an absent key', async () => {
    const store = createWeightStore(new IDBFactory());
    await expect(store.read('nope/model.onnx')).resolves.toBeNull();
  });

  it('round-trips a newly written weight', async () => {
    const store = createWeightStore(new IDBFactory());
    await store.write('sd-turbo/vae_decoder/model.onnx', Uint8Array.from([9, 8, 7]).buffer);
    const bytes = await store.read('sd-turbo/vae_decoder/model.onnx');
    expect(Array.from(new Uint8Array(bytes!))).toEqual([9, 8, 7]);
  });

  it('writes a RAW ArrayBuffer, so older Studio builds still read new writes', async () => {
    const factory = new IDBFactory();
    const store = createWeightStore(factory);
    await store.write('lcm-tiny-sd/unet/model.onnx', Uint8Array.from([4, 2]).buffer);

    const stored = await readRawValue(factory, 'lcm-tiny-sd/unet/model.onnx');
    expect(Object.prototype.toString.call(stored)).toBe('[object ArrayBuffer]');
    expect(Array.from(new Uint8Array(stored as ArrayBuffer))).toEqual([4, 2]);
  });

  it('reports a write as persisted only when the bytes landed', async () => {
    const store = createWeightStore(new IDBFactory());
    expect(store.canPersist()).toBe(true);
    await expect(store.write('lcm-tiny-sd/unet/model.onnx', Uint8Array.from([1]).buffer)).resolves.toBe(true);

    const denied = { open: () => { throw new DOMException('denied', 'SecurityError'); } } as unknown as IDBFactory;
    const broken = createWeightStore(denied);
    await expect(broken.write('lcm-tiny-sd/unet/model.onnx', Uint8Array.from([1]).buffer)).resolves.toBe(false);
  });

  it('reports presence without reading bytes', async () => {
    const store = createWeightStore(new IDBFactory());
    await store.write('lcm-tiny-sd/vae_decoder/model.onnx', Uint8Array.from([1]).buffer);
    await expect(store.has('lcm-tiny-sd/vae_decoder/model.onnx')).resolves.toBe(true);
    await expect(store.has('nope/model.onnx')).resolves.toBe(false);
  });
});

/** The value exactly as IndexedDB holds it — what an older build would read. */
function readRawValue(factory: IDBFactory, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = factory.open(WEIGHT_DB.dbName, WEIGHT_DB.dbVersion);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction(WEIGHT_DB.storeName, 'readonly').objectStore(WEIGHT_DB.storeName).get(key);
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
      get.onerror = () => reject(get.error);
    };
  });
}
