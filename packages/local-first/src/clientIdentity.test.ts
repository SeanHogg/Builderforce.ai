import { describe, expect, it, vi } from 'vitest';
import { DEVICE_ID_IS_USER, mintDeviceId } from './deviceIdentity.js';
import {
  CLIENT_IDENTITY_KEY,
  DEVICE_IDENTITY_KEY,
  DEVICE_KEY_REQUIRED,
  IDENTITY_NOT_DURABLE,
  IDENTITY_STORE_REQUIRED,
  LIVE_KEY_KIND_REQUIRED,
  LIVE_KEY_REQUIRED,
  MISSING_CLIENT_ID,
  SERVER_ASSIGNED_ID,
  assertClientIdentity,
  clientEntityId,
  keepClientIdAcrossSync,
  liveClientKey,
  reusedClientId,
  sameIdentityAfterSync,
  serverMappingKey,
  stableClientId,
  stableDeviceId,
  type DurableIdentityStore,
  type LiveContractKind,
} from './clientIdentity.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('client entity identity', () => {
  it('mints a non-empty client id without calling the network', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network_denied'));
    try {
      const id = clientEntityId();

      expect(typeof id).toBe('string');
      expect(id.trim()).not.toBe('');
      expect(id).toMatch(UUID);
      expect(id.startsWith('srv_')).toBe(false);
      // Synchronous: an offline create never waits for a server round trip.
      expect(id).not.toBeInstanceOf(Promise);
      expect(fetchSpy).not.toHaveBeenCalled();
      // Two mints are two entities.
      expect(clientEntityId()).not.toBe(id);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('accepts a client id', () => {
    const id = clientEntityId();
    expect(() => assertClientIdentity({ id })).not.toThrow();
    expect(assertClientIdentity({ id })).toBeUndefined();
    // Extra fields are irrelevant to the rule: a full record passes as-is.
    const record: { id: string; entityType: string; version: number } = { id, entityType: 'ticket', version: 1 };
    expect(() => assertClientIdentity(record)).not.toThrow();
  });

  it('refuses a missing client id with missing_client_id', () => {
    for (const record of [{ id: '' }, { id: '   ' }, { id: null }, {}, undefined, null]) {
      expect(() => assertClientIdentity(record)).toThrow(MISSING_CLIENT_ID);
      expect(() => assertClientIdentity(record)).toThrow(/^missing_client_id$/);
    }
    expect(() => assertClientIdentity({ id: 42 as unknown as string })).toThrow(MISSING_CLIENT_ID);
  });

  it('refuses a server-assigned id with server_assigned_id', () => {
    expect(() => assertClientIdentity({ id: 'srv_1234' })).toThrow(SERVER_ASSIGNED_ID);
    expect(() => assertClientIdentity({ id: 'srv_' })).toThrow(SERVER_ASSIGNED_ID);
    expect(() => assertClientIdentity({ id: 'srv_018f0c2a-1111-4222-8333-444455556666' })).toThrow(SERVER_ASSIGNED_ID);
  });

  it('keeps the same id after sync', () => {
    const id = clientEntityId();
    const before = { id, title: 'offline ticket', version: 1 };
    const after = { id, title: 'offline ticket', version: 2, serverVersion: 1 };

    expect(sameIdentityAfterSync(before, after)).toBe(true);
    expect(sameIdentityAfterSync(before, { ...before })).toBe(true);
    expect(sameIdentityAfterSync({ id }, { id })).toBe(true);
  });

  it('rejects a server remap and any other id change', () => {
    const id = clientEntityId();
    expect(sameIdentityAfterSync({ id }, { id: `srv_9${id}` })).toBe(false);
    expect(sameIdentityAfterSync({ id }, { id: clientEntityId() })).toBe(false);
    expect(sameIdentityAfterSync({ id }, { id: id.toUpperCase() })).toBe(false);
    expect(sameIdentityAfterSync({ id }, {})).toBe(false);
    expect(sameIdentityAfterSync({}, { id })).toBe(false);
    expect(sameIdentityAfterSync(undefined, { id })).toBe(false);
    expect(sameIdentityAfterSync({ id }, undefined)).toBe(false);
    expect(sameIdentityAfterSync({ id: '' }, { id: '' })).toBe(false);
  });

  it('holds the id across a full offline write then sync round trip', () => {
    const id = clientEntityId();
    // Written offline: the record already has its id before any sync.
    const local = { id, entityType: 'ticket', version: 1, payload: { title: 'written offline' } };
    expect(() => assertClientIdentity(local)).not.toThrow();

    // Pushed in a batch and acknowledged by the server.
    const receipt = { eventId: 'ticket:1', status: 'accepted' as const, serverId: 'srv_77' };
    const imported = { ...local, version: 2, serverId: receipt.serverId };

    expect(sameIdentityAfterSync(local, imported)).toBe(true);
    expect(() => assertClientIdentity(imported)).not.toThrow();
    // The server id lives beside the client id, never in place of it.
    expect(imported.serverId.startsWith('srv_')).toBe(true);
  });
});

function memoryStore(seed?: Record<string, string>): {
  store: DurableIdentityStore;
  memory: Map<string, string>;
  sets: string[];
} {
  const memory = new Map(Object.entries(seed ?? {}));
  const sets: string[] = [];
  return {
    memory,
    sets,
    store: {
      get: (key) => memory.get(key),
      set: (key, value) => {
        sets.push(key);
        memory.set(key, value);
      },
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('stable client identity across restart and sync', () => {
  it('reuses one client id across restart and does not write it again', async () => {
    const { store, memory, sets } = memoryStore();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network_denied'));
    try {
      const first = await reusedClientId(store);
      expect(first).toMatch(UUID);
      expect(memory.get(CLIENT_IDENTITY_KEY)).toBe(first);
      expect(sets).toEqual([CLIENT_IDENTITY_KEY]);

      const second = await reusedClientId(store);
      expect(second).toBe(first);
      expect(sets).toEqual([CLIENT_IDENTITY_KEY]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('shares one in-flight client id so a second read is not a second mint', async () => {
    let stored: string | undefined;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    const store: DurableIdentityStore = {
      get: () => stored,
      set: (key, value) => {
        expect(key).toBe(CLIENT_IDENTITY_KEY);
        writes += 1;
        return gate.then(() => {
          stored = value;
        });
      },
    };

    const pending = Promise.all([reusedClientId(store), reusedClientId(store)]);
    await flush();
    expect(writes).toBe(1);
    release();
    const [first, second] = await pending;
    expect(second).toBe(first);
    expect(stored).toBe(first);
    expect(await reusedClientId(store)).toBe(first);
    expect(writes).toBe(1);
  });

  it('reuses run, step, and approval ids across restart and later sync', async () => {
    const { store, memory } = memoryStore();
    const kinds = ['run', 'step', 'approval'] as const;
    const ids = {
      run: await stableClientId(store, 'run', '1'),
      step: await stableClientId(store, 'step', '1'),
      approval: await stableClientId(store, 'approval', '1'),
    };

    expect(new Set(Object.values(ids)).size).toBe(3);
    for (const kind of kinds) {
      expect(await stableClientId(store, kind, '1')).toBe(ids[kind]);
      expect(await keepClientIdAcrossSync(store, kind, '1', `srv_${kind}`)).toBe(ids[kind]);
      expect(await stableClientId(store, kind, '1')).toBe(ids[kind]);
      expect(memory.get(liveClientKey(kind, '1'))).toBe(ids[kind]);
      expect(memory.get(serverMappingKey(kind, '1'))).toBe(`srv_${kind}`);
      expect(sameIdentityAfterSync({ id: ids[kind] }, { id: ids[kind], serverId: `srv_${kind}` })).toBe(true);
    }
  });

  it('refuses a stored server id or numeric id as the live client key', async () => {
    const serverStored = memoryStore({ [liveClientKey('run', '9')]: 'srv_9' });
    await expect(stableClientId(serverStored.store, 'run', '9')).rejects.toThrow(SERVER_ASSIGNED_ID);
    expect(serverStored.sets).toEqual([]);

    const numeric = memoryStore({ [CLIENT_IDENTITY_KEY]: '42' });
    await expect(reusedClientId(numeric.store)).rejects.toThrow(SERVER_ASSIGNED_ID);
    expect(numeric.sets).toEqual([]);
  });

  it('refuses a missing live key, a bad kind, a missing store, and a blank server id', async () => {
    const { store } = memoryStore();
    expect(() => liveClientKey('chat' as LiveContractKind, '1')).toThrow(LIVE_KEY_KIND_REQUIRED);
    expect(() => stableClientId(store, 'nope' as LiveContractKind, '1')).toThrow(LIVE_KEY_KIND_REQUIRED);
    expect(() => stableClientId(store, 'run', '  ')).toThrow(LIVE_KEY_REQUIRED);
    expect(() => reusedClientId(store, '')).toThrow(LIVE_KEY_REQUIRED);
    expect(() => stableDeviceId(null as unknown as DurableIdentityStore)).toThrow(IDENTITY_STORE_REQUIRED);
    await expect(keepClientIdAcrossSync(store, 'step', '1', '   ')).rejects.toThrow(SERVER_ASSIGNED_ID);
  });
});

describe('device id awaited before return', () => {
  it('does not return a device id until persist has resolved and been read back', async () => {
    let stored: string | undefined;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    const store: DurableIdentityStore = {
      get: () => stored,
      set: (_key, value) => {
        writes += 1;
        return gate.then(() => {
          stored = value;
        });
      },
    };

    let settled = false;
    const pending = stableDeviceId(store, 'builderforce.localDeviceId').then(
      (id) => {
        settled = true;
        return id;
      },
      (error: unknown) => {
        settled = true;
        throw error;
      },
    );

    await flush();
    expect(settled).toBe(false);
    expect(writes).toBe(1);
    expect(stored).toBeUndefined();

    release();
    const id = await pending;
    expect(settled).toBe(true);
    expect(stored).toBe(id);
    expect(id.startsWith('dev_')).toBe(true);
    expect(await stableDeviceId(store, 'builderforce.localDeviceId')).toBe(id);
    expect(writes).toBe(1);
  });

  it('does not hand out an id when persist fails, so the next read is the first live id', async () => {
    const crashed = new Set<string>();
    const crashedStore: DurableIdentityStore = {
      get: () => undefined,
      set: async (_key, value) => {
        crashed.add(value);
        throw new Error('crash');
      },
    };
    await expect(stableDeviceId(crashedStore)).rejects.toThrow('crash');
    expect(crashed.size).toBe(1);

    let stored: string | undefined;
    const next: DurableIdentityStore = {
      get: () => stored,
      set: async (_key, value) => {
        stored = value;
      },
    };
    const live = await stableDeviceId(next);
    expect(crashed.has(live)).toBe(false);
    expect(await stableDeviceId(next)).toBe(live);
    expect(stored).toBe(live);
  });

  it('refuses to return an id the store does not confirm after set', async () => {
    const store: DurableIdentityStore = {
      get: () => undefined,
      set: async () => undefined,
    };
    await expect(stableDeviceId(store)).rejects.toThrow(IDENTITY_NOT_DURABLE);
    await expect(stableDeviceId(store)).rejects.toThrow(/^identity_not_durable$/);
  });

  it('returns a stored device id without writing, and refuses the signed-in user', async () => {
    const stored = mintDeviceId();
    const store: DurableIdentityStore = {
      get: async () => stored,
      set: () => {
        throw new Error('must_not_write');
      },
    };
    await expect(stableDeviceId(store, DEVICE_IDENTITY_KEY, 'user-account-a')).resolves.toBe(stored);

    const userStore: DurableIdentityStore = {
      get: () => 'user-account-a',
      set: () => {
        throw new Error('must_not_write');
      },
    };
    await expect(stableDeviceId(userStore, DEVICE_IDENTITY_KEY, 'user-account-a')).rejects.toThrow(DEVICE_ID_IS_USER);
  });

  it('requires a device key and does not call the network', async () => {
    const { store } = memoryStore();
    expect(() => stableDeviceId(store, '   ')).toThrow(DEVICE_KEY_REQUIRED);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network_denied'));
    try {
      const id = await stableDeviceId(store);
      expect(id.startsWith('dev_')).toBe(true);
      expect(await stableDeviceId(store)).toBe(id);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});