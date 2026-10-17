import { describe, expect, it, vi } from 'vitest';
import type { SnapshotStore } from '@seanhogg/builderforce-webcontainers';
import {
  hasInstalledPackages,
  installOrRestore,
  installSnapshotKey,
  restoreInstalledPackages,
  saveInstalledPackages,
  type SnapshotRuntime,
} from './installSnapshots';

/** An in-memory snapshot store with the package's contract. */
function memoryStore(initial: Record<string, Uint8Array> = {}) {
  const rows = new Map(Object.entries(initial));
  const store: SnapshotStore = {
    load: vi.fn(async (key: string) => rows.get(key)),
    save: vi.fn(async (key: string, zip: Uint8Array) => { rows.set(key, zip); return true; }),
    remove: vi.fn(async (key: string) => { rows.delete(key); }),
    keys: vi.fn(async () => [...rows.keys()]),
  };
  return { store, rows };
}

/** The runtime surface a snapshot touches: an fs listing and the zip pair. */
function fakeRuntime(files: string[] = []) {
  const runtime = {
    fs: { list: () => files },
    exportZip: vi.fn(() => new Uint8Array([1, 2, 3])),
    importZip: vi.fn(),
  };
  return { runtime, asRuntime: runtime as unknown as SnapshotRuntime };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('installSnapshotKey', () => {
  it('keys on the workspace, the manifest and the lockfile', () => {
    const a = installSnapshotKey(7, { 'package.json': '{"a":1}' });
    expect(a).toMatch(/^7:/);
    expect(installSnapshotKey(7, { 'package.json': '{"a":1}' })).toBe(a);
    expect(installSnapshotKey(8, { 'package.json': '{"a":1}' })).not.toBe(a);
    expect(installSnapshotKey(7, { 'package.json': '{"a":2}' })).not.toBe(a);
    expect(installSnapshotKey(7, { 'package.json': '{"a":1}', 'package-lock.json': '{}' })).not.toBe(a);
  });

  it('has no key without a package.json', () => {
    expect(installSnapshotKey(7, {})).toBeNull();
    expect(installSnapshotKey(7, { 'package.json': '' })).toBeNull();
  });
});

describe('hasInstalledPackages', () => {
  it('looks for anything under node_modules', () => {
    expect(hasInstalledPackages(fakeRuntime(['/package.json']).asRuntime)).toBe(false);
    expect(hasInstalledPackages(fakeRuntime(['/node_modules/react/index.js']).asRuntime)).toBe(true);
  });
});

describe('restore / save', () => {
  it('restores a stored snapshot into the runtime', async () => {
    const zip = new Uint8Array([9]);
    const { store } = memoryStore({ k: zip });
    const fake = fakeRuntime();
    expect(await restoreInstalledPackages(fake.asRuntime, 'k', store)).toBe(true);
    expect(fake.runtime.importZip).toHaveBeenCalledWith(zip);
  });

  it('is a miss when nothing is stored, when storage is off, or when the import throws', async () => {
    const fake = fakeRuntime();
    expect(await restoreInstalledPackages(fake.asRuntime, 'k', memoryStore().store)).toBe(false);
    expect(await restoreInstalledPackages(fake.asRuntime, 'k', null)).toBe(false);
    fake.runtime.importZip.mockImplementation(() => { throw new Error('corrupt zip'); });
    expect(await restoreInstalledPackages(fake.asRuntime, 'k', memoryStore({ k: new Uint8Array([1]) }).store)).toBe(false);
  });

  it('saves node_modules and the lockfile, fast', async () => {
    const { store, rows } = memoryStore();
    const fake = fakeRuntime();
    expect(await saveInstalledPackages(fake.asRuntime, 'k', store)).toBe(true);
    expect(fake.runtime.exportZip).toHaveBeenCalledWith({ include: ['node_modules', 'package-lock.json'], level: 1 });
    expect(rows.get('k')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('never throws from a save', async () => {
    const fake = fakeRuntime();
    fake.runtime.exportZip.mockImplementation(() => { throw new Error('out of memory'); });
    expect(await saveInstalledPackages(fake.asRuntime, 'k', memoryStore().store)).toBe(false);
  });
});

describe('installOrRestore', () => {
  it('restores instead of installing on a hit', async () => {
    const { store } = memoryStore({ k: new Uint8Array([4]) });
    const fake = fakeRuntime();
    const install = vi.fn(async () => 0);
    const onRestored = vi.fn();
    expect(await installOrRestore({ runtime: async () => fake.asRuntime, key: 'k', install, onRestored, store })).toBe(0);
    expect(install).not.toHaveBeenCalled();
    expect(onRestored).toHaveBeenCalledOnce();
  });

  it('installs on a miss and keeps the result for next time', async () => {
    const { store, rows } = memoryStore();
    const fake = fakeRuntime();
    const install = vi.fn(async () => 0);
    expect(await installOrRestore({ runtime: async () => fake.asRuntime, key: 'k', install, store })).toBe(0);
    expect(install).toHaveBeenCalledOnce();
    await settle();
    expect(rows.has('k')).toBe(true);
  });

  it('falls back to a normal install when the restore fails, and saves nothing after a failed install', async () => {
    const { store } = memoryStore({ k: new Uint8Array([1]) });
    const fake = fakeRuntime();
    fake.runtime.importZip.mockImplementation(() => { throw new Error('corrupt zip'); });
    const install = vi.fn(async () => 1);
    expect(await installOrRestore({ runtime: async () => fake.asRuntime, key: 'k', install, store })).toBe(1);
    expect(install).toHaveBeenCalledOnce();
    await settle();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('just installs when there is no key or the runtime will not boot', async () => {
    const install = vi.fn(async () => 0);
    const { store } = memoryStore();
    await installOrRestore({ runtime: async () => fakeRuntime().asRuntime, key: null, install, store });
    await installOrRestore({ runtime: async () => { throw new Error('no relay'); }, key: 'k', install, store });
    expect(install).toHaveBeenCalledTimes(2);
    expect(store.load).not.toHaveBeenCalled();
  });
});
