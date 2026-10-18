import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Db } from '../../infrastructure/database/connection';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import { CONNECT_WRITE_THROTTLE_MS, listVscodeConnections, upsertVscodeConnection } from './vscodeConnections';

beforeEach(() => { __clearL1CacheForTests(); });

/** `POST /connect` is ONE upsert on (tenant, user, machine); the list is cached. */

function insertDb() {
  const calls: { values?: unknown; conflict?: { target: unknown; set: Record<string, unknown> } } = {};
  const db = {
    insert: () => ({
      values: (v: unknown) => {
        calls.values = v;
        return { onConflictDoUpdate: async (c: never) => { calls.conflict = c; } };
      },
    }),
  } as unknown as Db;
  return { db, calls };
}

describe('upsertVscodeConnection', () => {
  it('is a single insert-on-conflict that refreshes status, version and heartbeat', async () => {
    const { db, calls } = insertDb();
    await upsertVscodeConnection(db, undefined, { tenantId: 3, userId: 'u1', machineName: 'box', extensionVersion: '1.2.3' });

    expect(calls.values).toEqual({ tenantId: 3, userId: 'u1', machineName: 'box', extensionVersion: '1.2.3' });
    expect(Array.isArray(calls.conflict!.target)).toBe(true);
    expect((calls.conflict!.target as unknown[]).length).toBe(3);
    expect(Object.keys(calls.conflict!.set).sort()).toEqual(['extensionVersion', 'lastSeenAt', 'status']);
    expect(calls.conflict!.set.status).toBe('active');
    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(calls.conflict!.set.extensionVersion as never).sql).toBe('excluded."extension_version"');
  });
});

describe('listVscodeConnections', () => {
  it('serves repeat polls from the cache and an upsert drops it', async () => {
    const kvStore = new Map<string, string>();
    const env = {
      AUTH_CACHE_KV: {
        get: async (k: string) => (kvStore.has(k) ? JSON.parse(kvStore.get(k)!) : null),
        put: async (k: string, v: string) => { kvStore.set(k, v); },
        delete: async (k: string) => { kvStore.delete(k); },
      },
    };
    const limit = vi.fn(async () => [{ id: 1, machineName: 'box' }]);
    const db = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit }) }) }) }),
      insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
    } as unknown as Db;

    await listVscodeConnections(db, env as never, 3);
    await listVscodeConnections(db, env as never, 3);
    expect(limit).toHaveBeenCalledTimes(1);

    await upsertVscodeConnection(db, env as never, { tenantId: 3, userId: 'u1', machineName: 'box', extensionVersion: null });
    await listVscodeConnections(db, env as never, 3);
    expect(limit).toHaveBeenCalledTimes(2);
  });
});

describe('upsertVscodeConnection throttle', () => {
  const input = { tenantId: 9, userId: 'u', machineName: 'm', extensionVersion: '1.0.0' };
  const countingDb = () => {
    const onConflict = vi.fn(async () => undefined);
    const db = { insert: () => ({ values: () => ({ onConflictDoUpdate: onConflict }) }) } as unknown as Db;
    return { db, onConflict };
  };

  it('skips a redundant beat, writes on a version change and after the throttle window', async () => {
    const { db, onConflict } = countingDb();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    expect(await upsertVscodeConnection(db, undefined, input)).toBe(true);
    now.mockReturnValue(1_000_000 + 60_000);
    expect(await upsertVscodeConnection(db, undefined, input)).toBe(false);
    expect(onConflict).toHaveBeenCalledTimes(1);

    expect(await upsertVscodeConnection(db, undefined, { ...input, extensionVersion: '1.0.1' })).toBe(true);
    expect(onConflict).toHaveBeenCalledTimes(2);

    now.mockReturnValue(1_000_000 + 60_000 + CONNECT_WRITE_THROTTLE_MS);
    expect(await upsertVscodeConnection(db, undefined, { ...input, extensionVersion: '1.0.1' })).toBe(true);
    expect(onConflict).toHaveBeenCalledTimes(3);
    now.mockRestore();
  });

  it('drops the list cache only for a new row or version, not a liveness refresh', async () => {
    const kv = new Map<string, string>();
    const env = { AUTH_CACHE_KV: {
      get: async (k: string) => (kv.has(k) ? JSON.parse(kv.get(k)!) : null),
      put: async (k: string, v: string) => { kv.set(k, v); },
      delete: vi.fn(async (k: string) => { kv.delete(k); }),
    } };
    const { db } = countingDb();
    const listKey = 'vscode:connections:9';
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(5_000_000);
    await upsertVscodeConnection(db, env as never, input);
    env.AUTH_CACHE_KV.delete.mockClear();
    now.mockReturnValue(5_000_000 + CONNECT_WRITE_THROTTLE_MS);
    await upsertVscodeConnection(db, env as never, input); // liveness-only write
    expect(env.AUTH_CACHE_KV.delete).not.toHaveBeenCalled();
    await upsertVscodeConnection(db, env as never, { ...input, extensionVersion: '2.0.0' });
    expect(env.AUTH_CACHE_KV.delete.mock.calls.some((c) => String(c[0]).includes(listKey))).toBe(true);
    now.mockRestore();
  });
});
