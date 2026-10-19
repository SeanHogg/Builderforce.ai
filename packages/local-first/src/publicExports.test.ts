import { describe, expect, it } from 'vitest';
import {
  LOCAL_FIRST_POLICY,
  PlatformAccessDenied,
  createGuardedPlatformFetch,
  createMemoryLocalFirstStore,
  createPlatformPolicy,
  platformSendPermission,
  type LocalFirstStore,
  type MutablePlatformPolicy,
  type PlatformCapability,
  type PlatformPolicySnapshot,
  type PlatformRequestRecord,
} from './index.js';

describe('@builderforce/local-first public exports', () => {
  it('exports the denied default and a mutable platform policy', () => {
    const policy: MutablePlatformPolicy = createPlatformPolicy();
    const snapshot: PlatformPolicySnapshot = policy.snapshot();
    const capability: PlatformCapability = 'synchronize';
    expect(snapshot).toEqual(LOCAL_FIRST_POLICY);
    expect(Object.values(LOCAL_FIRST_POLICY).every((granted) => granted === false)).toBe(true);
    expect(policy.allows(capability)).toBe(false);
    expect(() => policy.assert(capability)).toThrow(PlatformAccessDenied);
    policy.set({ synchronize: true });
    expect(platformSendPermission(policy).isAllowed()).toBe(true);
  });

  it('blocks a denied platform fetch before the transport is called', async () => {
    const records: PlatformRequestRecord[] = [];
    let called = false;
    const guarded = createGuardedPlatformFetch({
      policy: createPlatformPolicy(),
      fetch: async () => {
        called = true;
        return undefined as unknown as Response;
      },
      onRequest: (record) => records.push(record),
    });
    await expect(guarded('https://example.test/sync', undefined, 'synchronize')).rejects.toBeInstanceOf(PlatformAccessDenied);
    expect(called).toBe(false);
    expect(records).toEqual([
      expect.objectContaining({ capability: 'synchronize', outcome: 'blocked', url: 'https://example.test/sync' }),
    ]);
  });

  it('exports an in-memory LocalFirstStore', async () => {
    const store: LocalFirstStore = createMemoryLocalFirstStore();
    const exported = await store.export();
    expect(exported.records).toEqual([]);
    expect(exported.nextSequence).toBe(1);
    await expect(store.read(async (tx) => tx.list())).resolves.toEqual([]);
  });
});
